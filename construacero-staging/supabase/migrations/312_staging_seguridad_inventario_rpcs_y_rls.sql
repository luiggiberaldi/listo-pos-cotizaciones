-- OP-2026-071 Fase 3 (N30 + N16) — Solo STAGING
--
-- Cierra la superficie de ejecución directa (anon / authenticated) sobre RPCs de
-- mutación de inventario/despachos/préstamos/devoluciones y bloquea toda
-- escritura directa desde el cliente REST/PostgREST en tablas críticas,
-- conservando acceso de solo lectura (SELECT) dentro del tenant para el UI.
-- NO ejecuta DROP/CREATE/ALTER sobre funciones protegidas por guarda_precios_ddl.

-- 1. Asegurar limpieza de préstamos en tester_cleanup_cotizacion (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.tester_cleanup_cotizacion(p_cotizacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rol TEXT;
  v_despacho_ids UUID[] := '{}'::UUID[];
  v_comision_ids UUID[] := '{}'::UUID[];
  v_item_ids UUID[] := '{}'::UUID[];
BEGIN
  v_rol := public.get_rol_actual();
  IF v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'TESTER_ROLE_REQUIRED: solo roles privilegiados pueden ejecutar limpieza';
  END IF;

  SELECT array_agg(id) INTO v_despacho_ids
  FROM public.notas_despacho
  WHERE cotizacion_id = p_cotizacion_id;

  IF v_despacho_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_item_ids
    FROM public.notas_despacho_items
    WHERE despacho_id = ANY(v_despacho_ids);

    IF v_item_ids IS NOT NULL THEN
      DELETE FROM public.despacho_descuentos WHERE despacho_item_id = ANY(v_item_ids);
    END IF;

    SELECT array_agg(id) INTO v_comision_ids
    FROM public.comisiones
    WHERE despachoid = ANY(v_despacho_ids);

    IF v_comision_ids IS NOT NULL THEN
      DELETE FROM public.comision_liberaciones WHERE comision_id = ANY(v_comision_ids);
      DELETE FROM public.comisiones WHERE id = ANY(v_comision_ids);
    END IF;

    DELETE FROM public.cliente_prestamos WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.cuentas_por_cobrar WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_fecha_entrega_cambios WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.pagos_transportistas_despachos WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.seguimiento_operativo WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_devoluciones WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.despacho_devolucion_intercambios WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.notas_despacho_items WHERE despacho_id = ANY(v_despacho_ids);
    DELETE FROM public.notas_despacho WHERE id = ANY(v_despacho_ids);
  END IF;

  DELETE FROM public.comisiones WHERE cotizacionid = p_cotizacion_id;
  DELETE FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id;
  DELETE FROM public.cotizaciones WHERE id = p_cotizacion_id;
END;
$function$;

-- 2. Revocar EXECUTE de RPCs de mutación y legacy de PUBLIC, anon y authenticated;
-- otorgar únicamente a service_role (usado por Cloudflare Worker).
DO $$
DECLARE
  r RECORD;
  v_solo_service TEXT[] := ARRAY[
    'actualizar_estado_despacho',
    'actualizar_producto_con_kardex',
    'actualizar_producto_con_kardex_staging',
    'actualizar_producto_con_kardex_tenant_safe',
    'ajustar_conteo_inventario_atomico',
    'ajustar_conteo_inventario_atomico_staging',
    'ajustar_finanzas_devolucion_atomica',
    'ajustar_finanzas_devolucion_neta',
    'anular_despacho_atomico',
    'anular_despacho_con_pagos_staging',
    'aplicar_lote_precios',
    'aplicar_movimiento_inventario_atomico',
    'aplicar_movimiento_inventario_atomico_staging',
    'aplicar_movimiento_lote',
    'aprobar_despacho_inventario_atomico',
    'backfill_kardex_provenance_staging',
    'borrar_producto_con_kardex',
    'borrar_producto_con_kardex_staging',
    'borrar_producto_con_kardex_tenant_safe',
    'confirmar_entrega_finanzas_atomica_staging',
    'confirmar_entrega_finanzas_idempotente',
    'confirmar_entrega_inventario_atomica',
    'confirmar_entrega_inventario_atomica_staging',
    'confirmar_entrega_inventario_idempotente',
    'crear_nota_despacho',
    'crear_producto_con_kardex',
    'crear_producto_con_kardex_staging',
    'crear_producto_con_kardex_tenant_safe',
    'crear_version_cotizacion',
    'devolucion_con_donacion_staging',
    'devolver_prestamo_inventario_atomico',
    'devolver_prestamo_inventario_atomico_staging',
    'editar_despacho_profundidad',
    'editar_despacho_profundidad_con_cxc_staging',
    'enviar_cotizacion',
    'ingresar_lote_inventario_atomico',
    'ingresar_lote_inventario_atomico_staging',
    'obtener_items_netos_despacho',
    'obtener_stock_comprometido',
    'obtener_stock_comprometido_detalle',
    'reabrir_despacho_con_pagos_staging',
    'reciclar_cotizacion',
    'reciclar_despacho',
    'registrar_devolucion_inventario_atomica',
    'registrar_devolucion_parcial_atomica',
    'registrar_devolucion_parcial_atomica_staging',
    'registrar_devolucion_parcial_cobro_idempotente',
    'registrar_devolucion_parcial_cobro_staging',
    'registrar_devolucion_parcial_finanzas_atomica_staging',
    'registrar_devolucion_parcial_idempotente',
    'reservar_operacion_inventario',
    'revertir_despacho_inventario_atomica',
    'revertir_entrega_finanzas_atomica',
    'revertir_entrega_finanzas_atomica_staging',
    'revertir_entrega_finanzas_idempotente',
    'revertir_entrega_inventario_atomica',
    'revertir_entrega_inventario_idempotente',
    'revertir_movimiento_inventario_atomico',
    'revertir_pago_transportista',
    'revertir_reconciliacion_comisiones_238b',
    'revertir_reconciliacion_kardex',
    'revertir_reconciliacion_kardex_staging',
    'sincronizar_prestamos_despacho',
    'staging_etiquetar_lote',
    'staging_guardar_operacion',
    'staging_reservar_operacion',
    'transformar_inventario_atomico',
    'transformar_inventario_atomico_staging',
    'verificar_prestamos_despacho_reaperturable'
  ];
  v_solo_auth_y_service TEXT[] := ARRAY[
    'buscar_productos_hibrido',
    'obtener_categorias_vendedor',
    'obtener_productos_vendedor',
    'obtener_reporte_articulos_externos',
    'obtener_reporte_ventas_comisiones',
    'obtener_reporte_ventas_operaciones',
    'obtener_stock_productos',
    'peso_producto_visible',
    'tester_cleanup_cotizacion'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_solo_service)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_solo_auth_y_service)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon;', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role;', r.sig);
  END LOOP;
