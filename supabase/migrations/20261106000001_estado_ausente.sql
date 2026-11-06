-- Nuevo estado de turno: el cliente no asistió. Va en su propia migración porque
-- un valor nuevo de un enum no se puede usar en la misma transacción que lo crea.
alter type public.estado_turno add value if not exists 'ausente';
