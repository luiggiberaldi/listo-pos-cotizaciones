-- 282_retira_actualizar_producto_kardex_16.sql
--
-- RETIRO de la variante de 16 parámetros de `actualizar_producto_con_kardex`
-- (PRODUCCIÓN). Ya NO se usa (verificación 2026-10-25, cuatro evidencias):
--   1) permisos: solo `service_role` puede ejecutarla; `authenticated`/`anon` no
--      — la app (el navegador) ya no puede ni llamarla;
--   2) código: la app y el Worker usan `/api/productos/actualizar` →
--      `actualizar_producto_con_kardex_tenant_safe`, y ninguna otra función de
--      la base la invoca (confirmado en vivo: 0 referencias desde otros cuerpos);
--   3) datos: sus movimientos de kardex típicos terminan el 2026-08-18;
--   4) memoria de consultas: sus últimas llamadas reales son de abril–agosto 2026.
-- La ruta viva de edición de productos (tenant_safe, 21 args) NO se toca.
--
-- La guarda de precios (281_guarda_precios_ddl) rechaza el borrado de funciones
-- protegidas; el DROP lleva el pase autorizado porque el retiro es una decisión
-- de este release (282), no una pérdida del arreglo de precios. La guarda sigue
-- protegiendo el nombre: si alguien lo recrea, exigirá el marcador «contrato de
-- precios» (o el mismo pase).
--
-- Verificación: scripts/apply-282-retiro-16-produccion.mjs (preflight con
-- pre-imagen == rollback, apply, postflight read-only y prueba de
-- comportamiento revertida vía tenant_safe; nada queda escrito).
-- Rollback: 282_retira_actualizar_producto_kardex_16_rollback.sql (pre-imagen
-- exacta capturada en supabase/release/main/backup_pre_282/).
--
-- Permisos: la variante eliminada se lleva sus grants (postgres, service_role).

BEGIN;

-- Pase autorizado de la guarda de precios (transacción común con el DROP).
SET LOCAL app.precios_rollback_autorizado = 'REVERTIR_PRECIOS';

DROP FUNCTION IF EXISTS public.actualizar_producto_con_kardex(uuid, text, text, text, text, text, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric);

NOTIFY pgrst, 'reload schema';
COMMIT;
