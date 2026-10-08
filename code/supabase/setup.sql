create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.campus_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create table public.counters (
  name        text primary key,
  sort_order  int  not null default 0,
  is_active   boolean not null default true
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 80),

  roll_no    text not null unique check (roll_no ~ '^[A-Z0-9-]{3,20}$'),
  role       text not null default 'student' check (role in ('student','chef','admin')),
  created_at timestamptz not null default now()
);

create table public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 100),
  category      text not null check (length(trim(category)) between 1 and 50),
  price         numeric(8,2) not null check (price >= 0 and price <= 5000),
  is_available  boolean not null default true,
  image_url     text not null default '',
  veg_or_nonveg text not null check (veg_or_nonveg in ('veg','non-veg')),
  counter       text not null references public.counters(name) on update cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger menu_items_updated before update on public.menu_items
  for each row execute function public.set_updated_at();

create table public.settings (
  id         int primary key default 1 check (id = 1),
  is_open    boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.settings (id, is_open) values (1, true);
create trigger settings_updated before update on public.settings
  for each row execute function public.set_updated_at();

create table public.order_counters (
  day         date primary key,
  last_number int not null default 0
);

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  order_date    date not null default public.campus_today(),
  order_number  int  not null,
  user_id       uuid not null references public.profiles(id),
  counter       text not null references public.counters(name) on update cascade,
  status        text not null default 'Pending'
                  check (status in ('Pending','Cooking','Ready','Completed','Cancelled')),
  total_amount  numeric(10,2) not null check (total_amount >= 0),
  cancel_reason text,
  request_id    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (order_date, order_number)
);

create unique index orders_request_counter_uniq
  on public.orders (request_id, counter) where request_id is not null;
create index orders_user_created_idx   on public.orders (user_id, created_at desc);
create index orders_date_status_idx    on public.orders (order_date, status);
create trigger orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name    text not null,
  unit_price   numeric(8,2) not null,
  quantity     int not null check (quantity between 1 and 20)
);
create index order_items_order_idx on public.order_items (order_id);

create or replace function public.user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_roll text := upper(trim(coalesce(new.raw_user_meta_data->>'roll_no','')));
  v_name text := trim(coalesce(new.raw_user_meta_data->>'name',''));
begin
  if v_name = '' or v_roll !~ '^[A-Z0-9-]{3,20}$' then
    raise exception 'invalid_signup';
  end if;
  insert into public.profiles (id, name, roll_no, role)
  values (new.id, v_name, v_roll, 'student');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.counters       enable row level security;
alter table public.profiles       enable row level security;
alter table public.menu_items     enable row level security;
alter table public.settings       enable row level security;
alter table public.order_counters enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;

revoke insert, update, delete on public.profiles       from anon, authenticated;
revoke all                    on public.order_counters from anon, authenticated;
revoke insert, update, delete on public.orders         from anon, authenticated;
revoke insert, update, delete on public.order_items    from anon, authenticated;
revoke all on public.counters, public.profiles, public.menu_items,
              public.settings, public.orders, public.order_items from anon;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.user_role() = 'admin');

create policy counters_select on public.counters for select to authenticated using (true);
create policy counters_admin_write on public.counters for all to authenticated
  using (public.user_role() = 'admin') with check (public.user_role() = 'admin');

create policy menu_select on public.menu_items for select to authenticated using (true);
create policy menu_admin_write on public.menu_items for all to authenticated
  using (public.user_role() = 'admin') with check (public.user_role() = 'admin');

create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_admin_update on public.settings for update to authenticated
  using (public.user_role() = 'admin') with check (public.user_role() = 'admin');

create policy orders_select on public.orders for select to authenticated
  using (user_id = auth.uid() or public.user_role() in ('chef','admin'));

create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));

