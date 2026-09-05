-- ═════════════════════════════════════════════════════════════════════════════
-- 07_comision_split_designado_v3_rollback_review.sql
-- Reversión del paquete 07: restaura los cuerpos vivos previos (SHA-256 en
-- tmp/preflight-main-v3/summary.json) y elimina los objetos nuevos.
-- Ejecutar SOLO si el piloto falla y se decide volver atrás.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Restaurar 238b vivo previo (v2, single-fila) — pegar cuerpo de
--    tmp/preflight-main-v3/fn_calcularcomisiondespacho_238b.sql tal cual.
-- 2) Restaurar ajustar_finanzas_devolucion_atomica previo — cuerpo de
--    tmp/preflight-main-v3/fn_ajustar_finanzas_devolucion_atomica.sql.
--    (El apply script genera 07_rollback_aplicar.sql con los cuerpos incrustados;
--     este archivo documenta el plan y los pasos manuales.)

-- 3) Toggle OFF (primer escalón de cualquier reversión)
UPDATE public.configuracion_negocio SET comision_split_activo = false;

-- 4) Eliminar filas split creadas durante el piloto (evidencia: calculo_evidencia)
DELETE FROM public.comisiones c
WHERE (c.calculo_evidencia->>'split_cliente_ajeno')::boolean IS TRUE;

-- 5) Quitar el índice multi-fila y devolver la unicidad original
DROP INDEX IF EXISTS public.ux_comisiones_despacho_vendedor;
CREATE UNIQUE INDEX IF NOT EXISTS ux_comisiones_despachoid_238a
  ON public.comisiones (despachoid);

-- 6) Borrar la función recalcular (no existía antes del paquete 07)
DROP FUNCTION IF EXISTS public.recalcularcomisiondespacho_238b(uuid);

-- 7) Eliminar objetos de designación
DROP TABLE IF EXISTS public.comision_designacion_diaria;

-- 8) Retirar columnas de configuración split
ALTER TABLE public.configuracion_negocio
  DROP COLUMN IF EXISTS comision_split_activo,
  DROP COLUMN IF EXISTS comision_split_pct_vendedor,
  DROP COLUMN IF EXISTS comision_split_pct_dueno,
  DROP COLUMN IF EXISTS comision_split_dias;

NOTIFY pgrst, 'reload schema';
COMMIT;