END $$;

-- 3. Endurecimiento RLS (N30 + N16): solo lectura autenticada dentro del tenant.
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_operaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_operaciones_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_despacho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_despacho_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_prestamos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_devoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_devolucion_intercambios ENABLE ROW LEVEL SECURITY;

-- productos
DROP POLICY IF EXISTS "isolation_productos" ON public.productos;
DROP POLICY IF EXISTS "productos_admin_insert" ON public.productos;
DROP POLICY IF EXISTS "productos_admin_update" ON public.productos;
DROP POLICY IF EXISTS "productos_admin_delete" ON public.productos;
DROP POLICY IF EXISTS "productos_jefe_all" ON public.productos;

-- inventario_movimientos
DROP POLICY IF EXISTS "isolation_inventario_movimientos" ON public.inventario_movimientos;
DROP POLICY IF EXISTS "inventario_movimientos_jefe_all" ON public.inventario_movimientos;
DROP POLICY IF EXISTS "movimientos_admin_insert" ON public.inventario_movimientos;
DROP POLICY IF EXISTS "movimientos_supervisor_insert" ON public.inventario_movimientos;
DROP POLICY IF EXISTS "inventario_movimientos_authenticated_select" ON public.inventario_movimientos;
CREATE POLICY "inventario_movimientos_authenticated_select"
  ON public.inventario_movimientos
  FOR SELECT
  TO authenticated
  USING (cuenta_id = (SELECT auth.uid() AS uid));

-- notas_despacho
DROP POLICY IF EXISTS "isolation_notas_despacho" ON public.notas_despacho;
DROP POLICY IF EXISTS "notas_despacho_jefe_all" ON public.notas_despacho;
DROP POLICY IF EXISTS "despachos_supervisor_update" ON public.notas_despacho;

-- notas_despacho_items
DROP POLICY IF EXISTS "isolation_notas_despacho_items" ON public.notas_despacho_items;
DROP POLICY IF EXISTS "nd_items_admin" ON public.notas_despacho_items;
DROP POLICY IF EXISTS "nd_items_authenticated_select" ON public.notas_despacho_items;
CREATE POLICY "nd_items_authenticated_select"
  ON public.notas_despacho_items
  FOR SELECT
  TO authenticated
  USING (cuenta_id = (SELECT auth.uid() AS uid));

-- cliente_prestamos (cierra N16: qual=true/with_check=true)
DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en cliente_prestamos" ON public.cliente_prestamos;
DROP POLICY IF EXISTS "isolation_cliente_prestamos" ON public.cliente_prestamos;
DROP POLICY IF EXISTS "cliente_prestamos_authenticated_select" ON public.cliente_prestamos;
CREATE POLICY "cliente_prestamos_authenticated_select"
  ON public.cliente_prestamos
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = cliente_prestamos.cliente_id
        AND c.cuenta_id = (SELECT auth.uid() AS uid)
    )
  );

-- despacho_devoluciones (cierra bypass qual=true)
DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en despacho_devoluciones" ON public.despacho_devoluciones;
DROP POLICY IF EXISTS "despacho_devoluciones_authenticated_select" ON public.despacho_devoluciones;
CREATE POLICY "despacho_devoluciones_authenticated_select"
  ON public.despacho_devoluciones
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notas_despacho d
      WHERE d.id = despacho_devoluciones.despacho_id
        AND d.cuenta_id = (SELECT auth.uid() AS uid)
    )
  );

-- despacho_devolucion_intercambios (cierra bypass qual=true)
DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en despacho_devolucion_i" ON public.despacho_devolucion_intercambios;
DROP POLICY IF EXISTS "despacho_devolucion_intercambios_authenticated_select" ON public.despacho_devolucion_intercambios;
CREATE POLICY "despacho_devolucion_intercambios_authenticated_select"
  ON public.despacho_devolucion_intercambios
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notas_despacho d
      WHERE d.id = despacho_devolucion_intercambios.despacho_id
        AND d.cuenta_id = (SELECT auth.uid() AS uid)
    )
  );

-- Privilegios de tabla: defensa en profundidad contra escritura directa por REST.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.productos,
  public.inventario_movimientos,
  public.notas_despacho,
  public.notas_despacho_items,
  public.cliente_prestamos,
  public.despacho_devoluciones,
  public.despacho_devolucion_intercambios
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE
  public.inventario_operaciones,
  public.inventario_operaciones_staging
FROM PUBLIC, anon, authenticated;
