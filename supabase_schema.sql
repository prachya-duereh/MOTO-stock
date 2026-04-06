


create extension if not exists pgcrypto;



create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- ITEMS
-- =========================
create table if not exists public.items (
  id bigint primary key,
  name text not null default '',
  barcode text not null default '',
  category text not null default '',
  model text not null default '',
  year text not null default '',
  quantity integer not null default 0,
  retail_price numeric(12,2) not null default 0,
  wholesale_price numeric(12,2) not null default 0,
  mechanic_price numeric(12,2) not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.items
  add column if not exists name text not null default '',
  add column if not exists barcode text not null default '',
  add column if not exists category text not null default '',
  add column if not exists model text not null default '',
  add column if not exists year text not null default '',
  add column if not exists quantity integer not null default 0,
  add column if not exists retail_price numeric(12,2) not null default 0,
  add column if not exists wholesale_price numeric(12,2) not null default 0,
  add column if not exists mechanic_price numeric(12,2) not null default 0,
  add column if not exists note text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- รองรับชื่อคอลัมน์แบบเก่า camelCase
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'items' and column_name = 'retailprice'
  ) then
    execute 'update public.items set retail_price = coalesce(retail_price, retailprice, 0)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'items' and column_name = 'wholesaleprice'
  ) then
    execute 'update public.items set wholesale_price = coalesce(wholesale_price, wholesaleprice, 0)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'items' and column_name = 'mechanicprice'
  ) then
    execute 'update public.items set mechanic_price = coalesce(mechanic_price, mechanicprice, 0)';
  end if;
end $$;

create unique index if not exists idx_items_barcode_unique
on public.items (barcode)
where barcode <> '';

create index if not exists idx_items_name on public.items (name);
create index if not exists idx_items_category on public.items (category);
create index if not exists idx_items_model on public.items (model);
create index if not exists idx_items_created_at on public.items (created_at desc);

drop trigger if exists trg_items_updated_at on public.items;
create trigger trg_items_updated_at
before update on public.items
for each row
execute function public.set_updated_at();

-- =========================
-- REPAIRS
-- =========================
create table if not exists public.repairs (
  id bigint primary key,
  customer_name text not null default '',
  phone text not null default '',
  bike_model text not null default '',
  plate text not null default '',
  repair_date date,
  symptom text not null default '',
  parts jsonb not null default '[]'::jsonb,
  repair_price_type text not null default 'mechanic',
  labor_cost numeric(12,2) not null default 0,
  parts_cost numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.repairs
  add column if not exists customer_name text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists bike_model text not null default '',
  add column if not exists plate text not null default '',
  add column if not exists repair_date date,
  add column if not exists symptom text not null default '',
  add column if not exists parts jsonb not null default '[]'::jsonb,
  add column if not exists repair_price_type text not null default 'mechanic',
  add column if not exists labor_cost numeric(12,2) not null default 0,
  add column if not exists parts_cost numeric(12,2) not null default 0,
  add column if not exists total numeric(12,2) not null default 0,
  add column if not exists note text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- รองรับชื่อคอลัมน์แบบเก่า camelCase
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'repairs' and column_name = 'customername'
  ) then
    execute 'update public.repairs set customer_name = coalesce(customer_name, customername, '''')';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'repairs' and column_name = 'bikemodel'
  ) then
    execute 'update public.repairs set bike_model = coalesce(bike_model, bikemodel, '''')';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'repairs' and column_name = 'repairdate'
  ) then
    execute 'update public.repairs set repair_date = coalesce(repair_date, repairdate)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'repairs' and column_name = 'repairpricetype'
  ) then
    execute 'update public.repairs set repair_price_type = coalesce(repair_price_type, repairpricetype, ''mechanic'')';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'repairs' and column_name = 'laborcost'
  ) then
    execute 'update public.repairs set labor_cost = coalesce(labor_cost, laborcost, 0)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'repairs' and column_name = 'partscost'
  ) then
    execute 'update public.repairs set parts_cost = coalesce(parts_cost, partscost, 0)';
  end if;
end $$;

create index if not exists idx_repairs_customer_name on public.repairs (customer_name);
create index if not exists idx_repairs_phone on public.repairs (phone);
create index if not exists idx_repairs_plate on public.repairs (plate);
create index if not exists idx_repairs_repair_date on public.repairs (repair_date desc);
create index if not exists idx_repairs_created_at on public.repairs (created_at desc);

drop trigger if exists trg_repairs_updated_at on public.repairs;
create trigger trg_repairs_updated_at
before update on public.repairs
for each row
execute function public.set_updated_at();

