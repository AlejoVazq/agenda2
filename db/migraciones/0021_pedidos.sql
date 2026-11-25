-- =============================================================================
-- 0021 · Pedidos de la tienda: tablas, crear, vencer, pagar, cancelar y acciones del panel.
--
-- pedidos / pedido_items: los lee solo el dueño (RLS con es_dueno) y el servidor. Nadie
--   los escribe directo: todo pasa por funciones.
-- Stock: productos.stock es lo disponible. Un pedido "aparta" el stock al crearse
--   (pendiente) y lo sigue teniendo mientras está pagado; al entregarse se consume.
--   Vuelve una sola vez cuando el pedido pasa de pendiente/pagado a vencido, cancelado o
--   reembolsar (cada cambio de estado se hace con la fila del pedido bloqueada y
--   chequeando el estado anterior). Descontar siempre con "where stock >= n": nunca
--   queda negativo aunque dos personas compren la última unidad a la vez.
-- Del cliente (solo el servidor, con su límite por IP): crear_pedido, ver_pedido,
--   cancelar_pedido_cliente. Mercado Pago: registrar_pago_pedido (idempotente).
--   Cron: liberar_pedidos_vencidos.
-- Del panel (solo dueños, con el negocio habilitado): pedido_marcar_pagado,
--   pedido_marcar_entregado, pedido_cancelar, pedido_marcar_devuelto,
--   pedido_duplicado_devuelto.
-- Turno cancelado: un pedido en efectivo pendiente atado a ese turno pierde la extensión
--   hasta el día del turno (trigger tg_turno_cancelado_pedidos).
-- =============================================================================

create table public.pedidos (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references public.negocios (id) on delete cascade,
  numero        integer not null,
  -- Token secreto del link del pedido (/p/<token>), como el de los turnos.
  token         text not null unique
                  default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
                  check (token ~ '^[0-9a-f]{64}$'),
  turno_id      uuid references public.turnos (id) on delete set null,
  nombre        text check (char_length(nombre) between 2 and 80),
  email         text not null check (char_length(email) <= 254),
  telefono      text check (telefono ~ '^[0-9]{8,15}$'),
  medio         text not null check (medio in ('mercadopago', 'transferencia', 'efectivo')),
  estado        text not null default 'pendiente'
                  check (estado in ('pendiente', 'pagado', 'entregado', 'cancelado', 'vencido', 'reembolsar')),
  total         numeric(12, 2) not null check (total > 0),
  vence_at      timestamptz,
  pago_id       text,
  -- Otro pago aprobado que llegó con el pedido ya pagado (el último): hay que devolverlo
  -- desde Mercado Pago. Lo limpia el dueño con "Ya lo devolví".
  pago_duplicado_id text,
  pagado_at     timestamptz,
  entregado_at  timestamptz,
  cancelado_at  timestamptz,
  cancelado_por text check (cancelado_por in ('cliente', 'negocio', 'sistema')),
  created_at    timestamptz not null default now(),
  unique (negocio_id, numero),
  constraint pedidos_pendiente_vence check (estado <> 'pendiente' or vence_at is not null)
);

create index pedidos_negocio_idx on public.pedidos (negocio_id, created_at desc);
create index pedidos_vencen_idx on public.pedidos (vence_at) where estado = 'pendiente';
create index pedidos_turno_idx on public.pedidos (turno_id) where turno_id is not null;

create table public.pedido_items (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references public.pedidos (id) on delete cascade,
  producto_id     uuid references public.productos (id) on delete set null,
  -- Copia al momento de pedir: si el producto cambia o se borra, el pedido queda igual.
  nombre          text not null,
  precio_unitario numeric(12, 2) not null,
  cantidad        integer not null check (cantidad between 1 and 20)
);

create index pedido_items_pedido_idx on public.pedido_items (pedido_id);
create index pedido_items_producto_idx on public.pedido_items (producto_id);

alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

create policy pedidos_select on public.pedidos
  for select to agenda2_usuario using (public.es_dueno(negocio_id));
create policy pedido_items_select on public.pedido_items
  for select to agenda2_usuario using (
    exists (select 1 from public.pedidos p where p.id = pedido_id and public.es_dueno(p.negocio_id))
  );

