-- =============================================================================
-- Seguridad: Row Level Security.
--
-- * anon (público sin login): SIN acceso directo a ninguna tabla. El portal
--   público usa únicamente funciones RPC (ver migración de reservas).
-- * authenticated: solo ve datos del negocio al que pertenece su perfil.
--   - dueno: lee y escribe todo su negocio.
--   - empleado: lee la configuración del negocio, pero solo los turnos,
--     bloqueos y clientes de su propia agenda.
-- * Un usuario logueado sin perfil (p.ej. recién registrado) no ve nada.
-- =============================================================================

-- Helpers (security definer para poder leer perfiles sin recursión de RLS) -----
create or replace function public.mi_negocio_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select negocio_id from public.perfiles where id = auth.uid();
$$;

create or replace function public.mi_rol()
returns public.rol_usuario
language sql
stable
security definer
set search_path = ''
as $$
  select rol from public.perfiles where id = auth.uid();
$$;

create or replace function public.mi_profesional_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profesional_id from public.perfiles where id = auth.uid();
$$;

create or replace function public.es_miembro(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles where id = auth.uid() and negocio_id = p_negocio_id
  );
$$;

create or replace function public.es_dueno(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and negocio_id = p_negocio_id and rol = 'dueno'
  );
$$;

-- Activar RLS en todo ----------------------------------------------------------
alter table public.negocios             enable row level security;
alter table public.perfiles             enable row level security;
alter table public.profesionales        enable row level security;
alter table public.servicios            enable row level security;
alter table public.profesional_servicio enable row level security;
alter table public.horarios_profesional enable row level security;
alter table public.bloqueos             enable row level security;
alter table public.clientes             enable row level security;
alter table public.turnos               enable row level security;
alter table public.integraciones        enable row level security;

-- Defensa extra: el rol anónimo no tiene privilegios sobre las tablas.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- Negocios: alta solo vía crear_negocio(); nunca se borran desde el cliente.
create policy negocios_select on public.negocios
  for select to authenticated using (public.es_miembro(id));
create policy negocios_update on public.negocios
  for update to authenticated using (public.es_dueno(id)) with check (public.es_dueno(id));

-- Perfiles: cada uno ve el suyo; el dueño ve a su equipo.
-- Altas, cambios de rol y bajas se hacen desde el servidor (service role) o RPC.
create policy perfiles_select on public.perfiles
  for select to authenticated using (id = auth.uid() or public.es_dueno(negocio_id));

-- Configuración del negocio: todos los miembros leen, solo el dueño escribe.
create policy profesionales_select on public.profesionales
  for select to authenticated using (public.es_miembro(negocio_id));
create policy profesionales_insert on public.profesionales
  for insert to authenticated with check (public.es_dueno(negocio_id));
create policy profesionales_update on public.profesionales
  for update to authenticated using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy profesionales_delete on public.profesionales
  for delete to authenticated using (public.es_dueno(negocio_id));

create policy servicios_select on public.servicios
  for select to authenticated using (public.es_miembro(negocio_id));
create policy servicios_insert on public.servicios
  for insert to authenticated with check (public.es_dueno(negocio_id));
create policy servicios_update on public.servicios
  for update to authenticated using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy servicios_delete on public.servicios
  for delete to authenticated using (public.es_dueno(negocio_id));

create policy profesional_servicio_select on public.profesional_servicio
  for select to authenticated using (public.es_miembro(negocio_id));
create policy profesional_servicio_insert on public.profesional_servicio
  for insert to authenticated with check (public.es_dueno(negocio_id));
create policy profesional_servicio_delete on public.profesional_servicio
  for delete to authenticated using (public.es_dueno(negocio_id));

create policy horarios_select on public.horarios_profesional
  for select to authenticated using (public.es_miembro(negocio_id));
create policy horarios_insert on public.horarios_profesional
  for insert to authenticated with check (public.es_dueno(negocio_id));
create policy horarios_update on public.horarios_profesional
  for update to authenticated using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy horarios_delete on public.horarios_profesional
  for delete to authenticated using (public.es_dueno(negocio_id));

-- Bloqueos: el dueño gestiona todos; el empleado solo los de su agenda.
create policy bloqueos_select on public.bloqueos
  for select to authenticated
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));
create policy bloqueos_insert on public.bloqueos
  for insert to authenticated
  with check (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));
create policy bloqueos_update on public.bloqueos
  for update to authenticated
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()))
  with check (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));
create policy bloqueos_delete on public.bloqueos
  for delete to authenticated
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));

-- Turnos: el dueño todo su negocio; el empleado solo su agenda.
-- Las altas pasan por RPC (reserva online / alta desde el panel) para validar disponibilidad.
create policy turnos_select on public.turnos
  for select to authenticated
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));
create policy turnos_update on public.turnos
  for update to authenticated
  using (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()))
  with check (public.es_dueno(negocio_id) or (public.es_miembro(negocio_id) and profesional_id = public.mi_profesional_id()));

-- Clientes: el dueño todos; el empleado solo los que tienen turnos con él.
create policy clientes_select on public.clientes
  for select to authenticated
  using (
    public.es_dueno(negocio_id)
    or (
      public.es_miembro(negocio_id)
      and exists (
        select 1 from public.turnos t
        where t.cliente_id = clientes.id and t.profesional_id = public.mi_profesional_id()
      )
    )
  );
create policy clientes_update on public.clientes
  for update to authenticated using (public.es_dueno(negocio_id)) with check (public.es_dueno(negocio_id));
create policy clientes_delete on public.clientes
  for delete to authenticated using (public.es_dueno(negocio_id));

-- Integraciones: solo el dueño (y en el futuro, solo desde el servidor).
create policy integraciones_select on public.integraciones
  for select to authenticated using (public.es_dueno(negocio_id));

-- Columnas que un usuario del panel no puede tocar en un turno.
revoke update on public.turnos from authenticated;
grant update (profesional_id, inicio, fin, estado, notas, cancelado_at, cancelado_por) on public.turnos to authenticated;

-- El negocio no puede cambiar de id/slug libremente desde el cliente (slug sí, validado).
revoke update on public.negocios from authenticated;
grant update (
  nombre, slug, rubro, telefono, direccion, descripcion,
  cancelacion_min_horas, anticipacion_min_min, anticipacion_max_dias,
  intervalo_min, confirmacion_automatica
) on public.negocios to authenticated;

-- Las columnas de vínculo no se pueden mover de negocio.
revoke update on public.profesionales from authenticated;
grant update (nombre, email, color, activo, orden) on public.profesionales to authenticated;
revoke update on public.servicios from authenticated;
grant update (nombre, descripcion, duracion_min, precio, activo, orden) on public.servicios to authenticated;
revoke update on public.horarios_profesional from authenticated;
grant update (dia_semana, desde, hasta) on public.horarios_profesional to authenticated;
revoke update on public.bloqueos from authenticated;
grant update (inicio, fin, motivo) on public.bloqueos to authenticated;
revoke update on public.clientes from authenticated;
grant update (nombre, telefono, email, notas) on public.clientes to authenticated;
