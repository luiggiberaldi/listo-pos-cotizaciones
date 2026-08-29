-- POST-FLIGHT SOLO LECTURA — staging
-- No modifica datos.

-- 1) Cuenta de staging y resumen de operadores enlazados.
WITH destino AS (
  SELECT id
  FROM auth.users
  WHERE lower(email) = 'supervisor@listo.sys'
)
SELECT
  (SELECT id FROM destino) AS cuenta_staging_id,
  (SELECT count(*) FROM public.usuarios u WHERE u.cuenta_id = (SELECT id FROM destino)) AS usuarios_totales,
  (SELECT count(*) FROM public.usuarios u WHERE u.cuenta_id = (SELECT id FROM destino) AND u.activo = true) AS usuarios_activos,
  (SELECT count(*) FROM public.configuracion_negocio c WHERE c.cuenta_id = (SELECT id FROM destino)) AS configuraciones,
  (SELECT nombre_negocio FROM public.configuracion_negocio c WHERE c.cuenta_id = (SELECT id FROM destino) LIMIT 1) AS negocio;

-- 2) Datos principales visibles para la cuenta de staging.
WITH destino AS (
  SELECT id
  FROM auth.users
  WHERE lower(email) = 'supervisor@listo.sys'
)
SELECT 'clientes' AS tabla, count(*) AS filas FROM public.clientes WHERE cuenta_id = (SELECT id FROM destino)
UNION ALL SELECT 'productos', count(*) FROM public.productos WHERE cuenta_id = (SELECT id FROM destino)
UNION ALL SELECT 'cotizaciones', count(*) FROM public.cotizaciones WHERE cuenta_id = (SELECT id FROM destino)
UNION ALL SELECT 'notas_despacho', count(*) FROM public.notas_despacho WHERE cuenta_id = (SELECT id FROM destino)
UNION ALL SELECT 'transportistas', count(*) FROM public.transportistas WHERE cuenta_id = (SELECT id FROM destino)
UNION ALL SELECT 'inventario_movimientos', count(*) FROM public.inventario_movimientos WHERE cuenta_id = (SELECT id FROM destino)
ORDER BY tabla;

-- 3) Debe quedar un segundo tenant separado con tres operadores activos.
--    La consulta no muestra identificadores ni datos comerciales.
SELECT
  count(*) AS cuentas_de_operadores,
  sum(total_operadores) AS operadores_totales,
  sum(operadores_activos) AS operadores_activos
FROM (
  SELECT cuenta_id,
         count(*) AS total_operadores,
         count(*) FILTER (WHERE activo) AS operadores_activos
  FROM public.usuarios
  WHERE cuenta_id IS NOT NULL
  GROUP BY cuenta_id
) grupos
WHERE total_operadores = 3;
