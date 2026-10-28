-- =============================================================================
-- Funciones del panel.
-- =============================================================================

-- Alta de negocio + perfil de dueño en una sola transacción. -------------------
-- Si p_dueno_atiende = true, también crea un profesional con el nombre del dueño
-- y lo vincula a su perfil (caso típico: salón chico donde el dueño atiende).
create or replace function public.crear_negocio(
  p_nombre        text,
  p_slug          text,
  p_rubro         text,
  p_nombre_dueno  text,
  p_telefono      text default null,
  p_direccion     text default null,
  p_dueno_atiende boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_negocio_id  uuid;
  v_prof_id     uuid;
begin
  if v_uid is null then
    raise exception 'NO_AUTENTICADO' using errcode = '28000';
  end if;

  if exists (select 1 from public.perfiles where id = v_uid) then
    raise exception 'YA_TIENE_NEGOCIO' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.negocios where slug = lower(p_slug)) then
    raise exception 'SLUG_OCUPADO' using errcode = 'P0001';
  end if;

  insert into public.negocios (nombre, slug, rubro, telefono, direccion)
  values (trim(p_nombre), lower(trim(p_slug)), p_rubro, nullif(trim(p_telefono), ''), nullif(trim(p_direccion), ''))
  returning id into v_negocio_id;

  if p_dueno_atiende then
    insert into public.profesionales (negocio_id, nombre)
    values (v_negocio_id, trim(p_nombre_dueno))
    returning id into v_prof_id;
  end if;

  insert into public.perfiles (id, negocio_id, rol, nombre, profesional_id)
  values (v_uid, v_negocio_id, 'dueno', trim(p_nombre_dueno), v_prof_id);

  return v_negocio_id;
end;
$$;

revoke execute on function public.crear_negocio(text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.crear_negocio(text, text, text, text, text, text, boolean) to authenticated;

-- Reemplaza el horario semanal completo de un profesional (atómico). -----------
-- p_franjas: [{"dia_semana":1,"desde":"09:00","hasta":"13:00"}, ...]
-- security invoker: las políticas RLS siguen aplicando (solo el dueño puede).
create or replace function public.guardar_horarios(p_profesional_id uuid, p_franjas jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_negocio_id uuid;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  if v_negocio_id is null or not public.es_dueno(v_negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  delete from public.horarios_profesional where profesional_id = p_profesional_id;

  insert into public.horarios_profesional (negocio_id, profesional_id, dia_semana, desde, hasta)
  select v_negocio_id, p_profesional_id, (f->>'dia_semana')::smallint, (f->>'desde')::time, (f->>'hasta')::time
  from jsonb_array_elements(coalesce(p_franjas, '[]'::jsonb)) as f;
end;
$$;

revoke execute on function public.guardar_horarios(uuid, jsonb) from public, anon;
grant execute on function public.guardar_horarios(uuid, jsonb) to authenticated;

-- Reemplaza los servicios que realiza un profesional (atómico). ----------------
create or replace function public.guardar_servicios_profesional(p_profesional_id uuid, p_servicio_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_negocio_id uuid;
begin
  select negocio_id into v_negocio_id from public.profesionales where id = p_profesional_id;
  if v_negocio_id is null or not public.es_dueno(v_negocio_id) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  delete from public.profesional_servicio where profesional_id = p_profesional_id;

  -- La FK compuesta (negocio_id, servicio_id) rechaza servicios de otro negocio.
  insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id)
  select distinct v_negocio_id, p_profesional_id, s
  from unnest(coalesce(p_servicio_ids, '{}'::uuid[])) as s;
end;
$$;

revoke execute on function public.guardar_servicios_profesional(uuid, uuid[]) from public, anon;
grant execute on function public.guardar_servicios_profesional(uuid, uuid[]) to authenticated;

-- Los helpers de RLS solo tienen sentido para usuarios logueados.
revoke execute on function public.mi_negocio_id() from public, anon;
revoke execute on function public.mi_rol() from public, anon;
revoke execute on function public.mi_profesional_id() from public, anon;
revoke execute on function public.es_miembro(uuid) from public, anon;
revoke execute on function public.es_dueno(uuid) from public, anon;
grant execute on function public.mi_negocio_id() to authenticated;
grant execute on function public.mi_rol() to authenticated;
grant execute on function public.mi_profesional_id() to authenticated;
grant execute on function public.es_miembro(uuid) to authenticated;
grant execute on function public.es_dueno(uuid) to authenticated;
