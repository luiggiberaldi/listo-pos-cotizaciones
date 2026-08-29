-- 010_tabla_configuracion.sql
-- Una sola fila por sistema (singleton pattern)
CREATE TABLE public.configuracion_negocio (
  id                  INTEGER PRIMARY KEY DEFAULT 1
                      CHECK (id = 1),  -- Solo puede haber una fila
  nombre_negocio      TEXT NOT NULL DEFAULT 'Ferretería',
  rif_negocio         TEXT,
  telefono_negocio    TEXT,
  direccion_negocio   TEXT,
  email_negocio       TEXT,
  logo_url            TEXT,           -- URL en Supabase Storage
  moneda_principal    TEXT NOT NULL DEFAULT 'USD'
                      CHECK (moneda_principal IN ('USD', 'VES')),
  validez_cotizacion_dias INTEGER NOT NULL DEFAULT 15
                      CHECK (validez_cotizacion_dias > 0),
  pie_pagina_pdf      TEXT DEFAULT 'Gracias por su preferencia.',
  tasa_bcv_manual     NUMERIC(10,4),  -- Si no hay integración con BCV
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.configuracion_negocio
  IS 'Tabla singleton (solo id=1). Configuración global del negocio para PDFs.';
