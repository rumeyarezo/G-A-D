-- Grana a Dois — toda conta nova nasce com as categorias essenciais e NENHUM valor registrado;
-- e o dono pode zerar os dados financeiros da conta (mantendo só as categorias).
--
-- Aditiva: não altera dados existentes (só completa categorias de households que ainda não têm nenhuma).

create or replace function public.grana_categorias_padrao() returns jsonb
language sql immutable as $$ select $j$[{"id": "moradia", "nome": "Moradia", "tipo": "despesa", "subs": ["Aluguel", "Condomínio", "Água", "Energia elétrica", "Gás", "Internet", "IPTU", "Manutenção"]}, {"id": "alimentacao", "nome": "Alimentação", "tipo": "despesa", "subs": ["Supermercado", "Restaurante", "Delivery / iFood", "Padaria", "Café"]}, {"id": "transporte", "nome": "Transporte", "tipo": "despesa", "subs": ["Combustível", "Uber / 99", "Transporte público", "Estacionamento", "IPVA", "Seguro veículo"]}, {"id": "saude", "nome": "Saúde", "tipo": "despesa", "subs": ["Plano de saúde", "Farmácia", "Consultas médicas", "Exames", "Academia", "Terapia"]}, {"id": "educacao", "nome": "Educação", "tipo": "despesa", "subs": ["Mensalidade", "Cursos", "Material escolar", "Livros"]}, {"id": "lazer", "nome": "Lazer", "tipo": "despesa", "subs": ["Streaming", "Viagens", "Shows e eventos", "Bares", "Hobbies"]}, {"id": "compras", "nome": "Compras", "tipo": "despesa", "subs": ["Roupas e calçados", "Eletrônicos", "Casa e decoração", "Presentes"]}, {"id": "assinaturas", "nome": "Assinaturas", "tipo": "despesa", "subs": ["Apps", "Software", "Streaming"]}, {"id": "pets", "nome": "Pets", "tipo": "despesa", "subs": ["Ração", "Veterinário", "Pet shop"]}, {"id": "cuidados", "nome": "Cuidados pessoais", "tipo": "despesa", "subs": ["Salão / barbearia", "Cosméticos", "Estética"]}, {"id": "familia", "nome": "Filhos e família", "tipo": "despesa", "subs": ["Escola", "Brinquedos", "Mesada"]}, {"id": "dividas", "nome": "Dívidas e taxas", "tipo": "despesa", "subs": ["Empréstimo", "Juros do cartão", "Tarifas bancárias", "Impostos / IR"]}, {"id": "doacoes", "nome": "Doações", "tipo": "despesa", "subs": ["Dízimo", "Ofertas", "Caridade"]}, {"id": "outrosd", "nome": "Outros", "tipo": "despesa", "subs": ["Diversos"]}, {"id": "trabalho", "nome": "Trabalho", "tipo": "receita", "subs": ["Salário", "13º salário", "Férias", "Bônus / PLR"]}, {"id": "rendaextra", "nome": "Renda extra", "tipo": "receita", "subs": ["Freelance", "Consultoria", "Venda de produtos"]}, {"id": "rendainvest", "nome": "Rendimentos", "tipo": "receita", "subs": ["Dividendos", "Juros", "Aluguel recebido"]}, {"id": "reembolsos", "nome": "Reembolsos", "tipo": "receita", "subs": ["Reembolso médico", "Restituição de IR"]}, {"id": "presentes", "nome": "Presentes", "tipo": "receita", "subs": ["Presente recebido", "Doação recebida"]}, {"id": "outrosr", "nome": "Outros", "tipo": "receita", "subs": ["Prêmios", "Diversos"]}]$j$::jsonb $$;

create or replace function public.grana_semear_categorias(p_household uuid) returns void
language sql security definer set search_path = public as $$
  insert into grana_categorias (household_id, id, nome, tipo, subs)
  select p_household, c->>'id', c->>'nome', c->>'tipo',
         coalesce(array(select jsonb_array_elements_text(c->'subs')), '{}')
  from jsonb_array_elements(grana_categorias_padrao()) c
  on conflict do nothing
$$;

create or replace function public.grana_households_seed_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform grana_semear_categorias(new.id);
  return new;
end $$;

drop trigger if exists grana_households_seed on public.grana_households;
create trigger grana_households_seed after insert on public.grana_households
  for each row execute function public.grana_households_seed_trg();

-- households já existentes sem nenhuma categoria (ex.: criadas antes desta migração)
select public.grana_semear_categorias(h.id)
from public.grana_households h
where not exists (select 1 from public.grana_categorias c where c.household_id = h.id);

-- Zerar: só o DONO da conta; apaga movimentações e cadastros financeiros, mantém categorias e membros.
create or replace function public.grana_zerar_household() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_hh uuid; n_tx int; n_ap int; n_cofr int; n_cartao int; n_conta int; n_meta int; n_inv int; n_not int;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  select household_id into v_hh from grana_profiles where id = v_uid and papel = 'dono';
  if v_hh is null then raise exception 'só o dono da conta pode zerar os dados'; end if;
  delete from grana_aportes       where household_id = v_hh; get diagnostics n_ap = row_count;
  delete from grana_transacoes    where household_id = v_hh; get diagnostics n_tx = row_count;
  delete from grana_cofrinhos     where household_id = v_hh; get diagnostics n_cofr = row_count;
  delete from grana_cartoes       where household_id = v_hh; get diagnostics n_cartao = row_count;
  delete from grana_contas        where household_id = v_hh; get diagnostics n_conta = row_count;
  delete from grana_metas         where household_id = v_hh; get diagnostics n_meta = row_count;
  delete from grana_investimentos where household_id = v_hh; get diagnostics n_inv = row_count;
  delete from grana_notificacoes  where household_id = v_hh; get diagnostics n_not = row_count;
  return jsonb_build_object('transacoes', n_tx, 'aportes', n_ap, 'cofrinhos', n_cofr, 'cartoes', n_cartao,
                            'contas', n_conta, 'metas', n_meta, 'investimentos', n_inv, 'notificacoes', n_not);
end $$;

revoke all on function public.grana_zerar_household() from public, anon;
grant execute on function public.grana_zerar_household() to authenticated;
revoke all on function public.grana_semear_categorias(uuid), public.grana_households_seed_trg(), public.grana_categorias_padrao() from public, anon, authenticated;
