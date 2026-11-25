-- Reversa de 304 (solo STAGING)
drop function if exists public.anular_despacho_con_pagos_staging(uuid, uuid, text, text, text, text);
drop function if exists public.reabrir_despacho_con_pagos_staging(uuid, text, uuid, text, text, text, uuid, text, text);
drop function if exists public.cxc_pagos_en_juego_despacho(uuid);
drop function if exists public.cxc_es_pago_real(text);
