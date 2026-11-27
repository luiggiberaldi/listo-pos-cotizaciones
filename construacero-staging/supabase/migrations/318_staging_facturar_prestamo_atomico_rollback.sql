-- Rollback de 318_staging_facturar_prestamo_atomico.sql (Solo STAGING).
-- El servidor debe volver a la versión anterior de handleFacturarPrestamo antes de ejecutarlo.
BEGIN;
DROP FUNCTION IF EXISTS public.facturar_prestamo_atomico(uuid, uuid, numeric, uuid, numeric, uuid);
COMMIT;
