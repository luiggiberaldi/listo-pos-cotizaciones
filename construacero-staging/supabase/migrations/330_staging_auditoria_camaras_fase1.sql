-- ============================================================================
-- 320_auditoria_camaras_fase1.sql
-- OP-2026-110 (Auditoría 2.0 — Fase 1: Cámaras automáticas con antes/después)
--
-- Incluye:
--   1. Tabla append-only public.auditoria_cambios con índices BRIN y B-Tree.
--   2. RLS cerrada (solo service_role lee/escribe) + candado anti-borrado/edición.
--   3. Función trigger public.registrar_cambio_auditoria():
--      - Valida service_role antes de leer cabeceras x-operator-* / x-request-id.
--      - Respeta pausa controlada (app.skip_audit_triggers = '1' o x-audit-skip = '1'
--        solo con service_role) para restauraciones masivas y pruebas.
--      - Excluye campos sensibles (pin_hash, pin_salt, gate_password_hash, embedding, etc.).
--      - Graba solo campos modificados en UPDATE (omite actualizaciones sin cambio real).
--      - Etiqueta automáticamente es_sensible_dinero para ocultar precios/dinero al supervisor.
--   4. Disparadores AFTER INSERT OR UPDATE OR DELETE en las 17 tablas clave.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.auditoria_cambios (
  id                  BIGSERIAL PRIMARY KEY,
  ts                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cuenta_id           UUID,
  tabla               TEXT NOT NULL,
  registro_id         TEXT,
  tipo                TEXT NOT NULL CHECK (tipo IN ('INSERT', 'UPDATE', 'DELETE')),
  cambios             JSONB NOT NULL DEFAULT '{}'::jsonb,
  operador_id         UUID,
  operador_nombre     TEXT,
  operador_rol        TEXT,
  origen              TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('app', 'cron', 'sistema', 'manual')),
  operacion_id        TEXT,
  es_sensible_dinero  BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_aud_cambios_ts_brin      ON public.auditoria_cambios USING BRIN (ts);
