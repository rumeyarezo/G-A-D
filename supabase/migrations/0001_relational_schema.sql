-- Grana a Dois — modelo relacional (substitui o JSON único em grana_households.estado)
--
-- Princípios:
--  * dinheiro em CENTAVOS (bigint) — nunca decimal/float;
--  * saldo da conta e fatura do cartão NÃO são colunas: são DERIVADOS por views das transações
--    (mesma regra do pacote @grana/core: só transação PAGA mexe no saldo);
--  * toda linha pertence a um household e só é visível/editável por quem é membro dele (RLS);
--  * cada linha tem `versao` para detectar edição simultânea do casal (ninguém sobrescreve ninguém sem saber).
--
-- Esta migration é ADITIVA: não altera nem apaga nada do que o app atual usa.

create or replace function public.grana_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  new.versao := coalesce(old.versao, 0) + 1;
  return new;
end $$;

-- ---------- categorias ----------
create table public.grana_categorias (
  id            text not null,
  household_id  uuid not null references public.grana_households(id) on delete cascade,
  nome          text not null check (length(btrim(nome)) > 0),
  tipo          text not null check (tipo in ('despesa','receita')),
  subs          text[] not null default '{}',
  arquivada     boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  versao        integer not null default 1,
  primary key (household_id, id)
);

-- ---------- contas ----------
create table public.grana_contas (
  id            text not null,
  household_id  uuid not null references public.grana_households(id) on delete cascade,
  banco         text not null,
  apelido       text not null default 'Conta corrente',
  saldo_inicial bigint not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  versao        integer not null default 1,
  primary key (household_id, id)
);

-- ---------- cartões ----------
create table public.grana_cartoes (
  id             text not null,
  household_id   uuid not null references public.grana_households(id) on delete cascade,
  nome           text not null,
  tipo           text not null check (tipo in ('crédito','débito')),
  banco          text not null,
  bandeira       text not null,
  final4         text not null,
  limite_base    bigint not null default 0 check (limite_base >= 0),
  fatura_inicial bigint not null default 0,
  fechamento     smallint check (fechamento between 1 and 31),
  vencimento     smallint check (vencimento between 1 and 31),
  conta_id       text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  versao         integer not null default 1,
  check (tipo = 'crédito' or (fechamento is null and vencimento is null)),
  primary key (household_id, id)
);

-- ---------- cofrinhos e aportes ----------
create table public.grana_cofrinhos (
  id            text not null,
  household_id  uuid not null references public.grana_households(id) on delete cascade,
  nome          text not null,
  meta          bigint not null check (meta > 0),
  saldo_inicial bigint not null default 0,
  cartao_id     text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  versao        integer not null default 1,
  primary key (household_id, id)
);

create table public.grana_aportes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.grana_households(id) on delete cascade,
  cofrinho_id  text not null,
  valor        bigint not null check (valor > 0),
  data         date not null,
  pessoa       uuid references public.grana_profiles(id) on delete set null,
  conta_id     text,
  criado_em    timestamptz not null default now()
);

-- ---------- transações ----------
create table public.grana_transacoes (
  id                  text not null,
  household_id        uuid not null references public.grana_households(id) on delete cascade,
  tipo                text not null check (tipo in ('despesa','receita','transferencia','pagamento_fatura')),
  descricao           text not null default '',
  valor               bigint not null check (valor > 0),
  data                date not null,
  status              text not null default 'pago' check (status in ('pago','pendente','atrasado')),
  pessoa              uuid references public.grana_profiles(id) on delete set null,
  categoria_id        text,
  subcategoria        text,
  fornecedor          text,
  compartilhada       boolean not null default false,
  forma               text,
  cartao_id           text,
  conta_id            text,
  conta_origem_id     text,
  conta_destino_id    text,
  classificacao_custo text check (classificacao_custo in ('essencial','ajustavel','fora','confirmar')),
  recorrencia_id      text,
  frequencia          text check (frequencia in ('semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','personalizado')),
  vence_dia           text check (vence_dia is null or vence_dia = 'ultimo' or vence_dia ~ '^([1-9]|[12][0-9]|3[01])$'),
  intervalo_dias      integer check (intervalo_dias is null or intervalo_dias > 0),
  valor_variavel      boolean not null default false,
  desconto            boolean not null default false,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  versao              integer not null default 1,

  -- regras do ledger, garantidas pelo banco (não só pelo app)
  constraint transferencia_completa check (
    tipo <> 'transferencia'
    or (conta_origem_id is not null and conta_destino_id is not null and conta_origem_id <> conta_destino_id)),
  constraint pagamento_fatura_completo check (
    tipo <> 'pagamento_fatura' or (cartao_id is not null and conta_id is not null)),
  constraint compra_credito_sem_conta check (
    not (tipo = 'despesa' and cartao_id is not null and conta_id is not null)),
  primary key (household_id, id)
);

create index grana_transacoes_household_data on public.grana_transacoes (household_id, data desc);
create index grana_transacoes_conta on public.grana_transacoes (conta_id) where conta_id is not null;
create index grana_transacoes_cartao on public.grana_transacoes (cartao_id) where cartao_id is not null;
create index grana_transacoes_recorrencia on public.grana_transacoes (recorrencia_id) where recorrencia_id is not null;

