-- 131_limpieza_legacy_comisiones.sql
-- Fase 4: Limpieza de Legacy y Consolidación v2
-- Este script elimina las funciones RPC obsoletas del sistema de comisiones v1.

-- 1. Eliminar registrar_pago_comision (reemplazado por PATCH directo en v2)
DROP FUNCTION IF EXISTS public.registrar_pago_comision(UUID, UUID, UUID);

-- 2. Eliminar obtener_resumen_comisiones (reemplazado por obtener_resumen_comisiones_v2)
DROP FUNCTION IF EXISTS public.obtener_resumen_comisiones(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

-- 3. Eliminar calcular_comision_despacho (reemplazado por calcularcomisiondespacho)
DROP FUNCTION IF EXISTS public.calcular_comision_despacho(UUID);

COMMENT ON SCHEMA public IS 'Esquema de comisiones v2 consolidado. Se eliminaron funciones legacy v1.';
