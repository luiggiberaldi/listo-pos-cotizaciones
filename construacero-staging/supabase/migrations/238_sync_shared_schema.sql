-- 238_sync_shared_schema.sql
-- Sincronización segura del esquema compartido de staging.
--
-- Se conservan deliberadamente las diferencias propias de staging:
--   * tablas y configuración de nómina;
--   * configuración global de transportistas;
--   * vector_embedding con dimensión 1536;
--   * defaults y snapshots más recientes de notas_despacho_items.
--
-- Esta migración solo agrega compatibilidad requerida por la aplicación y por
-- el esquema compartido observado en el backup de producción.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cuentas_por_cobrar') IS NULL
     OR to_regclass('public.despacho_descuentos') IS NULL
     OR to_regclass('public.notas_despacho') IS NULL
     OR to_regclass('public.notas_despacho_items') IS NULL
     OR to_regclass('public.push_subscriptions') IS NULL
     OR to_regclass('public.usuarios') IS NULL
  THEN
    RAISE EXCEPTION 'PRECONDICION_TABLAS_COMPARTIDAS_FALTANTE';
  END IF;
END
$$;

-- CxC: la aplicación consulta y guarda la fecha de vencimiento del crédito.
ALTER TABLE public.cuentas_por_cobrar
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

COMMENT ON COLUMN public.cuentas_por_cobrar.fecha_vencimiento IS
  'Fecha de vencimiento para los créditos (días de crédito sumados a la fecha de creación)';

-- Descuentos: el flujo actual puede apuntar al snapshot del ítem del despacho.
ALTER TABLE public.despacho_descuentos
  ADD COLUMN IF NOT EXISTS despacho_item_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.despacho_descuentos'::regclass
      AND conname = 'despacho_descuentos_despacho_item_id_fkey'
  ) THEN
    ALTER TABLE public.despacho_descuentos
      ADD CONSTRAINT despacho_descuentos_despacho_item_id_fkey
      FOREIGN KEY (despacho_item_id)
      REFERENCES public.notas_despacho_items(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_despacho_descuentos_despacho_item
  ON public.despacho_descuentos(despacho_item_id)
  WHERE despacho_item_id IS NOT NULL;

-- El flujo de descuentos por unidad necesita este valor permitido.
ALTER TABLE public.despacho_descuentos
  DROP CONSTRAINT IF EXISTS despacho_descuentos_tipo_check;

ALTER TABLE public.despacho_descuentos
  ADD CONSTRAINT despacho_descuentos_tipo_check
  CHECK (tipo IN ('porcentaje', 'monto', 'monto_unitario'));

-- Snapshot temporal del ítem y fecha de creación histórica.
ALTER TABLE public.notas_despacho_items
  ADD COLUMN IF NOT EXISTS editado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS editado_por UUID,
  ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ DEFAULT now();

UPDATE public.notas_despacho_items
SET creado_en = now()
WHERE creado_en IS NULL;

ALTER TABLE public.notas_despacho_items
  ALTER COLUMN creado_en SET DEFAULT now(),
  ALTER COLUMN creado_en SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.notas_despacho_items'::regclass
      AND conname = 'notas_despacho_items_editado_por_fkey'
  ) THEN
    ALTER TABLE public.notas_despacho_items
      ADD CONSTRAINT notas_despacho_items_editado_por_fkey
      FOREIGN KEY (editado_por)
      REFERENCES public.usuarios(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_nd_items_despacho
  ON public.notas_despacho_items(despacho_id);

CREATE INDEX IF NOT EXISTS idx_nd_items_producto
  ON public.notas_despacho_items(producto_id);

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS items_editado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS items_editado_por TEXT;

-- Compatibilidad con clientes push que envían User-Agent.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Segundo teléfono opcional del operador.
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS telefono_secundario TEXT;

CREATE INDEX IF NOT EXISTS idx_cotizacion_items_producto
  ON public.cotizacion_items(producto_id);

CREATE INDEX IF NOT EXISTS idx_notas_despacho_cliente
  ON public.notas_despacho(cliente_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
