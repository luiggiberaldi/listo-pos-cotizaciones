-- 221_transportistas_liquidacion_atomica.sql
-- Liquidaciones y reversas atómicas, idempotentes y aisladas por cuenta.

ALTER TABLE public.pagos_transportistas
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS monto_aplicado_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS excedente_usd NUMERIC(12,4) NOT NULL DEFAULT 0;

ALTER TABLE public.pagos_transportistas_despachos
  ADD COLUMN IF NOT EXISTS cuenta_id UUID;

UPDATE public.pagos_transportistas p
SET cuenta_id = t.cuenta_id
FROM public.transportistas t
WHERE p.transportista_id = t.id
  AND p.cuenta_id IS NULL;

UPDATE public.pagos_transportistas_despachos j
SET cuenta_id = p.cuenta_id
FROM public.pagos_transportistas p
WHERE j.pago_id = p.id
  AND j.cuenta_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_transportistas_idempotencia
  ON public.pagos_transportistas(cuenta_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pagos_transportistas_cuenta_transp
  ON public.pagos_transportistas(cuenta_id, transportista_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_ptd_cuenta_pago
  ON public.pagos_transportistas_despachos(cuenta_id, pago_id);

DROP POLICY IF EXISTS "lectura_autenticados" ON public.pagos_transportistas_despachos;
DROP POLICY IF EXISTS pagos_transportistas_despachos_select ON public.pagos_transportistas_despachos;
CREATE POLICY pagos_transportistas_despachos_select
  ON public.pagos_transportistas_despachos
  FOR SELECT TO authenticated
  USING (
    cuenta_id = auth.uid()
    AND public.get_rol_actual() IN ('administracion', 'desarrollador', 'logistica')
  );

DROP POLICY IF EXISTS pagos_transportistas_admin_select ON public.pagos_transportistas;
CREATE POLICY pagos_transportistas_admin_select
  ON public.pagos_transportistas
  FOR SELECT TO authenticated
  USING (
    cuenta_id = auth.uid()
    AND public.get_rol_actual() IN ('administracion', 'desarrollador', 'logistica')
  );

DROP POLICY IF EXISTS pagos_transportistas_admin_insert ON public.pagos_transportistas;
CREATE POLICY pagos_transportistas_admin_insert
  ON public.pagos_transportistas
  FOR INSERT TO authenticated
  WITH CHECK (
    cuenta_id = auth.uid()
    AND public.get_rol_actual() IN ('administracion', 'desarrollador')
  );

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

  SELECT id, es_local, activo, cuenta_id, tipo_relacion
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
  IF v_transportista.tipo_relacion = 'empleado' THEN
    RAISE EXCEPTION 'EMPLEADO_DEBE_LIQUIDARSE_POR_NOMINA' USING ERRCODE = '22023';
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
      AND flete_pagado = false
      AND estado <> 'anulada'
      AND (p_despacho_ids IS NULL OR id = ANY(p_despacho_ids))
    ORDER BY creado_en ASC, id ASC
    FOR UPDATE
  LOOP
    IF v_restante <= 0.0001 THEN EXIT; END IF;
    IF COALESCE(v_despacho.flete_neto_transportista_usd, 0) <= 0 THEN CONTINUE; END IF;
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
    AND nd.cuenta_id = p_cuenta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SE_PUDIERON_VINCULAR_DESPACHOS' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.notas_despacho
  SET flete_pagado = true
  WHERE id = ANY(v_marcados)
    AND cuenta_id = p_cuenta_id
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
BEGIN
  SELECT id, transportista_id, monto_usd, revertido
  INTO v_pago
  FROM public.pagos_transportistas
  WHERE id = p_pago_id
    AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PAGO_NO_ENCONTRADO' USING ERRCODE = 'P0002'; END IF;
  IF v_pago.revertido THEN RAISE EXCEPTION 'PAGO_YA_REVERTIDO' USING ERRCODE = '22023'; END IF;

  SELECT count(*) INTO v_count
  FROM public.pagos_transportistas_despachos
  WHERE pago_id = p_pago_id AND cuenta_id = p_cuenta_id;

  IF v_count = 0 THEN RAISE EXCEPTION 'PAGO_SIN_DESPACHOS_VINCULADOS' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.notas_despacho nd
  SET flete_pagado = false
  WHERE nd.id IN (
    SELECT despacho_id
    FROM public.pagos_transportistas_despachos
    WHERE pago_id = p_pago_id AND cuenta_id = p_cuenta_id
  )
  AND nd.cuenta_id = p_cuenta_id
  AND nd.flete_pagado = true;

  UPDATE public.pagos_transportistas
  SET revertido = true,
      revertido_en = now(),
      revertido_por = p_revertido_por,
      revertido_por_nombre = p_revertido_por_nombre
  WHERE id = p_pago_id AND cuenta_id = p_cuenta_id;

  RETURN jsonb_build_object('pago_id', p_pago_id, 'despachos_reseteados', v_count);
END;
$$;
