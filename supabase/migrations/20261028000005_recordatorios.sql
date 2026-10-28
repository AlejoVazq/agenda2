-- =============================================================================
-- Fase 4: recordatorios por mail.
-- =============================================================================

alter table public.negocios
  add column recordatorio_horas integer not null default 24 check (recordatorio_horas between 0 and 72);

grant update (recordatorio_horas) on public.negocios to authenticated;

-- Marca atómicamente los turnos a recordar y devuelve sus datos. Pensada para
-- un cron que corre cada hora: "skip locked" evita que dos ejecuciones
-- simultáneas manden el mismo mail. Si el envío falla, el cron vuelve a poner
-- recordatorio_enviado_at en null para reintentar en la próxima corrida.
--
-- Se recuerdan turnos activos que empiezan dentro de las próximas
-- `recordatorio_horas` del negocio (pero no en menos de 1 hora) y que no se
-- reservaron hace instantes (para no mandar recordatorio pegado a la confirmación).
create or replace function public.reclamar_recordatorios(p_limite integer default 100)
returns table (
  turno_id      uuid,
  token         text,
  inicio        timestamptz,
  fin           timestamptz,
  cliente       text,
  email         text,
  servicio      text,
  profesional   text,
  negocio       text,
  slug          text,
  direccion     text,
  telefono      text,
  zona_horaria  text,
  cancelacion_min_horas integer
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
    join public.clientes c on c.id = t.cliente_id
    where n.recordatorio_horas > 0
      and t.estado in ('pendiente', 'confirmado')
      and t.recordatorio_enviado_at is null
      and c.email is not null
      and t.inicio > now() + interval '1 hour'
      and t.inicio <= now() + make_interval(hours => n.recordatorio_horas)
      and t.created_at < now() - interval '3 hours'
    order by t.inicio
    limit least(greatest(p_limite, 1), 500)
    for update of t skip locked
  ),
  marcados as (
    update public.turnos t
    set recordatorio_enviado_at = now()
    from candidatos
    where t.id = candidatos.id
    returning t.*
  )
  select m.id, m.token_cancelacion, m.inicio, m.fin, c.nombre, c.email, s.nombre, p.nombre,
         n.nombre, n.slug, n.direccion, n.telefono, n.zona_horaria, n.cancelacion_min_horas
  from marcados m
  join public.negocios n on n.id = m.negocio_id
  join public.clientes c on c.id = m.cliente_id
  join public.servicios s on s.id = m.servicio_id
  join public.profesionales p on p.id = m.profesional_id;
end;
$$;

-- Solo el servidor (service role) puede reclamar recordatorios.
revoke execute on function public.reclamar_recordatorios(integer) from public, anon, authenticated;
grant execute on function public.reclamar_recordatorios(integer) to service_role;
