-- 14_cod_financial_rpcs_review.sql
-- Main-project COD financial RPCs used by worker.js / api/handlers/cod.js.
-- REVIEW ONLY: do not run directly. No live schema or deployment SHA was checked.
-- The manual apply plan must first resolve the Supabase migration-history drift,
-- verify a backup, and test in a disposable database. This file deliberately
-- stops at REVIEW_ONLY until that release gate is explicitly approved.
--
-- Dependencies: account-scoped cuentas_por_cobrar schema (052/167/tenant
-- hardening), notas_despacho.forma_pago(_cliente), auditoria, users/clients,
-- dispatch return tables, and recalcularcomisiondespacho_238b from release 07.
-- The staging-only cash-repair endpoint/RPC is intentionally not promoted here.

BEGIN;

DO $review_gate$
BEGIN
  RAISE EXCEPTION 'REVIEW_ONLY: 14_cod_financial_rpcs_review.sql requiere aprobacion, backup y prueba aislada';
END;
$review_gate$;

DO $preflight$
DECLARE
  v_missing TEXT;
BEGIN
  IF to_regclass('public.notas_despacho') IS NULL
     OR to_regclass('public.cuentas_por_cobrar') IS NULL
     OR to_regclass('public.clientes') IS NULL
     OR to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.auditoria') IS NULL
     OR to_regclass('public.despacho_devoluciones') IS NULL
     OR to_regclass('public.despacho_devolucion_intercambios') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: tablas del contrato COD';
  END IF;

  IF to_regprocedure('public.recalcularcomisiondespacho_238b(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: release 07 debe instalar recalcularcomisiondespacho_238b(uuid)';
  END IF;
  IF to_regprocedure('pg_catalog.pg_input_is_valid(text,text)') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: PostgreSQL debe soportar pg_input_is_valid(text,text)';
  END IF;

  SELECT string_agg(required.table_name || '.' || required.column_name, ', ' ORDER BY required.table_name, required.column_name)
    INTO v_missing
  FROM (VALUES
    ('notas_despacho','id'), ('notas_despacho','numero'), ('notas_despacho','cuenta_id'),
    ('notas_despacho','estado'), ('notas_despacho','cliente_id'),
    ('notas_despacho','cliente_factura_id'), ('notas_despacho','total_usd'),
    ('notas_despacho','forma_pago'), ('notas_despacho','forma_pago_cliente'),
    ('cuentas_por_cobrar','id'), ('cuentas_por_cobrar','cuenta_id'),
    ('cuentas_por_cobrar','cliente_id'), ('cuentas_por_cobrar','despacho_id'),
    ('cuentas_por_cobrar','tipo'), ('cuentas_por_cobrar','monto_usd'),
    ('cuentas_por_cobrar','saldo_usd'), ('cuentas_por_cobrar','metodo_pago'),
    ('cuentas_por_cobrar','forma_pago_abono'), ('cuentas_por_cobrar','referencia'),
    ('cuentas_por_cobrar','descripcion'), ('cuentas_por_cobrar','registrado_por'),
    ('clientes','id'), ('clientes','cuenta_id'), ('usuarios','id'), ('usuarios','cuenta_id'),
    ('usuarios','nombre'), ('usuarios','rol'), ('usuarios','activo'),
    ('auditoria','usuario_id'), ('auditoria','usuario_nombre'), ('auditoria','usuario_rol'),
    ('auditoria','categoria'), ('auditoria','accion'), ('auditoria','descripcion'),
    ('auditoria','entidad_tipo'), ('auditoria','entidad_id'), ('auditoria','meta'),
    ('auditoria','ip_origen'), ('auditoria','cuenta_id'),
    ('despacho_devoluciones','despacho_id'), ('despacho_devoluciones','total_devuelto_usd'),
    ('despacho_devolucion_intercambios','despacho_id'), ('despacho_devolucion_intercambios','total_usd')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required.table_name
      AND c.column_name = required.column_name
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FALTANTE: columnas COD: %', v_missing;
  END IF;

  IF to_regprocedure('public.resumen_financiero_despacho(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDICION_FUNCION_EXISTENTE: revisar propiedad/contrato antes de reemplazar COD';
  END IF;

  IF to_regclass('public.cod_conciliacion_idempotencia') IS NOT NULL THEN
    IF obj_description('public.cod_conciliacion_idempotencia'::regclass, 'pg_class') IS DISTINCT FROM
       'Main COD release 14: retained request/replay records for external COD reconciliation.'
       OR EXISTS (
         SELECT required.column_name
         FROM (VALUES ('cuenta_id'), ('idempotency_key'), ('despacho_id'), ('payload_hash'), ('resultado'), ('creado_en')) AS required(column_name)
         WHERE NOT EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema='public' AND c.table_name='cod_conciliacion_idempotencia'
             AND c.column_name=required.column_name
         )
       )
       OR NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         WHERE c.conrelid='public.cod_conciliacion_idempotencia'::regclass
           AND c.contype='p'
           AND pg_get_constraintdef(c.oid)='PRIMARY KEY (cuenta_id, idempotency_key)'
       ) THEN
      RAISE EXCEPTION 'PRECONDICION_TABLA_IDEMPOTENCIA_NO_COINCIDE: revisar la tabla antes de reutilizarla';
    END IF;
  END IF;
END;
$preflight$;

-- Idempotency results are retained on rollback: they are part of the financial
-- operation history and are never deleted by this package's rollback.
CREATE TABLE IF NOT EXISTS public.cod_conciliacion_idempotencia (
  cuenta_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  despacho_id UUID NOT NULL REFERENCES public.notas_despacho(id) ON DELETE RESTRICT,
  payload_hash TEXT NOT NULL,
  resultado JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cuenta_id, idempotency_key)
);
ALTER TABLE public.cod_conciliacion_idempotencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cod_conciliacion_idempotencia FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.cod_conciliacion_idempotencia IS
  'Main COD release 14: retained request/replay records for external COD reconciliation.';