create or replace function public.place_order(p_request_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_open    boolean;
  v_existing jsonb;
  v_today   date := public.campus_today();
  v_token   int;
  v_order_id uuid;
  v_total   numeric(10,2);
  v_result  jsonb := '[]'::jsonb;
  v_bad     text;
  g         record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null then raise exception 'missing_request_id'; end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'invalid_items';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_request_id::text, 0));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'order_number', o.order_number, 'counter', o.counter,
           'total_amount', o.total_amount, 'status', o.status) order by o.order_number), '[]'::jsonb)
    into v_existing
    from public.orders o
   where o.user_id = v_uid and o.request_id = p_request_id;
  if jsonb_array_length(v_existing) > 0 then return v_existing; end if;

  select is_open into v_open from public.settings where id = 1;
  if not coalesce(v_open, false) then raise exception 'canteen_closed'; end if;

  create temporary table if not exists _po_lines (
    menu_item_id uuid, quantity int
  ) on commit drop;
  truncate _po_lines;

  begin
    insert into _po_lines (menu_item_id, quantity)
    select (e->>'menu_item_id')::uuid, (e->>'quantity')::int
      from jsonb_array_elements(p_items) e;
  exception when others then
    raise exception 'invalid_items';
  end;

  if exists (select 1 from _po_lines where menu_item_id is null or quantity is null
                                         or quantity < 1 or quantity > 20) then
    raise exception 'invalid_items';
  end if;

  select string_agg(coalesce(m.name, l.menu_item_id::text), ', ')
    into v_bad
    from (select menu_item_id, sum(quantity) q from _po_lines group by menu_item_id) l
    left join public.menu_items m on m.id = l.menu_item_id
   where m.id is null or not m.is_available or l.q > 20;
  if v_bad is not null then
    raise exception 'item_unavailable: %', v_bad;
  end if;

  for g in
    select m.counter, sum(m.price * l.q) as total
      from (select menu_item_id, sum(quantity)::int q from _po_lines group by menu_item_id) l
      join public.menu_items m on m.id = l.menu_item_id
     group by m.counter
     order by m.counter
  loop
    insert into public.order_counters (day, last_number) values (v_today, 1)
    on conflict (day) do update set last_number = public.order_counters.last_number + 1
    returning last_number into v_token;

    insert into public.orders (order_date, order_number, user_id, counter,
                               status, total_amount, request_id)
    values (v_today, v_token, v_uid, g.counter, 'Pending', g.total, p_request_id)
    returning id, total_amount into v_order_id, v_total;

    insert into public.order_items (order_id, menu_item_id, item_name, unit_price, quantity)
    select v_order_id, m.id, m.name, m.price, l.q
      from (select menu_item_id, sum(quantity)::int q from _po_lines group by menu_item_id) l
      join public.menu_items m on m.id = l.menu_item_id
     where m.counter = g.counter;

    v_result := v_result || jsonb_build_object(
      'id', v_order_id, 'order_number', v_token, 'counter', g.counter,
      'total_amount', v_total, 'status', 'Pending');
  end loop;

  return v_result;
end $$;

