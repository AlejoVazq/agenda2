-- =============================================================================
-- 0018 · Opiniones abiertas y borrado por el dueño.
--
-- Cualquiera puede opinar desde la página del negocio (/n/[slug]), sin turno:
-- nombre, 1 a 5 estrellas, comentario opcional y, si quiere, de qué profesional.
-- Esas reseñas no tienen turno_id; las que vienen de /t/[token] siguen igual y se
-- muestran como "Tuvo turno acá".
--
-- Contra las opiniones basura: límite por IP en la app y el dueño (cualquier dueño
-- del negocio) puede borrar una opinión entera desde /panel/opiniones.
-- =============================================================================

alter table public.resenas
  alter column turno_id drop not null,
  alter column profesional_id drop not null,
  alter column servicio_id drop not null;

-- Una opinión de turno siempre sabe profesional y servicio.
alter table public.resenas
  add constraint resenas_turno_completo
  check (turno_id is null or (profesional_id is not null and servicio_id is not null));

-- El dueño borra opiniones (el trigger resenas_habilitado exige la suscripción al día).
create policy resenas_delete on public.resenas
  for delete to agenda2_usuario using (public.es_dueno(negocio_id));
grant delete on public.resenas to agenda2_usuario;

-- Deja una opinión sin turno. Solo la ejecuta el servidor (con límite por IP).
create or replace function public.dejar_resena_libre(
  p_negocio     uuid,
  p_nombre      text,
  p_estrellas   integer,
  p_comentario  text,
  p_profesional uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_activas boolean;
  v_nombre  text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_texto   text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_prof    uuid;
  v_id      uuid;
begin
  select n.resenas_activas into v_activas from public.negocios n where n.id = p_negocio;
  if not found then
    raise exception 'RESENA_NO_DISPONIBLE' using errcode = 'P0001', hint = 'No encontramos el negocio.';
  end if;
  if not v_activas or not plataforma.negocio_toma_reservas(p_negocio) then
    raise exception 'RESENA_DESACTIVADA' using errcode = 'P0001', hint = 'Este negocio no está recibiendo opiniones.';
  end if;
  if char_length(v_nombre) not between 2 and 60 then
    raise exception 'RESENA_NOMBRE' using errcode = 'P0001', hint = 'El nombre debe tener entre 2 y 60 caracteres.';
  end if;

  -- Un profesional que no es del negocio (o ya no atiende) se ignora.
  if p_profesional is not null then
    select p.id into v_prof from public.profesionales p
    where p.id = p_profesional and p.negocio_id = p_negocio and p.activo;
  end if;

  insert into public.resenas (negocio_id, profesional_id, autor, estrellas, comentario)
  values (p_negocio, v_prof, public.autor_resena(v_nombre), p_estrellas, v_texto)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.dejar_resena_libre(uuid, text, integer, text, uuid) to agenda2_servidor;