CREATE INDEX IF NOT EXISTS idx_aud_cambios_tabla_reg_ts ON public.auditoria_cambios (tabla, registro_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_aud_cambios_operacion    ON public.auditoria_cambios (operacion_id) WHERE operacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aud_cambios_cuenta_ts    ON public.auditoria_cambios (cuenta_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_aud_cambios_origen       ON public.auditoria_cambios (origen) WHERE origen <> 'app';

ALTER TABLE public.auditoria_cambios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria_cambios FROM anon, authenticated;
GRANT SELECT, INSERT ON public.auditoria_cambios TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auditoria_cambios_id_seq TO service_role;

-- Candado anti-borrado/edición
DROP TRIGGER IF EXISTS trg_auditoria_cambios_inmutable ON public.auditoria_cambios;
CREATE TRIGGER trg_auditoria_cambios_inmutable
  BEFORE UPDATE OR DELETE ON public.auditoria_cambios
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_auditoria_inmutable();

-- Función genérica de cámara automática
CREATE OR REPLACE FUNCTION public.registrar_cambio_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_es_service    BOOLEAN := false;
  v_headers       JSONB := '{}'::jsonb;
  v_raw_headers   TEXT;
  v_op_id_txt     TEXT;
  v_op_id         UUID := NULL;
  v_op_nombre     TEXT := NULL;
  v_op_rol        TEXT := NULL;
  v_operacion_id  TEXT := NULL;
  v_audit_source  TEXT := NULL;
  v_origen        TEXT := 'manual';
  v_old_j         JSONB;
  v_new_j         JSONB;
  v_cambios       JSONB := '{}'::jsonb;
  v_key           TEXT;
  v_val_old       JSONB;
  v_val_new       JSONB;
  v_cuenta_id     UUID := NULL;
  v_registro_id   TEXT := NULL;
  v_sensible      BOOLEAN := false;
  v_excluidos     CONSTANT TEXT[] := ARRAY[
    'pin_hash', 'pin_salt', 'gate_password_hash', 'token_hash',
    'password', 'secret', 'embedding', 'actualizado_en', 'updated_at'
  ];
  v_tablas_dinero CONSTANT TEXT[] := ARRAY[
    'cuentas_por_cobrar', 'comisiones', 'pagos_transportistas',
    'cuentas_por_pagar', 'despacho_descuentos', 'despacho_devoluciones'
  ];
BEGIN
  -- 1. Pausa controlada para restauraciones masivas o mantenimiento privilegiado
  IF current_setting('app.skip_audit_triggers', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    v_es_service := (
      COALESCE(
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        current_setting('request.jwt.claim.role', true),
        ''
      ) = 'service_role'
      OR current_user = 'service_role'
      OR session_user = 'service_role'
    );
  EXCEPTION WHEN OTHERS THEN
    v_es_service := (current_user = 'service_role' OR session_user = 'service_role');
  END;

  IF v_es_service THEN
    v_raw_headers := current_setting('request.headers', true);
    IF v_raw_headers IS NOT NULL AND v_raw_headers <> '' THEN
      BEGIN
        v_headers := v_raw_headers::jsonb;
      EXCEPTION WHEN OTHERS THEN
        v_headers := '{}'::jsonb;
      END;
    END IF;

    IF COALESCE(v_headers->>'x-audit-skip', '') = '1' THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    v_op_id_txt    := NULLIF(TRIM(COALESCE(v_headers->>'x-operator-id', '')), '');
    v_op_nombre    := NULLIF(TRIM(COALESCE(v_headers->>'x-operator-nombre', '')), '');
    v_op_rol       := NULLIF(TRIM(COALESCE(v_headers->>'x-operator-rol', '')), '');
    v_operacion_id := NULLIF(TRIM(COALESCE(v_headers->>'x-request-id', '')), '');
    v_audit_source := NULLIF(TRIM(COALESCE(v_headers->>'x-audit-source', '')), '');

    IF v_op_id_txt IS NOT NULL AND v_op_id_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_op_id := v_op_id_txt::uuid;
    END IF;

    IF v_audit_source = 'cron' THEN
      v_origen := 'cron';
    ELSIF v_op_id IS NOT NULL OR v_op_nombre IS NOT NULL THEN
      v_origen := 'app';
    ELSE
      v_origen := 'sistema';
    END IF;
  ELSE
    v_origen := 'manual';
  END IF;

  -- 2. Construir diff antes / después excluyendo campos sensibles
  IF TG_OP = 'INSERT' THEN
    v_new_j := to_jsonb(NEW);
    v_registro_id := v_new_j->>'id';
    IF v_new_j ? 'cuenta_id' AND NULLIF(v_new_j->>'cuenta_id', '') IS NOT NULL THEN
      BEGIN v_cuenta_id := (v_new_j->>'cuenta_id')::uuid; EXCEPTION WHEN OTHERS THEN v_cuenta_id := NULL; END;
    END IF;
    FOR v_key, v_val_new IN SELECT * FROM jsonb_each(v_new_j) LOOP
      IF v_key = ANY(v_excluidos) OR v_val_new = 'null'::jsonb THEN CONTINUE; END IF;
      v_cambios := v_cambios || jsonb_build_object(v_key, jsonb_build_object('antes', NULL, 'despues', v_val_new));
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    v_old_j := to_jsonb(OLD);
    v_registro_id := v_old_j->>'id';
    IF v_old_j ? 'cuenta_id' AND NULLIF(v_old_j->>'cuenta_id', '') IS NOT NULL THEN
      BEGIN v_cuenta_id := (v_old_j->>'cuenta_id')::uuid; EXCEPTION WHEN OTHERS THEN v_cuenta_id := NULL; END;
    END IF;
    FOR v_key, v_val_old IN SELECT * FROM jsonb_each(v_old_j) LOOP
      IF v_key = ANY(v_excluidos) OR v_val_old = 'null'::jsonb THEN CONTINUE; END IF;
      v_cambios := v_cambios || jsonb_build_object(v_key, jsonb_build_object('antes', v_val_old, 'despues', NULL));
    END LOOP;
  ELSE
    -- UPDATE: solo campos que realmente cambiaron
    v_old_j := to_jsonb(OLD);
    v_new_j := to_jsonb(NEW);
    v_registro_id := COALESCE(v_new_j->>'id', v_old_j->>'id');
    IF v_new_j ? 'cuenta_id' AND NULLIF(v_new_j->>'cuenta_id', '') IS NOT NULL THEN
      BEGIN v_cuenta_id := (v_new_j->>'cuenta_id')::uuid; EXCEPTION WHEN OTHERS THEN v_cuenta_id := NULL; END;
    END IF;
    FOR v_key, v_val_new IN SELECT * FROM jsonb_each(v_new_j) LOOP
      IF v_key = ANY(v_excluidos) THEN CONTINUE; END IF;
      v_val_old := v_old_j -> v_key;
      IF v_val_old IS DISTINCT FROM v_val_new THEN
        v_cambios := v_cambios || jsonb_build_object(v_key, jsonb_build_object('antes', v_val_old, 'despues', v_val_new));
      END IF;
    END LOOP;
    IF v_cambios = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 3. Clasificar si expone precios o dinero (para ocultar al supervisor)
  IF TG_TABLE_NAME = ANY(v_tablas_dinero) THEN
    v_sensible := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_cambios) AS k
      WHERE k ~* '(precio|costo|monto|total|saldo|flete|comision|tasa|descuento|abono|credito|tarifa|markup)'
    ) INTO v_sensible;
  END IF;

  INSERT INTO public.auditoria_cambios (
    cuenta_id, tabla, registro_id, tipo, cambios,
    operador_id, operador_nombre, operador_rol,
    origen, operacion_id, es_sensible_dinero
  ) VALUES (
    v_cuenta_id, TG_TABLE_NAME, v_registro_id, TG_OP, v_cambios,
    v_op_id, v_op_nombre, v_op_rol,
    v_origen, v_operacion_id, v_sensible
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_cambio_auditoria() FROM PUBLIC, anon, authenticated;

-- 4. Instalar cámaras en las 17 tablas clave
DO $$
DECLARE
  v_tabla TEXT;
  v_tablas TEXT[] := ARRAY[
    'notas_despacho',
    'notas_despacho_items',
    'cotizaciones',
    'cuentas_por_cobrar',
    'clientes',
    'productos',
    'inventario_movimientos',
    'comisiones',
    'usuarios',
    'transportistas',
    'pagos_transportistas',
    'vehiculos',
    'cuentas_por_pagar',
    'proveedores',
    'configuracion_negocio',
    'despacho_devoluciones',
    'despacho_descuentos'
  ];
BEGIN
  FOREACH v_tabla IN ARRAY v_tablas LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria_camara ON public.%I;', v_tabla);
    EXECUTE format(
      'CREATE TRIGGER trg_auditoria_camara AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.registrar_cambio_auditoria();',
      v_tabla
    );
  END LOOP;
END $$;

COMMIT;
