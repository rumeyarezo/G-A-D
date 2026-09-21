-- Simula o mínimo do Supabase + o estado ATUAL das tabelas grana_* (copiado do banco real) para testar as migrations localmente.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
create publication supabase_realtime;
grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;

create table public.grana_households (id uuid primary key default gen_random_uuid(), nome text default 'Minha família', estado jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.grana_profiles (id uuid primary key references auth.users(id), household_id uuid references public.grana_households(id), nome text not null, email text not null, papel text not null default 'membro', created_at timestamptz not null default now());
create table public.grana_convites (id uuid primary key default gen_random_uuid(), household_id uuid not null references public.grana_households(id), email text not null, status text not null default 'pendente', created_at timestamptz not null default now());
alter publication supabase_realtime add table public.grana_households, public.grana_profiles, public.grana_convites;
alter table public.grana_households enable row level security; alter table public.grana_profiles enable row level security; alter table public.grana_convites enable row level security;
grant all on public.grana_households, public.grana_profiles, public.grana_convites to authenticated, anon;

create function public.grana_my_household_id() returns uuid language sql stable security definer set search_path to 'public' as $$ select household_id from public.grana_profiles where id = auth.uid() $$;
create function public.grana_handle_new_user() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_household_id uuid; v_nome text; v_is_first boolean;
begin
  v_nome := coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1));
  select household_id into v_household_id from public.grana_convites where lower(email) = lower(new.email) and status = 'pendente' order by created_at desc limit 1;
  if v_household_id is null then
    insert into public.grana_households (nome) values (v_nome || ' & família') returning id into v_household_id; v_is_first := true;
  else
    update public.grana_convites set status = 'aceito' where household_id = v_household_id and lower(email) = lower(new.email) and status = 'pendente'; v_is_first := false;
  end if;
  insert into public.grana_profiles (id, household_id, nome, email, papel) values (new.id, v_household_id, v_nome, new.email, case when v_is_first then 'dono' else 'membro' end);
  return new;
end $$;
create trigger grana_on_auth_user_created after insert on auth.users for each row execute function public.grana_handle_new_user();

create policy "convites: household delete" on public.grana_convites for delete using (household_id = grana_my_household_id());
create policy "convites: household insert" on public.grana_convites for insert with check (household_id = grana_my_household_id());
create policy "convites: household read" on public.grana_convites for select using (household_id = grana_my_household_id());
create policy "convites: household update" on public.grana_convites for update using (household_id = grana_my_household_id());
create policy "convites: invitee sees own pending invite" on public.grana_convites for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy "household: authenticated can create" on public.grana_households for insert with check (auth.uid() is not null);
create policy "household: members read" on public.grana_households for select using (id = grana_my_household_id());
create policy "household: members update" on public.grana_households for update using (id = grana_my_household_id());
create policy "profiles: dono manages household members" on public.grana_profiles for update using ((household_id = grana_my_household_id()) and exists (select 1 from grana_profiles me where me.id = auth.uid() and me.papel = 'dono')) with check (exists (select 1 from grana_profiles me where me.id = auth.uid() and me.papel = 'dono'));
create policy "profiles: household + self read" on public.grana_profiles for select using ((household_id = grana_my_household_id()) or (id = auth.uid()));
create policy "profiles: self insert" on public.grana_profiles for insert with check (id = auth.uid());
create policy "profiles: self update" on public.grana_profiles for update using (id = auth.uid());