-- =========================
-- SALES
-- =========================
create table if not exists public.sales (
  id bigint primary key,
  customer_name text not null default '',
  payment_method text not null default 'cash',
  items jsonb not null default '[]'::jsonb,
  price_type text not null default 'retail',
  items_total numeric(12,2) not null default 0,
  labor_cost numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  change_amount numeric(12,2) not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales
  add column if not exists customer_name text not null default '',
  add column if not exists payment_method text not null default 'cash',
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists price_type text not null default 'retail',
  add column if not exists items_total numeric(12,2) not null default 0,
  add column if not exists labor_cost numeric(12,2) not null default 0,
  add column if not exists total numeric(12,2) not null default 0,
  add column if not exists paid_amount numeric(12,2) not null default 0,
  add column if not exists change_amount numeric(12,2) not null default 0,
  add column if not exists note text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- รองรับชื่อคอลัมน์เก่า
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'customername'
  ) then
    execute 'update public.sales set customer_name = coalesce(customer_name, customername, '''')';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'pricetype'
  ) then
    execute 'update public.sales set price_type = coalesce(price_type, pricetype, ''retail'')';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'itemstotal'
  ) then
    execute 'update public.sales set items_total = coalesce(items_total, itemstotal, 0)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'laborcost'
  ) then
    execute 'update public.sales set labor_cost = coalesce(labor_cost, laborcost, 0)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'paidamount'
  ) then
    execute 'update public.sales set paid_amount = coalesce(paid_amount, paidamount, 0)';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'changeamount'
  ) then
    execute 'update public.sales set change_amount = coalesce(change_amount, changeamount, 0)';
  end if;
end $$;

create index if not exists idx_sales_created_at on public.sales (created_at desc);
create index if not exists idx_sales_customer_name on public.sales (customer_name);
create index if not exists idx_sales_price_type on public.sales (price_type);

drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at
before update on public.sales
for each row
execute function public.set_updated_at();

-- =========================
-- ค่า default / clean data
-- =========================
update public.items
set
  name = coalesce(name, ''),
  barcode = coalesce(barcode, ''),
  category = coalesce(category, ''),
  model = coalesce(model, ''),
  year = coalesce(year, ''),
  quantity = coalesce(quantity, 0),
  retail_price = coalesce(retail_price, 0),
  wholesale_price = coalesce(wholesale_price, 0),
  mechanic_price = coalesce(mechanic_price, 0),
  note = coalesce(note, ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

update public.repairs
set
  customer_name = coalesce(customer_name, ''),
  phone = coalesce(phone, ''),
  bike_model = coalesce(bike_model, ''),
  plate = coalesce(plate, ''),
  symptom = coalesce(symptom, ''),
  parts = coalesce(parts, '[]'::jsonb),
  repair_price_type = coalesce(repair_price_type, 'mechanic'),
  labor_cost = coalesce(labor_cost, 0),
  parts_cost = coalesce(parts_cost, 0),
  total = coalesce(total, coalesce(parts_cost, 0) + coalesce(labor_cost, 0)),
  note = coalesce(note, ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

update public.sales
set
  customer_name = coalesce(customer_name, ''),
  payment_method = coalesce(payment_method, 'cash'),
  items = coalesce(items, '[]'::jsonb),
  price_type = coalesce(price_type, 'retail'),
  items_total = coalesce(items_total, 0),
  labor_cost = coalesce(labor_cost, 0),
  total = coalesce(total, coalesce(items_total, 0) + coalesce(labor_cost, 0)),
  paid_amount = coalesce(paid_amount, 0),
  change_amount = coalesce(change_amount, 0),
  note = coalesce(note, ''),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

-- =========================
-- RLS
-- =========================
alter table public.items enable row level security;
alter table public.repairs enable row level security;
alter table public.sales enable row level security;

-- =========================
-- POLICIES: ITEMS
-- =========================
drop policy if exists "Allow read items" on public.items;
create policy "Allow read items"
on public.items
for select
using (true);

drop policy if exists "Allow insert items" on public.items;
create policy "Allow insert items"
on public.items
for insert
with check (true);

drop policy if exists "Allow update items" on public.items;
create policy "Allow update items"
on public.items
for update
using (true)
with check (true);

drop policy if exists "Allow delete items" on public.items;
create policy "Allow delete items"
on public.items
for delete
using (true);

-- =========================
-- POLICIES: REPAIRS
-- =========================
drop policy if exists "Allow read repairs" on public.repairs;
create policy "Allow read repairs"
on public.repairs
for select
using (true);

drop policy if exists "Allow insert repairs" on public.repairs;
create policy "Allow insert repairs"
on public.repairs
for insert
with check (true);

drop policy if exists "Allow update repairs" on public.repairs;
create policy "Allow update repairs"
on public.repairs
for update
using (true)
with check (true);

drop policy if exists "Allow delete repairs" on public.repairs;
create policy "Allow delete repairs"
on public.repairs
for delete
using (true);

-- =========================
-- POLICIES: SALES
-- =========================
drop policy if exists "Allow read sales" on public.sales;
create policy "Allow read sales"
on public.sales
for select
using (true);

drop policy if exists "Allow insert sales" on public.sales;
create policy "Allow insert sales"
on public.sales
for insert
with check (true);

drop policy if exists "Allow update sales" on public.sales;
create policy "Allow update sales"
on public.sales
for update
using (true)
with check (true);

drop policy if exists "Allow delete sales" on public.sales;
create policy "Allow delete sales"
on public.sales
for delete
using (true);

create table if not exists public.customers (
  id bigint primary key,
  name text not null,
  phone text default '',
  note text default '',
  created_at timestamptz default now()
);

alter table public.customers enable row level security;

drop policy if exists "Allow all access on customers" on public.customers;
create policy "Allow all access on customers"
on public.customers
for all
using (true)
with check (true);
