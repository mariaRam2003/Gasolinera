-- ============================================================
-- GASOLINERA · MIGRACIÓN DE SEGURIDAD
-- Autenticación administrativa sin login/correo
-- ============================================================

create extension if not exists pgcrypto with schema extensions;


-- ============================================================
-- 1. SESIONES ADMINISTRATIVAS
-- ============================================================

create table if not exists public.admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null
);


-- ============================================================
-- 2. INTENTOS DE LOGIN
-- Protección básica contra fuerza bruta
-- ============================================================

create table if not exists public.admin_login_attempts (
  client_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);


-- ============================================================
-- 3. SEGURIDAD DE TABLAS
-- ============================================================

alter table public.settings enable row level security;
alter table public.prices enable row level security;
alter table public.sales enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_login_attempts enable row level security;


-- Nadie accede directamente a las tablas desde el frontend.
revoke all on table public.settings from public, anon, authenticated;
revoke all on table public.prices from public, anon, authenticated;
revoke all on table public.sales from public, anon, authenticated;
revoke all on table public.admin_sessions from public, anon, authenticated;
revoke all on table public.admin_login_attempts from public, anon, authenticated;


-- ============================================================
-- 4. FECHA ACTUAL DE GUATEMALA
-- ============================================================

create or replace function public.gt_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Guatemala')::date
$$;


-- ============================================================
-- 5. VALIDAR SESIÓN ADMINISTRATIVA
-- ============================================================

drop function if exists public.validate_admin_session(text);

