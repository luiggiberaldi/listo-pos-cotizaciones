-- PRE-FLIGHT SOLO LECTURA — staging
-- Proyecto esperado: spupqgkdsgohxxfoxydl
-- No ejecutar en producción.
-- Este archivo únicamente consulta el estado actual; no realiza cambios.

-- 1) Cuenta de destino y tenant de origen.
SELECT
  au.id AS cuenta_staging_id,
  au.email AS cuenta_staging_email,
  au.email_confirmed_at IS NOT NULL AS correo_confirmado,
  cn.id AS configuracion_origen_id,
  cn.cuenta_id AS cuenta_origen_id,
  cn.nombre_negocio,
  cn.moneda_principal
FROM auth.users au
LEFT JOIN public.configuracion_negocio cn
  ON cn.id = 1
WHERE lower(au.email) = 'supervisor@listo.sys';

-- 2) Debe existir el destino, el origen debe ser distinto y el destino no debe
--    tener datos propios. Si alguna cuenta ya tiene datos, el paquete debe parar.
WITH destino AS (
  SELECT id
  FROM auth.users
  WHERE lower(email) = 'supervisor@listo.sys'
), origen AS (
  SELECT cuenta_id
  FROM public.configuracion_negocio
  WHERE id = 1
    AND lower(coalesce(nombre_negocio, '')) LIKE '%construacero%'
)
SELECT
  (SELECT count(*) FROM destino) AS destinos_encontrados,
  (SELECT count(*) FROM origen) AS origenes_encontrados,
  (SELECT count(*) FROM public.usuarios u WHERE u.cuenta_id = (SELECT id FROM destino)) AS usuarios_ya_en_destino,
  (SELECT count(*) FROM public.configuracion_negocio c WHERE c.cuenta_id = (SELECT id FROM destino)) AS configuraciones_ya_en_destino,
  (SELECT count(*) FROM public.usuarios u WHERE u.cuenta_id = (SELECT cuenta_id FROM origen)) AS usuarios_en_origen,
  (SELECT count(*) FROM public.clientes c WHERE c.cuenta_id = (SELECT cuenta_id FROM origen)) AS clientes_en_origen,
  (SELECT count(*) FROM public.productos p WHERE p.cuenta_id = (SELECT cuenta_id FROM origen)) AS productos_en_origen,
  (SELECT count(*) FROM public.cotizaciones c WHERE c.cuenta_id = (SELECT cuenta_id FROM origen)) AS cotizaciones_en_origen,
  (SELECT count(*) FROM public.notas_despacho d WHERE d.cuenta_id = (SELECT cuenta_id FROM origen)) AS despachos_en_origen;

-- 3) Resumen de tablas que se moverían. Las filas NULL no se mueven.
WITH origen AS (
  SELECT cuenta_id
  FROM public.configuracion_negocio
  WHERE id = 1
    AND lower(coalesce(nombre_negocio, '')) LIKE '%construacero%'
)
SELECT 'auditoria' AS tabla, count(*) AS filas FROM public.auditoria WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'buzon_sugerencias', count(*) FROM public.buzon_sugerencias WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'clientes', count(*) FROM public.clientes WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'comision_liberaciones', count(*) FROM public.comision_liberaciones WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'configuracion_negocio', count(*) FROM public.configuracion_negocio WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'cotizacion_items', count(*) FROM public.cotizacion_items WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'cotizaciones', count(*) FROM public.cotizaciones WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'cuentas_por_cobrar', count(*) FROM public.cuentas_por_cobrar WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'cuentas_por_pagar', count(*) FROM public.cuentas_por_pagar WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'despacho_descuentos', count(*) FROM public.despacho_descuentos WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'inventario_movimientos', count(*) FROM public.inventario_movimientos WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'notas_despacho', count(*) FROM public.notas_despacho WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'notas_despacho_items', count(*) FROM public.notas_despacho_items WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'orden_compra_items', count(*) FROM public.orden_compra_items WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'ordenes_compra', count(*) FROM public.ordenes_compra WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'pagos_transportistas', count(*) FROM public.pagos_transportistas WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'pagos_transportistas_despachos', count(*) FROM public.pagos_transportistas_despachos WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'productos', count(*) FROM public.productos WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'proveedores', count(*) FROM public.proveedores WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'reasignaciones_clientes', count(*) FROM public.reasignaciones_clientes WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'seguimiento_operativo', count(*) FROM public.seguimiento_operativo WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'transportistas', count(*) FROM public.transportistas WHERE cuenta_id = (SELECT cuenta_id FROM origen)
UNION ALL SELECT 'usuarios', count(*) FROM public.usuarios WHERE cuenta_id = (SELECT cuenta_id FROM origen)
ORDER BY tabla;
