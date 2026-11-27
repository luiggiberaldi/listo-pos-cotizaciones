-- Rollback de 323 (Solo STAGING): devuelve la escritura directa a authenticated (abre el hueco de nuevo).
BEGIN;
GRANT INSERT, UPDATE, DELETE ON public.cuentas_por_cobrar TO authenticated;
COMMIT;