revoke all on public.pedidos, public.pedido_items from public, agenda2_usuario, agenda2_anonimo, agenda2_servidor;
grant select on public.pedidos, public.pedido_items to agenda2_usuario, agenda2_servidor;

-- Stock (internas: sin grants) --------------------------------------------------------

-- Devuelve al producto lo apartado por el pedido (los productos borrados se saltean).
-- Quien la llama tiene bloqueado el pedido y cambia su estado en la misma transacción.
-- Con tope en 100000 (el máximo de productos.stock): si la dueña subió el stock mientras
-- tanto, la devolución no rompe el check.
create or replace function public.devolver_stock_pedido(p_pedido uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- En orden de producto, como al apartar, para no cruzar candados.
  for r in
    select i.producto_id, sum(i.cantidad)::integer as n
    from public.pedido_items i
    where i.pedido_id = p_pedido and i.producto_id is not null
    group by i.producto_id
    order by i.producto_id
  loop
    update public.productos set stock = least(stock + r.n, 100000) where id = r.producto_id;
  end loop;
end;
$$;

-- Vuelve a apartar el stock de un pedido que lo había devuelto (vencido o cancelado).
-- Todo o nada: si algún producto no alcanza (o ya no existe) no toca nada y devuelve false.
create or replace function public.apartar_stock_pedido(p_pedido uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
begin
  begin
    for r in
      select i.producto_id, sum(i.cantidad)::integer as n
      from public.pedido_items i
      where i.pedido_id = p_pedido
      group by i.producto_id
      order by i.producto_id
    loop
      if r.producto_id is null then
        raise exception 'SIN_STOCK' using errcode = 'P0001';
      end if;
      update public.productos set stock = stock - r.n where id = r.producto_id and stock >= r.n;
      if not found then
        raise exception 'SIN_STOCK' using errcode = 'P0001';
      end if;
    end loop;
  exception when raise_exception then
    -- Deshace lo descontado en este bloque. Otros errores (p. ej. NEGOCIO_NO_HABILITADO
    -- del trigger de productos) siguen de largo.
    if sqlerrm = 'SIN_STOCK' then
      return false;
    end if;
    raise;
  end;
  return true;
end;
$$;

-- Cron ---------------------------------------------------------------------------------

-- Pendientes con el plazo cumplido → vencido, y vuelve su stock. Devuelve cuántos venció.
-- "skip locked": si otra transacción tiene el pedido (un pago entrando), lo deja para la
-- próxima corrida. El stock de todos los vencidos se devuelve en una sola pasada, sumado
-- por producto y en orden de producto (el mismo orden en que se bloquean productos en
-- todas partes), así dos corridas o un pedido nuevo no se cruzan los candados.
create or replace function public.liberar_pedidos_vencidos(p_negocio uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  r     record;
begin
  select coalesce(array_agg(s.id), '{}') into v_ids
  from (
    select p.id from public.pedidos p
    where p.estado = 'pendiente' and p.vence_at < now()
      and (p_negocio is null or p.negocio_id = p_negocio)
    order by p.id
    for update skip locked
  ) s;
  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  for r in
    select i.producto_id, sum(i.cantidad)::integer as n
    from public.pedido_items i
    where i.pedido_id = any(v_ids) and i.producto_id is not null
    group by i.producto_id
    order by i.producto_id
  loop
    update public.productos set stock = least(stock + r.n, 100000) where id = r.producto_id;
  end loop;

  update public.pedidos
  set estado = 'vencido', cancelado_at = now(), cancelado_por = 'sistema'
  where id = any(v_ids);
  return cardinality(v_ids);
end;
$$;

-- Crear (cliente, desde el servidor) ---------------------------------------------------
-- p_items: [{"producto_id": uuid, "cantidad": 1-20}], 1 a 20 productos distintos.
-- Errores: DATOS_INVALIDOS, NEGOCIO_NO_DISPONIBLE, TIENDA_NO_DISPONIBLE, LIMITE_PEDIDOS,
-- SIN_STOCK (también si el producto no existe, no está activo o es de otro negocio).
-- Plazo para pagar o retirar: Mercado Pago 30 min, transferencia transferencia_plazo_horas,
-- efectivo efectivo_plazo_dias o, con un turno activo del negocio, hasta el fin del día
-- local del turno si es más tarde.
create or replace function public.crear_pedido(
  p_negocio     uuid,
  p_items       jsonb,
  p_nombre      text,
  p_email       text,
  p_telefono    text,
  p_medio       text,
  p_turno_token text default null
)
returns table (pedido_id uuid, token text, numero integer, total numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_neg       public.negocios;
  v_nombre    text := trim(coalesce(p_nombre, ''));
  v_email     text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_clave     text := public.clave_email(p_email);
  v_tel       text := case when nullif(trim(coalesce(p_telefono, '')), '') is null then null
                           else public.normalizar_telefono(p_telefono) end;
  v_item      jsonb;
  v_ids       uuid[] := '{}';
  v_cants     integer[] := '{}';
  v_nombres   text[] := '{}';
  v_precios   numeric[] := '{}';
  v_prod      record;
  v_total     numeric := 0;
  v_turno     public.turnos;
  v_vence     timestamptz;
  v_numero    integer;
  v_pedido    uuid;
  v_token     text;
  v_pendientes integer;
  i           integer;
begin
  -- Validación de input (también se valida en la app con zod).
  if char_length(v_nombre) not between 2 and 80
     or v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or (v_tel is not null and v_tel !~ '^[0-9]{8,15}$')
     or (p_telefono is not null and nullif(trim(p_telefono), '') is not null and v_tel is null)
     or p_medio is null or p_medio not in ('mercadopago', 'transferencia', 'efectivo')
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'producto_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item -> 'cantidad') is distinct from 'number'
       or (v_item ->> 'cantidad') !~ '^[0-9]{1,2}$'
       or (v_item ->> 'cantidad')::integer not between 1 and 20
       or (v_item ->> 'producto_id')::uuid = any(v_ids) then
      raise exception 'DATOS_INVALIDOS' using errcode = 'P0001';
    end if;
    v_ids := v_ids || (v_item ->> 'producto_id')::uuid;
    v_cants := v_cants || (v_item ->> 'cantidad')::integer;
  end loop;

  select * into v_neg from public.negocios n where n.id = p_negocio and n.activo;
  if not found or not plataforma.negocio_toma_reservas(p_negocio) then
    raise exception 'NEGOCIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  if not v_neg.tienda_activa
     or not (p_medio = any(v_neg.tienda_medios))
     or (p_medio = 'mercadopago' and not exists (
           select 1 from public.integraciones ig
           where ig.negocio_id = p_negocio and ig.proveedor = 'mercadopago' and ig.estado = 'activa'))
     or (p_medio = 'transferencia' and v_neg.transferencia_alias is null and v_neg.transferencia_cbu is null) then
    raise exception 'TIENDA_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  -- Los pedidos de un local se crean de a uno (número correlativo y límite por mail).
  perform pg_advisory_xact_lock(hashtextextended('pedidos:' || p_negocio::text, 0));

  -- Candados de productos, todos juntos y en orden de id: los de este pedido y los de los
  -- vencidos que se liberan abajo. Así nunca se toma un producto "menor" después de uno
  -- "mayor" (liberar y apartar, por separado, ya van en orden; juntos no).
  perform 1 from public.productos pr
  where pr.id = any(v_ids)
     or pr.id in (
       select i.producto_id from public.pedido_items i
       join public.pedidos p on p.id = i.pedido_id
       where p.negocio_id = p_negocio and p.estado = 'pendiente' and p.vence_at < now()
     )
  order by pr.id
  for update;

  -- Antes de contar y de apartar: lo vencido vuelve al stock.
  perform public.liberar_pedidos_vencidos(p_negocio);

  select count(*) into v_pendientes
  from public.pedidos p
  where p.negocio_id = p_negocio and p.estado = 'pendiente' and public.clave_email(p.email) = v_clave;
  if v_pendientes >= 3 then
    raise exception 'LIMITE_PEDIDOS' using errcode = 'P0001';
  end if;

  -- Apartar el stock, en orden de producto (igual que devolver_stock_pedido).
  v_nombres := array_fill(null::text, array[cardinality(v_ids)]);
  v_precios := array_fill(null::numeric, array[cardinality(v_ids)]);
  for i in select o from unnest(v_ids) with ordinality as u(id, o) order by u.id loop
    update public.productos pr
    set stock = pr.stock - v_cants[i]
    where pr.id = v_ids[i] and pr.negocio_id = p_negocio and pr.activo and pr.stock >= v_cants[i]
    returning pr.nombre, pr.precio into v_prod;
    if not found then
      raise exception 'SIN_STOCK' using errcode = 'P0001';
    end if;
    v_nombres[i] := v_prod.nombre;
    v_precios[i] := v_prod.precio;
    v_total := v_total + v_prod.precio * v_cants[i];
  end loop;

  if p_turno_token is not null then
    select * into v_turno from public.turnos t
    where t.token_cancelacion = p_turno_token and t.negocio_id = p_negocio
      and t.estado <> 'cancelado' and t.inicio > now();
  end if;

  v_vence := case p_medio
    when 'mercadopago' then now() + interval '30 minutes'
    when 'transferencia' then now() + make_interval(hours => v_neg.transferencia_plazo_horas)
    else greatest(
      now() + make_interval(days => v_neg.efectivo_plazo_dias),
      case when v_turno.id is not null then
        (((v_turno.inicio at time zone v_neg.zona_horaria)::date + 1)::timestamp at time zone v_neg.zona_horaria)
      end
    )
  end;

  select coalesce(max(p.numero), 0) + 1 into v_numero from public.pedidos p where p.negocio_id = p_negocio;

  insert into public.pedidos (negocio_id, numero, turno_id, nombre, email, telefono, medio, total, vence_at)
  values (p_negocio, v_numero, v_turno.id, v_nombre, v_email, v_tel, p_medio, v_total, v_vence)
  returning id, token into v_pedido, v_token;

  insert into public.pedido_items (pedido_id, producto_id, nombre, precio_unitario, cantidad)
  select v_pedido, u.id, u.nombre, u.precio, u.cantidad
  from unnest(v_ids, v_nombres, v_precios, v_cants) as u(id, nombre, precio, cantidad);

  pedido_id := v_pedido;
  token := v_token;
  numero := v_numero;
  total := v_total;
  return next;
end;
$$;

-- Ver (cliente, desde el servidor) -----------------------------------------------------
-- Para /p/<token>. Sin el id del pago. Un pendiente con el plazo cumplido figura vencido
-- aunque el cron todavía no haya pasado.
create or replace function public.ver_pedido(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'numero', p.numero,
    'nombre', p.nombre,
    'email', p.email,
    'telefono', p.telefono,
    'medio', p.medio,
    'estado', case when p.estado = 'pendiente' and p.vence_at < now() then 'vencido' else p.estado end,
    'total', p.total,
    'vence_at', p.vence_at,
    'created_at', p.created_at,
    'pagado_at', p.pagado_at,
    'entregado_at', p.entregado_at,
    'cancelado_at', p.cancelado_at,
    'cancelado_por', p.cancelado_por,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'producto_id', i.producto_id,
          'nombre', i.nombre,
          'precio_unitario', i.precio_unitario,
          'cantidad', i.cantidad
        ) order by i.nombre, i.id)
      from public.pedido_items i where i.pedido_id = p.id
    ), '[]'::jsonb),
    'negocio', jsonb_build_object(
      'nombre', n.nombre,
      'slug', n.slug,
      'telefono', n.telefono,
      'direccion', n.direccion,
      'zona_horaria', n.zona_horaria,
      'transferencia_alias', n.transferencia_alias,
      'transferencia_cbu', n.transferencia_cbu,
      'transferencia_titular', n.transferencia_titular
    ),
    'turno', (select jsonb_build_object('inicio', t.inicio) from public.turnos t where t.id = p.turno_id)
  )
  from public.pedidos p
  join public.negocios n on n.id = p.negocio_id
  where p_token ~ '^[0-9a-f]{64}$' and p.token = p_token;
