-- =============================================================================
-- 0022 · Terminar la prueba antes de tiempo.
--
-- Hasta ahora un pago cargado durante la prueba arrancaba cuando la prueba terminaba
-- (admin_registrar_pago, 0002), y no había forma de cortarla: si el negocio paga el
-- día 1 y quiere que el mes cuente desde hoy, no se podía.
--
-- plataforma.admin_terminar_prueba: la prueba termina ahora. Los pagos que ya estaban
-- encolados detrás de la prueba se adelantan los días que le quedaban (así no se pierde
-- ni se regala nada) y pagado_hasta se recalcula. Si no tiene ningún pago, el negocio
-- pasa a la gracia (solo lectura): por eso /admin la ofrece sobre todo junto con
-- "Registrar pago" (el pago se carga en la misma transacción, desde hoy).
-- =============================================================================

create or replace function plataforma.admin_terminar_prueba(p_negocio_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_neg    public.negocios;
  v_ahora  timestamptz := now();
  v_resto  interval;
  v_pagado timestamptz;
begin
  perform plataforma.requerir_admin();
  select * into v_neg from public.negocios where id = p_negocio_id for update;
  if not found then
    raise exception 'NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if v_neg.prueba_hasta <= v_ahora then
    raise exception 'SIN_PRUEBA' using errcode = 'P0001';
  end if;

  v_resto := v_neg.prueba_hasta - v_ahora;

  -- Los pagos que arrancaban al terminar la prueba (o después) se corren para atrás.
  update plataforma.pagos
  set periodo_desde = periodo_desde - v_resto, periodo_hasta = periodo_hasta - v_resto
  where negocio_id = p_negocio_id and anulado_at is null and periodo_desde >= v_neg.prueba_hasta;

  select max(periodo_hasta) into v_pagado
  from plataforma.pagos where negocio_id = p_negocio_id and anulado_at is null;

  update public.negocios set prueba_hasta = v_ahora, pagado_hasta = v_pagado where id = p_negocio_id;

  perform plataforma.auditar('terminar_prueba', p_negocio_id, jsonb_build_object(
    'prueba_hasta_antes', v_neg.prueba_hasta, 'pagado_hasta', v_pagado));
  return v_pagado;
end;
$$;

grant execute on function plataforma.admin_terminar_prueba(uuid) to agenda2_usuario;