-- Read-only COD state. Flags in the JSON are evidence/context only; the CxC
-- ledger decides debt, collected cash, compensations and derived COD status.
CREATE FUNCTION public.resumen_financiero_despacho(p_cuenta_id UUID, p_despacho_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $summary$
DECLARE
  v_despacho RECORD;
  v_cliente_id UUID;
  v_cargos NUMERIC(14,4) := 0;
  v_abonos NUMERIC(14,4) := 0;
  v_cargo_cod NUMERIC(14,4) := 0;
  v_abono_cod NUMERIC(14,4) := 0;
  v_cobrado NUMERIC(14,4) := 0;
  v_compensado NUMERIC(14,4) := 0;
  v_creditos NUMERIC(14,4) := 0;
  v_devolucion_credito NUMERIC(14,4) := 0;
  v_consumo_credito NUMERIC(14,4) := 0;
  v_devuelto NUMERIC(14,4) := 0;
  v_intercambio NUMERIC(14,4) := 0;
  v_deuda NUMERIC(14,4) := 0;
  v_saldo_favor NUMERIC(14,4) := 0;
  v_cod JSONB := NULL;
  v_cod_presente BOOLEAN := FALSE;
  v_cod_monto NUMERIC(14,4) := 0;
  v_cod_flag_pagado BOOLEAN := FALSE;
  v_sin_abono BOOLEAN := FALSE;
  v_estado TEXT;
  v_revisar BOOLEAN := FALSE;
  v_fp_text TEXT;
  v_fp JSONB;
  v_deuda_cod NUMERIC(14,4);
BEGIN
  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_Y_DESPACHO_REQUERIDOS';
  END IF;

  SELECT nd.id, nd.numero, nd.cuenta_id, nd.estado, nd.cliente_id,
         nd.cliente_factura_id, nd.total_usd, nd.forma_pago, nd.forma_pago_cliente
    INTO v_despacho
  FROM public.notas_despacho nd
  WHERE nd.id = p_despacho_id AND nd.cuenta_id = p_cuenta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO_O_SIN_PERMISO'; END IF;
  v_cliente_id := COALESCE(v_despacho.cliente_factura_id, v_despacho.cliente_id);

  v_fp_text := COALESCE(NULLIF(btrim(v_despacho.forma_pago_cliente), ''),
                        NULLIF(btrim(v_despacho.forma_pago), ''));
  IF v_fp_text IS NOT NULL AND pg_input_is_valid(v_fp_text, 'jsonb') THEN
    v_fp := v_fp_text::JSONB;
    IF jsonb_typeof(v_fp) = 'array' THEN
      SELECT e.value INTO v_cod
      FROM jsonb_array_elements(v_fp) AS e(value)
      WHERE jsonb_typeof(e.value) = 'object'
        AND lower(trim(COALESCE(e.value->>'metodo', e.value->>'metodo_pago', ''))) = 'cobro a destino'
      LIMIT 1;
      v_cod_presente := v_cod IS NOT NULL;
    ELSIF jsonb_typeof(v_fp) = 'object' THEN
      IF lower(trim(COALESCE(v_fp->>'metodo', v_fp->>'metodo_pago', ''))) = 'cobro a destino' THEN
        v_cod := v_fp;
        v_cod_presente := TRUE;
      ELSE
        v_revisar := TRUE;
      END IF;
    ELSE
      v_revisar := TRUE;
    END IF;
  ELSIF v_fp_text IS NOT NULL THEN
    v_revisar := lower(v_fp_text) LIKE '%cobro a destino%';
  END IF;

  IF v_cod_presente THEN
    BEGIN
      v_cod_monto := COALESCE(NULLIF(v_cod->>'monto', '')::NUMERIC,
                              NULLIF(v_cod->>'amount', '')::NUMERIC, 0);
      v_cod_flag_pagado := COALESCE((v_cod->>'cobro_destino_pagado')::BOOLEAN, FALSE);
      v_sin_abono := COALESCE((v_cod->>'conciliado_sin_abono')::BOOLEAN, FALSE);
    EXCEPTION WHEN others THEN
      v_revisar := TRUE;
      v_cod_monto := 0;
    END;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN c.tipo='cargo' THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono' THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='cargo' AND lower(COALESCE(c.metodo_pago,''))='cod' THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono' THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%devoluci%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%compensa%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%cruce%'
      AND lower(COALESCE(c.forma_pago_abono,'')) NOT LIKE '%saldo a favor%'
      THEN ABS(c.monto_usd) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN c.tipo='abono'
      AND (lower(COALESCE(c.forma_pago_abono,'')) LIKE '%devoluci%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%compensa%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%cruce%'
        OR lower(COALESCE(c.forma_pago_abono,'')) LIKE '%saldo a favor%')
      THEN ABS(c.monto_usd) ELSE 0 END),0)
  INTO v_cargos, v_abonos, v_cargo_cod, v_abono_cod, v_cobrado, v_compensado
  FROM public.cuentas_por_cobrar c
  WHERE c.despacho_id=p_despacho_id AND c.cliente_id=v_cliente_id AND c.cuenta_id=v_despacho.cuenta_id;

  v_deuda := round(v_cargos-v_abonos,2);
  IF v_cod_presente AND v_cargo_cod=0 AND v_cod_monto>0 THEN v_revisar := TRUE; END IF;
  IF v_cod_presente AND v_cargo_cod>0 AND abs(v_cargos-v_cargo_cod)>0.01 THEN v_revisar := TRUE; END IF;
  v_cargo_cod := round(v_cargo_cod,2);
  v_abono_cod := round(v_abono_cod,2);
  v_cobrado := round(v_cobrado,2);
  v_compensado := round(v_compensado,2);

  SELECT COALESCE(SUM(ABS(d.total_devuelto_usd)),0) INTO v_devuelto
  FROM public.despacho_devoluciones d WHERE d.despacho_id=p_despacho_id;
  SELECT COALESCE(SUM(ABS(i.total_usd)),0) INTO v_intercambio
  FROM public.despacho_devolucion_intercambios i WHERE i.despacho_id=p_despacho_id;

  IF v_cliente_id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN c.tipo='credito' THEN ABS(c.monto_usd) ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN c.tipo='devolucion_credito' THEN ABS(c.monto_usd) ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN c.tipo='consumo_credito' THEN ABS(c.monto_usd)
        WHEN c.tipo='abono' AND lower(COALESCE(c.forma_pago_abono,'')) LIKE '%saldo a favor%'
        THEN ABS(c.monto_usd) ELSE 0 END),0)
    INTO v_creditos, v_devolucion_credito, v_consumo_credito
    FROM public.cuentas_por_cobrar c WHERE c.cliente_id=v_cliente_id AND c.cuenta_id=v_despacho.cuenta_id;
  END IF;
  v_saldo_favor := GREATEST(0,round(v_creditos-v_devolucion_credito-v_consumo_credito,2));

  IF NOT v_cod_presente OR v_cod_monto<=0 THEN
    v_estado := 'sin_cargo';
  ELSIF v_cargo_cod<=0 OR abs(v_cargos-v_cargo_cod)>0.01 THEN
    v_estado := 'manual_review'; v_revisar := TRUE;
  ELSE
    v_deuda_cod := GREATEST(0,round(v_cargo_cod-v_abono_cod,2));

    IF v_deuda_cod>0 THEN
      IF v_cobrado>0 THEN
        v_estado := 'parcial';
      ELSIF v_sin_abono OR v_cod_flag_pagado THEN
        v_estado := 'manual_review'; v_revisar := TRUE;
      ELSE
        v_estado := 'pendiente';
      END IF;
    ELSIF v_cobrado>0 THEN
      v_estado := 'cobrado';
    ELSIF v_compensado>0 THEN
      v_estado := 'compensado';
    ELSE
      v_estado := 'manual_review'; v_revisar := TRUE;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'despacho_id',v_despacho.id,'numero',v_despacho.numero,'cuenta_id',v_despacho.cuenta_id,
    'cliente_id',v_cliente_id,'moneda','USD',
    'ledger',jsonb_build_object('cargo_usd',round(v_cargos,2),'abono_usd',round(v_abonos,2),
      'deuda_usd',GREATEST(0,v_deuda),'cobrado_usd',v_cobrado,'compensado_usd',v_compensado,
      'cargo_cod_usd',v_cargo_cod,'abono_cod_usd',v_abono_cod,
      'deuda_cod_usd',GREATEST(0,round(v_cargo_cod-v_abono_cod,2)),'saldo_a_favor_cliente_usd',v_saldo_favor),
    'devoluciones',jsonb_build_object('total_usd',round(v_devuelto,2),'intercambios_usd',round(v_intercambio,2)),
    'cod',jsonb_build_object('presente',v_cod_presente,'monto_nominal_usd',round(v_cod_monto,2),
      'flag_pagado_legacy',v_cod_flag_pagado,'conciliado_sin_abono_legacy',v_sin_abono,
      'estado',v_estado,'revisar',v_revisar),
    'fuente','cuentas_por_cobrar','solo_lectura',TRUE);
