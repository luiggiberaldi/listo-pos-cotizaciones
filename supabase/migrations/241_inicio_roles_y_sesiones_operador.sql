-- 241: sesión por dispositivo + lectura del inicio sin suplantación por headers/JWT compartido.
-- Desplegar junto al Worker y frontend de esta revisión. Requiere volver a introducir el PIN.
-- No modifica ventas, comisiones, usuarios ni sus credenciales existentes.
BEGIN;

CREATE TABLE public.operator_sessions (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  cuenta_id UUID NOT NULL,
  operator_id UUID NOT NULL,
  credential_hash TEXT,
  virtual_developer BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > creado_en),
  CHECK ((virtual_developer AND operator_id = '00000000-0000-0000-0000-000000000000' AND credential_hash IS NULL)
    OR (NOT virtual_developer AND credential_hash ~ '^[0-9a-f]{64}$'))
);
CREATE INDEX operator_sessions_account_idx ON public.operator_sessions(cuenta_id, operator_id);
ALTER TABLE public.operator_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_sessions TO service_role;

-- El token aleatorio se entrega solo tras verificar PIN en el Worker; se almacena únicamente su SHA-256.
-- Nunca se toma el rol del navegador ni de app_metadata de la cuenta compartida.
CREATE OR REPLACE FUNCTION public.current_operator_context()
RETURNS TABLE(operator_id UUID, rol TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_headers JSONB;
  v_token TEXT;
  v_requested TEXT;
  v_session public.operator_sessions%ROWTYPE;
  v_operator public.usuarios%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  BEGIN
    v_headers := COALESCE(NULLIF(current_setting('request.headers', TRUE), ''), '{}')::JSONB;
  EXCEPTION WHEN invalid_text_representation THEN RETURN;
  END;
  v_token := v_headers->>'x-operator-session';
  v_requested := NULLIF(v_headers->>'x-operator-id', '');
  IF v_token IS NULL OR v_token !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  SELECT s.* INTO v_session FROM public.operator_sessions s
  WHERE s.token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex')
    AND s.cuenta_id = auth.uid() AND s.revoked_at IS NULL AND s.expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF v_requested IS NOT NULL AND v_requested <> v_session.operator_id::TEXT THEN RETURN; END IF;
  IF v_session.virtual_developer AND v_session.operator_id = '00000000-0000-0000-0000-000000000000' THEN
    RETURN QUERY SELECT v_session.operator_id, 'desarrollador'::TEXT;
    RETURN;
  END IF;
  SELECT u.* INTO v_operator FROM public.usuarios u
  WHERE u.id = v_session.operator_id AND u.cuenta_id = auth.uid() AND u.activo = TRUE;
  IF NOT FOUND OR v_operator.pin_hash IS NULL OR v_operator.pin_salt IS NULL THEN RETURN; END IF;
  IF encode(sha256(convert_to(v_operator.pin_hash || ':' || v_operator.pin_salt, 'UTF8')), 'hex')
    IS DISTINCT FROM v_session.credential_hash THEN RETURN; END IF;
  IF v_operator.rol NOT IN ('jefe', 'supervisor', 'vendedor', 'vendedor_sin_comision', 'administracion', 'logistica', 'desarrollador') THEN RETURN; END IF;
  RETURN QUERY SELECT v_operator.id, v_operator.rol::TEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.current_operator_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_operator_context() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_operador_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT operator_id FROM public.current_operator_context() LIMIT 1; $$;
CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN auth.role() = 'service_role' THEN 'administracion'
    ELSE COALESCE((SELECT rol FROM public.current_operator_context() LIMIT 1), 'sin_operador') END;
$$;
-- 'sin_operador', no NULL: las comprobaciones IF rol NOT IN (...) también deben denegar.
REVOKE ALL ON FUNCTION public.get_operador_id(), public.get_rol_actual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operador_id(), public.get_rol_actual() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_read_seller(p_vendedor_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.current_operator_context() ctx
    WHERE ctx.rol IN ('jefe', 'administracion', 'logistica', 'desarrollador')
      OR ctx.operator_id = p_vendedor_id
      OR (ctx.rol = 'supervisor' AND EXISTS (
        SELECT 1 FROM public.usuarios u WHERE u.id = p_vendedor_id AND u.cuenta_id = auth.uid()
          AND u.rol IN ('vendedor', 'vendedor_sin_comision')
      ))
  ), FALSE);
