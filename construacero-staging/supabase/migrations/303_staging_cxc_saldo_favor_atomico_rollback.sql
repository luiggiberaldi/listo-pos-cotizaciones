-- Reversa de 303 (solo STAGING): quita la función de saldo a favor en un solo paso.
drop function if exists public.cxc_saldo_favor_atomico(text, uuid, numeric, text, text, text, uuid, text, text, text, boolean, text);