END;
$summary$;

REVOKE ALL ON FUNCTION public.resumen_financiero_despacho(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resumen_financiero_despacho(UUID,UUID) TO service_role;
COMMENT ON FUNCTION public.resumen_financiero_despacho(UUID,UUID) IS
  'Main COD release 14: read-only tenant-scoped summary derived from CxC ledger.';

-- Atomic, tenant-scoped and replay-safe external COD receipt. The two JSON
-- columns are updated independently: each retains its own non-COD entries and
-- is rejected if its COD entry is absent, duplicated or has a different amount.
CREATE FUNCTION public.registrar_pago_externo_cobro_idempotente(
  p_cuenta_id UUID,
  p_despacho_id UUID,
  p_idempotency_key UUID,
  p_usuario_id UUID,
  p_usuario_nombre TEXT,
  p_pagos JSONB,
  p_evidencia TEXT,
  p_ip_origen TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $reconcile$
DECLARE
  v_despacho RECORD;
  v_actor RECORD;
  v_cliente_id UUID;
  v_cod_cliente JSONB;
  v_cod_pago JSONB;
  v_formas_cliente JSONB;
  v_formas_pago JSONB;
  v_formas_cliente_nuevas JSONB;
  v_formas_pago_nuevas JSONB;
  v_hash TEXT;
  v_guard RECORD;
  v_monto_nominal NUMERIC(14,4) := 0;
  v_monto_pago NUMERIC(14,4) := 0;
  v_monto_bs NUMERIC(14,4) := 0;
  v_tasa_snapshot NUMERIC(20,8) := 0;
  v_pagos_snapshot JSONB := '[]'::JSONB;
  v_cargos NUMERIC(14,4) := 0;
  v_abonos NUMERIC(14,4) := 0;
  v_saldo_cliente NUMERIC(14,4) := 0;
  v_cargos_cod NUMERIC(14,4) := 0;
  v_deuda_cod NUMERIC(14,4) := 0;
  v_deuda_cliente NUMERIC(14,4) := 0;
  v_total_pago NUMERIC(14,4) := 0;
  v_pago JSONB;
  v_pago_json JSONB;
  v_metodo TEXT;
  v_abono_id UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
  v_resultado JSONB;
  v_comision_id UUID;
  v_cod_count INTEGER := 0;
  v_cod_pago_count INTEGER := 0;
BEGIN
  IF p_cuenta_id IS NULL OR p_despacho_id IS NULL OR p_idempotency_key IS NULL
     OR p_usuario_id IS NULL OR NULLIF(btrim(p_usuario_nombre),'') IS NULL
     OR p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array'
     OR NULLIF(btrim(p_evidencia),'') IS NULL OR length(btrim(p_evidencia)) < 4
     OR length(p_evidencia) > 500 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_PARAMETROS_INVALIDOS';
  END IF;
  IF jsonb_array_length(p_pagos) < 1 OR jsonb_array_length(p_pagos) > 6 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_PARAMETROS_INVALIDOS';
  END IF;

  FOR v_pago_json IN SELECT x.value FROM jsonb_array_elements(p_pagos) AS x(value)
  LOOP
    IF jsonb_typeof(v_pago_json) <> 'object' THEN
      RAISE EXCEPTION 'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS';
    END IF;
    v_metodo := lower(btrim(COALESCE(v_pago_json->>'metodo','')));
    IF v_metodo NOT IN ('efectivo $','efectivo bs','zelle','transf. / pago móvil','punto de venta','usdt')
       OR COALESCE(v_pago_json->>'monto','') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS';
    END IF;
    v_monto_pago := (v_pago_json->>'monto')::NUMERIC;
    IF v_monto_pago <= 0 OR v_monto_pago <> round(v_monto_pago,2) THEN
      RAISE EXCEPTION 'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS';
    END IF;
    IF v_metodo = 'efectivo bs' THEN
      IF length(COALESCE(v_pago_json->>'monto_bs','')) > 20
         OR length(COALESCE(v_pago_json->>'tasa_snapshot','')) > 20
         OR COALESCE(v_pago_json->>'monto_bs','') !~ '^[0-9]+([.][0-9]{1,2})?$'
         OR COALESCE(v_pago_json->>'tasa_snapshot','') !~ '^[0-9]+([.][0-9]{1,8})?$'
         OR length(btrim(COALESCE(v_pago_json->>'tasa_fuente',''))) NOT BETWEEN 1 AND 80
         OR (v_pago_json->>'tasa_actualizada_en' IS NOT NULL
           AND NOT pg_input_is_valid(v_pago_json->>'tasa_actualizada_en','timestamptz')) THEN
        RAISE EXCEPTION 'COD_CONCILIACION_TASA_BS_INVALIDA';
      END IF;
      v_monto_bs := (v_pago_json->>'monto_bs')::NUMERIC;
      v_tasa_snapshot := (v_pago_json->>'tasa_snapshot')::NUMERIC;
      IF v_monto_bs <= 0 OR v_tasa_snapshot <= 0 OR v_tasa_snapshot > 1000000000
         OR v_tasa_snapshot <> round(v_tasa_snapshot,8)
         OR round(v_monto_bs / v_tasa_snapshot,2) <> v_monto_pago THEN
        RAISE EXCEPTION 'COD_CONCILIACION_TASA_BS_INVALIDA';
      END IF;
      v_pago_json := v_pago_json || jsonb_build_object(
        'monto',round(v_monto_bs / v_tasa_snapshot,2),
        'equivalente_usd',round(v_monto_bs / v_tasa_snapshot,2),
        'tasa_confirmada_en',clock_timestamp());
    ELSE
      IF v_metodo NOT IN ('efectivo $','efectivo bs')
         AND length(btrim(COALESCE(v_pago_json->>'referencia',''))) < 2 THEN
        RAISE EXCEPTION 'COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS';
      END IF;
    END IF;
    v_pagos_snapshot := v_pagos_snapshot || jsonb_build_array(v_pago_json);
  END LOOP;
  SELECT COALESCE(SUM((x.value->>'monto')::NUMERIC),0) INTO v_total_pago
  FROM jsonb_array_elements(v_pagos_snapshot) AS x(value);
  IF v_total_pago <= 0 OR v_total_pago <> round(v_total_pago,2) THEN
    RAISE EXCEPTION 'COD_CONCILIACION_MONTO_INVALIDO';
  END IF;

  v_hash := md5(jsonb_build_object('despacho_id',p_despacho_id,
    'pagos',p_pagos,'evidencia',btrim(p_evidencia))::TEXT);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cuenta_id::TEXT || ':' || p_idempotency_key::TEXT,0));

  SELECT * INTO v_despacho FROM public.notas_despacho nd
  WHERE nd.id=p_despacho_id AND nd.cuenta_id=p_cuenta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD_CONCILIACION_DESPACHO_NO_ENCONTRADO'; END IF;
  IF v_despacho.estado NOT IN ('despachada','entregada') THEN
    RAISE EXCEPTION 'COD_CONCILIACION_ESTADO_INVALIDO';
  END IF;
  v_cliente_id := COALESCE(v_despacho.cliente_factura_id,v_despacho.cliente_id);
  IF v_cliente_id IS NULL THEN RAISE EXCEPTION 'COD_CONCILIACION_CLIENTE_REQUERIDO'; END IF;

  SELECT u.id,u.nombre,u.rol INTO v_actor FROM public.usuarios u
  WHERE u.id=p_usuario_id AND u.cuenta_id=p_cuenta_id AND u.activo=TRUE
    AND u.rol IN ('administracion','jefe','supervisor','desarrollador') LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD_CONCILIACION_ACTOR_NO_AUTORIZADO'; END IF;

  PERFORM 1 FROM public.clientes c
  WHERE c.id=v_cliente_id AND c.cuenta_id=p_cuenta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD_CONCILIACION_CLIENTE_REQUERIDO'; END IF;

  SELECT i.payload_hash,i.resultado INTO v_guard
  FROM public.cod_conciliacion_idempotencia i
  WHERE i.cuenta_id=p_cuenta_id AND i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_guard.payload_hash<>v_hash OR v_guard.resultado IS NULL THEN
      RAISE EXCEPTION 'COD_CONCILIACION_IDEMPOTENCIA_REUTILIZADA';
    END IF;
    RETURN v_guard.resultado || jsonb_build_object('idempotent',TRUE);
  END IF;

  IF v_despacho.forma_pago_cliente IS NOT NULL AND btrim(v_despacho.forma_pago_cliente)<>'' THEN
    IF NOT pg_input_is_valid(v_despacho.forma_pago_cliente,'jsonb') THEN
      RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
    END IF;
    v_formas_cliente := v_despacho.forma_pago_cliente::JSONB;
  ELSIF v_despacho.forma_pago IS NOT NULL AND btrim(v_despacho.forma_pago)<>''
        AND pg_input_is_valid(v_despacho.forma_pago,'jsonb') THEN
    v_formas_cliente := v_despacho.forma_pago::JSONB;
  ELSE
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;
  IF jsonb_typeof(v_formas_cliente)<>'array' THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;

  IF v_despacho.forma_pago IS NOT NULL AND btrim(v_despacho.forma_pago)<>'' THEN
    IF NOT pg_input_is_valid(v_despacho.forma_pago,'jsonb') THEN
      RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
    END IF;
    v_formas_pago := v_despacho.forma_pago::JSONB;
  ELSE
    v_formas_pago := v_formas_cliente;
  END IF;
  IF jsonb_typeof(v_formas_pago)<>'array'
     OR jsonb_array_length(v_formas_pago)<>jsonb_array_length(v_formas_cliente) THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;

  SELECT count(*)::INTEGER INTO v_cod_count FROM jsonb_array_elements(v_formas_cliente) AS x(value)
  WHERE jsonb_typeof(x.value)='object' AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino';
  SELECT count(*)::INTEGER INTO v_cod_pago_count FROM jsonb_array_elements(v_formas_pago) AS x(value)
  WHERE jsonb_typeof(x.value)='object' AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino';
  IF v_cod_count<>1 OR v_cod_pago_count<>1 THEN RAISE EXCEPTION 'COD_CONCILIACION_COD_AMBIGUO'; END IF;
  SELECT x.value INTO v_cod_cliente FROM jsonb_array_elements(v_formas_cliente) AS x(value)
  WHERE jsonb_typeof(x.value)='object' AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino';
  SELECT x.value INTO v_cod_pago FROM jsonb_array_elements(v_formas_pago) AS x(value)
  WHERE jsonb_typeof(x.value)='object' AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino';
  BEGIN
    v_monto_nominal := (v_cod_cliente->>'monto')::NUMERIC;
    v_monto_pago := (v_cod_pago->>'monto')::NUMERIC;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'COD_CONCILIACION_MONTO_NOMINAL_INVALIDO';
  END;
  IF v_monto_nominal<=0 OR v_monto_pago IS NULL OR abs(v_monto_pago-v_monto_nominal)>0.01 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;
  IF (v_cod_cliente ? 'metodos_pagados' AND jsonb_typeof(v_cod_cliente->'metodos_pagados')<>'array')
     OR (v_cod_pago ? 'metodos_pagados' AND jsonb_typeof(v_cod_pago->'metodos_pagados')<>'array') THEN
    RAISE EXCEPTION 'COD_CONCILIACION_FORMA_PAGO_INVALIDA';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN c.tipo='cargo' THEN ABS(c.monto_usd) ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN c.tipo='abono' THEN ABS(c.monto_usd) ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN c.tipo='cargo' AND lower(COALESCE(c.metodo_pago,''))='cod' THEN ABS(c.monto_usd) ELSE 0 END),0)
    INTO v_cargos,v_abonos,v_cargos_cod
  FROM public.cuentas_por_cobrar c
  WHERE c.cuenta_id=p_cuenta_id AND c.cliente_id=v_cliente_id AND c.despacho_id=p_despacho_id;
  IF v_cargos_cod<=0 OR abs(v_cargos-v_cargos_cod)>0.01 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_LEDGER_AMBIGUO';
  END IF;
  IF abs(v_cargos_cod-v_monto_nominal)>0.01 THEN RAISE EXCEPTION 'COD_CONCILIACION_CARGO_NO_COINCIDE'; END IF;
  SELECT COALESCE(SUM(CASE WHEN c.tipo='cargo' THEN ABS(c.monto_usd)
    WHEN c.tipo='abono' THEN -ABS(c.monto_usd) ELSE 0 END),0) INTO v_deuda_cliente
  FROM public.cuentas_por_cobrar c WHERE c.cuenta_id=p_cuenta_id AND c.cliente_id=v_cliente_id;
  v_saldo_cliente:=GREATEST(0,v_deuda_cliente);
  v_deuda_cod:=GREATEST(0,round(v_cargos_cod-v_abonos,2));
  IF v_deuda_cod<=0 THEN RAISE EXCEPTION 'COD_CONCILIACION_SIN_DEUDA'; END IF;
  IF v_total_pago>v_deuda_cod+0.01 THEN
    RAISE EXCEPTION 'COD_CONCILIACION_MONTO_NO_COINCIDE: saldo %, pago %',v_deuda_cod,v_total_pago;
  END IF;
  IF v_deuda_cliente+0.01<v_total_pago THEN RAISE EXCEPTION 'COD_CONCILIACION_LEDGER_AMBIGUO'; END IF;

  INSERT INTO public.cod_conciliacion_idempotencia(cuenta_id,idempotency_key,despacho_id,payload_hash)
  VALUES(p_cuenta_id,p_idempotency_key,p_despacho_id,v_hash);

  FOR v_pago IN SELECT x.value FROM jsonb_array_elements(v_pagos_snapshot) AS x(value)
  LOOP
    v_metodo:=btrim(v_pago->>'metodo');
    v_monto_pago:=(v_pago->>'monto')::NUMERIC;
    INSERT INTO public.cuentas_por_cobrar(
      cuenta_id,cliente_id,despacho_id,tipo,monto_usd,saldo_usd,metodo_pago,
      forma_pago_abono,referencia,descripcion,registrado_por
    ) VALUES(
      p_cuenta_id,v_cliente_id,p_despacho_id,'abono',v_monto_pago,
      GREATEST(0,round(v_saldo_cliente-v_monto_pago,4)),'cod',v_metodo,
      NULLIF(btrim(v_pago->>'referencia'),''),
      'Pago externo COD — evidencia: '||btrim(p_evidencia)||CASE WHEN lower(v_metodo)='efectivo bs' THEN
        ' | snapshot Bs: recibido='||(v_pago->>'monto_bs')||'; tasa='||(v_pago->>'tasa_snapshot')
        ||'; fuente='||(v_pago->>'tasa_fuente')||'; equivalente_usd='||(v_pago->>'equivalente_usd')
        ||'; confirmado_en='||(v_pago->>'tasa_confirmada_en')
        ELSE '' END,p_usuario_id
    ) RETURNING id INTO v_abono_id;
    v_ids:=array_append(v_ids,v_abono_id);
    v_saldo_cliente:=GREATEST(0,v_saldo_cliente-v_monto_pago);
  END LOOP;

  SELECT jsonb_agg(CASE WHEN jsonb_typeof(x.value)='object'
      AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino'
    THEN x.value||jsonb_build_object(
      'cobro_destino_pagado',(v_deuda_cod-v_total_pago)<=0,
      'conciliado_sin_abono',FALSE,
      'metodos_pagados',COALESCE(v_cod_cliente->'metodos_pagados','[]'::JSONB)||v_pagos_snapshot,
      'conciliado_en',clock_timestamp(),'evidencia_pago',btrim(p_evidencia),
      'idempotency_key',p_idempotency_key)
    ELSE x.value END ORDER BY x.ordinality) INTO v_formas_cliente_nuevas
  FROM jsonb_array_elements(v_formas_cliente) WITH ORDINALITY AS x(value,ordinality);

  SELECT jsonb_agg(CASE WHEN jsonb_typeof(x.value)='object'
      AND lower(btrim(COALESCE(x.value->>'metodo','')))='cobro a destino'
    THEN x.value||jsonb_build_object(
      'cobro_destino_pagado',(v_deuda_cod-v_total_pago)<=0,
      'conciliado_sin_abono',FALSE,
      'metodos_pagados',COALESCE(v_cod_pago->'metodos_pagados','[]'::JSONB)||v_pagos_snapshot,
      'conciliado_en',clock_timestamp(),'evidencia_pago',btrim(p_evidencia),
      'idempotency_key',p_idempotency_key)
    ELSE x.value END ORDER BY x.ordinality) INTO v_formas_pago_nuevas
  FROM jsonb_array_elements(v_formas_pago) WITH ORDINALITY AS x(value,ordinality);

  UPDATE public.notas_despacho SET forma_pago=v_formas_pago_nuevas::TEXT,
    forma_pago_cliente=v_formas_cliente_nuevas::TEXT
  WHERE id=p_despacho_id AND cuenta_id=p_cuenta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COD_CONCILIACION_DESPACHO_CAMBIO'; END IF;

  INSERT INTO public.auditoria(
    usuario_id,usuario_nombre,usuario_rol,categoria,accion,descripcion,
    entidad_tipo,entidad_id,meta,ip_origen,cuenta_id
  ) VALUES(
    p_usuario_id,v_actor.nombre,v_actor.rol,'COTIZACION','COD_CONCILIADO_CON_EVIDENCIA',
    'Cobro COD registrado en ledger para despacho #'||v_despacho.numero,
    'despacho',p_despacho_id,
    jsonb_build_object('cuenta_id',p_cuenta_id,'cargo_cod_usd',round(v_cargos_cod,2),
      'pago_usd',round(v_total_pago,2),'saldo_previo_usd',v_deuda_cod,
      'excedente_usd',GREATEST(0,round(v_total_pago-v_deuda_cod,2)),
      'metodos',v_pagos_snapshot,'evidencia',btrim(p_evidencia),'abono_ids',to_jsonb(v_ids),
      'idempotency_key',p_idempotency_key),NULLIF(btrim(p_ip_origen),''),p_cuenta_id
  );

  IF v_deuda_cod-v_total_pago<=0 THEN
    SELECT public.recalcularcomisiondespacho_238b(p_despacho_id) INTO v_comision_id;
  END IF;
  v_resultado:=jsonb_build_object('ok',TRUE,'transaccion_atomica',TRUE,'idempotent',FALSE,
    'cuenta_id',p_cuenta_id,'despacho_id',p_despacho_id,'abono_ids',to_jsonb(v_ids),
    'comision_id',v_comision_id,'saldo_previo_usd',v_deuda_cod,'pago_usd',round(v_total_pago,2),
    'saldo_restante_usd',GREATEST(0,round(v_deuda_cod-v_total_pago,2)),
    'excedente_usd',GREATEST(0,round(v_total_pago-v_deuda_cod,2)),
    'estado_cod',CASE WHEN v_deuda_cod-v_total_pago<=0 THEN 'cobrado' ELSE 'parcial' END,
    'idempotency_key',p_idempotency_key);
  UPDATE public.cod_conciliacion_idempotencia SET resultado=v_resultado
  WHERE cuenta_id=p_cuenta_id AND idempotency_key=p_idempotency_key;
  RETURN v_resultado;
END;
$reconcile$;

REVOKE ALL ON FUNCTION public.registrar_pago_externo_cobro_idempotente(UUID,UUID,UUID,UUID,TEXT,JSONB,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago_externo_cobro_idempotente(UUID,UUID,UUID,UUID,TEXT,JSONB,TEXT,TEXT)
  TO service_role;
COMMENT ON FUNCTION public.registrar_pago_externo_cobro_idempotente(UUID,UUID,UUID,UUID,TEXT,JSONB,TEXT,TEXT) IS
  'Main COD release 14: atomic idempotent COD payment; independently preserves payment JSON and per-Bs-payment rate snapshots.';

NOTIFY pgrst,'reload schema';
COMMIT;
