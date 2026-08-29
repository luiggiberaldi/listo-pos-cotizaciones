-- 236_comision_flete_fuera_carabobo.sql
-- Staging mantiene una migración 235 propia; esta migración aplica la misma
-- regla financiera que la 235 del proyecto principal.
--
-- Chofer local + destino Carabobo = nómina externa, sin comisión aquí.
-- Chofer local + destino fuera de Carabobo = comisión liquidable.
-- Transportista no local = fuera del módulo de comisión de choferes.

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS flete_estado_destino_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS flete_comisionable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flete_regla_aplicada TEXT NOT NULL DEFAULT 'no_aplica';

COMMENT ON COLUMN public.notas_despacho.flete_estado_destino_snapshot IS
  'Estado del destino usado para decidir si el flete genera comisión. Es un snapshot del despacho.';
COMMENT ON COLUMN public.notas_despacho.flete_comisionable IS
  'true únicamente cuando el chofer local tiene comisión de flete por un destino fuera de Carabobo.';
COMMENT ON COLUMN public.notas_despacho.flete_regla_aplicada IS
  'Regla financiera aplicada: comision_fuera_carabobo, nomina_carabobo, transportista_no_local, no_aplica o destino_no_identificado.';

CREATE INDEX IF NOT EXISTS idx_notas_despacho_flete_comisionable
  ON public.notas_despacho(cuenta_id, transportista_id, flete_comisionable, flete_pagado);

