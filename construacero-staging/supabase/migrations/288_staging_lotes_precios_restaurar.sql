-- 288_staging_lotes_precios_restaurar.sql
-- Actualización masiva de precios: historial de lotes y botón "Restaurar" (pedido del dueño 2026-11-02).
--
-- Cada cambio masivo queda guardado como un LOTE con los precios de antes y de después de
-- cada producto. Dos funciones, ambas todo-o-nada (una sola transacción):
--   aplicar_lote_precios   → guarda el lote y cambia los precios a la vez. Si algún precio
--                            cambió entre la vista previa y la confirmación, no cambia nada.
--   restaurar_lote_precios → devuelve los precios de antes, SOLO de los productos que no se
--                            tocaron después (el precio actual debe seguir igual al de después).
-- Las tablas y funciones son solo del Worker (service_role): el navegador no las toca (R2).
-- Los lotes de más de 60 días se limpian solos al aplicar un lote nuevo.
-- Rollback: 288_staging_lotes_precios_restaurar_rollback.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.productos_precio_lotes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id          UUID NOT NULL,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  operador_id        UUID,
  operador_nombre    TEXT NOT NULL DEFAULT 'Sistema',
  operador_rol       TEXT,
  modo               TEXT NOT NULL,
  porcentaje         NUMERIC,
  categoria          TEXT,
  precio_objetivo    TEXT NOT NULL,
  seleccion_manual   BOOLEAN NOT NULL DEFAULT false,
  total_productos    INT NOT NULL DEFAULT 0,
  restaurado_en      TIMESTAMPTZ,
  restaurado_por_id  UUID,
  restaurado_por_nombre TEXT,
  restaurados        INT,
  parciales          INT,
  omitidos           INT
);