create or replace function public.validate_admin_session(
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash text;
  v_expires_at timestamptz;
begin

  if p_session_token is null
     or length(p_session_token) < 20 then
    raise exception 'ADMIN_SESION_INVALIDA';
  end if;

  v_token_hash :=
    encode(
      extensions.digest(p_session_token, 'sha256'),
      'hex'
    );

  select expires_at
  into v_expires_at
  from public.admin_sessions
  where token_hash = v_token_hash;

  if v_expires_at is null
     or v_expires_at <= now() then

    delete from public.admin_sessions
    where token_hash = v_token_hash;

    raise exception 'ADMIN_SESION_INVALIDA';
  end if;

  -- Sesión deslizante:
  -- cada operación administrativa extiende otros 30 minutos.
  update public.admin_sessions
  set
    last_used_at = now(),
    expires_at = now() + interval '30 minutes'
  where token_hash = v_token_hash;

end;
$$;


revoke all on function public.validate_admin_session(text)
from public, anon, authenticated;


-- ============================================================
-- 6. LOGIN ADMINISTRATIVO
-- ============================================================

drop function if exists public.admin_login(text);

create or replace function public.admin_login(
  p_password text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password_hash text;
  v_token text;
  v_token_hash text;

  v_headers jsonb;
  v_ip text;
  v_user_agent text;
  v_client_key text;

  v_attempts integer := 0;
  v_window timestamptz;
begin

  -- ----------------------------------------------------------
  -- Validación básica
  -- ----------------------------------------------------------

  if p_password is null
     or length(trim(p_password)) < 6 then
    raise exception 'PASSWORD_CORTA';
  end if;


  -- ----------------------------------------------------------
  -- Identificación básica del cliente
  -- ----------------------------------------------------------

  v_headers :=
    coalesce(
      nullif(current_setting('request.headers', true), ''),
      '{}'
    )::jsonb;

  v_ip :=
    coalesce(
      v_headers ->> 'cf-connecting-ip',
      split_part(
        coalesce(v_headers ->> 'x-forwarded-for', ''),
        ',',
        1
      ),
      'unknown'
    );

  v_user_agent :=
    coalesce(
      v_headers ->> 'user-agent',
      'unknown'
    );

  v_client_key :=
    encode(
      extensions.digest(
        v_ip || '|' || v_user_agent,
        'sha256'
      ),
      'hex'
    );


  -- ----------------------------------------------------------
  -- Rate limit
  --
  -- Máximo 5 intentos en 5 minutos por cliente.
  -- ----------------------------------------------------------

  select
    attempts,
    window_started_at
  into
    v_attempts,
    v_window
  from public.admin_login_attempts
  where client_key = v_client_key;

  if v_window is not null
     and v_window > now() - interval '5 minutes'
     and v_attempts >= 5 then

    raise exception 'DEMASIADOS_INTENTOS';

  end if;


  -- ----------------------------------------------------------
  -- Obtener hash
  -- ----------------------------------------------------------

  select pin_hash
  into v_password_hash
  from public.settings
  where id = 1;


  -- ----------------------------------------------------------
  -- Verificar contraseña
  -- ----------------------------------------------------------

  if v_password_hash is null
     or v_password_hash <>
        extensions.crypt(
          p_password,
          v_password_hash
        ) then

    if v_window is null
       or v_window <= now() - interval '5 minutes' then

      insert into public.admin_login_attempts (
        client_key,
        window_started_at,
        attempts
      )
      values (
        v_client_key,
        now(),
        1
      )
      on conflict (client_key)
      do update set
        window_started_at = now(),
        attempts = 1;

    else

      update public.admin_login_attempts
      set attempts = attempts + 1
      where client_key = v_client_key;

    end if;

    raise exception 'PIN_INCORRECTO';

  end if;


  -- ----------------------------------------------------------
  -- Login correcto
  -- ----------------------------------------------------------

  delete from public.admin_login_attempts
  where client_key = v_client_key;


  -- Generar token criptográficamente aleatorio.
  v_token :=
    encode(
      extensions.gen_random_bytes(32),
      'hex'
    );

  v_token_hash :=
    encode(
      extensions.digest(v_token, 'sha256'),
      'hex'
    );


  insert into public.admin_sessions (
    token_hash,
    expires_at
  )
  values (
    v_token_hash,
    now() + interval '30 minutes'
  );


  return json_build_object(
    'token',
    v_token,
    'expires_at',
    now() + interval '30 minutes'
  );

end;
$$;


revoke all on function public.admin_login(text)
from public, authenticated;

grant execute on function public.admin_login(text)
to anon;


-- ============================================================
-- 7. CERRAR SESIÓN ADMINISTRATIVA
-- ============================================================

drop function if exists public.admin_logout(text);

create or replace function public.admin_logout(
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash text;
begin

  if p_session_token is null then
    return;
  end if;

  v_token_hash :=
    encode(
      extensions.digest(p_session_token, 'sha256'),
      'hex'
    );

  delete from public.admin_sessions
  where token_hash = v_token_hash;

end;
$$;


revoke all on function public.admin_logout(text)
from public, anon, authenticated;

grant execute on function public.admin_logout(text)
to anon;


-- ============================================================
-- 8. OBTENER PRECIOS
-- Público para los despachadores
-- ============================================================

drop function if exists public.get_prices();

create or replace function public.get_prices()
returns json
language sql
security definer
set search_path = ''
as $$
  select row_to_json(t)
  from (
    select
      day,
      super,
      regular,
      diesel
    from public.prices
    where day <= public.gt_today()
    order by day desc
    limit 1
  ) t
$$;


revoke all on function public.get_prices()
from public, anon, authenticated;

grant execute on function public.get_prices()
to anon, authenticated;


-- ============================================================
-- 9. REGISTRAR VENTA
-- ============================================================

drop function if exists public.add_sale(text, text, text, numeric);

create or replace function public.add_sale(
  p_fuel text,
  p_pay text,
  p_mode text,
  p_value numeric
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price numeric;
  v_q numeric;
  v_g numeric;
begin

  if p_fuel not in ('super', 'regular', 'diesel') then
    raise exception 'COMBUSTIBLE_INVALIDO';
  end if;

  if p_pay not in ('efectivo', 'tarjeta') then
    raise exception 'PAGO_INVALIDO';
  end if;

  if p_mode not in ('q', 'g') then
    raise exception 'MODO_INVALIDO';
  end if;

  if p_value is null
     or p_value <= 0 then
    raise exception 'MONTO_INVALIDO';
  end if;


  select
    case p_fuel
      when 'super' then super
      when 'regular' then regular
      when 'diesel' then diesel
    end
  into v_price
  from public.prices
  where day <= public.gt_today()
  order by day desc
  limit 1;


  if v_price is null then
    raise exception 'SIN_PRECIOS';
  end if;


  if p_mode = 'q' then

    v_q := round(p_value, 2);
    v_g := round(p_value / v_price, 3);

  else

    v_g := round(p_value, 3);
    v_q := round(p_value * v_price, 2);

  end if;


  insert into public.sales (
    day,
    fuel,
    pay,
    q,
    gal,
    price
  )
  values (
    public.gt_today(),
    p_fuel,
    p_pay,
    v_q,
    v_g,
    v_price
  );


  return json_build_object(
    'q', v_q,
    'gal', v_g
  );

end;
$$;


revoke all on function public.add_sale(text, text, text, numeric)
from public, anon, authenticated;

grant execute on function public.add_sale(text, text, text, numeric)
to anon, authenticated;


-- ============================================================
-- 10. VENTAS DEL DÍA
-- ============================================================

drop function if exists public.today_sales();

create or replace function public.today_sales()
returns table(
  id bigint,
  created_at timestamptz,
  fuel text,
  pay text,
  q numeric,
  gal numeric
)
language sql
security definer
set search_path = ''
as $$
  select
    id,
    created_at,
    fuel,
    pay,
    q,
    gal
  from public.sales
  where day = public.gt_today()
  order by id desc
  limit 15
$$;


revoke all on function public.today_sales()
from public, anon, authenticated;

grant execute on function public.today_sales()
to anon, authenticated;


-- ============================================================
-- 11. GUARDAR PRECIOS
-- ============================================================

drop function if exists public.admin_set_prices(text, numeric, numeric, numeric);

create or replace function public.admin_set_prices(
  p_session_token text,
  p_super numeric,
  p_regular numeric,
  p_diesel numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin

  perform public.validate_admin_session(
    p_session_token
  );


  if p_super <= 0
     or p_regular <= 0
     or p_diesel <= 0 then
    raise exception 'PRECIOS_INVALIDOS';
  end if;


  insert into public.prices (
    day,
    super,
    regular,
    diesel
  )
  values (
    public.gt_today(),
    p_super,
    p_regular,
    p_diesel
  )
  on conflict (day)
  do update set
    super = excluded.super,
    regular = excluded.regular,
    diesel = excluded.diesel;

end;
$$;


revoke all on function public.admin_set_prices(text, numeric, numeric, numeric)
from public, anon, authenticated;

grant execute on function public.admin_set_prices(text, numeric, numeric, numeric)
to anon;


-- ============================================================
-- 12. CORTE
-- ============================================================

drop function if exists public.admin_corte(text, date);

create or replace function public.admin_corte(
  p_session_token text,
  p_day date
)
returns table(
  id bigint,
  created_at timestamptz,
  fuel text,
  pay text,
  q numeric,
  gal numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin

  perform public.validate_admin_session(
    p_session_token
  );


  return query
  select
    s.id,
    s.created_at,
    s.fuel,
    s.pay,
    s.q,
    s.gal
  from public.sales s
  where s.day = p_day
  order by s.id;

end;
$$;


revoke all on function public.admin_corte(text, date)
from public, anon, authenticated;

grant execute on function public.admin_corte(text, date)
to anon;


-- ============================================================
-- 13. ELIMINAR VENTA
-- ============================================================

drop function if exists public.admin_delete_sale(text, bigint);

create or replace function public.admin_delete_sale(
  p_session_token text,
  p_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin

  perform public.validate_admin_session(
    p_session_token
  );


  delete from public.sales
  where id = p_id;


end;
$$;


revoke all on function public.admin_delete_sale(text, bigint)
from public, anon, authenticated;

grant execute on function public.admin_delete_sale(text, bigint)
to anon;


-- ============================================================
-- 14. CAMBIAR CONTRASEÑA
-- ============================================================

drop function if exists public.admin_change_pin(text, text);
drop function if exists public.admin_change_password(text, text);

create or replace function public.admin_change_password(
  p_session_token text,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin

  perform public.validate_admin_session(
    p_session_token
  );


  if p_new_password is null
     or length(trim(p_new_password)) < 6 then
    raise exception 'PASSWORD_CORTA';
  end if;


  update public.settings
  set pin_hash =
    extensions.crypt(
      p_new_password,
      extensions.gen_salt('bf')
    )
  where id = 1;


  -- Por seguridad:
  -- cambiar la contraseña invalida todas las sesiones
  -- administrativas existentes.
  delete from public.admin_sessions;

end;
$$;


revoke all on function public.admin_change_password(text, text)
from public, anon, authenticated;

grant execute on function public.admin_change_password(text, text)
to anon;


-- ============================================================
-- 15. LIMPIEZA DE SESIONES EXPIRADAS
-- ============================================================

create or replace function public.cleanup_admin_sessions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin

  delete from public.admin_sessions
  where expires_at <= now();

  delete from public.admin_login_attempts
  where window_started_at <= now() - interval '1 hour';

end;
$$;


revoke all on function public.cleanup_admin_sessions()
from public, anon, authenticated;


-- ============================================================
-- FIN
-- ============================================================