-- 300_indices_relaciones_fase2.sql
-- Plan de optimización, Fase 2 (docs/operaciones/plan-optimizacion-velocidad-20261106.md).
-- Agrega 39 índices a relaciones entre tablas que no tenían índice y quita 1 índice repetido.
-- No cambia ningún resultado, solo la rapidez.
-- Aplicado en PRODUCCIÓN el 2026-11-07 (UTC) uno por uno con CONCURRENTLY (sin bloquear).
-- Nota: CONCURRENTLY no puede ir dentro de una transacción; ejecutar cada sentencia por separado.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cliente_prestamos_cliente_id ON public.cliente_prestamos (cliente_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cliente_prestamos_despacho_id ON public.cliente_prestamos (despacho_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cliente_prestamos_producto_id ON public.cliente_prestamos (producto_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clientes_ultima_reasig_por ON public.clientes (ultima_reasig_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cod_conciliacion_idempotencia_despacho_id ON public.cod_conciliacion_idempotencia (despacho_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comision_238b_batch_rows_comision_id ON public.comision_238b_batch_rows (comision_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comision_designacion_diaria_creado_por ON public.comision_designacion_diaria (creado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comision_designacion_diaria_designado_id ON public.comision_designacion_diaria (designado_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comision_liberaciones_vendedor_id ON public.comision_liberaciones (vendedor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comisiones_cotizacionid ON public.comisiones (cotizacionid);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comisiones_vendedorid ON public.comisiones (vendedorid);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cotizaciones_transportista_id ON public.cotizaciones (transportista_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cotizaciones_vehiculo_id ON public.cotizaciones (vehiculo_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cuentas_por_cobrar_registrado_por ON public.cuentas_por_cobrar (registrado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cuentas_por_pagar_registrado_por ON public.cuentas_por_pagar (registrado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_descuentos_aplicado_por ON public.despacho_descuentos (aplicado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_descuentos_cotizacion_item_id ON public.despacho_descuentos (cotizacion_item_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_descuentos_despacho_item_id ON public.despacho_descuentos (despacho_item_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_devolucion_intercambios_producto_id ON public.despacho_devolucion_intercambios (producto_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_devolucion_intercambios_registrado_por ON public.despacho_devolucion_intercambios (registrado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_devoluciones_cotizacion_reemplazo_id ON public.despacho_devoluciones (cotizacion_reemplazo_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_devoluciones_despacho_item_id ON public.despacho_devoluciones (despacho_item_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_devoluciones_producto_id ON public.despacho_devoluciones (producto_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_despacho_devoluciones_registrado_por ON public.despacho_devoluciones (registrado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventario_movimientos_usuario_id ON public.inventario_movimientos (usuario_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notas_despacho_creado_por ON public.notas_despacho (creado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notas_despacho_vehiculo_id ON public.notas_despacho (vehiculo_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notas_despacho_items_editado_por ON public.notas_despacho_items (editado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pagos_transportistas_creado_por ON public.pagos_transportistas (creado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pagos_transportistas_revertido_por ON public.pagos_transportistas (revertido_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pagos_transportistas_despachos_despacho_id ON public.pagos_transportistas_despachos (despacho_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_subscriptions_usuario_id ON public.push_subscriptions (usuario_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reasignaciones_clientes_vendedor_destino ON public.reasignaciones_clientes (vendedor_destino);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reasignaciones_clientes_vendedor_origen ON public.reasignaciones_clientes (vendedor_origen);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seguimiento_operativo_usuario_id ON public.seguimiento_operativo (usuario_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transportistas_creado_por ON public.transportistas (creado_por);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transportistas_empleado_id ON public.transportistas (empleado_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transportistas_vehiculo_habitual_id ON public.transportistas (vehiculo_habitual_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usuarios_creado_por ON public.usuarios (creado_por);

-- Índice repetido: idx_notas_despacho_cliente era idéntico a idx_nd_cliente_id (se conserva este último).
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notas_despacho_cliente;
