-- 283_flota_vehiculos_locales_rollback_review.sql — REVERSA del plan de flota (PRODUCCIÓN).
-- Copia de construacero-staging/supabase/migrations/283_flota_vehiculos_locales_rollback.sql.
-- Solo para usar si el postflight falla o hay un problema grave tras el apply.
-- Efecto: se pierde la asignación de camión de los viajes (columnas nuevas); NO toca
-- cotizaciones, notas de despacho, pagos ni comisiones. El Worker y la web deben
-- volver ANTES a la versión sin flota (si no, pedirían columnas que ya no existen).

DO $$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY: reversa 283 solo en ventana autorizada'; END $$;

-- 283_flota_vehiculos_locales_rollback.sql
-- Revierte la migración 283 por completo (estructura y funciones).
-- OJO: las asignaciones de vehículo en viajes viejos se pierden junto con las
-- columnas; no toca cotizaciones, notas de despacho ni pagos existentes.

BEGIN;

DROP TRIGGER IF EXISTS trg_autocompletar_vehiculo_despacho ON public.notas_despacho;
DROP FUNCTION IF EXISTS public.fn_autocompletar_vehiculo_despacho();
DROP FUNCTION IF EXISTS public.eliminar_o_desactivar_vehiculo_atomico(UUID, UUID);
DROP FUNCTION IF EXISTS public.eliminar_o_desactivar_transportista_atomico(UUID, UUID);
DROP FUNCTION IF EXISTS public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

ALTER TABLE public.notas_despacho
  DROP COLUMN IF EXISTS vehiculo_origen,
  DROP COLUMN IF EXISTS vehiculo_id;

ALTER TABLE public.cotizaciones
  DROP COLUMN IF EXISTS vehiculo_id;

ALTER TABLE public.transportistas
  DROP COLUMN IF EXISTS vehiculo_habitual_id;

DROP TABLE IF EXISTS public.vehiculos;

COMMIT;
