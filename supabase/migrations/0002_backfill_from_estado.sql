-- Grana a Dois — migração dos dados do JSON antigo (grana_households.estado) para as tabelas novas.
--
-- Uso (somente com service_role / postgres, NUNCA pelo app):
--   select public.grana_migrar_estado('<household_id>');
--   -- se o estado antigo tiver "Pagamento fatura ..." registrado como despesa (sem conta de origem),
--   -- informe de qual conta ele saiu:
--   select public.grana_migrar_estado('<household_id>', 'conta-inter');
--
-- Garantias:
--  * idempotente por linha (ON CONFLICT DO NOTHING) — rodar de novo não duplica;
--  * saldo_inicial / fatura_inicial / saldo_inicial de cofrinho são calculados para que os valores
--    DERIVADOS (views) batam, centavo a centavo, com os valores que o app antigo mostrava;
--  * nada é descartado em silêncio: o retorno lista o que foi importado e os avisos.

create or replace function public.grana_migrar_estado(p_household uuid, p_conta_padrao text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  e            jsonb;
  v_dono       uuid;
  v_membro     uuid;
  v_avisos     text[] := '{}';
  v_pag_sem_conta int;
  n_cat int; n_conta int; n_cartao int; n_cofr int; n_aporte int; n_tx int; n_meta int; n_inv int;
begin
  select estado into e from grana_households where id = p_household;
  if e is null then raise exception 'household % não encontrado', p_household; end if;

  select id into v_dono   from grana_profiles where household_id = p_household and papel = 'dono' limit 1;
  select id into v_membro from grana_profiles where household_id = p_household and papel <> 'dono' order by created_at limit 1;

  -- pagamentos de fatura do app antigo (despesa "Pagamento fatura X") precisam de uma conta de origem
  select count(*) into v_pag_sem_conta
  from jsonb_array_elements(coalesce(e->'transacoes','[]')) t
  where t->>'tipo' = 'despesa' and t->>'desc' like 'Pagamento fatura %' and t->>'catId' = 'dividas';
  if v_pag_sem_conta > 0 and p_conta_padrao is null then
    raise exception 'O estado tem % pagamento(s) de fatura sem conta de origem. Rode de novo informando a conta: grana_migrar_estado(%, ''<id da conta>'')', v_pag_sem_conta, quote_literal(p_household);
  end if;
  if v_pag_sem_conta > 0 then
    v_avisos := v_avisos || format('%s pagamento(s) de fatura foram debitados da conta %s (o app antigo não registrava a conta).', v_pag_sem_conta, p_conta_padrao);
  end if;

  -- categorias
  insert into grana_categorias (household_id, id, nome, tipo, subs, arquivada)
  select p_household, c->>'id', c->>'nome', c->>'tipo',
         coalesce(array(select jsonb_array_elements_text(coalesce(c->'subs','[]'))), '{}'),
         coalesce((c->>'arquivada')::boolean, false)
  from jsonb_array_elements(coalesce(e->'categorias','[]')) c
  on conflict do nothing;
  get diagnostics n_cat = row_count;

  -- contas (saldo_inicial provisório 0; reconciliado no fim)
  insert into grana_contas (household_id, id, banco, apelido, saldo_inicial)
  select p_household, c->>'id', c->>'banco', coalesce(c->>'apelido','Conta corrente'), 0
  from jsonb_array_elements(coalesce(e->'contas','[]')) c
  on conflict do nothing;
  get diagnostics n_conta = row_count;

  -- cartões
  insert into grana_cartoes (household_id, id, nome, tipo, banco, bandeira, final4, limite_base, fatura_inicial, fechamento, vencimento, conta_id)
  select p_household, c->>'id', c->>'nome', c->>'tipo', c->>'banco', c->>'bandeira', coalesce(c->>'final','0000'),
         round(coalesce((c->>'limiteBase')::numeric, 0) * 100)::bigint, 0,
         (c->>'fechamento')::smallint, (c->>'vencimento')::smallint, c->>'contaId'
  from jsonb_array_elements(coalesce(e->'cartoes','[]')) c
  on conflict do nothing;
  get diagnostics n_cartao = row_count;

  -- cofrinhos (o vínculo com cartão do lado do COFRINHO é o que o app antigo usava no cálculo do limite)
  insert into grana_cofrinhos (household_id, id, nome, meta, saldo_inicial, cartao_id)
  select p_household, c->>'id', c->>'nome', round((c->>'meta')::numeric * 100)::bigint, 0, nullif(c->>'cartaoId','')
  from jsonb_array_elements(coalesce(e->'cofrinhos','[]')) c
  on conflict do nothing;
  get diagnostics n_cofr = row_count;

  insert into grana_aportes (household_id, cofrinho_id, valor, data, pessoa)
  select p_household, c->>'id', round((h->>'valor')::numeric * 100)::bigint, (h->>'data')::date,
         case h->>'pessoa' when 'caio' then v_dono when 'marina' then v_membro end
  from jsonb_array_elements(coalesce(e->'cofrinhos','[]')) c,
       jsonb_array_elements(coalesce(c->'historico','[]')) h
  where (h->>'valor')::numeric > 0
    and exists (select 1 from grana_cofrinhos x where x.household_id = p_household and x.id = c->>'id')
    and not exists (select 1 from grana_aportes a where a.household_id = p_household and a.cofrinho_id = c->>'id'); -- só se ainda não migrou
  get diagnostics n_aporte = row_count;

  -- transações
  insert into grana_transacoes (
    household_id, id, tipo, descricao, valor, data, status, pessoa, categoria_id, subcategoria, fornecedor,
    compartilhada, forma, cartao_id, conta_id, conta_origem_id, conta_destino_id, classificacao_custo,
    recorrencia_id, frequencia, vence_dia, intervalo_dias, valor_variavel, desconto)
  select p_household, t->>'id',
         case when t->>'tipo' = 'despesa' and t->>'desc' like 'Pagamento fatura %' and t->>'catId' = 'dividas'
              then 'pagamento_fatura' else t->>'tipo' end,
         coalesce(t->>'desc',''), round((t->>'valor')::numeric * 100)::bigint, (t->>'data')::date,
         coalesce(t->>'status','pago'),
         case t->>'pessoa' when 'caio' then v_dono when 'marina' then v_membro end,
         case when t->>'desc' like 'Pagamento fatura %' and t->>'catId' = 'dividas' then null else t->>'catId' end,
         case when t->>'desc' like 'Pagamento fatura %' and t->>'catId' = 'dividas' then null else t->>'sub' end,
         t->>'fornecedor', coalesce((t->>'compartilhada')::boolean,false), t->>'forma',
         case when t->>'desc' like 'Pagamento fatura %' and t->>'catId' = 'dividas'
              then (select k->>'id' from jsonb_array_elements(coalesce(e->'cartoes','[]')) k where k->>'nome' = substr(t->>'desc', 18) limit 1)
              else t->>'cartaoId' end,
         case when t->>'desc' like 'Pagamento fatura %' and t->>'catId' = 'dividas' then p_conta_padrao else t->>'contaId' end,
         t->>'contaOrigemId', t->>'contaDestinoId', t->>'classificacaoCusto',
         t->>'recorrenciaId', t->>'frequencia', t->>'venceDia', (t->>'intervaloDias')::integer,
         coalesce((t->>'valorVariavel')::boolean,false), coalesce((t->>'desconto')::boolean,false)
  from jsonb_array_elements(coalesce(e->'transacoes','[]')) t
  on conflict do nothing;
  get diagnostics n_tx = row_count;

  -- metas e investimentos
  insert into grana_metas (household_id, id, nome, alvo, atual, prazo, vinculo)
  select p_household, m->>'id', m->>'nome', round((m->>'alvo')::numeric*100)::bigint, round((m->>'atual')::numeric*100)::bigint, (m->>'prazo')::date, m->>'vinculo'
  from jsonb_array_elements(coalesce(e->'metas','[]')) m
  on conflict do nothing;
  get diagnostics n_meta = row_count;

  insert into grana_investimentos (household_id, id, classe, nome, valor, rent_bps, data)
  select p_household, a->>'id', c->>'classe', a->>'nome', round((a->>'valor')::numeric*100)::bigint,
         round(coalesce((a->>'rent')::numeric,0)*10000)::integer, (a->>'data')::date
  from jsonb_array_elements(coalesce(e->'investimentos','[]')) c, jsonb_array_elements(coalesce(c->'ativos','[]')) a
  on conflict do nothing;
  get diagnostics n_inv = row_count;

  -- RECONCILIAÇÃO: saldo derivado == saldo que o app antigo mostrava
  update grana_contas c
     set saldo_inicial = round(leg.saldo * 100)::bigint - (v.saldo - v.saldo_inicial)
    from (select x->>'id' as id, (x->>'saldo')::numeric as saldo from jsonb_array_elements(coalesce(e->'contas','[]')) x) leg,
         grana_saldos_contas v
   where c.household_id = p_household and c.id = leg.id and v.household_id = c.household_id and v.conta_id = c.id;

  update grana_cartoes k
     set fatura_inicial = round(leg.fatura * 100)::bigint - (v.fatura - k.fatura_inicial)
    from (select x->>'id' as id, coalesce((x->>'faturaAtual')::numeric, 0) as fatura
            from jsonb_array_elements(coalesce(e->'cartoes','[]')) x where x->>'tipo' = 'crédito') leg,
         grana_faturas v
   where k.household_id = p_household and k.id = leg.id and v.household_id = k.household_id and v.cartao_id = k.id;

  update grana_cofrinhos p
     set saldo_inicial = round(leg.saldo * 100)::bigint - coalesce((select sum(a.valor) from grana_aportes a where a.household_id = p.household_id and a.cofrinho_id = p.id), 0)
    from (select x->>'id' as id, (x->>'saldo')::numeric as saldo from jsonb_array_elements(coalesce(e->'cofrinhos','[]')) x) leg
   where p.household_id = p_household and p.id = leg.id;

  return jsonb_build_object(
    'household', p_household,
    'importado', jsonb_build_object('categorias', n_cat, 'contas', n_conta, 'cartoes', n_cartao, 'cofrinhos', n_cofr,
                                    'aportes', n_aporte, 'transacoes', n_tx, 'metas', n_meta, 'investimentos', n_inv),
    'avisos', to_jsonb(v_avisos));
end $$;

revoke all on function public.grana_migrar_estado(uuid, text) from public, anon, authenticated;
