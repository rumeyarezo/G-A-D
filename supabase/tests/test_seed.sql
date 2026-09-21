\set ON_ERROR_STOP on
create function pg_temp.eq(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin if actual is distinct from expected then raise exception 'FALHOU [%]: obtido %, esperado %', label, actual, expected; end if; raise notice 'ok  %', label; end $$;
create function pg_temp.falha(label text, comando text) returns void language plpgsql as $$
begin begin execute comando; exception when others then raise notice 'ok  % (recusado: %)', label, left(sqlerrm, 70); return; end; raise exception 'FALHOU [%]: deveria ter sido recusado', label; end $$;

-- ===== conta NOVA nasce só com as categorias essenciais e zero valores =====
insert into auth.users (id, email, raw_user_meta_data) values ('55555555-5555-5555-5555-555555555555', 'eva@x.com', '{"nome":"Eva"}');
select set_config('t.he', (select household_id::text from grana_profiles where id='55555555-5555-5555-5555-555555555555'), false);
select pg_temp.eq('conta nova: 20 categorias padrão', (select count(*) from grana_categorias where household_id = current_setting('t.he')::uuid), 20::bigint);
select pg_temp.eq('conta nova: 14 despesa + 6 receita', (select count(*) filter (where tipo='despesa')*100 + count(*) filter (where tipo='receita') from grana_categorias where household_id = current_setting('t.he')::uuid), 1406::bigint);
select pg_temp.eq('conta nova: nenhuma conta', (select count(*) from grana_contas where household_id = current_setting('t.he')::uuid), 0::bigint);
select pg_temp.eq('conta nova: nenhum lançamento', (select count(*) from grana_transacoes where household_id = current_setting('t.he')::uuid), 0::bigint);
select pg_temp.eq('subcategorias vieram (Moradia tem 8)', (select cardinality(subs) from grana_categorias where household_id = current_setting('t.he')::uuid and id='moradia'), 8);

-- convidada entra na mesma família: NÃO duplica categorias
insert into grana_convites (household_id, email) values (current_setting('t.he')::uuid, 'fabi@x.com');
insert into auth.users (id, email, raw_user_meta_data) values ('66666666-6666-6666-6666-666666666666', 'fabi@x.com', '{"nome":"Fabi"}');
select pg_temp.eq('membro convidado não duplica categorias', (select count(*) from grana_categorias where household_id = current_setting('t.he')::uuid), 20::bigint);

-- ===== zerar =====
set role authenticated; select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
insert into grana_contas (household_id, id, banco, apelido, saldo_inicial) values (current_setting('t.he')::uuid, 'e1', 'Nubank', 'Principal', 17650);
insert into grana_transacoes (household_id, id, tipo, descricao, valor, data, status, conta_id) values (current_setting('t.he')::uuid, 'et1', 'despesa', 'Mercado', 500, '2026-09-10', 'pago', 'e1');
select pg_temp.eq('antes de zerar: saldo derivado', (select saldo from grana_saldos_contas where conta_id='e1'), 17150::bigint);
reset role;

set role authenticated; select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
select pg_temp.falha('membro (não dono) não zera', $$select grana_zerar_household()$$);
reset role;
select pg_temp.eq('nada foi apagado pelo membro', (select count(*) from grana_contas where household_id = current_setting('t.he')::uuid), 1::bigint);

set role anon; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.falha('anon não zera', $$select grana_zerar_household()$$);
reset role;

set role authenticated; select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select set_config('t.r', grana_zerar_household()::text, false);
select pg_temp.eq('dono zera: 1 conta e 1 lançamento apagados', (current_setting('t.r')::jsonb->>'contas') || '/' || (current_setting('t.r')::jsonb->>'transacoes'), '1/1');
reset role;
select pg_temp.eq('depois de zerar: sem contas', (select count(*) from grana_contas where household_id = current_setting('t.he')::uuid), 0::bigint);
select pg_temp.eq('depois de zerar: sem lançamentos', (select count(*) from grana_transacoes where household_id = current_setting('t.he')::uuid), 0::bigint);
select pg_temp.eq('depois de zerar: categorias e membros preservados', (select count(*) from grana_categorias where household_id = current_setting('t.he')::uuid), 20::bigint);
select pg_temp.eq('zerar não afeta outra família', (select count(*) from grana_contas where household_id = (select household_id from grana_profiles where id='11111111-1111-1111-1111-111111111111')), 2::bigint);
