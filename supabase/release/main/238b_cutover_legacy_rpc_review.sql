-- 238b_cutover_legacy_rpc_review.sql
-- REVIEW ONLY - proyecto principal.
--
-- Este archivo NO se ejecuta durante la preparacion. Solo se aplica despues
-- de validar en staging la funcion calcularcomisiondespacho_238b(UUID), el
-- Worker y los cuatro PDFs.
--
-- El nombre legacy se conserva temporalmente porque los triggers/RPCs actuales
-- del esquema principal lo invocan. La firma publica no cambia.

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 238b_cutover_legacy_rpc_review.sql no debe ejecutarse todavia';
END
$$;

DO $$
BEGIN
  IF to_regprocedure('public.calcularcomisiondespacho_238b(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: calcularcomisiondespacho_238b(uuid)';
  END IF;
  IF to_regclass('public.comisiones') IS NULL
     OR to_regclass('public.notas_despacho') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: tablas de comisiones';
  END IF;
END
$$;

-- La wrapper hereda la seguridad de la funcion 238b y conserva el retorno UUID.
CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho(p_despachoid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN public.calcularcomisiondespacho_238b(p_despachoid);
END
$$;

REVOKE ALL ON FUNCTION public.calcularcomisiondespacho(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO service_role;

-- No se revoca el RPC detallado aqui. Su contrato de salida debe actualizarse
-- y probarse como un archivo separado antes del cutover para no romper el hook
-- useReporteVentasComisiones ni los PDFs detallados.

NOTIFY pgrst, 'reload schema';
COMMIT;