$$;

-- Cancelar (cliente, desde el servidor): solo un pendiente. Devuelve si lo canceló.
create or replace function public.cancelar_pedido_cliente(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select p.id into v_id from public.pedidos p
  where p.token = p_token and p.estado = 'pendiente'
  for update;
  if not found then
    return false;
  end if;
  perform public.devolver_stock_pedido(v_id);
  update public.pedidos
  set estado = 'cancelado', cancelado_at = now(), cancelado_por = 'cliente'
  where id = v_id;
  return true;
end;
$$;

-- Pago de Mercado Pago (verificado contra su API) --------------------------------------
-- Devuelve 'confirmado' | 'ya_procesado' | 'rechazado' | 'reembolsar' | 'duplicado'.
-- Idempotente: con el pedido bloqueado, el segundo aviso del mismo pago (webhook y vuelta
-- del cliente) recibe 'ya_procesado' y no toca el stock. Otro pago aprobado (otro id) con
-- el pedido ya pagado, entregado o para devolver queda en pago_duplicado_id y devuelve
-- 'duplicado' (una sola vez por pago): hay que devolverlo desde Mercado Pago.
create or replace function public.registrar_pago_pedido(
  p_pedido   uuid,
  p_pago_id  text,
  p_aprobado boolean,
  p_monto    numeric
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pedidos;
begin
  select * into v from public.pedidos where id = p_pedido for update;
  if not found then
    return 'rechazado';
  end if;

  if p_pago_id = v.pago_id or p_pago_id = v.pago_duplicado_id then
    return 'ya_procesado';
  end if;
  if v.estado in ('pagado', 'entregado', 'reembolsar') then
    if not coalesce(p_aprobado, false) then
      return 'ya_procesado';
    end if;
    update public.pedidos set pago_duplicado_id = p_pago_id where id = v.id;
    return 'duplicado';
  end if;
  if not coalesce(p_aprobado, false) then
    return 'rechazado';
  end if;

  if coalesce(p_monto, 0) + 0.01 < v.total then
    -- Pagó de menos: no se entrega. Lo apartado vuelve (si todavía lo tenía).
    if v.estado = 'pendiente' then
      perform public.devolver_stock_pedido(v.id);
    end if;
    update public.pedidos set estado = 'reembolsar', pago_id = p_pago_id, vence_at = null where id = v.id;
    return 'reembolsar';
  end if;

  if v.estado = 'pendiente' then
    update public.pedidos
    set estado = 'pagado', pago_id = p_pago_id, pagado_at = now(), vence_at = null
    where id = v.id;
    return 'confirmado';
  end if;

  -- Vencido o cancelado por el cliente: el stock ya había vuelto. Si alcanza se vuelve a
  -- apartar; si no, queda para devolver la plata (el dueño lo ve en el panel). Si lo
  -- canceló el negocio (o ya marcó la plata como devuelta), manda el negocio: no revive.
  if (v.estado = 'vencido' or (v.estado = 'cancelado' and v.cancelado_por = 'cliente'))
     and public.apartar_stock_pedido(v.id) then
    update public.pedidos
    set estado = 'pagado', pago_id = p_pago_id, pagado_at = now(), vence_at = null,
        cancelado_at = null, cancelado_por = null
    where id = v.id;
    return 'confirmado';
  end if;

  update public.pedidos set estado = 'reembolsar', pago_id = p_pago_id, vence_at = null where id = v.id;
  return 'reembolsar';
end;
$$;

-- Panel (solo dueños, con el negocio habilitado) ----------------------------------------

-- Bloquea el pedido y verifica permisos. Errores: SIN_PERMISO, NEGOCIO_NO_HABILITADO.
create or replace function public.pedido_para_panel(p_pedido uuid)
returns public.pedidos
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pedidos;
begin
  select * into v from public.pedidos where id = p_pedido for update;
  if not found or not public.es_dueno(v.negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = 'P0001';
  end if;
  if not plataforma.negocio_habilitado(v.negocio_id) then
    raise exception 'NEGOCIO_NO_HABILITADO' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- "Pago recibido": pendiente o vencido → pagado (un vencido vuelve a apartar o SIN_STOCK).
create or replace function public.pedido_marcar_pagado(p_pedido uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pedidos := public.pedido_para_panel(p_pedido);
begin
  if v.estado = 'vencido' then
    if not public.apartar_stock_pedido(v.id) then
      raise exception 'SIN_STOCK' using errcode = 'P0001';
    end if;
  elsif v.estado <> 'pendiente' then
    raise exception 'ESTADO_INVALIDO' using errcode = 'P0001';
  end if;
  update public.pedidos
  set estado = 'pagado', pagado_at = now(), vence_at = null, cancelado_at = null, cancelado_por = null
  where id = v.id;
end;
$$;

-- "Entregado": pendiente o pagado → entregado (si no estaba pagado, se cobró al entregar).
create or replace function public.pedido_marcar_entregado(p_pedido uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pedidos := public.pedido_para_panel(p_pedido);
begin
  if v.estado not in ('pendiente', 'pagado') then
    raise exception 'ESTADO_INVALIDO' using errcode = 'P0001';
  end if;
  update public.pedidos
  set estado = 'entregado', entregado_at = now(), pagado_at = coalesce(pagado_at, now()), vence_at = null
  where id = v.id;
end;
$$;

-- "Cancelar": pendiente o pagado (sin entregar) → cancelado, y vuelve el stock. Si estaba
-- pagado, la devolución de la plata la arregla el dueño con el cliente.
create or replace function public.pedido_cancelar(p_pedido uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pedidos := public.pedido_para_panel(p_pedido);
begin
  if v.estado not in ('pendiente', 'pagado') then
    raise exception 'ESTADO_INVALIDO' using errcode = 'P0001';
  end if;
  perform public.devolver_stock_pedido(v.id);
  update public.pedidos
  set estado = 'cancelado', cancelado_at = now(), cancelado_por = 'negocio', vence_at = null
  where id = v.id;
end;
$$;

-- "Marcar como devuelto": reembolsar → cancelado. El stock ya no estaba apartado.
create or replace function public.pedido_marcar_devuelto(p_pedido uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pedidos := public.pedido_para_panel(p_pedido);
begin
  if v.estado <> 'reembolsar' then
    raise exception 'ESTADO_INVALIDO' using errcode = 'P0001';
  end if;
  update public.pedidos
  set estado = 'cancelado', cancelado_at = coalesce(cancelado_at, now()), cancelado_por = 'negocio'
  where id = v.id;
end;
$$;

-- "Ya lo devolví": el dueño devolvió el pago duplicado desde Mercado Pago.
create or replace function public.pedido_duplicado_devuelto(p_pedido uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.pedidos := public.pedido_para_panel(p_pedido);
begin
  if v.pago_duplicado_id is null then
    raise exception 'ESTADO_INVALIDO' using errcode = 'P0001';
  end if;
  update public.pedidos set pago_duplicado_id = null where id = v.id;
end;
$$;

-- Turno cancelado (por el cliente, el negocio o el sistema): un pedido en efectivo
-- pendiente que se retiraba ese día vuelve al plazo común (efectivo_plazo_dias desde que
-- se hizo); si ya pasó, vence en la próxima pasada. Así no queda stock apartado para un
-- turno que no va a ocurrir.
create or replace function public.tg_turno_cancelado_pedidos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pedidos p
  set vence_at = least(p.vence_at, p.created_at + make_interval(days => n.efectivo_plazo_dias))
  from public.negocios n
  where p.turno_id = new.id and p.estado = 'pendiente' and p.medio = 'efectivo'
    and n.id = p.negocio_id;
  return null;
end;
$$;

create trigger turnos_cancelado_pedidos
  after update of estado on public.turnos
  for each row
  when (new.estado = 'cancelado' and old.estado is distinct from 'cancelado')
  execute function public.tg_turno_cancelado_pedidos();

-- Permisos (las internas devolver/apartar_stock_pedido y pedido_para_panel, sin grants).
grant execute on function public.crear_pedido(uuid, jsonb, text, text, text, text, text) to agenda2_servidor;
grant execute on function public.ver_pedido(text) to agenda2_servidor;
grant execute on function public.cancelar_pedido_cliente(text) to agenda2_servidor;
grant execute on function public.registrar_pago_pedido(uuid, text, boolean, numeric) to agenda2_servidor;
grant execute on function public.liberar_pedidos_vencidos(uuid) to agenda2_servidor;
grant execute on function public.pedido_marcar_pagado(uuid) to agenda2_usuario;
grant execute on function public.pedido_marcar_entregado(uuid) to agenda2_usuario;
grant execute on function public.pedido_cancelar(uuid) to agenda2_usuario;
grant execute on function public.pedido_marcar_devuelto(uuid) to agenda2_usuario;
grant execute on function public.pedido_duplicado_devuelto(uuid) to agenda2_usuario;
