\set ON_ERROR_STOP on
\set ua '11111111-1111-1111-1111-111111111111'
\set ub '22222222-2222-2222-2222-222222222222'
create function pg_temp.eq(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin if actual is distinct from expected then raise exception 'FALHOU [%]: obtido %, esperado %', label, actual, expected; end if; raise notice 'ok  %', label; end $$;
create function pg_temp.falha(label text, comando text) returns void language plpgsql as $$
begin begin execute comando; exception when others then raise notice 'ok  % (recusado: %)', label, left(sqlerrm, 70); return; end; raise exception 'FALHOU [%]: deveria ter sido recusado', label; end $$;

-- Ana convida a Bia? Simulamos: o convite existe e a Dani (nova) entra na família da Ana pelo gatilho
insert into grana_convites (household_id, email) select household_id, 'dani@x.com' from grana_profiles where id = :'ua';
insert into auth.users (id, email, raw_user_meta_data) values ('44444444-4444-4444-4444-444444444444', 'dani@x.com', '{"nome":"Dani"}');
select pg_temp.eq('Dani entrou na família da Ana como membro', (select papel from grana_profiles where id='44444444-4444-4444-4444-444444444444'), 'membro');

-- ===== ataque: a Dani (membro) tenta virar dona / mudar de família =====
set role authenticated; select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select pg_temp.falha('membro se promove a dono', $$update grana_profiles set papel='dono' where id='44444444-4444-4444-4444-444444444444'$$);
select pg_temp.falha('membro troca de household', $$update grana_profiles set household_id=(select household_id from grana_profiles where id='22222222-2222-2222-2222-222222222222') where id='44444444-4444-4444-4444-444444444444'$$);
select pg_temp.falha('membro remove a dona', $$update grana_profiles set household_id=null where id='11111111-1111-1111-1111-111111111111'$$);
select pg_temp.falha('perfil forjado via insert', $$insert into grana_profiles (id, household_id, nome, email, papel) values (gen_random_uuid(), (select household_id from grana_profiles where id='22222222-2222-2222-2222-222222222222'), 'x','x@x','dono')$$);
update grana_profiles set nome = 'Daniela' where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.eq('membro ainda edita o próprio nome', (select nome from grana_profiles where id='44444444-4444-4444-4444-444444444444'), 'Daniela');
select pg_temp.falha('membro não remove ninguém', $$select grana_remover_membro('11111111-1111-1111-1111-111111111111')$$);
reset role;

-- anon não executa a função de household nem lê nada
set role anon; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.falha('anon não executa grana_my_household_id', $$select grana_my_household_id()$$);
reset role;

-- ===== fluxos legítimos via funções =====
set role authenticated; select set_config('request.jwt.claim.sub', :'ua', false);
select pg_temp.falha('dona não remove a si mesma', $$select grana_remover_membro('11111111-1111-1111-1111-111111111111')$$);
select grana_remover_membro('44444444-4444-4444-4444-444444444444');
reset role;
select pg_temp.eq('Dani ficou sem família', (select household_id is null from grana_profiles where id='44444444-4444-4444-4444-444444444444'), true);

set role authenticated; select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select grana_criar_household();
select pg_temp.eq('Dani cria a própria família e vira dona', (select papel from grana_profiles where id='44444444-4444-4444-4444-444444444444'), 'dono');
select pg_temp.falha('Dani não cria uma segunda família', $$select grana_criar_household()$$);
reset role;
