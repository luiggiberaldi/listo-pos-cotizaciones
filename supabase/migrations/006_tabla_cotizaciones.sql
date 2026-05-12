-- 006_tabla_cotizaciones.sql

-- Tipo para máquina de estados (más seguro que CHECK)
CREATE TYPE estado_cotizacion AS ENUM (
  'borrador',    -- Editable por el vendedor
  'enviada',     -- Enviada al cliente — inmutable, se versiona
  'aceptada',    -- Cliente confirmó
  'rechazada',   -- Cliente declinó
  'vencida',     -- Pasó la fecha de validez
  'anulada'      -- Anulada por supervisor o vendedor (solo borradores)
);

CREATE TABLE public.cotizaciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Número de cotización legible
  -- Formato en display: COT-{numero:05d} o COT-{numero:05d} Rev.{version}
  numero          INTEGER GENERATED ALWAYS AS IDENTITY,
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Si version > 1, cotizacion_raiz_id apunta a la RAÍZ (v1), no al anterior
  cotizacion_raiz_id UUID REFERENCES public.cotizaciones(id) ON DELETE SET NULL,

  -- Relaciones
  cliente_id      UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  vendedor_id     UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  transportista_id UUID REFERENCES public.transportistas(id) ON DELETE SET NULL,

  -- Estado
  estado          estado_cotizacion NOT NULL DEFAULT 'borrador',

  -- Totales (desnormalizados — se recalculan al guardar)
  subtotal_usd    NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (subtotal_usd >= 0),
  descuento_global_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
                        CHECK (descuento_global_pct >= 0 AND descuento_global_pct <= 100),
  descuento_usd   NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (descuento_usd >= 0),
  costo_envio_usd NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (costo_envio_usd >= 0),
  total_usd       NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (total_usd >= 0),
  -- Tasa y total en Bs en el MOMENTO de emisión (snapshot)
  tasa_bcv_snapshot  NUMERIC(10,4),
  total_bs_snapshot  NUMERIC(14,2),

  -- Validez
  valida_hasta    DATE,

  -- Notas
  notas_cliente   TEXT,     -- Visible en PDF
  notas_internas  TEXT,     -- SOLO supervisor en la app (no en el PDF)
  -- notas_internas NO se puede ocultar vía RLS (es column-level)
  -- Se filtra en la vista v_cotizaciones_vendedor (ver migration 012)

  -- Metadatos temporales
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviada_en      TIMESTAMPTZ,
  exportada_en    TIMESTAMPTZ   -- Última vez que se generó el PDF

  -- Constraint: solo puede tener cotizacion_raiz si version > 1
  -- (validado en la RPC, no con constraint para simplificar)
);

CREATE INDEX idx_cotizaciones_cliente ON public.cotizaciones(cliente_id);
CREATE INDEX idx_cotizaciones_vendedor ON public.cotizaciones(vendedor_id);
CREATE INDEX idx_cotizaciones_estado ON public.cotizaciones(estado);
CREATE INDEX idx_cotizaciones_numero ON public.cotizaciones(numero DESC);
CREATE INDEX idx_cotizaciones_raiz ON public.cotizaciones(cotizacion_raiz_id)
  WHERE cotizacion_raiz_id IS NOT NULL;

COMMENT ON COLUMN public.cotizaciones.cotizacion_raiz_id
  IS 'UUID de la cotización original (v1). NULL si esta ES la original.';
COMMENT ON COLUMN public.cotizaciones.notas_internas
  IS 'Oculto en la UI del vendedor vía la vista v_cotizaciones_vendedor';
