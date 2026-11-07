-- 300_indices_relaciones_fase2_rollback.sql
-- Deshace la migración 300: borra los 39 índices nuevos y recrea el repetido.
-- Ejecutar cada sentencia por separado (CONCURRENTLY no admite transacción).

DROP INDEX CONCURRENTLY IF EXISTS public.idx_cliente_prestamos_cliente_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cliente_prestamos_despacho_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cliente_prestamos_producto_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_clientes_ultima_reasig_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cod_conciliacion_idempotencia_despacho_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comision_238b_batch_rows_comision_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comision_designacion_diaria_creado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comision_designacion_diaria_designado_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comision_liberaciones_vendedor_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comisiones_cotizacionid;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comisiones_vendedorid;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cotizaciones_transportista_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cotizaciones_vehiculo_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cuentas_por_cobrar_registrado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_cuentas_por_pagar_registrado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_descuentos_aplicado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_descuentos_cotizacion_item_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_descuentos_despacho_item_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_devolucion_intercambios_producto_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_devolucion_intercambios_registrado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_devoluciones_cotizacion_reemplazo_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_devoluciones_despacho_item_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_devoluciones_producto_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_despacho_devoluciones_registrado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_inventario_movimientos_usuario_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notas_despacho_creado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notas_despacho_vehiculo_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notas_despacho_items_editado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_pagos_transportistas_creado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_pagos_transportistas_revertido_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_pagos_transportistas_despachos_despacho_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_push_subscriptions_usuario_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_reasignaciones_clientes_vendedor_destino;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_reasignaciones_clientes_vendedor_origen;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_seguimiento_operativo_usuario_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_transportistas_creado_por;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_transportistas_empleado_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_transportistas_vehiculo_habitual_id;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_usuarios_creado_por;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notas_despacho_cliente ON public.notas_despacho USING btree (cliente_id);
