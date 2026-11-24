-- 305_despacho_pagos_al_reabrir_anular_rollback.sql — PRODUCCIÓN
-- OP-2026-059. Reversa de 305_despacho_pagos_al_reabrir_anular.sql (adaptada de 304_staging_despacho_pagos_al_reabrir_anular_rollback.sql).
-- Reversa de 304 
drop function if exists public.anular_despacho_con_pagos(uuid, uuid, text, text, text, text);
drop function if exists public.reabrir_despacho_con_pagos(uuid, text, uuid, text, text, text, uuid, text, text);
drop function if exists public.cxc_pagos_en_juego_despacho(uuid);
drop function if exists public.cxc_es_pago_real(text);

notify pgrst, 'reload schema';
