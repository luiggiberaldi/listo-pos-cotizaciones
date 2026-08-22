-- 234_tester_cleanup_tenant_safe.sql
-- Corrige la limpieza del Tester Determinista.
--
-- La versión 075 podía devolver 400 cuando el JWT todavía no exponía el rol
-- del operador virtual o cuando existían referencias financieras de un
-- despacho (por ejemplo pagos_transportistas_despachos). Esta versión:
--   * acepta explícitamente los roles privilegiados permitidos;
--   * exige que la cotización pertenezca a auth.uid() (tenant actual);
--   * elimina dependencias que bloquean la eliminación del despacho;
--   * mantiene la operación SECURITY DEFINER sin abrirla a anon.

CREATE OR REPLACE FUNCTION public.tester_cleanup_cotizacion(p_cotizacion_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id UUID := auth.uid();
  v_rol TEXT := COALESCE(
    auth.jwt()->'app_metadata'->>'operator_rol',
    public.get_rol_actual()
  );
  v_cotizacion_cuenta_id UUID;
  v_despacho_ids UUID[];
  v_comision_ids UUID[];
  v_pago_ids UUID[];
BEGIN
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'TESTER_AUTH_REQUIRED: se requiere una sesión autenticada';
  END IF;

  IF v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador') THEN
    RAISE EXCEPTION 'TESTER_ROLE_REQUIRED: solo roles privilegiados pueden ejecutar limpieza';
  END IF;

  SELECT cuenta_id
    INTO v_cotizacion_cuenta_id
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_cotizacion_cuenta_id IS DISTINCT FROM v_cuenta_id THEN
    RAISE EXCEPTION 'TESTER_TENANT_MISMATCH: la cotización no pertenece a la cuenta actual';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
    INTO v_despacho_ids
  FROM public.notas_despacho
  WHERE cotizacion_id = p_cotizacion_id;

  IF cardinality(v_despacho_ids) > 0 THEN
    -- Esta tabla no tenía ON DELETE CASCADE hacia notas_despacho. Capturar
    -- primero los pagos del fixture para no dejar registros append-only huérfanos.
    SELECT COALESCE(array_agg(DISTINCT pago_id), ARRAY[]::UUID[])
      INTO v_pago_ids
    FROM public.pagos_transportistas_despachos
    WHERE despacho_id = ANY(v_despacho_ids)
      AND cuenta_id = v_cuenta_id;

    DELETE FROM public.pagos_transportistas_despachos
    WHERE despacho_id = ANY(v_despacho_ids)
      AND cuenta_id = v_cuenta_id;

    -- Solo borrar el pago si ya no conserva vínculos con otros despachos. Así
    -- la limpieza tenant-safe no puede tocar una liquidación real compartida.
    IF cardinality(v_pago_ids) > 0 THEN
      DELETE FROM public.pagos_transportistas p
      WHERE p.id = ANY(v_pago_ids)
        AND p.cuenta_id = v_cuenta_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.pagos_transportistas_despachos j
          WHERE j.pago_id = p.id
        );
    END IF;

    DELETE FROM public.despacho_descuentos
    WHERE despacho_id = ANY(v_despacho_ids);

    DELETE FROM public.cuentas_por_cobrar
    WHERE despacho_id = ANY(v_despacho_ids);

    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
      INTO v_comision_ids
    FROM public.comisiones
    WHERE despachoid = ANY(v_despacho_ids);

    -- comision_liberaciones tiene ON DELETE CASCADE, pero se elimina de forma
    -- explícita para que el contrato siga siendo claro ante esquemas antiguos.
    IF cardinality(v_comision_ids) > 0 THEN
      DELETE FROM public.comision_liberaciones
      WHERE comision_id = ANY(v_comision_ids);
    END IF;

    DELETE FROM public.comisiones
    WHERE despachoid = ANY(v_despacho_ids);

    DELETE FROM public.notas_despacho
    WHERE id = ANY(v_despacho_ids);
  END IF;

  DELETE FROM public.comisiones
  WHERE cotizacionid = p_cotizacion_id;

  DELETE FROM public.cotizacion_items
  WHERE cotizacion_id = p_cotizacion_id;

  DELETE FROM public.cotizaciones
  WHERE id = p_cotizacion_id;
END;
$$;

REVOKE ALL ON FUNCTION public.tester_cleanup_cotizacion(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tester_cleanup_cotizacion(UUID) TO authenticated;
