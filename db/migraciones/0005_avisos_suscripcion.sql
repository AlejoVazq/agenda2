-- =============================================================================
-- 0005 · Avisos por mail del vencimiento de la suscripción (los manda el cron).
--
--   por_vencer  faltan 3 días o menos (prueba o plan pago)
--   vencio      ya venció: empieza la gracia, todo sigue funcionando
--   bloqueado   terminó la gracia: solo lectura y sin reservas (solo si fue hace
--               menos de 3 días, para no escribirle a negocios abandonados)
--
-- Cada aviso se anota en plataforma.avisos_suscripcion con la fecha de vencimiento
-- de ese ciclo: el cron corre cada hora, pero cada aviso sale una sola vez, y al
-- registrar un pago (nueva fecha) los avisos vuelven a empezar.
-- Reemplaza a plataforma.negocios_por_vencer (0002), que no se llegó a usar.
-- =============================================================================

drop function plataforma.negocios_por_vencer(timestamptz, timestamptz);

create table plataforma.avisos_suscripcion (
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  tipo       text not null check (tipo in ('por_vencer', 'vencio', 'bloqueado')),
  vence      timestamptz not null,
  enviado_at timestamptz not null default now(),
  primary key (negocio_id, tipo, vence)
);
alter table plataforma.avisos_suscripcion enable row level security;

-- Devuelve los avisos a mandar y los marca como enviados. Si el mail falla, el cron
-- borra la marca y se reintenta en la corrida siguiente (como los recordatorios).
create or replace function plataforma.reclamar_avisos_suscripcion()
returns table (
  negocio_id   uuid,
  tipo         text,
  nombre       text,
  estado       text,
  vence        timestamptz,
  fin_servicio timestamptz,
  dueno_nombre text,
  dueno_email  text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with base as (
    select n.id, n.nombre, n.prueba_hasta, n.pagado_hasta, n.suspendido_at,
           greatest(n.prueba_hasta, coalesce(n.pagado_hasta, n.prueba_hasta)) as vence,
           plataforma.estado_suscripcion(n.prueba_hasta, n.pagado_hasta, n.suspendido_at) as estado,
           plataforma.fin_servicio(n.prueba_hasta, n.pagado_hasta, n.suspendido_at) as fin
    from public.negocios n
    where n.suspendido_at is null and n.activo
  ),
  candidatos as (
    select b.*, case
        when b.estado in ('prueba', 'activa') and b.vence <= now() + interval '3 days' then 'por_vencer'
        when b.estado = 'gracia' then 'vencio'
        when b.estado = 'vencida' and b.fin > now() - interval '3 days' then 'bloqueado'
      end as tipo
    from base b
  ),
  marcados as (
    insert into plataforma.avisos_suscripcion (negocio_id, tipo, vence)
    select c.id, c.tipo, c.vence from candidatos c where c.tipo is not null
    on conflict do nothing
    returning avisos_suscripcion.negocio_id, avisos_suscripcion.tipo
  )
  select c.id, c.tipo, c.nombre, c.estado, c.vence, c.fin, pe.nombre, u."email"
  from marcados m
  join candidatos c on c.id = m.negocio_id and c.tipo = m.tipo
  join lateral (
    select p.id, p.nombre from public.perfiles p
    where p.negocio_id = c.id and p.rol = 'dueno' order by p.created_at limit 1
  ) pe on true
  join auth."user" u on u."id" = pe.id;
end;
$$;

grant execute on function plataforma.reclamar_avisos_suscripcion() to agenda2_servidor;
-- Para desmarcar un aviso cuyo mail falló (src/app/api/cron/route.ts).
grant usage on schema plataforma to agenda2_servidor;
grant select, delete on plataforma.avisos_suscripcion to agenda2_servidor;