CREATE INDEX IF NOT EXISTS idx_productos_precio_lotes_cuenta
  ON public.productos_precio_lotes (cuenta_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS public.productos_precio_lote_items (
  lote_id            UUID NOT NULL REFERENCES public.productos_precio_lotes(id) ON DELETE CASCADE,
  producto_id        UUID NOT NULL,
  nombre             TEXT NOT NULL,
  precio_usd_antes   NUMERIC(12,4),
  precio_usd_despues NUMERIC(12,4),
  precio_2_antes     NUMERIC(12,4),
  precio_2_despues   NUMERIC(12,4),
  precio_3_antes     NUMERIC(12,4),
  precio_3_despues   NUMERIC(12,4),
  PRIMARY KEY (lote_id, producto_id)
);

-- Solo el Worker (service_role) lee y escribe. En producción Supabase da permisos amplios
-- por defecto a anon/authenticated (lección de la 283b): se quitan de forma explícita.
ALTER TABLE public.productos_precio_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos_precio_lote_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.productos_precio_lotes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.productos_precio_lote_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.productos_precio_lotes TO service_role;
GRANT ALL ON public.productos_precio_lote_items TO service_role;

-- ───────────────────────────────────────────────────────────────────────────────
-- p_cambios: [{ "id": uuid, "nombre": text,
--               "precio_usd": {"antes": n, "despues": n}, "precio_2": {...}, "precio_3": {...} }]
-- (solo aparecen los precios que cambian)
CREATE OR REPLACE FUNCTION public.aplicar_lote_precios(
  p_cuenta_id UUID,
  p_operador_id UUID,
  p_operador_nombre TEXT,
  p_operador_rol TEXT,
  p_modo TEXT,
  p_porcentaje NUMERIC,
  p_categoria TEXT,
  p_precio_objetivo TEXT,
  p_seleccion_manual BOOLEAN,
  p_cambios JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote UUID;
  v_item JSONB;
  v_actual RECORD;
  v_id UUID;
  v_n INT := 0;
BEGIN
  IF p_cuenta_id IS NULL THEN RAISE EXCEPTION 'CUENTA_OBLIGATORIA'; END IF;
  IF p_cambios IS NULL OR jsonb_typeof(p_cambios) <> 'array' OR jsonb_array_length(p_cambios) = 0 THEN
    RAISE EXCEPTION 'SIN_CAMBIOS';
  END IF;
  IF jsonb_array_length(p_cambios) > 10000 THEN RAISE EXCEPTION 'DEMASIADOS_PRODUCTOS'; END IF;

  -- Limpieza de lotes viejos de esta cuenta
  DELETE FROM public.productos_precio_lotes
   WHERE cuenta_id = p_cuenta_id AND creado_en < now() - interval '60 days';

  INSERT INTO public.productos_precio_lotes (
    cuenta_id, operador_id, operador_nombre, operador_rol, modo, porcentaje,
    categoria, precio_objetivo, seleccion_manual, total_productos
  ) VALUES (
    p_cuenta_id, p_operador_id, COALESCE(NULLIF(btrim(p_operador_nombre), ''), 'Sistema'), p_operador_rol,
    p_modo, p_porcentaje, p_categoria, p_precio_objetivo, COALESCE(p_seleccion_manual, false),
    jsonb_array_length(p_cambios)
  ) RETURNING id INTO v_lote;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cambios) LOOP
    v_id := (v_item->>'id')::UUID;

    SELECT precio_usd, precio_2, precio_3
      INTO v_actual
      FROM public.productos
     WHERE id = v_id AND cuenta_id = p_cuenta_id AND activo = true
       FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO:%', v_id; END IF;

    -- Si alguien cambió el precio después de la vista previa, no se cambia nada
    IF (v_item ? 'precio_usd') AND v_actual.precio_usd IS DISTINCT FROM (v_item->'precio_usd'->>'antes')::NUMERIC
       OR (v_item ? 'precio_2') AND v_actual.precio_2 IS DISTINCT FROM (v_item->'precio_2'->>'antes')::NUMERIC
       OR (v_item ? 'precio_3') AND v_actual.precio_3 IS DISTINCT FROM (v_item->'precio_3'->>'antes')::NUMERIC THEN
      RAISE EXCEPTION 'PRECIO_CAMBIO_CONCURRENTE';
    END IF;

    UPDATE public.productos SET
      precio_usd = CASE WHEN v_item ? 'precio_usd' THEN (v_item->'precio_usd'->>'despues')::NUMERIC ELSE precio_usd END,
      precio_2   = CASE WHEN v_item ? 'precio_2'   THEN (v_item->'precio_2'->>'despues')::NUMERIC   ELSE precio_2 END,
      precio_3   = CASE WHEN v_item ? 'precio_3'   THEN (v_item->'precio_3'->>'despues')::NUMERIC   ELSE precio_3 END,
      actualizado_en = now()
    WHERE id = v_id AND cuenta_id = p_cuenta_id;

    INSERT INTO public.productos_precio_lote_items (
      lote_id, producto_id, nombre,
      precio_usd_antes, precio_usd_despues, precio_2_antes, precio_2_despues, precio_3_antes, precio_3_despues
    ) VALUES (
      v_lote, v_id, COALESCE(v_item->>'nombre', ''),
      (v_item->'precio_usd'->>'antes')::NUMERIC, (v_item->'precio_usd'->>'despues')::NUMERIC,
      (v_item->'precio_2'->>'antes')::NUMERIC,   (v_item->'precio_2'->>'despues')::NUMERIC,
      (v_item->'precio_3'->>'antes')::NUMERIC,   (v_item->'precio_3'->>'despues')::NUMERIC
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('lote_id', v_lote, 'updated', v_n);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restaurar_lote_precios(
  p_cuenta_id UUID,
  p_lote_id UUID,
  p_operador_id UUID,
  p_operador_nombre TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote public.productos_precio_lotes%ROWTYPE;
  v_it public.productos_precio_lote_items%ROWTYPE;
  v_actual RECORD;
  v_cambian INT;
  v_ok INT;
  v_nuevo_usd NUMERIC;
  v_nuevo_2 NUMERIC;
  v_nuevo_3 NUMERIC;
  v_completos INT := 0;
  v_parciales INT := 0;
  v_omitidos INT := 0;
BEGIN
  SELECT * INTO v_lote FROM public.productos_precio_lotes
   WHERE id = p_lote_id AND cuenta_id = p_cuenta_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_NO_ENCONTRADO'; END IF;
  IF v_lote.restaurado_en IS NOT NULL THEN RAISE EXCEPTION 'LOTE_YA_RESTAURADO'; END IF;

  FOR v_it IN SELECT * FROM public.productos_precio_lote_items WHERE lote_id = p_lote_id LOOP
    SELECT precio_usd, precio_2, precio_3 INTO v_actual
      FROM public.productos
     WHERE id = v_it.producto_id AND cuenta_id = p_cuenta_id
       FOR UPDATE;
    IF NOT FOUND THEN
      v_omitidos := v_omitidos + 1;
      CONTINUE;
    END IF;

    v_cambian := 0; v_ok := 0;
    v_nuevo_usd := v_actual.precio_usd; v_nuevo_2 := v_actual.precio_2; v_nuevo_3 := v_actual.precio_3;

    IF v_it.precio_usd_despues IS NOT NULL THEN
      v_cambian := v_cambian + 1;
      IF v_actual.precio_usd IS NOT DISTINCT FROM v_it.precio_usd_despues THEN
        v_nuevo_usd := v_it.precio_usd_antes; v_ok := v_ok + 1;
      END IF;
    END IF;
    IF v_it.precio_2_despues IS NOT NULL THEN
      v_cambian := v_cambian + 1;
      IF v_actual.precio_2 IS NOT DISTINCT FROM v_it.precio_2_despues THEN
        v_nuevo_2 := v_it.precio_2_antes; v_ok := v_ok + 1;
      END IF;
    END IF;
    IF v_it.precio_3_despues IS NOT NULL THEN
      v_cambian := v_cambian + 1;
      IF v_actual.precio_3 IS NOT DISTINCT FROM v_it.precio_3_despues THEN
        v_nuevo_3 := v_it.precio_3_antes; v_ok := v_ok + 1;
      END IF;
    END IF;

    IF v_ok = 0 THEN
      v_omitidos := v_omitidos + 1;
    ELSE
      UPDATE public.productos
         SET precio_usd = v_nuevo_usd, precio_2 = v_nuevo_2, precio_3 = v_nuevo_3, actualizado_en = now()
       WHERE id = v_it.producto_id AND cuenta_id = p_cuenta_id;
      IF v_ok = v_cambian THEN v_completos := v_completos + 1; ELSE v_parciales := v_parciales + 1; END IF;
    END IF;
  END LOOP;

  UPDATE public.productos_precio_lotes
     SET restaurado_en = now(), restaurado_por_id = p_operador_id,
         restaurado_por_nombre = COALESCE(NULLIF(btrim(p_operador_nombre), ''), 'Sistema'),
         restaurados = v_completos, parciales = v_parciales, omitidos = v_omitidos
   WHERE id = p_lote_id;

  RETURN jsonb_build_object('restaurados', v_completos, 'parciales', v_parciales, 'omitidos', v_omitidos);
END;
$$;

REVOKE ALL ON FUNCTION public.aplicar_lote_precios(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_lote_precios(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.restaurar_lote_precios(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restaurar_lote_precios(UUID, UUID, UUID, TEXT) TO service_role;

COMMIT;
