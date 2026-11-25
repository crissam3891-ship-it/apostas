create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  wallet_id uuid references public.wallets(id),
  amount numeric(12,2) not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
