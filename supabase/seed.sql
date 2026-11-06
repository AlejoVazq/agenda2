-- Datos de prueba para desarrollo local (se cargan con `supabase db reset`).
-- Usuario dueño: demo@turnos.test / demo1234
-- Página pública: http://localhost:3000/n/estudio-luna

do $$
declare
  v_user   uuid := '11111111-1111-4111-8111-111111111111';
  v_neg    uuid := '22222222-2222-4222-8222-222222222222';
  v_sofi   uuid := '33333333-3333-4333-8333-333333333331';
  v_mica   uuid := '33333333-3333-4333-8333-333333333332';
  v_corte  uuid := '44444444-4444-4444-8444-444444444441';
  v_color  uuid := '44444444-4444-4444-8444-444444444442';
  v_semi   uuid := '44444444-4444-4444-8444-444444444443';
  v_kapping uuid := '44444444-4444-4444-8444-444444444444';
  d        int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'demo@turnos.test', extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"nombre":"Sofía"}', now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_user, v_user::text,
    jsonb_build_object('sub', v_user::text, 'email', 'demo@turnos.test', 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.negocios (id, nombre, slug, rubro, telefono, direccion, descripcion)
  values (v_neg, 'Estudio Luna', 'estudio-luna', 'unas', '3415551234', 'Bv. Oroño 1234',
          'Uñas, cejas y pestañas. Reservá tu turno online.');

  insert into public.profesionales (id, negocio_id, nombre, color, orden) values
    (v_sofi, v_neg, 'Sofía', '#7c3aed', 1),
    (v_mica, v_neg, 'Mica', '#0d9488', 2);

  insert into public.perfiles (id, negocio_id, rol, nombre, profesional_id)
  values (v_user, v_neg, 'dueno', 'Sofía', v_sofi);

  insert into public.servicios (id, negocio_id, nombre, duracion_min, precio, orden) values
    (v_semi, v_neg, 'Esmaltado semipermanente', 60, 12000, 1),
    (v_kapping, v_neg, 'Kapping gel', 90, 16000, 2),
    (v_corte, v_neg, 'Perfilado de cejas', 30, 6000, 3),
    (v_color, v_neg, 'Lifting de pestañas', 60, 15000, 4);

  insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id) values
    (v_neg, v_sofi, v_semi), (v_neg, v_sofi, v_kapping), (v_neg, v_sofi, v_corte),
    (v_neg, v_mica, v_semi), (v_neg, v_mica, v_color), (v_neg, v_mica, v_corte);

  -- Lunes a viernes 9-13 y 15-20; sábados 9-14.
  for d in 1..5 loop
    insert into public.horarios_profesional (negocio_id, profesional_id, dia_semana, desde, hasta) values
      (v_neg, v_sofi, d, '09:00', '13:00'), (v_neg, v_sofi, d, '15:00', '20:00'),
      (v_neg, v_mica, d, '10:00', '18:00');
  end loop;
  insert into public.horarios_profesional (negocio_id, profesional_id, dia_semana, desde, hasta) values
    (v_neg, v_sofi, 6, '09:00', '14:00');
end;
$$;

-- Peluquería masculina de ejemplo: barbero@turnos.test / demo1234
-- Página pública: http://localhost:3000/n/peluqueria-caballeros
do $$
declare
  v_user    uuid := '11111111-1111-4111-8111-111111111112';
  v_neg     uuid := '22222222-2222-4222-8222-222222222223';
  v_mateo   uuid := '33333333-3333-4333-8333-333333333333';
  v_lucho   uuid := '33333333-3333-4333-8333-333333333334';
  v_corte   uuid := '44444444-4444-4444-8444-444444444445';
  v_combo   uuid := '44444444-4444-4444-8444-444444444446';
  v_barba   uuid := '44444444-4444-4444-8444-444444444447';
  v_nino    uuid := '44444444-4444-4444-8444-444444444448';
  d         int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'barbero@turnos.test', extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"nombre":"Mateo"}', now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_user, v_user::text,
    jsonb_build_object('sub', v_user::text, 'email', 'barbero@turnos.test', 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.negocios (id, nombre, slug, rubro, telefono, direccion, descripcion, intervalo_min)
  values (v_neg, 'Peluquería Caballeros', 'peluqueria-caballeros', 'peluqueria_masculina', '3415559876', 'San Lorenzo 850',
          'Peluquería masculina. Corte, barba y corte infantil. Reservá tu turno online.', 10);

  insert into public.profesionales (id, negocio_id, nombre, color, orden) values
    (v_mateo, v_neg, 'Mateo', '#1d4ed8', 1),
    (v_lucho, v_neg, 'Lucho', '#b45309', 2);

  insert into public.perfiles (id, negocio_id, rol, nombre, profesional_id)
  values (v_user, v_neg, 'dueno', 'Mateo', v_mateo);

  insert into public.servicios (id, negocio_id, nombre, duracion_min, precio, orden) values
    (v_corte, v_neg, 'Corte de pelo', 30, 9000, 1),
    (v_combo, v_neg, 'Corte y barba', 45, 13000, 2),
    (v_barba, v_neg, 'Arreglo de barba', 20, 6000, 3),
    (v_nino, v_neg, 'Corte infantil', 30, 8000, 4);

  insert into public.profesional_servicio (negocio_id, profesional_id, servicio_id) values
    (v_neg, v_mateo, v_corte), (v_neg, v_mateo, v_combo), (v_neg, v_mateo, v_barba), (v_neg, v_mateo, v_nino),
    (v_neg, v_lucho, v_corte), (v_neg, v_lucho, v_combo), (v_neg, v_lucho, v_barba);

  -- Martes a viernes 9-13 y 15-20; sábados 9-18. Lunes cerrado.
  for d in 2..5 loop
    insert into public.horarios_profesional (negocio_id, profesional_id, dia_semana, desde, hasta) values
      (v_neg, v_mateo, d, '09:00', '13:00'), (v_neg, v_mateo, d, '15:00', '20:00'),
      (v_neg, v_lucho, d, '09:00', '13:00'), (v_neg, v_lucho, d, '15:00', '20:00');
  end loop;
  insert into public.horarios_profesional (negocio_id, profesional_id, dia_semana, desde, hasta) values
    (v_neg, v_mateo, 6, '09:00', '18:00'),
    (v_neg, v_lucho, 6, '09:00', '18:00');
end;
$$;