-- ---------- metas e investimentos ----------
create table public.grana_metas (
  id            text not null,
  household_id  uuid not null references public.grana_households(id) on delete cascade,
  nome          text not null,
  alvo          bigint not null check (alvo > 0),
  atual         bigint not null default 0 check (atual >= 0),
  prazo         date not null,
  vinculo       text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  versao        integer not null default 1,
  primary key (household_id, id)
);

create table public.grana_investimentos (
  id            text not null,
  household_id  uuid not null references public.grana_households(id) on delete cascade,
  classe        text not null,
  nome          text not null,
  valor         bigint not null check (valor >= 0),
  rent_bps      integer not null default 0,            -- rentabilidade no mês em pontos-base (120 = 1,20%)
  data          date not null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  versao        integer not null default 1,
  primary key (household_id, id)
);

create table public.grana_notificacoes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.grana_households(id) on delete cascade,
  tipo         text not null check (tipo in ('good','bad')),
  texto        text not null,
  lida         boolean not null default false,
  criado_em    timestamptz not null default now()
);


-- ---------- chaves estrangeiras COMPOSTAS: uma linha nunca aponta para outro household ----------
alter table public.grana_cartoes
  add foreign key (household_id, conta_id) references public.grana_contas (household_id, id) on delete set null (conta_id);
alter table public.grana_cofrinhos
  add foreign key (household_id, cartao_id) references public.grana_cartoes (household_id, id) on delete set null (cartao_id);
alter table public.grana_aportes
  add foreign key (household_id, cofrinho_id) references public.grana_cofrinhos (household_id, id) on delete cascade,
  add foreign key (household_id, conta_id) references public.grana_contas (household_id, id) on delete set null (conta_id);
alter table public.grana_transacoes
  add foreign key (household_id, categoria_id)     references public.grana_categorias (household_id, id) on delete set null (categoria_id),
  add foreign key (household_id, cartao_id)        references public.grana_cartoes (household_id, id)    on delete set null (cartao_id),
  add foreign key (household_id, conta_id)         references public.grana_contas (household_id, id)     on delete set null (conta_id),
  add foreign key (household_id, conta_origem_id)  references public.grana_contas (household_id, id)     on delete set null (conta_origem_id),
  add foreign key (household_id, conta_destino_id) references public.grana_contas (household_id, id)     on delete set null (conta_destino_id);

-- versão + carimbo automáticos em toda edição
do $$
declare t text;
begin
  foreach t in array array['grana_categorias','grana_contas','grana_cartoes','grana_cofrinhos','grana_transacoes','grana_metas','grana_investimentos']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.grana_touch()', t || '_touch', t);
  end loop;
end $$;

-- ---------- RLS: só o casal enxerga e mexe no que é do casal ----------
do $$
declare t text;
begin
  foreach t in array array['grana_categorias','grana_contas','grana_cartoes','grana_cofrinhos','grana_aportes','grana_transacoes','grana_metas','grana_investimentos','grana_notificacoes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                      using (household_id = public.grana_my_household_id())
                      with check (household_id = public.grana_my_household_id())$p$, t || ': household', t);
  end loop;
end $$;

-- ---------- saldo e fatura DERIVADOS (security_invoker: respeitam a RLS de quem consulta) ----------
create view public.grana_saldos_contas with (security_invoker = true) as
select c.id as conta_id, c.household_id, c.banco, c.apelido, c.saldo_inicial,
       c.saldo_inicial + coalesce(sum(
         case
           when t.status <> 'pago'                                              then 0
           when t.tipo = 'receita'          and t.conta_id = c.id                then  t.valor
           when t.tipo = 'despesa'          and t.conta_id = c.id and t.cartao_id is null then -t.valor
           when t.tipo = 'pagamento_fatura' and t.conta_id = c.id                then -t.valor
           when t.tipo = 'transferencia'    and t.conta_destino_id = c.id        then  t.valor
           when t.tipo = 'transferencia'    and t.conta_origem_id  = c.id        then -t.valor
           else 0
         end), 0)::bigint as saldo
from public.grana_contas c
left join public.grana_transacoes t
  on t.household_id = c.household_id
 and (t.conta_id = c.id or t.conta_origem_id = c.id or t.conta_destino_id = c.id)
group by c.household_id, c.id;

create view public.grana_faturas with (security_invoker = true) as
select k.id as cartao_id, k.household_id, k.nome, k.limite_base,
       k.fatura_inicial + coalesce(sum(
         case
           when t.status <> 'pago'           then 0
           when t.tipo = 'despesa'           then  t.valor
           when t.tipo = 'pagamento_fatura'  then -t.valor
           else 0
         end), 0)::bigint as fatura,
       coalesce((select sum(p.saldo_inicial + coalesce((select sum(a.valor) from public.grana_aportes a where a.household_id = p.household_id and a.cofrinho_id = p.id), 0))
                   from public.grana_cofrinhos p where p.household_id = k.household_id and p.cartao_id = k.id), 0)::bigint as bonus_cofrinhos
from public.grana_cartoes k
left join public.grana_transacoes t on t.cartao_id = k.id and t.household_id = k.household_id
where k.tipo = 'crédito'
group by k.household_id, k.id;

grant select on public.grana_saldos_contas, public.grana_faturas to authenticated;

-- realtime para o casal ver as alterações um do outro ao vivo
alter publication supabase_realtime add table
  public.grana_transacoes, public.grana_contas, public.grana_cartoes, public.grana_cofrinhos,
  public.grana_aportes, public.grana_metas, public.grana_investimentos, public.grana_categorias, public.grana_notificacoes;
