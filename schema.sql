-- GASOLINERA · Pegar TODO esto en Supabase > SQL Editor > Run
create extension if not exists pgcrypto with schema extensions;

create table settings(id int primary key default 1 check (id=1), pin_hash text not null);
insert into settings values (1, extensions.crypt('1234', extensions.gen_salt('bf'))); -- contraseña inicial: 1234

create table prices(day date primary key, super numeric(8,2) not null, regular numeric(8,2) not null, diesel numeric(8,2) not null);
create table sales(
  id bigserial primary key, created_at timestamptz not null default now(), day date not null,
  fuel text not null check (fuel in ('super','regular','diesel')),
  pay text not null check (pay in ('efectivo','tarjeta')),
  q numeric(10,2) not null, gal numeric(10,3) not null, price numeric(8,2) not null);

-- Nadie puede leer/escribir tablas directo; solo a través de las funciones de abajo
alter table settings enable row level security;
alter table prices enable row level security;
alter table sales enable row level security;

create or replace function gt_today() returns date language sql stable as
$$ select (now() at time zone 'America/Guatemala')::date $$;

create or replace function check_pin(p text) returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if not exists (select 1 from settings where pin_hash = crypt(p, pin_hash)) then
    raise exception 'PIN_INCORRECTO';
  end if;
end $$;
revoke all on function check_pin(text) from public, anon, authenticated;

-- ===== Funciones para despachadores (sin contraseña) =====
create or replace function get_prices() returns json language sql security definer
set search_path = public as $$
  select row_to_json(t) from (select day, super, regular, diesel from prices
  where day <= gt_today() order by day desc limit 1) t $$;

create or replace function add_sale(p_fuel text, p_pay text, p_mode text, p_value numeric)
returns json language plpgsql security definer set search_path = public as $$
declare pr numeric; v_q numeric; v_g numeric;
begin
  select case p_fuel when 'super' then super when 'regular' then regular else diesel end
    into pr from prices where day <= gt_today() order by day desc limit 1;
  if pr is null then raise exception 'SIN_PRECIOS'; end if;
  if p_value is null or p_value <= 0 then raise exception 'MONTO_INVALIDO'; end if;
  if p_mode = 'q' then v_q := round(p_value,2); v_g := round(p_value/pr,3);
  else v_g := round(p_value,3); v_q := round(p_value*pr,2); end if;
  insert into sales(day,fuel,pay,q,gal,price) values (gt_today(),p_fuel,p_pay,v_q,v_g,pr);
  return json_build_object('q',v_q,'gal',v_g);
end $$;

create or replace function today_sales() returns table(id bigint, created_at timestamptz, fuel text, pay text, q numeric, gal numeric)
language sql security definer set search_path = public as $$
  select id, created_at, fuel, pay, q, gal from sales where day = gt_today() order by id desc limit 15 $$;

-- ===== Funciones del dueño (piden contraseña) =====
create or replace function admin_check(p_pin text) returns void language plpgsql security definer
set search_path = public, extensions as $$ begin perform check_pin(p_pin); end $$;

create or replace function admin_set_prices(p_pin text, p_super numeric, p_regular numeric, p_diesel numeric)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform check_pin(p_pin);
  insert into prices(day,super,regular,diesel) values (gt_today(),p_super,p_regular,p_diesel)
  on conflict (day) do update set super=excluded.super, regular=excluded.regular, diesel=excluded.diesel;
end $$;

create or replace function admin_corte(p_pin text, p_day date)
returns table(id bigint, created_at timestamptz, fuel text, pay text, q numeric, gal numeric)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform check_pin(p_pin);
  return query select s.id, s.created_at, s.fuel, s.pay, s.q, s.gal from sales s where s.day = p_day order by s.id;
end $$;

create or replace function admin_delete_sale(p_pin text, p_id bigint)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin perform check_pin(p_pin); delete from sales where id = p_id; end $$;

create or replace function admin_change_pin(p_pin text, p_new text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform check_pin(p_pin);
  if length(p_new) < 4 then raise exception 'PIN_CORTO'; end if;
  update settings set pin_hash = crypt(p_new, gen_salt('bf')) where id = 1;
end $$;
