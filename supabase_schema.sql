alter table if exists items
  add column if not exists costPrice numeric default 0,
  add column if not exists minStock numeric default 0;

alter table if exists sales
  add column if not exists costPrice numeric default 0,
  add column if not exists profit numeric default 0;

-- ถ้ายังไม่มีตาราง ใช้อันนี้แทน
create table if not exists items (
  id bigint primary key,
  name text not null default '',
  barcode text default '',
  category text default '',
  model text default '',
  year text default '',
  quantity numeric not null default 0,
  retailPrice numeric not null default 0,
  wholesalePrice numeric not null default 0,
  mechanicPrice numeric not null default 0,
  costPrice numeric not null default 0,
  minStock numeric not null default 0,
  note text default '',
  createdAt timestamptz default now()
);

create table if not exists sales (
  id bigint primary key,
  saleId text,
  itemId bigint,
  barcode text default '',
  name text default '',
  category text default '',
  model text default '',
  year text default '',
  qty numeric not null default 0,
  priceType text default 'retail',
  priceLabel text default 'ราคาปลีก',
  price numeric not null default 0,
  total numeric not null default 0,
  costPrice numeric not null default 0,
  profit numeric not null default 0,
  laborCost numeric not null default 0,
  grandTotal numeric not null default 0,
  customerName text default '',
  paid numeric not null default 0,
  change numeric not null default 0,
  createdAt timestamptz default now()
);

create table if not exists repairs (
  id bigint primary key,
  customerName text not null default '',
  phone text default '',
  bikeModel text default '',
  plate text default '',
  repairDate text default '',
  symptom text default '',
  parts jsonb not null default '[]'::jsonb,
  partsUsedText text default '',
  repairPriceType text default 'mechanic',
  repairPriceLabel text default 'ราคาช่าง',
  partsCost numeric not null default 0,
  laborCost numeric not null default 0,
  totalCost numeric not null default 0,
  note text default '',
  createdAt timestamptz default now()
);