create or replace function public.set_order_status(
  p_order_id uuid, p_status text, p_reason text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.user_role();
  v_order public.orders;
begin
  if auth.uid() is null or v_role not in ('chef','admin') then
    raise exception 'forbidden';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if not (
       (v_order.status = 'Pending' and p_status in ('Cooking','Cancelled'))
    or (v_order.status = 'Cooking' and p_status in ('Ready','Cancelled'))
    or (v_order.status = 'Ready'   and p_status in ('Completed','Cancelled'))
  ) then
    raise exception 'invalid_transition: % -> %', v_order.status, p_status;
  end if;

  if p_status = 'Cancelled' and length(trim(coalesce(p_reason,''))) = 0 then
    raise exception 'cancel_reason_required';
  end if;

  update public.orders
     set status = p_status,
         cancel_reason = case when p_status = 'Cancelled' then trim(p_reason) else cancel_reason end
   where id = p_order_id
   returning * into v_order;

  return v_order;
end $$;

create or replace function public.ping()
returns timestamptz language sql stable as $$ select now() $$;

revoke execute on function public.place_order(uuid, jsonb)             from public, anon;
revoke execute on function public.set_order_status(uuid, text, text)   from public, anon;
revoke execute on function public.user_role()                          from public, anon;
grant  execute on function public.place_order(uuid, jsonb)             to authenticated;
grant  execute on function public.set_order_status(uuid, text, text)   to authenticated;
grant  execute on function public.user_role()                          to authenticated;
grant  execute on function public.ping()                               to anon, authenticated;

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.menu_items;

create or replace function public.place_order(p_request_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_open      boolean;
  v_existing  jsonb;
  v_today     date := public.campus_today();
  v_token     int;
  v_order_id  uuid;
  v_total     numeric(10,2);
  v_result    jsonb := '[]'::jsonb;
  v_bad       text;
  v_lines     jsonb;
  v_badlines  int;
  g           record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null then raise exception 'missing_request_id'; end if;


  if (case when jsonb_typeof(p_items) = 'array'
           then jsonb_array_length(p_items) between 1 and 30
           else false end) is not true then
    raise exception 'invalid_items';
  end if;


  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_request_id::text, 0));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'order_number', o.order_number, 'counter', o.counter,
           'total_amount', o.total_amount, 'status', o.status) order by o.order_number), '[]'::jsonb)
    into v_existing
    from public.orders o
   where o.user_id = v_uid and o.request_id = p_request_id;
  if jsonb_array_length(v_existing) > 0 then return v_existing; end if;

  select is_open into v_open from public.settings where id = 1;
  if not coalesce(v_open, false) then raise exception 'canteen_closed'; end if;


  begin
    select count(*) filter (where id is null or qty is null or qty < 1 or qty > 20)
      into v_badlines
      from (select (e->>'menu_item_id')::uuid as id, (e->>'quantity')::int as qty
              from jsonb_array_elements(p_items) e) p;

    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'q', q)), '[]'::jsonb)
      into v_lines
      from (select (e->>'menu_item_id')::uuid as id,
                   sum((e->>'quantity')::int)::int as q
              from jsonb_array_elements(p_items) e
             where e->>'menu_item_id' is not null
             group by 1) s;
  exception when others then
    raise exception 'invalid_items';
  end;
  if v_badlines > 0 then raise exception 'invalid_items'; end if;


  select string_agg(coalesce(m.name, l.id::text), ', ')
    into v_bad
    from jsonb_to_recordset(v_lines) as l(id uuid, q int)
    left join public.menu_items m on m.id = l.id
   where m.id is null or not m.is_available or l.q > 20;
  if v_bad is not null then
    raise exception 'item_unavailable: %', v_bad;
  end if;


  for g in
    select m.counter, sum(m.price * l.q) as total
      from jsonb_to_recordset(v_lines) as l(id uuid, q int)
      join public.menu_items m on m.id = l.id
     group by m.counter
     order by m.counter
  loop
    insert into public.order_counters (day, last_number) values (v_today, 1)
    on conflict (day) do update set last_number = public.order_counters.last_number + 1
    returning last_number into v_token;

    insert into public.orders (order_date, order_number, user_id, counter,
                               status, total_amount, request_id)
    values (v_today, v_token, v_uid, g.counter, 'Pending', g.total, p_request_id)
    returning id, total_amount into v_order_id, v_total;

    insert into public.order_items (order_id, menu_item_id, item_name, unit_price, quantity)
    select v_order_id, m.id, m.name, m.price, l.q
      from jsonb_to_recordset(v_lines) as l(id uuid, q int)
      join public.menu_items m on m.id = l.id
     where m.counter = g.counter;

    v_result := v_result || jsonb_build_object(
      'id', v_order_id, 'order_number', v_token, 'counter', g.counter,
      'total_amount', v_total, 'status', 'Pending');
  end loop;

  return v_result;
end $$;
alter table public.profiles drop constraint if exists profiles_roll_no_check;
alter table public.profiles alter column roll_no drop not null;

create table if not exists public.allowed_staff_emails (
  email      text primary key check (email = lower(trim(email))),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.allowed_staff_emails enable row level security;
revoke all on public.allowed_staff_emails from anon, authenticated;

create or replace function public.is_campus_email(p_email text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_email,'')) ~ '^[a-z0-9._%+-]+@(ug\.)?iist\.ac\.in$'
$$;

