-- =============================================================================
-- 0009 · Borrar un cliente sin perder el historial.
--
-- El dueño borra la ficha (nombre, celular, mail y notas). Sus turnos quedan: siguen en
-- la agenda y en las estadísticas con el nombre con que se pidieron y su precio, así se
-- sabe de quién vino cada pago; se les borra el celular y el mail de la reserva.
-- Si tiene turnos por venir, primero hay que cancelarlos (así se avisa y se sincroniza).
--
-- Para eso turnos.cliente_id pasa a aceptar null: al borrar la ficha queda en null
-- (on delete set null solo de esa columna; negocio_id no se toca).
-- =============================================================================

alter table public.turnos alter column cliente_id drop not null;
alter table public.turnos drop constraint turnos_negocio_id_cliente_id_fkey;
alter table public.turnos
  add constraint turnos_negocio_id_cliente_id_fkey
  foreign key (negocio_id, cliente_id) references public.clientes (negocio_id, id)
  on delete set null (cliente_id);

-- Devuelve cuántos turnos quedaron en el historial.
create or replace function public.borrar_cliente(p_cliente_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cliente public.clientes;
  v_turnos  integer;
begin
  select * into v_cliente from public.clientes where id = p_cliente_id for update;
  if not found or not public.es_dueno(v_cliente.negocio_id) then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.turnos
    where cliente_id = p_cliente_id and estado in ('pendiente', 'confirmado') and inicio > now()
  ) then
    raise exception 'TIENE_TURNOS_FUTUROS' using errcode = 'P0001';
  end if;

  update public.turnos
  set nombre_reserva = coalesce(nombre_reserva, v_cliente.nombre),
      email_reserva = null,
      telefono_reserva = null
  where cliente_id = p_cliente_id;
  get diagnostics v_turnos = row_count;

  delete from public.clientes where id = p_cliente_id;
  return v_turnos;
end;
$$;

grant execute on function public.borrar_cliente(uuid) to agenda2_usuario;

-- La página del turno (/t/[token]) de un cliente borrado se sigue viendo.
create or replace function public.ver_turno(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'estado', t.estado,
    'inicio', t.inicio,
    'fin', t.fin,
    'precio', t.precio,
    'servicio', s.nombre,
    'profesional', p.nombre,
    'cliente', coalesce(t.nombre_reserva, c.nombre),
    'negocio', jsonb_build_object(
      'nombre', n.nombre, 'slug', n.slug, 'telefono', n.telefono,
      'direccion', n.direccion, 'zona_horaria', n.zona_horaria
    ),
    'cancelacion_min_horas', n.cancelacion_min_horas,
    'cancelable_hasta', public.cancelable_hasta(t.inicio, t.created_at, n.cancelacion_min_horas),
    'por_arrepentimiento', now() > t.inicio - make_interval(hours => n.cancelacion_min_horas)
                           and now() <= public.cancelable_hasta(t.inicio, t.created_at, n.cancelacion_min_horas),
    'cancelado_por', t.cancelado_por,
    'sena_monto', t.sena_monto,
    'pago_estado', case
      when t.pago_estado = 'pendiente' and t.pago_vence_at < now() then 'vencido'
      else t.pago_estado
    end,
    'pago_vence_at', t.pago_vence_at,
    'puede_cancelar', t.estado in ('pendiente', 'confirmado')
                      and now() <= public.cancelable_hasta(t.inicio, t.created_at, n.cancelacion_min_horas)
  )
  from public.turnos t
  join public.negocios n on n.id = t.negocio_id
  join public.servicios s on s.id = t.servicio_id
  join public.profesionales p on p.id = t.profesional_id
  left join public.clientes c on c.id = t.cliente_id
  where p_token ~ '^[0-9a-f]{64}$'
    and t.token_cancelacion = p_token;
$$;
