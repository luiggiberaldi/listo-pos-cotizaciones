-- Reversa de 302 (solo STAGING). Quita la función de abono en un solo paso.
-- Las categorías nuevas de auditoría NO se quitan: Postgres no permite borrar valores de una lista (enum)
-- y además ya puede haber anotaciones que las usan. No hacen daño.
drop function if exists public.cxc_registrar_abono_atomico(uuid, numeric, text, text, text, uuid, uuid, text, text, text, boolean, text, jsonb);