create or replace function public.is_allowed_email(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_campus_email(p_email)
      or exists (select 1 from public.allowed_staff_emails
                  where email = lower(trim(coalesce(p_email,''))))
$$;

revoke execute on function public.is_allowed_email(text) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(trim(coalesce(new.raw_user_meta_data->>'name','')), 80);
begin
  if not public.is_allowed_email(new.email) then
    raise exception 'invalid_email_domain';
  end if;
  if v_name = '' then
    v_name := left(split_part(lower(new.email), '@', 1), 80);
  end if;
  insert into public.profiles (id, name, role)
  values (new.id, v_name, 'student');
  return new;
end $$;

create or replace function public.guard_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email and not public.is_allowed_email(new.email) then
    raise exception 'invalid_email_domain';
  end if;
  return new;
end $$;

drop trigger if exists guard_email_change on auth.users;
create trigger guard_email_change
  before update of email on auth.users
  for each row execute function public.guard_email_change();
alter table public.profiles
  add column if not exists counter text references public.counters(name) on update cascade;

create or replace function public.user_counter()
returns text language sql stable security definer set search_path = public as $$
  select counter from public.profiles where id = auth.uid()
$$;
revoke execute on function public.user_counter() from public, anon;
grant  execute on function public.user_counter() to authenticated;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (
    user_id = auth.uid()
    or public.user_role() = 'admin'
    or (public.user_role() = 'chef' and counter = public.user_counter())
  );

create or replace function public.set_order_status(
  p_order_id uuid, p_status text, p_reason text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_role  text := public.user_role();
  v_order public.orders;
begin
  if auth.uid() is null or v_role not in ('chef','admin') then
    raise exception 'forbidden';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if v_role = 'chef' and v_order.counter is distinct from public.user_counter() then
    raise exception 'forbidden';
  end if;

  if not (
       (v_order.status = 'Pending' and p_status in ('Cooking','Cancelled'))
    or (v_order.status = 'Cooking' and p_status in ('Ready','Cancelled'))
    or (v_order.status = 'Ready'   and p_status in ('Completed','Cancelled'))
  ) then
    raise exception 'invalid_transition: % -> %', v_order.status, p_status;
  end if;

  if p_status = 'Cancelled' and length(trim(coalesce(p_reason,''))) = 0 then
    raise exception 'cancel_reason_required';
  end if;

  update public.orders
     set status = p_status,
         cancel_reason = case when p_status = 'Cancelled' then trim(p_reason) else cancel_reason end
   where id = p_order_id
   returning * into v_order;

  return v_order;
end $$;
alter table public.menu_items add column if not exists is_archived boolean not null default false;

alter table public.menu_items drop constraint if exists menu_archived_unavailable;
alter table public.menu_items add constraint menu_archived_unavailable check (not is_archived or not is_available);

create unique index if not exists menu_items_live_name_uniq
  on public.menu_items (lower(trim(name))) where not is_archived;

drop policy if exists menu_select on public.menu_items;
create policy menu_select on public.menu_items for select to authenticated
  using (not is_archived or public.user_role() = 'admin');

revoke delete on public.menu_items from authenticated;
create or replace function public.is_campus_email(p_email text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_email,'')) ~ '^[a-z0-9._-]+@(ug\.)?iist\.ac\.in$'
$$;

create or replace function public.place_order(p_request_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_open      boolean;
  v_existing  jsonb;
  v_today     date := public.campus_today();
  v_token     int;
  v_order_id  uuid;
  v_total     numeric(10,2);
  v_result    jsonb := '[]'::jsonb;
  v_bad       text;
  v_lines     jsonb;
  v_badlines  int;
  v_qty       int;
  v_active    int;
  g           record;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null then raise exception 'missing_request_id'; end if;

  if (case when jsonb_typeof(p_items) = 'array'
           then jsonb_array_length(p_items) between 1 and 30
           else false end) is not true then
    raise exception 'invalid_items';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_request_id::text, 0));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'order_number', o.order_number, 'counter', o.counter,
           'total_amount', o.total_amount, 'status', o.status) order by o.order_number), '[]'::jsonb)
    into v_existing
    from public.orders o
   where o.user_id = v_uid and o.request_id = p_request_id;
  if jsonb_array_length(v_existing) > 0 then return v_existing; end if;

  select is_open into v_open from public.settings where id = 1;
  if not coalesce(v_open, false) then raise exception 'canteen_closed'; end if;

  begin
    select count(*) filter (where id is null or qty is null or qty < 1 or qty > 20)
      into v_badlines
      from (select (e->>'menu_item_id')::uuid as id, (e->>'quantity')::int as qty
              from jsonb_array_elements(p_items) e) p;

    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'q', q)), '[]'::jsonb),
           coalesce(sum(q), 0)::int
      into v_lines, v_qty
      from (select (e->>'menu_item_id')::uuid as id,
                   sum((e->>'quantity')::int)::int as q
              from jsonb_array_elements(p_items) e
             where e->>'menu_item_id' is not null
             group by 1) s;
  exception when others then
    raise exception 'invalid_items';
  end;
  if v_badlines > 0 then raise exception 'invalid_items'; end if;

  if v_qty > 40 then raise exception 'order_too_large'; end if;
  perform pg_advisory_xact_lock(hashtextextended('po-user:' || v_uid::text, 0));
  select count(*) into v_active from public.orders
   where user_id = v_uid and status in ('Pending','Cooking','Ready');
  if v_active >= 6 then raise exception 'too_many_active_orders'; end if;

  select string_agg(coalesce(m.name, l.id::text), ', ')
    into v_bad
    from jsonb_to_recordset(v_lines) as l(id uuid, q int)
    left join public.menu_items m on m.id = l.id
   where m.id is null or not m.is_available or l.q > 20;
  if v_bad is not null then
    raise exception 'item_unavailable: %', v_bad;
  end if;

  for g in
    select m.counter, sum(m.price * l.q) as total
      from jsonb_to_recordset(v_lines) as l(id uuid, q int)
      join public.menu_items m on m.id = l.id
     group by m.counter
     order by m.counter
  loop
    insert into public.order_counters (day, last_number) values (v_today, 1)
    on conflict (day) do update set last_number = public.order_counters.last_number + 1
    returning last_number into v_token;

    insert into public.orders (order_date, order_number, user_id, counter,
                               status, total_amount, request_id)
    values (v_today, v_token, v_uid, g.counter, 'Pending', g.total, p_request_id)
    returning id, total_amount into v_order_id, v_total;

    insert into public.order_items (order_id, menu_item_id, item_name, unit_price, quantity)
    select v_order_id, m.id, m.name, m.price, l.q
      from jsonb_to_recordset(v_lines) as l(id uuid, q int)
      join public.menu_items m on m.id = l.id
     where m.counter = g.counter;

    v_result := v_result || jsonb_build_object(
      'id', v_order_id, 'order_number', v_token, 'counter', g.counter,
      'total_amount', v_total, 'status', 'Pending');
  end loop;

  return v_result;
