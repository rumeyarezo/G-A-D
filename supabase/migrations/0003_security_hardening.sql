-- Grana a Dois — endurecimento de segurança.
--
-- ⚠ APLICAR SOMENTE quando o app novo (que usa as funções abaixo) já estiver no ar. O app ANTIGO
--   altera household_id/papel do próprio perfil direto pelo cliente e deixaria de funcionar.
--
-- Problemas corrigidos (achados na auditoria do banco atual):
--  1. "profiles: self update" deixava qualquer usuário editar o PRÓPRIO household_id e papel:
--     um membro podia se promover a "dono" (e então remover o outro) ou tentar entrar em outra família.
--     Agora o cliente só pode alterar o próprio `nome`; entrar/sair/remover passa por funções abaixo.
--  2. "profiles: self insert" permitia criar perfil já apontando para qualquer household.
--     O perfil é criado pelo gatilho grana_handle_new_user; a policy foi removida.
--  3. grana_my_household_id() era executável por usuário NÃO logado (aviso do Supabase advisor).

-- 1) só o nome é editável direto pelo cliente
revoke update on public.grana_profiles from authenticated, anon;
grant  update (nome) on public.grana_profiles to authenticated;

-- 2) sem auto-criação de perfil pelo cliente
drop policy if exists "profiles: self insert" on public.grana_profiles;

-- a policy do dono precisa continuar valendo só para a mesma household (o WITH CHECK antigo não conferia)
drop policy if exists "profiles: dono manages household members" on public.grana_profiles;

-- 3) anon não executa
revoke execute on function public.grana_my_household_id() from public, anon;
grant  execute on function public.grana_my_household_id() to authenticated;

-- ---------- ações controladas ----------

-- Quem ficou sem household (foi removido) cria uma nova, como dono.
create or replace function public.grana_criar_household() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nome text; v_hh uuid;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  select nome into v_nome from grana_profiles where id = v_uid;
  if v_nome is null then raise exception 'perfil não encontrado'; end if;
  if exists (select 1 from grana_profiles where id = v_uid and household_id is not null) then
    raise exception 'você já faz parte de uma conta compartilhada';
  end if;
  insert into grana_households (nome) values (v_nome || ' & família') returning id into v_hh;
  update grana_profiles set household_id = v_hh, papel = 'dono' where id = v_uid;
  return v_hh;
end $$;

-- O dono remove o outro membro (nunca a si mesmo).
create or replace function public.grana_remover_membro(p_membro uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_hh uuid;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  select household_id into v_hh from grana_profiles where id = v_uid and papel = 'dono';
  if v_hh is null then raise exception 'só o dono da conta pode remover membros'; end if;
  if p_membro = v_uid then raise exception 'o dono não pode remover a si mesmo'; end if;
  update grana_profiles set household_id = null, papel = 'membro'
   where id = p_membro and household_id = v_hh;
  if not found then raise exception 'membro não encontrado nesta conta'; end if;
end $$;

-- O membro (não o dono) sai por conta própria.
create or replace function public.grana_sair_da_household() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  update grana_profiles set household_id = null where id = v_uid and papel = 'membro';
  if not found then raise exception 'o dono não pode sair; remova o outro membro ou exclua a conta'; end if;
end $$;

revoke all on function public.grana_criar_household(), public.grana_remover_membro(uuid), public.grana_sair_da_household() from public, anon;
grant execute on function public.grana_criar_household(), public.grana_remover_membro(uuid), public.grana_sair_da_household() to authenticated;
