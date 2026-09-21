\set ON_ERROR_STOP on
\set ua '11111111-1111-1111-1111-111111111111'
\set ub '22222222-2222-2222-2222-222222222222'
\set uc '33333333-3333-3333-3333-333333333333'

create function pg_temp.eq(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FALHOU [%]: obtido %, esperado %', label, actual, expected; end if;
  raise notice 'ok  %', label;
end $$;
create function pg_temp.falha(label text, comando text) returns void language plpgsql as $$
begin
  begin execute comando; exception when others then raise notice 'ok  % (recusado: %)', label, left(sqlerrm, 70); return; end;
  raise exception 'FALHOU [%]: deveria ter sido recusado', label;
end $$;

create function pg_temp.linhas(comando text) returns bigint language plpgsql as $$
declare n bigint; begin execute comando; get diagnostics n = row_count; return n; end $$;

-- usuários (o gatilho grana_handle_new_user cria household + perfil)
insert into auth.users (id, email, raw_user_meta_data) values
  (:'ua', 'a@x.com', '{"nome":"Ana"}'), (:'ub', 'b@x.com', '{"nome":"Bia"}'), (:'uc', 'c@x.com', '{"nome":"Cris"}');
select set_config('t.ha', (select household_id::text from grana_profiles where id = :'ua'), false);
select set_config('t.hb', (select household_id::text from grana_profiles where id = :'ub'), false);
select set_config('t.hc', (select household_id::text from grana_profiles where id = :'uc'), false);

-- ===== como Ana =====
set role authenticated; select set_config('request.jwt.claim.sub', :'ua', false);
insert into grana_contas (household_id, id, banco, apelido, saldo_inicial) values
  (current_setting('t.ha')::uuid, 'c1', 'Inter', 'a', 100000), (current_setting('t.ha')::uuid, 'c2', 'Nubank', 'b', 0);
insert into grana_cartoes (household_id, id, nome, tipo, banco, bandeira, final4, limite_base, fatura_inicial, fechamento, vencimento) values
  (current_setting('t.ha')::uuid, 'k1', 'Cartão', 'crédito', 'Nubank', 'Visa', '1234', 200000, 0, 27, 5);
insert into grana_categorias (household_id, id, nome, tipo) values (current_setting('t.ha')::uuid, 'moradia', 'Moradia', 'despesa');

insert into grana_transacoes (household_id, id, tipo, descricao, valor, data, status, conta_id, cartao_id, conta_origem_id, conta_destino_id) values
  (current_setting('t.ha')::uuid, 't1', 'receita', 'Salário',        5000, '2026-09-05', 'pago',     'c1', null, null, null),
  (current_setting('t.ha')::uuid, 't2', 'despesa', 'Padaria',        1200, '2026-09-06', 'pago',     'c1', null, null, null),
  (current_setting('t.ha')::uuid, 't3', 'despesa', 'Pendente',        999, '2026-09-07', 'pendente', 'c1', null, null, null),
  (current_setting('t.ha')::uuid, 't4', 'transferencia', 'Acerto',   3000, '2026-09-08', 'pago',     null, null, 'c1', 'c2'),
  (current_setting('t.ha')::uuid, 't5', 'despesa', 'Compra crédito', 8000, '2026-09-09', 'pago',     null, 'k1', null, null),
  (current_setting('t.ha')::uuid, 't6', 'pagamento_fatura', 'Fatura', 8000, '2026-09-18', 'pago',   'c1', 'k1', null, null);

-- valores exatamente iguais aos do pacote TypeScript (@grana/core): 100000 + 5000 - 1200 - 3000 - 8000
select pg_temp.eq('saldo c1 derivado (igual ao core TS)', (select saldo from grana_saldos_contas where conta_id='c1'), 92800::bigint);
select pg_temp.eq('saldo c2 derivado', (select saldo from grana_saldos_contas where conta_id='c2'), 3000::bigint);
select pg_temp.eq('fatura k1 quitada', (select fatura from grana_faturas where cartao_id='k1'), 0::bigint);

-- baixa muda o saldo; versão incrementa
update grana_transacoes set status = 'pago' where id = 't3';
select pg_temp.eq('saldo c1 após baixa', (select saldo from grana_saldos_contas where conta_id='c1'), 91801::bigint);
select pg_temp.eq('versao incrementou', (select versao from grana_transacoes where id='t3'), 2);

-- regras do ledger no banco
select pg_temp.falha('valor zero', $$insert into grana_transacoes (household_id,id,tipo,valor,data,conta_id) values (current_setting('t.ha')::uuid,'x1','despesa',0,'2026-09-01','c1')$$);
select pg_temp.falha('valor negativo', $$insert into grana_transacoes (household_id,id,tipo,valor,data,conta_id) values (current_setting('t.ha')::uuid,'x2','despesa',-5,'2026-09-01','c1')$$);
select pg_temp.falha('transferência mesma conta', $$insert into grana_transacoes (household_id,id,tipo,valor,data,conta_origem_id,conta_destino_id) values (current_setting('t.ha')::uuid,'x3','transferencia',10,'2026-09-01','c1','c1')$$);
select pg_temp.falha('pagamento de fatura sem conta', $$insert into grana_transacoes (household_id,id,tipo,valor,data,cartao_id) values (current_setting('t.ha')::uuid,'x4','pagamento_fatura',10,'2026-09-01','k1')$$);
select pg_temp.falha('compra no crédito com conta', $$insert into grana_transacoes (household_id,id,tipo,valor,data,cartao_id,conta_id) values (current_setting('t.ha')::uuid,'x5','despesa',10,'2026-09-01','k1','c1')$$);
select pg_temp.falha('tipo inválido', $$insert into grana_transacoes (household_id,id,tipo,valor,data) values (current_setting('t.ha')::uuid,'x6','pix',10,'2026-09-01')$$);
select pg_temp.falha('vence_dia inválido', $$insert into grana_transacoes (household_id,id,tipo,valor,data,conta_id,vence_dia) values (current_setting('t.ha')::uuid,'x7','despesa',10,'2026-09-01','c1','32')$$);
select pg_temp.falha('conta inexistente (FK)', $$insert into grana_transacoes (household_id,id,tipo,valor,data,conta_id) values (current_setting('t.ha')::uuid,'x8','despesa',10,'2026-09-01','nao-existe')$$);
select pg_temp.falha('cartão de débito com fechamento', $$insert into grana_cartoes (household_id,id,nome,tipo,banco,bandeira,final4,fechamento) values (current_setting('t.ha')::uuid,'d1','D','débito','X','V','1',10)$$);

-- ===== como Bia (outra família) =====
reset role; set role authenticated; select set_config('request.jwt.claim.sub', :'ub', false);
select pg_temp.eq('Bia não vê transações da Ana', (select count(*) from grana_transacoes), 0::bigint);
select pg_temp.eq('Bia não vê saldos da Ana (view security_invoker)', (select count(*) from grana_saldos_contas), 0::bigint);
select pg_temp.eq('Bia não vê faturas da Ana', (select count(*) from grana_faturas), 0::bigint);
select pg_temp.falha('Bia grava na família da Ana', $$insert into grana_contas (household_id,id,banco) values (current_setting('t.ha')::uuid,'zz','Hack')$$);
select pg_temp.eq('Bia não consegue editar contas da Ana (0 linhas visíveis)', pg_temp.linhas($$update grana_contas set banco='Hack' where household_id = current_setting('t.ha')::uuid$$), 0::bigint);
-- mesmo id textual em famílias diferentes é permitido (chave composta)
insert into grana_contas (household_id, id, banco, apelido, saldo_inicial) values (current_setting('t.hb')::uuid, 'c1', 'Itaú', 'da Bia', 777);
select pg_temp.eq('id "c1" da Bia é independente do "c1" da Ana', (select saldo from grana_saldos_contas where conta_id='c1'), 777::bigint);
-- a Bia NÃO consegue apontar para a conta 'c2' que só existe na família da Ana
select pg_temp.falha('FK não cruza famílias', $$insert into grana_transacoes (household_id,id,tipo,valor,data,conta_id) values (current_setting('t.hb')::uuid,'b1','despesa',10,'2026-09-01','c2')$$);
select pg_temp.eq('Bia não consegue apagar dados da Ana', pg_temp.linhas($$delete from grana_transacoes$$), 0::bigint);

-- ===== a Ana continua com tudo intacto =====
reset role; set role authenticated; select set_config('request.jwt.claim.sub', :'ua', false);
select pg_temp.eq('dados da Ana intactos', (select count(*) from grana_transacoes), 6::bigint);

-- ===== migração do estado antigo (JSON em reais) =====
reset role;
update grana_households set estado = $json$
{"categorias":[{"id":"moradia","nome":"Moradia","tipo":"despesa","subs":["Aluguel","Condomínio"]},{"id":"trabalho","nome":"Trabalho","tipo":"receita","subs":["Salário"]},{"id":"dividas","nome":"Dívidas","tipo":"despesa","subs":["Juros do cartão"]}],
 "contas":[{"id":"conta-inter","banco":"Inter","apelido":"cc","saldo":3260.10},{"id":"conta-nu","banco":"Nubank","apelido":"dia","saldo":1450}],
 "cartoes":[{"id":"nu-credito","nome":"Nubank Ultravioleta","tipo":"crédito","banco":"Nubank","bandeira":"Mastercard","final":"4821","limiteBase":6000,"faturaAtual":2340.55,"fechamento":27,"vencimento":5},
            {"id":"inter-debito","nome":"Inter Débito","tipo":"débito","banco":"Inter","bandeira":"Visa","final":"1187","contaId":"conta-inter"}],
 "cofrinhos":[{"id":"viagem","nome":"Viagem","saldo":1200,"meta":8000,"cartaoId":"nu-credito","historico":[{"valor":700.5,"data":"2026-08-05","pessoa":"marina"},{"valor":499.5,"data":"2026-09-02","pessoa":"caio"}]}],
 "transacoes":[
  {"id":"l1","tipo":"despesa","desc":"Padaria","catId":"moradia","sub":"Aluguel","valor":89.90,"data":"2026-09-10","pessoa":"caio","forma":"Pix","contaId":"conta-inter","status":"pago"},
  {"id":"l2","tipo":"despesa","desc":"Netflix","catId":"moradia","sub":"Aluguel","valor":44.9,"data":"2026-09-12","pessoa":"caio","forma":"Crédito","cartaoId":"nu-credito","status":"pago"},
  {"id":"l3","tipo":"receita","desc":"Salário","catId":"trabalho","sub":"Salário","valor":7200,"data":"2026-09-05","pessoa":"caio","forma":"Pix","contaId":"conta-inter","status":"pago"},
  {"id":"l4","tipo":"despesa","desc":"Pendente","catId":"moradia","sub":"Aluguel","valor":310,"data":"2026-09-20","pessoa":"marina","forma":"Pix","contaId":"conta-nu","status":"pendente"},
  {"id":"l5","tipo":"transferencia","desc":"Acerto","valor":200,"data":"2026-09-15","contaOrigemId":"conta-inter","contaDestinoId":"conta-nu","status":"pago"},
  {"id":"l6","tipo":"despesa","desc":"Pagamento fatura Nubank Ultravioleta","catId":"dividas","sub":"Juros do cartão","valor":500,"data":"2026-09-16","pessoa":"caio","forma":"Pix","status":"pago"}],
 "metas":[{"id":"m1","nome":"Viagem","alvo":8000,"atual":1200,"prazo":"2026-12-01","vinculo":null}],
 "investimentos":[{"classe":"Renda Fixa","ativos":[{"id":"i1","nome":"Tesouro","valor":12500.5,"rent":0.012,"data":"2026-03-10"}]}]}
$json$ where id = current_setting('t.hc')::uuid;

select pg_temp.falha('migração recusa pagamento de fatura sem conta de origem', $$select grana_migrar_estado(current_setting('t.hc')::uuid)$$);
select grana_migrar_estado(current_setting('t.hc')::uuid, 'conta-inter');
select pg_temp.eq('saldo conta-inter == app antigo (R$ 3.260,10)', (select saldo from grana_saldos_contas where household_id=current_setting('t.hc')::uuid and conta_id='conta-inter'), 326010::bigint);
select pg_temp.eq('saldo conta-nu == app antigo (R$ 1.450,00)', (select saldo from grana_saldos_contas where household_id=current_setting('t.hc')::uuid and conta_id='conta-nu'), 145000::bigint);
select pg_temp.eq('fatura == app antigo (R$ 2.340,55)', (select fatura from grana_faturas where household_id=current_setting('t.hc')::uuid and cartao_id='nu-credito'), 234055::bigint);
select pg_temp.eq('limite bônus do cofrinho (R$ 1.200,00)', (select bonus_cofrinhos from grana_faturas where household_id=current_setting('t.hc')::uuid and cartao_id='nu-credito'), 120000::bigint);
select pg_temp.eq('pagamento de fatura virou pagamento_fatura', (select tipo from grana_transacoes where id='l6' and household_id=current_setting('t.hc')::uuid), 'pagamento_fatura');
select pg_temp.eq('investimento em centavos e bps', (select valor*1000 + rent_bps from grana_investimentos where id='i1'), 1250050::bigint*1000 + 120);
select pg_temp.eq('pessoa mapeada para o dono', (select pessoa from grana_transacoes where id='l1' and household_id=current_setting('t.hc')::uuid), :'uc'::uuid);
-- idempotência
select grana_migrar_estado(current_setting('t.hc')::uuid, 'conta-inter');
select pg_temp.eq('rodar de novo não duplica transações', (select count(*) from grana_transacoes where household_id=current_setting('t.hc')::uuid), 6::bigint);
select pg_temp.eq('nem aportes', (select count(*) from grana_aportes where household_id=current_setting('t.hc')::uuid), 2::bigint);
select pg_temp.eq('saldo continua igual', (select saldo from grana_saldos_contas where household_id=current_setting('t.hc')::uuid and conta_id='conta-inter'), 326010::bigint);
-- a função de migração não é chamável pelo app
set role authenticated;
select pg_temp.falha('app não pode chamar a migração', $$select grana_migrar_estado(current_setting('t.hc')::uuid, 'x')$$);
reset role;