end $$;
insert into public.counters (name, sort_order, is_active) values
  ('Veg Counter', 1, true),
  ('Non-Veg Counter', 2, true)
on conflict (name) do update set sort_order = excluded.sort_order;

insert into public.menu_items (category, name, price, veg_or_nonveg, counter, is_available)
select v.category, v.name, v.price, v.veg_or_nonveg, v.counter, v.is_available
from (values
  ('Tea / Snacks', 'Tea', 10, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Coffee', 12, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Boost', 22, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Horlicks', 22, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Hot Milk', 17, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Badam Milk', 10, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Cold Milk', 10, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Banana Fry', 10, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Bonda', 10, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Cake', 10, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Ela Ada', 12, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Egg Puffs', 20, 'non-veg', 'Non-Veg Counter', true),
  ('Tea / Snacks', 'Veg Puffs', 20, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Egg Bun', 20, 'non-veg', 'Non-Veg Counter', true),
  ('Tea / Snacks', 'Butter Bun', 15, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Cup Cake', 15, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Sweet Porotta', 17, 'veg', 'Veg Counter', true),
  ('Tea / Snacks', 'Pizza Cake', 14, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Masala Dosa', 40, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Ghee Dosa', 35, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Onion Dosa', 35, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Plain Dosa', 15, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Bread Omelet', 40, 'non-veg', 'Non-Veg Counter', true),
  ('Breakfast', 'Double Omelet', 30, 'non-veg', 'Non-Veg Counter', true),
  ('Breakfast', 'Poori Masala Set', 25, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Idly Set', 30, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Puttu & Curry', 45, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Egg Curry', 25, 'non-veg', 'Non-Veg Counter', true),
  ('Breakfast', 'Kadala Curry', 25, 'veg', 'Veg Counter', true),
  ('Breakfast', 'Boiled Egg', 10, 'non-veg', 'Non-Veg Counter', true),
  ('Veg Items', 'Chapathi', 8, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Paratha', 10, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Veg Fried Rice', 60, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Tomato Rice', 60, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Jeera Rice', 60, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Gobi Rice', 80, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Paneer Rice', 100, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Veg Noodles', 55, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Paneer Noodles', 90, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Veg Momos', 40, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Paneer Vell', 90, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Jeera Aloo', 80, 'veg', 'Veg Counter', true),
  ('Veg Items', 'Dal Khichadi', 75, 'veg', 'Veg Counter', true),
  ('Lunch', 'Biriyani', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Lunch', 'Veg Meals', 55, 'veg', 'Veg Counter', true),
  ('Lunch', 'Fish Curry', 36, 'non-veg', 'Non-Veg Counter', true),
  ('Lunch', 'Fish Fry', 0, 'non-veg', 'Non-Veg Counter', false),
  ('Juices & Shakes', 'Lime', 18, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Grape', 35, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Watermelon', 35, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Orange', 35, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Pineapple', 35, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Papaya', 40, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Mango', 50, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Chocolate Shake', 70, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Sharjah Shake', 70, 'veg', 'Veg Counter', true),
  ('Juices & Shakes', 'Strawberry Shake', 70, 'veg', 'Veg Counter', true),
  ('Non-Veg Items', 'Chicken Fried Rice', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Chicken Noodles', 90, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Egg Rice', 70, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Egg Noodles', 70, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Chicken Kothuparotta', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Chicken Pasta', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Egg Bhurji', 50, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Alfaham Quarter', 110, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Alfaham Half', 205, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Alfaham Full', 410, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Shawarma Roll', 90, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Shawarma Plate', 135, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Rumali Shawarma Roll', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Rumali Shawarma Plate', 150, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Rumali Cheese Shawarma Roll', 120, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Rumali Cheese Shawarma Plate', 170, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Items', 'Chicken 65', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Veg Curry', 'Paneer Butter Masala', 100, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Chilly Paneer', 90, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Paneer 65', 100, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Kadai Paneer', 90, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Gobi Manchurian', 90, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Chilly Gobi', 60, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Tomato Fry', 65, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Dal Fry', 70, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Dal Tadka', 70, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Dal Palak', 100, 'veg', 'Veg Counter', true),
  ('Veg Curry', 'Palak Paneer', 140, 'veg', 'Veg Counter', true),
  ('Non-Veg Curry', 'Chicken Curry', 120, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Curry', 'Garlic Chicken', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Curry', 'Pepper Chicken', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Curry', 'Ginger Chicken', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Curry', 'Kadai Chicken', 100, 'non-veg', 'Non-Veg Counter', true),
  ('Non-Veg Curry', 'Chilly Chicken', 90, 'non-veg', 'Non-Veg Counter', true)
) as v(category, name, price, veg_or_nonveg, counter, is_available)
where not exists (select 1 from public.menu_items m where m.name = v.name);