$$;
REVOKE ALL ON FUNCTION public.can_read_seller(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_seller(UUID) TO authenticated, service_role;

-- Restrictive AND: las políticas amplias de 132 no pueden reabrir los registros ajenos.
CREATE POLICY dashboard_scope_select ON public.notas_despacho AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND public.can_read_seller(vendedor_id));
CREATE POLICY dashboard_scope_select ON public.cotizaciones AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND public.can_read_seller(vendedor_id));
CREATE POLICY dashboard_scope_select ON public.notas_despacho_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_id));
CREATE POLICY dashboard_scope_allow ON public.notas_despacho_items FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = despacho_id));
CREATE POLICY dashboard_scope_select ON public.cotizacion_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_id));
CREATE POLICY dashboard_scope_allow ON public.cotizacion_items FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND EXISTS (SELECT 1 FROM public.cotizaciones c WHERE c.id = cotizacion_id));
CREATE POLICY dashboard_scope_select ON public.comisiones AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuentaid = auth.uid() AND public.can_read_seller(vendedorid)
    AND public.get_rol_actual() <> 'logistica');
CREATE POLICY dashboard_scope_allow ON public.comisiones FOR SELECT TO authenticated
  USING (cuentaid = auth.uid() AND public.can_read_seller(vendedorid)
    AND public.get_rol_actual() <> 'logistica');
-- Tabla recreada en 183: también requiere su propia barrera tenant/beneficiario.
DO $$
BEGIN
  IF to_regclass('public.comision_liberaciones') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY dashboard_scope_select ON public.comision_liberaciones AS RESTRICTIVE FOR SELECT TO authenticated
      USING (cuenta_id = auth.uid() AND public.can_read_seller(vendedor_id)
        AND public.get_rol_actual() <> ''logistica''
        AND EXISTS (SELECT 1 FROM public.comisiones c WHERE c.id = comision_id))';
  END IF;
END;
$$;
CREATE POLICY dashboard_scope_select ON public.clientes AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND public.can_read_seller(vendedor_id));
CREATE POLICY dashboard_scope_select ON public.cuentas_por_cobrar AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = cliente_id));
CREATE POLICY dashboard_scope_select ON public.productos AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND public.get_rol_actual() IN ('jefe','supervisor','administracion','desarrollador'));
CREATE POLICY dashboard_scope_select ON public.usuarios AS RESTRICTIVE FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid() AND public.can_read_seller(id));

-- Los usuarios del navegador no deben poder descargar hashes/salts para atacar PIN ajenos.
-- Mantener las columnas de perfil empleadas por las pantallas existentes.
REVOKE SELECT ON public.usuarios FROM PUBLIC, authenticated, anon;
DO $$
DECLARE v_columns TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usuarios'
    AND column_name NOT IN ('pin_hash', 'pin_salt');
  EXECUTE 'GRANT SELECT (' || v_columns || ') ON public.usuarios TO authenticated';
  REVOKE SELECT (pin_hash, pin_salt) ON public.usuarios FROM PUBLIC, anon, authenticated;
END;
$$;

-- RPCs legacy SECURITY DEFINER con cuenta/vendedor arbitrarios: fuera del navegador.
-- El inicio/Comisiones ya usa el Worker validado. Mantener service_role para procesos internos.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('obtener_resumen_comisiones','obtener_resumen_comisiones_v2')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END;
$$;

-- Corregir los RPCs de reportes de 240 sin cambiar sus contratos de columnas:
-- auth.uid() es la cuenta, no el vendedor. Forzar alcance mediante el operador validado
-- incluso si p_vendedor_id llega NULL, sin usar el propietario actual del cliente.
DO $$
DECLARE f RECORD; definition TEXT;
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('obtener_reporte_ventas_operaciones','obtener_reporte_ventas_comisiones')
  LOOP
    definition := pg_get_functiondef(f.oid);
    definition := replace(definition, 'COALESCE(cl.vendedor_id, nd.vendedor_id)', 'nd.vendedor_id');
    definition := replace(definition, '''desarrollador'', ''vendedor''', '''desarrollador'', ''vendedor'', ''vendedor_sin_comision''');
    definition := replace(definition, 'v_rol = ''vendedor'' AND (p_vendedor_id IS NULL OR p_vendedor_id <> v_uid)',
      'v_rol IN (''vendedor'',''vendedor_sin_comision'') AND (p_vendedor_id IS NULL OR p_vendedor_id <> public.get_operador_id())');
    definition := replace(definition, 'WHERE nd.estado IN (''despachada'', ''entregada'')',
      'WHERE (auth.role() = ''service_role'' OR public.can_read_seller(nd.vendedor_id)) AND nd.estado IN (''despachada'', ''entregada'')');
    IF position('public.can_read_seller(nd.vendedor_id)' IN definition) = 0 THEN
      RAISE EXCEPTION 'Definición de % no compatible: revisar alcance antes de aplicar 241', f.proname;
    END IF;
    EXECUTE definition;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
