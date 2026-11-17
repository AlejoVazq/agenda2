-- =============================================================================
-- 0012 · Reseñas de cada local.
--
-- Solo opina quien tuvo un turno: la reseña se deja desde la página del turno
-- (/t/[token], link secreto que llega por mail), cuando el turno ya terminó y hasta
-- 60 días después. Una por turno; si vuelve a opinar, se actualiza.
-- 1 a 5 estrellas y un comentario opcional. El dueño responde en público y puede
-- ocultar un comentario ofensivo, pero las estrellas siempre cuentan.
--
-- Las escribe y las lee para el portal el rol del servidor (dejar_resena y consultas
-- directas): el anónimo sigue con sus 5 funciones. En el panel, solo el dueño.
-- =============================================================================

alter table public.negocios
  add column resenas_activas boolean not null default true;
grant update (resenas_activas) on public.negocios to agenda2_usuario;

-- Marca del mail que pide la opinión (lo manda el cron).
alter table public.turnos
  add column resena_pedida_at timestamptz;

create table public.resenas (
  id                uuid primary key default gen_random_uuid(),
  negocio_id        uuid not null references public.negocios (id) on delete cascade,
  turno_id          uuid not null unique references public.turnos (id) on delete cascade,
  profesional_id    uuid not null,
  servicio_id       uuid not null,
  -- Cómo se muestra quién opinó: primer nombre e inicial ("Martina G.").
  autor             text not null check (char_length(autor) between 1 and 80),
  estrellas         smallint not null check (estrellas between 1 and 5),
  comentario        text check (char_length(comentario) between 1 and 600),
  comentario_oculto boolean not null default false,
  respuesta         text check (char_length(respuesta) between 1 and 600),
  respondida_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index resenas_negocio_idx on public.resenas (negocio_id, created_at desc);
create trigger resenas_updated_at before update on public.resenas
  for each row execute function public.tg_set_updated_at();
-- Desde el panel (responder, ocultar) exige la suscripción al día, como el resto.
create trigger resenas_habilitado before insert or update or delete on public.resenas
  for each row execute function plataforma.tg_exigir_habilitado('negocio_id');

alter table public.resenas enable row level security;
create policy resenas_select on public.resenas
  for select to agenda2_usuario using (public.es_dueno(negocio_id));
create policy resenas_update on public.resenas
  for update to agenda2_usuario using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));

revoke all on public.resenas from public, agenda2_usuario, agenda2_anonimo;
grant select on public.resenas to agenda2_usuario;
grant update (respuesta, respondida_at, comentario_oculto) on public.resenas to agenda2_usuario;
grant select, insert, update, delete on public.resenas to agenda2_servidor;

-- Primer nombre + inicial del apellido.
create or replace function public.autor_resena(p_nombre text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      left(split_part(n, ' ', 1), 40)
        || case when split_part(n, ' ', 2) <> '' then ' ' || upper(left(split_part(n, ' ', 2), 1)) || '.' else '' end,
      ''),
    'Cliente')
  from (select regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g') as n) x;
$$;

-- Deja o actualiza la reseña del turno. Solo la ejecuta el servidor (con límite por IP).
create or replace function public.dejar_resena(p_token text, p_estrellas integer, p_comentario text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_turno  record;
  v_id     uuid;
  v_nueva  boolean;
  v_texto  text := nullif(btrim(coalesce(p_comentario, '')), '');
begin
  select t.id, t.negocio_id, t.profesional_id, t.servicio_id, n.resenas_activas,
         coalesce(t.nombre_reserva, c.nombre) as nombre
  into v_turno
  from public.turnos t
  join public.negocios n on n.id = t.negocio_id
  left join public.clientes c on c.id = t.cliente_id
  where p_token ~ '^[0-9a-f]{64}$'
    and t.token_cancelacion = p_token
    and t.estado in ('confirmado', 'completado')
    and t.fin <= now()
    and t.fin > now() - interval '60 days';

  if not found then
    raise exception 'RESENA_NO_DISPONIBLE' using errcode = 'P0001',
      hint = 'Solo se puede opinar de un turno que ya pasó, hasta 60 días después.';
  end if;
  if not v_turno.resenas_activas then
    raise exception 'RESENA_DESACTIVADA' using errcode = 'P0001', hint = 'Este negocio no está recibiendo opiniones.';
  end if;

  insert into public.resenas as r (negocio_id, turno_id, profesional_id, servicio_id, autor, estrellas, comentario)
  values (v_turno.negocio_id, v_turno.id, v_turno.profesional_id, v_turno.servicio_id,
          public.autor_resena(v_turno.nombre), p_estrellas, v_texto)
  on conflict (turno_id) do update
    set estrellas = excluded.estrellas,
        comentario = excluded.comentario,
        -- Un texto nuevo vuelve a mostrarse; el mismo texto sigue oculto.
        comentario_oculto = r.comentario_oculto and r.comentario is not distinct from excluded.comentario
  returning r.id, (xmax = 0) into v_id, v_nueva;

  return jsonb_build_object('id', v_id, 'nueva', v_nueva);
end;
$$;

-- Turnos que terminaron hace entre 2 y 48 h, sin reseña ni pedido: los marca y los
-- devuelve para el mail. Como los recordatorios: si el envío falla, el cron desmarca.
create or replace function public.reclamar_pedidos_resena(p_limite integer default 100)
returns table (
  turno_id    uuid,
  token       text,
  cliente     text,
  email       text,
  servicio    text,
  profesional text,
  negocio     text,
  slug        text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidatos as (
    select t.id
    from public.turnos t
    join public.negocios n on n.id = t.negocio_id
    left join public.clientes c on c.id = t.cliente_id
    where n.resenas_activas
      and plataforma.negocio_toma_reservas(n.id)
      and t.estado in ('confirmado', 'completado')
      and t.resena_pedida_at is null
      and t.fin <= now() - interval '2 hours'
      and t.fin > now() - interval '48 hours'
      and coalesce(t.email_reserva, c.email) is not null
      and not exists (select 1 from public.resenas r where r.turno_id = t.id)
    order by t.fin
    limit least(greatest(p_limite, 1), 500)
    for update of t skip locked
  ),
  marcados as (
    update public.turnos t
    set resena_pedida_at = now()
    from candidatos
    where t.id = candidatos.id
    returning t.*
  )
  select m.id, m.token_cancelacion, coalesce(m.nombre_reserva, c.nombre), coalesce(m.email_reserva, c.email),
         s.nombre, p.nombre, n.nombre, n.slug
  from marcados m
  join public.negocios n on n.id = m.negocio_id
  left join public.clientes c on c.id = m.cliente_id
  join public.servicios s on s.id = m.servicio_id
  join public.profesionales p on p.id = m.profesional_id;
end;
$$;

grant execute on function public.dejar_resena(text, integer, text) to agenda2_servidor;
grant execute on function public.reclamar_pedidos_resena(integer) to agenda2_servidor;