CREATE OR REPLACE FUNCTION public.normalizar_estado_venezuela(p_estado TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    lower(trim(translate(
      COALESCE(p_estado, ''),
      'ÁÉÍÓÚÜÑáéíóúüñ',
      'AEIOUUNaeiouun'
    ))),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.aplicar_regla_comision_flete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta_id UUID := NEW.cuenta_id;
  v_relacion_cuenta_id UUID;
  v_estado_cliente TEXT;
  v_estado_destino TEXT;
  v_estado_normalizado TEXT;
  v_es_local BOOLEAN := false;
  v_flete NUMERIC(12,4) := GREATEST(COALESCE(NEW.flete_usd, 0), 0);
  v_tipo TEXT := 'porcentaje';
  v_pct NUMERIC := 0;
  v_tarifa NUMERIC := 0;
  v_neto NUMERIC(12,4) := 0;
BEGIN
  IF NEW.cliente_id IS NOT NULL THEN
    SELECT c.cuenta_id, NULLIF(trim(c.estado), '')
      INTO v_relacion_cuenta_id, v_estado_cliente
    FROM public.clientes c
    WHERE c.id = NEW.cliente_id
    LIMIT 1;

    IF v_cuenta_id IS NULL THEN
      v_cuenta_id := v_relacion_cuenta_id;
    ELSIF v_relacion_cuenta_id IS NOT NULL
       AND v_relacion_cuenta_id IS DISTINCT FROM v_cuenta_id THEN
      RAISE EXCEPTION 'CUENTA_DESTINO_INVALIDA: el cliente no pertenece a la cuenta del despacho';
    END IF;
  END IF;

  IF NEW.transportista_id IS NOT NULL THEN
    SELECT t.cuenta_id, COALESCE(t.es_local, false)
      INTO v_relacion_cuenta_id, v_es_local
    FROM public.transportistas t
    WHERE t.id = NEW.transportista_id
    LIMIT 1;

    IF v_cuenta_id IS NULL THEN
      v_cuenta_id := v_relacion_cuenta_id;
    ELSIF v_relacion_cuenta_id IS NOT NULL
       AND v_relacion_cuenta_id IS DISTINCT FROM v_cuenta_id THEN
      RAISE EXCEPTION 'CUENTA_TRANSPORTISTA_INVALIDA: el chofer no pertenece a la cuenta del despacho';
    END IF;
  END IF;

  IF NEW.cuenta_id IS NULL AND v_cuenta_id IS NOT NULL THEN
    NEW.cuenta_id := v_cuenta_id;
  END IF;

  v_estado_destino := NULLIF(trim(NEW.direccion_envio_estado), '');
  IF v_estado_destino IS NULL THEN
    v_estado_destino := v_estado_cliente;
  END IF;

  NEW.flete_estado_destino_snapshot := v_estado_destino;
  NEW.flete_comisionable := false;
  NEW.flete_neto_transportista_usd := 0;
  NEW.flete_pct_aplicado := NULL;
  NEW.flete_regla_aplicada := 'no_aplica';

  IF NEW.transportista_id IS NULL OR v_flete <= 0 THEN
    RETURN NEW;
  END IF;

  IF NOT COALESCE(v_es_local, false) THEN
    NEW.flete_regla_aplicada := 'transportista_no_local';
    RETURN NEW;
  END IF;

  IF v_estado_destino IS NULL THEN
    NEW.flete_regla_aplicada := 'destino_no_identificado';
    RAISE EXCEPTION 'DESTINO_ESTADO_REQUERIDO: debe indicar el estado de destino para calcular la comisión del chofer local';
  END IF;

  v_estado_normalizado := public.normalizar_estado_venezuela(v_estado_destino);
  IF v_estado_normalizado = 'carabobo' THEN
    NEW.flete_regla_aplicada := 'nomina_carabobo';
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(transp_tipo_calculo, 'porcentaje'),
    GREATEST(COALESCE(transp_pct_comision, 0), 0),
    GREATEST(COALESCE(transp_tarifa_fija_usd, 0), 0)
  INTO v_tipo, v_pct, v_tarifa
  FROM public.configuracion_negocio
  WHERE cuenta_id = v_cuenta_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFIG_TRANSPORTISTA_NO_DISPONIBLE: configure la comisión de choferes locales antes de registrar el flete';
  END IF;

  IF v_tipo = 'fija' THEN
    v_neto := LEAST(v_tarifa, v_flete);
  ELSE
    v_pct := LEAST(v_pct, 100);
    v_neto := ROUND((v_flete * v_pct / 100)::NUMERIC, 4);
    NEW.flete_pct_aplicado := v_pct;
  END IF;

  NEW.flete_comisionable := true;
  NEW.flete_neto_transportista_usd := GREATEST(v_neto, 0);
  NEW.flete_regla_aplicada := 'comision_fuera_carabobo';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aplicar_regla_comision_flete ON public.notas_despacho;
CREATE TRIGGER trg_aplicar_regla_comision_flete
  BEFORE INSERT OR UPDATE OF transportista_id, flete_usd, cliente_id, direccion_envio_estado,
                              flete_comisionable, flete_neto_transportista_usd,
                              flete_pct_aplicado, flete_estado_destino_snapshot,
                              flete_regla_aplicada
  ON public.notas_despacho
  FOR EACH ROW
  EXECUTE FUNCTION public.aplicar_regla_comision_flete();

-- Impide marcar como pagado un flete que no sea una comisión externa válida.
-- La nómina de Carabobo nunca puede entrar a pagos_transportistas por accidente.
CREATE OR REPLACE FUNCTION public.validar_cambio_flete_pagado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  -- También cubrir INSERT: un registro no puede nacer marcado como pagado
  -- si no representa una comisión externa válida.
  IF TG_OP = 'INSERT' THEN
    IF NEW.flete_pagado = true
       AND (
         COALESCE(NEW.flete_comisionable, false) IS NOT TRUE
         OR COALESCE(NEW.flete_neto_transportista_usd, 0) <= 0
       )
    THEN
      RAISE EXCEPTION 'FLETE_NO_COMISIONABLE: solo se pueden liquidar comisiones de flete fuera de Carabobo';
    END IF;
    IF NEW.flete_pagado = true THEN
      NEW.flete_pagado_en := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.flete_pagado = true
     AND (
       COALESCE(NEW.flete_comisionable, false) IS NOT TRUE
       OR COALESCE(NEW.flete_neto_transportista_usd, 0) <= 0
     )
  THEN
    RAISE EXCEPTION 'FLETE_NO_COMISIONABLE: solo se pueden liquidar comisiones de flete fuera de Carabobo';
  END IF;

  IF NEW.flete_pagado = OLD.flete_pagado THEN
    RETURN NEW;
  END IF;

  v_rol := public.get_rol_actual();
  IF v_rol IS NULL THEN
    IF NEW.flete_pagado = true AND OLD.flete_pagado = false THEN
      NEW.flete_pagado_en := now();
    END IF;
    RETURN NEW;
  END IF;

  IF v_rol NOT IN ('administracion', 'desarrollador') THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: solo administración o desarrollador pueden liquidar fletes al transportista';
  END IF;

  IF NEW.flete_pagado = true AND OLD.flete_pagado = false THEN
    NEW.flete_pagado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bloquear_edicion_flete_pagado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rol TEXT;
BEGIN
  IF OLD.flete_pagado = true
     AND (
       NEW.flete_usd IS DISTINCT FROM OLD.flete_usd
       OR NEW.flete_neto_transportista_usd IS DISTINCT FROM OLD.flete_neto_transportista_usd
       OR NEW.flete_comisionable IS DISTINCT FROM OLD.flete_comisionable
       OR NEW.flete_regla_aplicada IS DISTINCT FROM OLD.flete_regla_aplicada
       OR NEW.flete_pct_aplicado IS DISTINCT FROM OLD.flete_pct_aplicado
       OR NEW.flete_estado_destino_snapshot IS DISTINCT FROM OLD.flete_estado_destino_snapshot
       OR NEW.transportista_id IS DISTINCT FROM OLD.transportista_id
       OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
       OR NEW.direccion_envio_estado IS DISTINCT FROM OLD.direccion_envio_estado
     )
  THEN
    v_rol := public.get_rol_actual();
    IF v_rol IS NOT NULL THEN
      RAISE EXCEPTION 'FLETE_YA_PAGADO: revierta el pago antes de editar el flete, chofer o destino';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flete_pagado ON public.notas_despacho;
CREATE TRIGGER trg_flete_pagado
  BEFORE INSERT OR UPDATE OF flete_pagado ON public.notas_despacho
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_cambio_flete_pagado();

DROP TRIGGER IF EXISTS trg_bloquear_flete_pagado ON public.notas_despacho;
CREATE TRIGGER trg_bloquear_flete_pagado
  BEFORE UPDATE OF transportista_id, flete_usd, flete_neto_transportista_usd,
                   flete_comisionable, flete_pct_aplicado, flete_estado_destino_snapshot,
                   flete_regla_aplicada, cliente_id, direccion_envio_estado
  ON public.notas_despacho
  FOR EACH ROW
  EXECUTE FUNCTION public.bloquear_edicion_flete_pagado();

CREATE OR REPLACE FUNCTION public.liquidar_transportista(
  p_transportista_id UUID,
  p_cuenta_id UUID,
  p_monto NUMERIC,
  p_referencia TEXT DEFAULT NULL,
  p_nota TEXT DEFAULT NULL,
  p_creado_por UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_despacho_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transportista RECORD;
  v_existente RECORD;
  v_despacho RECORD;
  v_restante NUMERIC(12,4);
  v_aplicado NUMERIC(12,4) := 0;
  v_excedente NUMERIC(12,4) := 0;
  v_marcados UUID[] := ARRAY[]::UUID[];
  v_pago_id UUID;
BEGIN
  IF p_cuenta_id IS NULL OR p_transportista_id IS NULL THEN
    RAISE EXCEPTION 'CUENTA_Y_TRANSPORTISTA_REQUERIDOS' USING ERRCODE = '22023';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 OR p_monto <> round(p_monto, 4) THEN
    RAISE EXCEPTION 'MONTO_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUERIDA' USING ERRCODE = '22023';
  END IF;

  SELECT id, es_local, activo, cuenta_id
    INTO v_transportista
  FROM public.transportistas
  WHERE id = p_transportista_id
    AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSPORTISTA_NO_ENCONTRADO' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_transportista.es_local OR NOT v_transportista.activo THEN
    RAISE EXCEPTION 'TRANSPORTISTA_NO_LIQUIDABLE' USING ERRCODE = '22023';
  END IF;

  SELECT id, transportista_id, monto_usd, monto_aplicado_usd, excedente_usd
    INTO v_existente
  FROM public.pagos_transportistas
  WHERE cuenta_id = p_cuenta_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existente.transportista_id <> p_transportista_id
       OR v_existente.monto_usd <> p_monto THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUTILIZADA' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'pago_id', v_existente.id,
      'despachos_marcados', 0,
      'monto_aplicado_usd', v_existente.monto_aplicado_usd,
      'excedente_usd', v_existente.excedente_usd,
      'idempotent_replay', true
    );
  END IF;

  v_restante := round(p_monto, 4);
  FOR v_despacho IN
    SELECT id, flete_neto_transportista_usd
    FROM public.notas_despacho
    WHERE cuenta_id = p_cuenta_id
      AND transportista_id = p_transportista_id
      AND flete_comisionable = true
      AND flete_neto_transportista_usd > 0
      AND flete_pagado = false
      AND estado <> 'anulada'
      AND (p_despacho_ids IS NULL OR id = ANY(p_despacho_ids))
    ORDER BY creado_en ASC, id ASC
    FOR UPDATE
  LOOP
    IF v_restante <= 0.0001 THEN EXIT; END IF;
    IF v_despacho.flete_neto_transportista_usd > v_restante + 0.0001 THEN EXIT; END IF;
    v_marcados := array_append(v_marcados, v_despacho.id);
    v_restante := round(v_restante - v_despacho.flete_neto_transportista_usd, 4);
  END LOOP;

  IF cardinality(v_marcados) = 0 THEN
    RAISE EXCEPTION 'SIN_DESPACHOS_LIQUIDABLES' USING ERRCODE = 'P0002';
  END IF;

  v_aplicado := round(p_monto - v_restante, 4);
  v_excedente := greatest(v_restante, 0);

  INSERT INTO public.pagos_transportistas (
    transportista_id, monto_usd, monto_aplicado_usd, excedente_usd,
    referencia, nota, cuenta_id, creado_por, idempotency_key
  ) VALUES (
    p_transportista_id, p_monto, v_aplicado, v_excedente,
    p_referencia, p_nota, p_cuenta_id, p_creado_por, p_idempotency_key
  )
  RETURNING id INTO v_pago_id;

  INSERT INTO public.pagos_transportistas_despachos (pago_id, despacho_id, neto_usd, cuenta_id)
  SELECT v_pago_id, nd.id, nd.flete_neto_transportista_usd, p_cuenta_id
  FROM public.notas_despacho nd
  WHERE nd.id = ANY(v_marcados)
    AND nd.cuenta_id = p_cuenta_id
    AND nd.flete_comisionable = true
    AND nd.flete_neto_transportista_usd > 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SE_PUDIERON_VINCULAR_DESPACHOS' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.notas_despacho
  SET flete_pagado = true
  WHERE id = ANY(v_marcados)
    AND cuenta_id = p_cuenta_id
    AND flete_comisionable = true
    AND flete_pagado = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SE_PUDIERON_MARCAR_DESPACHOS' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'pago_id', v_pago_id,
    'despachos_marcados', cardinality(v_marcados),
    'monto_aplicado_usd', v_aplicado,
    'excedente_usd', v_excedente,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revertir_pago_transportista(
  p_pago_id UUID,
  p_cuenta_id UUID,
  p_revertido_por UUID,
  p_revertido_por_nombre TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago RECORD;
  v_count INTEGER := 0;
  v_invalid_count INTEGER := 0;
  v_reset_count INTEGER := 0;
BEGIN
  SELECT id, transportista_id, monto_usd, revertido
    INTO v_pago
  FROM public.pagos_transportistas
  WHERE id = p_pago_id
    AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAGO_NO_ENCONTRADO' USING ERRCODE = 'P0002';
  END IF;
  IF v_pago.revertido THEN
    RAISE EXCEPTION 'PAGO_YA_REVERTIDO' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
    INTO v_count
  FROM public.pagos_transportistas_despachos j
  WHERE j.pago_id = p_pago_id
    AND j.cuenta_id = p_cuenta_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'PAGO_SIN_DESPACHOS_VINCULADOS' USING ERRCODE = 'P0001';
  END IF;

  -- Una reversa nunca debe tocar un despacho de nómina ni un vínculo
  -- inconsistente de otra cuenta/chofer. Se aborta completa, sin cambios.
  SELECT count(*)
    INTO v_invalid_count
  FROM public.pagos_transportistas_despachos j
  LEFT JOIN public.notas_despacho nd ON nd.id = j.despacho_id
  WHERE j.pago_id = p_pago_id
    AND j.cuenta_id = p_cuenta_id
    AND (
      nd.id IS NULL
      OR nd.cuenta_id IS DISTINCT FROM p_cuenta_id
      OR nd.transportista_id IS DISTINCT FROM v_pago.transportista_id
      OR nd.flete_comisionable IS NOT TRUE
      OR COALESCE(nd.flete_neto_transportista_usd, 0) <= 0
    );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'FLETE_NO_COMISIONABLE: el pago contiene vínculos que no corresponden a comisiones fuera de Carabobo';
  END IF;

  UPDATE public.notas_despacho nd
  SET flete_pagado = false
  WHERE nd.id IN (
    SELECT j.despacho_id
    FROM public.pagos_transportistas_despachos j
    WHERE j.pago_id = p_pago_id
      AND j.cuenta_id = p_cuenta_id
  )
    AND nd.cuenta_id = p_cuenta_id
    AND nd.transportista_id = v_pago.transportista_id
    AND nd.flete_comisionable = true
    AND nd.flete_neto_transportista_usd > 0
    AND nd.flete_pagado = true;

  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  IF v_reset_count <> v_count THEN
    RAISE EXCEPTION 'NO_SE_PUDIERON_REVERTIR_DESPACHOS' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pagos_transportistas
  SET revertido = true,
      revertido_en = now(),
      revertido_por = p_revertido_por,
      revertido_por_nombre = p_revertido_por_nombre
  WHERE id = p_pago_id
    AND cuenta_id = p_cuenta_id;

  RETURN jsonb_build_object(
    'pago_id', p_pago_id,
    'despachos_reseteados', v_reset_count
  );
END;
$$;

COMMENT ON FUNCTION public.liquidar_transportista(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID[])
  IS 'Liquida únicamente comisiones de flete fuera de Carabobo; la nómina local no se calcula en este sistema.';

REVOKE ALL ON FUNCTION public.liquidar_transportista(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liquidar_transportista(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID[])
  TO service_role;

REVOKE ALL ON FUNCTION public.revertir_pago_transportista(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revertir_pago_transportista(UUID, UUID, UUID, TEXT)
  TO service_role;

-- No se recalculan automáticamente despachos históricos: si no tenían un
-- snapshot confiable de destino/configuración, administración debe revisarlos
-- explícitamente antes de incorporarlos al saldo liquidable.

NOTIFY pgrst, 'reload schema';
