# Listo POS Cotizaciones — Arquitectura del Sistema

> Documento maestro de arquitectura, base de datos y reglas de negocio.
> **Versión 1.1** — Revisión crítica sobre v1.0 del 14/04/2026.
> Todos los SQL en esta versión son ejecutables en Supabase sin ambigüedades.

---

## ERRORES CORREGIDOS VS v1.0

| # | Problema detectado en v1.0 | Corrección en v1.1 |
|---|---|---|
| 1 | `SERIAL` deprecado en PG14+ | Reemplazado por `GENERATED ALWAYS AS IDENTITY` |
| 2 | RLS en `cotizacion_items` completamente ausente | Políticas definidas explícitamente |
| 3 | RLS en `transportistas` ausente | Políticas definidas explícitamente |
| 4 | RLS en `reasignaciones_clientes` ausente | Políticas definidas |
| 5 | RLS en `usuarios` ausente | Políticas definidas |
| 6 | Política INSERT en `cotizaciones` ausente | Agregada |
| 7 | `SECURITY DEFINER` sin `SET search_path` | Corregido en todas las RPCs |
| 8 | `auditoria` INSERT bloqueada desde funciones SECURITY DEFINER | Resuelto con `SECURITY DEFINER` en RPC de auditoría |
| 9 | `costo_usd` "oculto" via comentario SQL (RLS no es column-level) | Vista `v_productos_vendedor` sin esa columna |
| 10 | `notas_internas` igual: no se puede ocultar con RLS | Vista de cotizaciones por rol |
| 11 | Orden de CREATE TABLE tiene dependencias circulares implícitas | Orden de migrations corregido |
| 12 | Máquina de estados de cotización sin transiciones válidas definidas | Estado `anulada` agregado + trigger de validación |
| 13 | `updated_at` sin triggers (no se auto-actualiza) | Triggers definidos para todas las tablas |
| 14 | Tabla `configuracion_negocio` omitida (necesaria para el PDF) | Tabla agregada |
| 15 | Versioning de cotizaciones sin lógica completa | Especificación exacta del modelo |
| 16 | Campo `precio_bs` en productos sin claridad sobre cómo se calcula | Eliminado como columna — se calcula en frontend |
| 17 | Política `clientes_supervisor` FOR ALL sin WITH CHECK | Separada en SELECT, INSERT, UPDATE, DELETE |
| 18 | Política `productos_lectura` sin RLS habilitado explícitamente | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` incluido |
| 19 | Sin política DEFAULT DENY explícita | Documentado: Supabase con RLS = deny-by-default |
| 20 | Campos mínimos para EMITIR cotización no definidos | Definición exacta en sección 9 |

---

## 1. ANÁLISIS DEL PROYECTO BASE (sin cambios desde v1.0)

### Archivos que SE CONSERVAN
| Archivo/Carpeta | Razón |
|---|---|
| `src/utils/dinero.js` | Matemática financiera precisa |
| `src/components/ui/` | Componentes UI genéricos |
| `tailwind.config.js` | Configuración de estilos |
| `vite.config.js` | Build config (quitar plugin PWA) |
| `postcss.config.js`, `eslint.config.js` | Sin cambios |

### Archivos que SE REESCRIBEN COMPLETOS
| Archivo | Razón |
|---|---|
| `src/config/supabase.js` | Nuevo proyecto Supabase, cliente limpio |
| `src/hooks/store/useAuthStore.js` | Rol desde BD, no PIN local |
| `src/App.jsx` | Nueva navegación, rutas por rol |
| `package.json` | Quitar Capacitor, Groq; agregar TanStack Query |

### Archivos/Carpetas que SE ELIMINAN
Ver BITACORA.md — Sesión 1. No cambia.

---

## 2. ESTRUCTURA DE CARPETAS (sin cambios desde v1.0)

```
listo pos cotizaciones/
├── public/
│   └── logo.png
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── ui/                      # Botón, Modal, Input, Badge, EmptyState
│   │   ├── layout/
│   │   │   ├── Navbar.jsx
│   │   │   └── Sidebar.jsx
│   │   ├── clientes/
│   │   │   ├── ClienteForm.jsx
│   │   │   ├── ClienteCard.jsx
│   │   │   └── ReasignacionModal.jsx  # NUEVO (era ClienteAsignado.jsx)
│   │   ├── cotizaciones/
│   │   │   ├── CotizacionBuilder.jsx
│   │   │   ├── ItemLinea.jsx
│   │   │   ├── ResumenCotizacion.jsx
│   │   │   └── PDFPreview.jsx
│   │   ├── inventario/
│   │   │   ├── ProductoBusqueda.jsx
│   │   │   └── ProductoCard.jsx
│   │   ├── transportistas/
│   │   │   ├── TransportistaForm.jsx
│   │   │   └── TransportistaCard.jsx
│   │   └── auditoria/
│   │       └── LogAuditoria.jsx
│   ├── config/
│   │   └── supabase.js
│   ├── hooks/
│   │   ├── store/
│   │   │   └── useAuthStore.js
│   │   ├── useClientes.js
│   │   ├── useCotizaciones.js
│   │   ├── useInventario.js
│   │   ├── useTransportistas.js
│   │   ├── useConfigNegocio.js      # NUEVO
│   │   └── useNotificaciones.js
│   ├── services/
│   │   └── cotizacionPDF.js
│   ├── utils/
│   │   ├── dinero.js
│   │   └── formatters.js
│   ├── views/
│   │   ├── LoginView.jsx
│   │   ├── ClientesView.jsx
│   │   ├── NuevaCotizacionView.jsx
│   │   ├── CotizacionesView.jsx
│   │   ├── InventarioView.jsx
│   │   ├── TransportistasView.jsx
│   │   └── SupervisorView.jsx
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── supabase/
│   └── migrations/
│       ├── 001_extensions.sql
│       ├── 002_tabla_usuarios.sql
│       ├── 003_tabla_productos.sql
│       ├── 004_tabla_transportistas.sql
│       ├── 005_tabla_clientes.sql
│       ├── 006_tabla_cotizaciones.sql
│       ├── 007_tabla_cotizacion_items.sql
│       ├── 008_tabla_auditoria.sql
│       ├── 009_tabla_reasignaciones.sql
│       ├── 010_tabla_configuracion.sql
│       ├── 011_triggers.sql
│       ├── 012_views.sql
│       ├── 013_rls_enable_and_policies.sql
│       ├── 014_funciones_rpc.sql
│       └── 015_seed_configuracion.sql
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── .env.example
```

---

## 3. ESQUEMA DE BASE DE DATOS — EJECUTABLE EN SUPABASE

### ORDEN CORRECTO DE EJECUCIÓN (dependencias resueltas)

```
001 → extensions (uuid-ossp)
002 → usuarios      (depende de: auth.users)
003 → productos     (depende de: nada)
004 → transportistas (depende de: usuarios)
005 → clientes      (depende de: usuarios)
006 → cotizaciones  (depende de: clientes, transportistas, usuarios)
007 → cotizacion_items (depende de: cotizaciones, productos)
008 → auditoria     (depende de: usuarios)
009 → reasignaciones_clientes (depende de: clientes, usuarios)
010 → configuracion_negocio (depende de: nada)
011 → triggers
012 → views
013 → RLS
014 → RPCs
015 → seed
```

---

### MIGRATION 001 — Extensions

```sql
-- 001_extensions.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- gen_random_uuid() ya viene incluido en PG14+; uuid-ossp es por compatibilidad
```

---

### MIGRATION 002 — Tabla `usuarios`

```sql
-- 002_tabla_usuarios.sql
CREATE TABLE public.usuarios (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  rol         TEXT NOT NULL CHECK (rol IN ('supervisor', 'vendedor')),
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.usuarios IS 'Extensión de auth.users con datos de rol y negocio';
COMMENT ON COLUMN public.usuarios.creado_por IS 'Supervisor que creó este usuario';
```

---

### MIGRATION 003 — Tabla `productos`

```sql
-- 003_tabla_productos.sql
CREATE TABLE public.productos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         TEXT,
  nombre         TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  descripcion    TEXT,
  categoria      TEXT,
  unidad         TEXT NOT NULL DEFAULT 'und',
  precio_usd     NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (precio_usd >= 0),
  -- precio_bs se calcula en frontend: precio_usd * tasa_bcv_actual
  -- NO se almacena precio_bs para evitar inconsistencias con tasas cambiantes
  costo_usd      NUMERIC(12,4) CHECK (costo_usd >= 0),
  -- costo_usd visible SOLO para supervisores (ver vista v_productos_vendedor)
  stock_actual   NUMERIC(10,2) NOT NULL DEFAULT 0,
  stock_minimo   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  imagen_url     TEXT,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_productos_nombre_fts
  ON public.productos USING gin(to_tsvector('spanish', nombre));
CREATE INDEX idx_productos_categoria ON public.productos(categoria);
CREATE INDEX idx_productos_activo ON public.productos(activo) WHERE activo = true;
CREATE UNIQUE INDEX idx_productos_codigo_unico
  ON public.productos(codigo) WHERE codigo IS NOT NULL AND codigo <> '';

COMMENT ON COLUMN public.productos.costo_usd
  IS 'Costo de compra. SOLO visible para supervisores vía vista v_productos_supervisor';
```

---

### MIGRATION 004 — Tabla `transportistas`

```sql
-- 004_tabla_transportistas.sql
CREATE TABLE public.transportistas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  rif            TEXT,
  telefono       TEXT,
  zona_cobertura TEXT,
  tarifa_base    NUMERIC(12,2) DEFAULT 0 CHECK (tarifa_base >= 0),
  notas          TEXT,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por     UUID REFERENCES public.usuarios(id) ON DELETE SET NULL
);
```

---

### MIGRATION 005 — Tabla `clientes`

```sql
-- 005_tabla_clientes.sql
CREATE TABLE public.clientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Datos del cliente
  nombre          TEXT NOT NULL CHECK (char_length(trim(nombre)) > 0),
  rif_cedula      TEXT,
  telefono        TEXT,
  email           TEXT,
  direccion       TEXT,
  notas           TEXT,

  -- Control de asignación (núcleo del anti-robo)
  vendedor_id     UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  asignado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Metadatos de última reasignación (desnormalizados para consulta rápida)
  -- El historial completo vive en reasignaciones_clientes
  ultima_reasig_por  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ultima_reasig_motivo TEXT,
  ultima_reasig_en    TIMESTAMPTZ,

  -- Metadatos
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_clientes_vendedor ON public.clientes(vendedor_id);
CREATE INDEX idx_clientes_activo ON public.clientes(activo) WHERE activo = true;

-- RIF único (solo cuando tiene valor — NULL no viola la unicidad)
CREATE UNIQUE INDEX idx_clientes_rif_unico
  ON public.clientes(rif_cedula)
  WHERE rif_cedula IS NOT NULL AND trim(rif_cedula) <> '';

COMMENT ON COLUMN public.clientes.vendedor_id
  IS 'Propietario del cliente. Solo modificable vía RPC reasignar_cliente()';
```

---

### MIGRATION 006 — Tabla `cotizaciones`

```sql
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
  -- Si version > 1, cotizacion_padre_id apunta a la RAÍZ (v1), no al anterior
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
```

---

### MIGRATION 007 — Tabla `cotizacion_items`

```sql
-- 007_tabla_cotizacion_items.sql
CREATE TABLE public.cotizacion_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id    UUID NOT NULL
                   REFERENCES public.cotizaciones(id) ON DELETE CASCADE,

  -- Snapshot del producto al momento de cotizar
  -- producto_id es referencial pero el precio real es el snapshot
  producto_id      UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  codigo_snap      TEXT,
  nombre_snap      TEXT NOT NULL CHECK (char_length(trim(nombre_snap)) > 0),
  unidad_snap      TEXT NOT NULL DEFAULT 'und',

  -- Cantidades y precios
  cantidad         NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  precio_unit_usd  NUMERIC(12,4) NOT NULL CHECK (precio_unit_usd >= 0),
  descuento_pct    NUMERIC(5,2) NOT NULL DEFAULT 0
                   CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  total_linea_usd  NUMERIC(12,4) NOT NULL CHECK (total_linea_usd >= 0),
  -- total_linea_usd = cantidad * precio_unit_usd * (1 - descuento_pct/100)

  -- Orden visual en la cotización
  orden            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_items_cotizacion ON public.cotizacion_items(cotizacion_id);

COMMENT ON COLUMN public.cotizacion_items.producto_id
  IS 'Referencia al catálogo. Puede ser NULL si el producto fue eliminado.';
COMMENT ON COLUMN public.cotizacion_items.nombre_snap
  IS 'Nombre del producto al momento de cotizar. No cambia si el catálogo cambia.';
```

---

### MIGRATION 008 — Tabla `auditoria`

```sql
-- 008_tabla_auditoria.sql
CREATE TYPE categoria_auditoria AS ENUM (
  'AUTH', 'CLIENTE', 'COTIZACION', 'INVENTARIO',
  'TRANSPORTISTA', 'USUARIO', 'REASIGNACION', 'CONFIGURACION', 'SISTEMA'
);

CREATE TABLE public.auditoria (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Quién (desnormalizado para preservar historial aunque el usuario se elimine)
  usuario_id    UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  usuario_nombre TEXT NOT NULL DEFAULT 'Sistema',
  usuario_rol   TEXT NOT NULL DEFAULT 'sistema',

  -- Qué
  categoria     categoria_auditoria NOT NULL,
  accion        TEXT NOT NULL,
  descripcion   TEXT,

  -- Sobre qué
  entidad_tipo  TEXT,
  entidad_id    UUID,

  -- Contexto
  meta          JSONB DEFAULT '{}'::jsonb,
  ip_origen     TEXT
);

-- Esta tabla es APPEND-ONLY: nunca UPDATE ni DELETE
-- Enforced via RLS (no UPDATE/DELETE policies) y permisos de tabla
CREATE INDEX idx_auditoria_ts ON public.auditoria(ts DESC);
CREATE INDEX idx_auditoria_usuario ON public.auditoria(usuario_id);
CREATE INDEX idx_auditoria_categoria ON public.auditoria(categoria);
CREATE INDEX idx_auditoria_entidad ON public.auditoria(entidad_tipo, entidad_id)
  WHERE entidad_id IS NOT NULL;

COMMENT ON TABLE public.auditoria
  IS 'Registro inmutable. Solo INSERT. Ver políticas RLS.';
```

---

### MIGRATION 009 — Tabla `reasignaciones_clientes`

```sql
-- 009_tabla_reasignaciones.sql
CREATE TABLE public.reasignaciones_clientes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id       UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  vendedor_origen  UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  vendedor_destino UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  supervisor_id    UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  motivo           TEXT NOT NULL CHECK (char_length(trim(motivo)) >= 10),
  -- Mínimo 10 caracteres para forzar motivos descriptivos
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reasig_cliente ON public.reasignaciones_clientes(cliente_id);
CREATE INDEX idx_reasig_supervisor ON public.reasignaciones_clientes(supervisor_id);

COMMENT ON COLUMN public.reasignaciones_clientes.motivo
  IS 'Mínimo 10 caracteres. Evita motivos como "x" o "na".';
```

---

### MIGRATION 010 — Tabla `configuracion_negocio`

```sql
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
```

---

### MIGRATION 011 — Triggers `updated_at`

```sql
-- 011_triggers.sql

-- Función genérica para updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en = now();
  RETURN NEW;
END;
$$;

-- Aplicar a todas las tablas con actualizado_en
CREATE TRIGGER trg_usuarios_updated
  BEFORE UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_productos_updated
  BEFORE UPDATE ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_transportistas_updated
  BEFORE UPDATE ON public.transportistas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_clientes_updated
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_cotizaciones_updated
  BEFORE UPDATE ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_config_updated
  BEFORE UPDATE ON public.configuracion_negocio
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Trigger: validar transiciones de estado (máquina de estados)
CREATE OR REPLACE FUNCTION public.validar_transicion_estado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transiciones_validas TEXT[][] := ARRAY[
    -- [estado_origen, estado_destino]
    ARRAY['borrador',  'enviada'],
    ARRAY['borrador',  'anulada'],
    ARRAY['enviada',   'aceptada'],
    ARRAY['enviada',   'rechazada'],
    ARRAY['enviada',   'vencida'],
    ARRAY['enviada',   'anulada'],
    ARRAY['aceptada',  'anulada'],    -- Solo supervisor, validado en RPC
    ARRAY['vencida',   'anulada']
  ];
  par TEXT[];
  valido BOOLEAN := false;
BEGIN
  -- Si el estado no cambia, permitir
  IF OLD.estado = NEW.estado THEN
    RETURN NEW;
  END IF;

  FOREACH par SLICE 1 IN ARRAY transiciones_validas LOOP
    IF par[1] = OLD.estado::TEXT AND par[2] = NEW.estado::TEXT THEN
      valido := true;
      EXIT;
    END IF;
  END LOOP;

  IF NOT valido THEN
    RAISE EXCEPTION 'Transición de estado inválida: % → %', OLD.estado, NEW.estado;
  END IF;

  -- Registrar timestamps automáticamente
  IF NEW.estado = 'enviada' AND OLD.estado = 'borrador' THEN
    NEW.enviada_en = now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cotizaciones_estado
  BEFORE UPDATE OF estado ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.validar_transicion_estado();
```

---

### MIGRATION 012 — Vistas (Column-Level Security)

```sql
-- 012_views.sql
-- Las vistas son la única forma de ocultar columnas en Supabase/PostgREST

-- Vista de productos para VENDEDORES (sin costo_usd)
CREATE OR REPLACE VIEW public.v_productos_vendedor AS
SELECT
  id,
  codigo,
  nombre,
  descripcion,
  categoria,
  unidad,
  precio_usd,
  -- costo_usd OMITIDO intencionalmente
  stock_actual,
  stock_minimo,
  imagen_url,
  activo,
  creado_en,
  actualizado_en
FROM public.productos
WHERE activo = true;

COMMENT ON VIEW public.v_productos_vendedor
  IS 'Vista sin costo_usd. Para uso exclusivo del rol vendedor.';


-- Vista de cotizaciones para VENDEDORES (sin notas_internas)
CREATE OR REPLACE VIEW public.v_cotizaciones_vendedor AS
SELECT
  id,
  numero,
  version,
  cotizacion_raiz_id,
  cliente_id,
  vendedor_id,
  transportista_id,
  estado,
  subtotal_usd,
  descuento_global_pct,
  descuento_usd,
  costo_envio_usd,
  total_usd,
  tasa_bcv_snapshot,
  total_bs_snapshot,
  valida_hasta,
  notas_cliente,
  -- notas_internas OMITIDO intencionalmente
  creado_en,
  actualizado_en,
  enviada_en,
  exportada_en
FROM public.cotizaciones;

COMMENT ON VIEW public.v_cotizaciones_vendedor
  IS 'Vista sin notas_internas. Para uso exclusivo del rol vendedor.';
```

---

### MIGRATION 013 — RLS (Row Level Security)

```sql
-- 013_rls_enable_and_policies.sql
-- PRINCIPIO: Con RLS habilitado, el DEFAULT es DENY ALL.
-- Cada política que se crea es un permiso adicional (PERMISSIVE = OR entre políticas del mismo comando).

-- ============================================================
-- HABILITAR RLS EN TODAS LAS TABLAS
-- ============================================================
ALTER TABLE public.usuarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transportistas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizaciones          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizacion_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reasignaciones_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_negocio ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- HELPER: función para verificar rol del usuario actual
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_rol_actual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo = true;
$$;


-- ============================================================
-- TABLA: usuarios
-- ============================================================

-- Cualquier usuario autenticado puede verse a sí mismo
CREATE POLICY usuarios_ver_propio ON public.usuarios
  FOR SELECT
  USING (id = auth.uid());

-- Supervisores ven todos los usuarios
CREATE POLICY usuarios_supervisor_select ON public.usuarios
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Solo supervisores crean usuarios
CREATE POLICY usuarios_supervisor_insert ON public.usuarios
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Solo supervisores actualizan usuarios (y no pueden cambiar su propio rol)
CREATE POLICY usuarios_supervisor_update ON public.usuarios
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor')
  WITH CHECK (
    -- Un supervisor no puede quitarse el rol a sí mismo
    NOT (id = auth.uid() AND NEW.rol <> 'supervisor')
  );

-- Nadie elimina usuarios (se desactivan con activo = false)
-- No CREATE POLICY para DELETE → DENY por default


-- ============================================================
-- TABLA: productos
-- ============================================================

-- Todos los usuarios autenticados leen productos activos
CREATE POLICY productos_todos_leen ON public.productos
  FOR SELECT
  USING (activo = true);

-- Solo supervisores insertan, actualizan, eliminan productos
CREATE POLICY productos_supervisor_insert ON public.productos
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

CREATE POLICY productos_supervisor_update ON public.productos
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');

CREATE POLICY productos_supervisor_delete ON public.productos
  FOR DELETE
  USING (public.get_rol_actual() = 'supervisor');


-- ============================================================
-- TABLA: transportistas
-- ============================================================

-- Todos leen transportistas activos
CREATE POLICY transportistas_todos_leen ON public.transportistas
  FOR SELECT
  USING (activo = true);

-- Supervisores también ven los inactivos
CREATE POLICY transportistas_supervisor_todos ON public.transportistas
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

CREATE POLICY transportistas_supervisor_write ON public.transportistas
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

CREATE POLICY transportistas_supervisor_update ON public.transportistas
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');


-- ============================================================
-- TABLA: clientes
-- ============================================================

-- Vendedor solo ve SUS clientes
CREATE POLICY clientes_vendedor_select ON public.clientes
  FOR SELECT
  USING (vendedor_id = auth.uid() AND activo = true);

-- Supervisor ve todos
CREATE POLICY clientes_supervisor_select ON public.clientes
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Vendedor crea clientes (se auto-asigna)
CREATE POLICY clientes_vendedor_insert ON public.clientes
  FOR INSERT
  WITH CHECK (
    vendedor_id = auth.uid()
    AND public.get_rol_actual() = 'vendedor'
  );

-- Supervisor puede insertar (ej: migración de datos)
CREATE POLICY clientes_supervisor_insert ON public.clientes
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Vendedor puede editar datos de SU cliente, pero NO cambiar vendedor_id
CREATE POLICY clientes_vendedor_update ON public.clientes
  FOR UPDATE
  USING (
    vendedor_id = auth.uid()
    AND public.get_rol_actual() = 'vendedor'
  )
  WITH CHECK (
    vendedor_id = auth.uid()  -- No puede cambiar la asignación
  );

-- Supervisor puede editar cualquier cliente
CREATE POLICY clientes_supervisor_update ON public.clientes
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');

-- Nadie elimina clientes (se desactivan)
-- DELETE: DENY por default


-- ============================================================
-- TABLA: cotizaciones
-- ============================================================

-- Vendedor ve solo SUS cotizaciones
CREATE POLICY cotizaciones_vendedor_select ON public.cotizaciones
  FOR SELECT
  USING (vendedor_id = auth.uid());

-- Supervisor ve todas
CREATE POLICY cotizaciones_supervisor_select ON public.cotizaciones
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Vendedor crea cotizaciones (solo para sus clientes)
CREATE POLICY cotizaciones_vendedor_insert ON public.cotizaciones
  FOR INSERT
  WITH CHECK (
    vendedor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.clientes
      WHERE id = cliente_id AND vendedor_id = auth.uid()
    )
  );

-- Supervisor puede crear cotizaciones
CREATE POLICY cotizaciones_supervisor_insert ON public.cotizaciones
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Vendedor edita SOLO borradores propios
CREATE POLICY cotizaciones_vendedor_update ON public.cotizaciones
  FOR UPDATE
  USING (
    vendedor_id = auth.uid()
    AND estado = 'borrador'
  )
  WITH CHECK (
    vendedor_id = auth.uid()
    AND estado IN ('borrador', 'enviada', 'anulada')
    -- solo puede avanzar a: enviada, o anular su borrador
  );

-- Supervisor puede actualizar cualquier cotización
CREATE POLICY cotizaciones_supervisor_update ON public.cotizaciones
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');

-- Nadie elimina cotizaciones
-- DELETE: DENY por default


-- ============================================================
-- TABLA: cotizacion_items
-- ============================================================

-- Un usuario puede ver los items de sus propias cotizaciones
CREATE POLICY items_vendedor_select ON public.cotizacion_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id AND c.vendedor_id = auth.uid()
    )
  );

CREATE POLICY items_supervisor_select ON public.cotizacion_items
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- Vendedor inserta items en sus borradores
CREATE POLICY items_vendedor_insert ON public.cotizacion_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = auth.uid()
        AND c.estado = 'borrador'
    )
  );

CREATE POLICY items_supervisor_insert ON public.cotizacion_items
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'supervisor');

-- Vendedor actualiza items de sus borradores
CREATE POLICY items_vendedor_update ON public.cotizacion_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = auth.uid()
        AND c.estado = 'borrador'
    )
  );

-- Vendedor elimina items de sus borradores
CREATE POLICY items_vendedor_delete ON public.cotizacion_items
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.cotizaciones c
      WHERE c.id = cotizacion_id
        AND c.vendedor_id = auth.uid()
        AND c.estado = 'borrador'
    )
  );

CREATE POLICY items_supervisor_update ON public.cotizacion_items
  FOR UPDATE USING (public.get_rol_actual() = 'supervisor');

CREATE POLICY items_supervisor_delete ON public.cotizacion_items
  FOR DELETE USING (public.get_rol_actual() = 'supervisor');


-- ============================================================
-- TABLA: auditoria (APPEND-ONLY)
-- ============================================================

-- Solo supervisores leen
CREATE POLICY auditoria_supervisor_select ON public.auditoria
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- TODOS los usuarios autenticados pueden insertar su propio registro
CREATE POLICY auditoria_insert ON public.auditoria
  FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

-- NOTA: No hay política UPDATE ni DELETE → ambas bloqueadas por RLS


-- ============================================================
-- TABLA: reasignaciones_clientes (APPEND-ONLY)
-- ============================================================

-- Supervisores leen todo
CREATE POLICY reasig_supervisor_select ON public.reasignaciones_clientes
  FOR SELECT
  USING (public.get_rol_actual() = 'supervisor');

-- INSERT solo vía RPC reasignar_cliente() (SECURITY DEFINER)
-- No política de INSERT directa → bloqueada por RLS


-- ============================================================
-- TABLA: configuracion_negocio
-- ============================================================

-- Todos los autenticados pueden leer la config
CREATE POLICY config_todos_leen ON public.configuracion_negocio
  FOR SELECT
  USING (true);

-- Solo supervisores actualizan
CREATE POLICY config_supervisor_update ON public.configuracion_negocio
  FOR UPDATE
  USING (public.get_rol_actual() = 'supervisor');
```

---

### MIGRATION 014 — Funciones RPC

```sql
-- 014_funciones_rpc.sql
-- IMPORTANTE: Todas las funciones SECURITY DEFINER deben tener SET search_path
-- para prevenir ataques de search_path injection.


-- ============================================================
-- RPC 1: registrar_auditoria
-- Usada internamente por otras RPCs para insertar en auditoria
-- sin necesidad de que el usuario_id = auth.uid() (las RPCs corren como postgres)
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_auditoria(
  p_usuario_id    UUID,
  p_usuario_nombre TEXT,
  p_usuario_rol   TEXT,
  p_categoria     categoria_auditoria,
  p_accion        TEXT,
  p_descripcion   TEXT DEFAULT NULL,
  p_entidad_tipo  TEXT DEFAULT NULL,
  p_entidad_id    UUID DEFAULT NULL,
  p_meta          JSONB DEFAULT '{}'::jsonb
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.auditoria (
    usuario_id, usuario_nombre, usuario_rol,
    categoria, accion, descripcion,
    entidad_tipo, entidad_id, meta
  ) VALUES (
    p_usuario_id, p_usuario_nombre, p_usuario_rol,
    p_categoria, p_accion, p_descripcion,
    p_entidad_tipo, p_entidad_id, p_meta
  );
END;
$$;


-- ============================================================
-- RPC 2: reasignar_cliente
-- ============================================================
CREATE OR REPLACE FUNCTION public.reasignar_cliente(
  p_cliente_id      UUID,
  p_nuevo_vendedor  UUID,
  p_motivo          TEXT
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_supervisor_id   UUID := auth.uid();
  v_supervisor_nombre TEXT;
  v_vendedor_origen UUID;
  v_cliente_nombre  TEXT;
BEGIN
  -- 1. Verificar que el caller es supervisor activo
  SELECT nombre INTO v_supervisor_nombre
  FROM public.usuarios
  WHERE id = v_supervisor_id AND rol = 'supervisor' AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO: Solo un supervisor activo puede reasignar clientes';
  END IF;

  -- 2. Motivo obligatorio y mínimo
  IF p_motivo IS NULL OR char_length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'MOTIVO_INVALIDO: El motivo debe tener al menos 10 caracteres';
  END IF;

  -- 3. Verificar que el cliente existe y está activo
  SELECT vendedor_id, nombre INTO v_vendedor_origen, v_cliente_nombre
  FROM public.clientes
  WHERE id = p_cliente_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_NO_ENCONTRADO: El cliente no existe o está inactivo';
  END IF;

  -- 4. Verificar que el destino es un vendedor activo (o supervisor)
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = p_nuevo_vendedor AND activo = true
  ) THEN
    RAISE EXCEPTION 'VENDEDOR_INVALIDO: El vendedor destino no existe o está inactivo';
  END IF;

  -- 5. No reasignar al mismo vendedor
  IF v_vendedor_origen = p_nuevo_vendedor THEN
    RAISE EXCEPTION 'SIN_CAMBIO: El cliente ya pertenece a ese vendedor';
  END IF;

  -- 6. Actualizar el cliente
  UPDATE public.clientes
  SET
    vendedor_id          = p_nuevo_vendedor,
    ultima_reasig_por    = v_supervisor_id,
    ultima_reasig_motivo = p_motivo,
    ultima_reasig_en     = now(),
    actualizado_en       = now()
  WHERE id = p_cliente_id;

  -- 7. Insertar en historial de reasignaciones
  INSERT INTO public.reasignaciones_clientes
    (cliente_id, vendedor_origen, vendedor_destino, supervisor_id, motivo)
  VALUES
    (p_cliente_id, v_vendedor_origen, p_nuevo_vendedor, v_supervisor_id, p_motivo);

  -- 8. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id    := v_supervisor_id,
    p_usuario_nombre := v_supervisor_nombre,
    p_usuario_rol   := 'supervisor',
    p_categoria     := 'REASIGNACION',
    p_accion        := 'REASIGNAR_CLIENTE',
    p_descripcion   := 'Cliente "' || v_cliente_nombre || '" reasignado. Motivo: ' || p_motivo,
    p_entidad_tipo  := 'cliente',
    p_entidad_id    := p_cliente_id,
    p_meta          := jsonb_build_object(
      'vendedor_origen', v_vendedor_origen,
      'vendedor_destino', p_nuevo_vendedor,
      'motivo', p_motivo
    )
  );
END;
$$;


-- ============================================================
-- RPC 3: enviar_cotizacion
-- Cierra una cotización: estado borrador → enviada
-- ============================================================
CREATE OR REPLACE FUNCTION public.enviar_cotizacion(
  p_cotizacion_id  UUID,
  p_tasa_bcv       NUMERIC  -- Tasa BCV del momento del envío
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id    UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol   TEXT;
  v_cotizacion    RECORD;
BEGIN
  -- 1. Obtener datos del usuario
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USUARIO_INVALIDO';
  END IF;

  -- 2. Obtener y validar la cotización
  SELECT * INTO v_cotizacion
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA';
  END IF;

  -- 3. Solo el vendedor dueño o un supervisor puede enviar
  IF v_cotizacion.vendedor_id <> v_usuario_id
     AND v_usuario_rol <> 'supervisor' THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO';
  END IF;

  -- 4. Solo se puede enviar desde borrador
  IF v_cotizacion.estado <> 'borrador' THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: La cotización debe estar en borrador para enviar';
  END IF;

  -- 5. Validar que tiene al menos un ítem
  IF NOT EXISTS (
    SELECT 1 FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id
  ) THEN
    RAISE EXCEPTION 'SIN_ITEMS: No se puede enviar una cotización sin productos';
  END IF;

  -- 6. Actualizar la cotización
  UPDATE public.cotizaciones
  SET
    estado             = 'enviada',
    enviada_en         = now(),
    tasa_bcv_snapshot  = p_tasa_bcv,
    total_bs_snapshot  = total_usd * p_tasa_bcv,
    actualizado_en     = now()
  WHERE id = p_cotizacion_id;

  -- 7. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := v_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'ENVIAR_COTIZACION',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := p_cotizacion_id,
    p_meta           := jsonb_build_object('tasa_bcv', p_tasa_bcv)
  );
END;
$$;


-- ============================================================
-- RPC 4: crear_version_cotizacion
-- Crea una nueva versión de una cotización enviada
-- ============================================================
CREATE OR REPLACE FUNCTION public.crear_version_cotizacion(
  p_cotizacion_id  UUID,
  p_notas_cambio   TEXT DEFAULT NULL
)
RETURNS UUID  -- Retorna el ID de la nueva versión
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario_id     UUID := auth.uid();
  v_usuario_nombre TEXT;
  v_usuario_rol    TEXT;
  v_original       RECORD;
  v_raiz_id        UUID;
  v_nueva_version  INTEGER;
  v_nueva_cot_id   UUID;
BEGIN
  -- 1. Validar usuario
  SELECT nombre, rol INTO v_usuario_nombre, v_usuario_rol
  FROM public.usuarios WHERE id = v_usuario_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'USUARIO_INVALIDO'; END IF;

  -- 2. Obtener cotización original
  SELECT * INTO v_original
  FROM public.cotizaciones WHERE id = p_cotizacion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'COTIZACION_NO_ENCONTRADA'; END IF;

  -- 3. Solo se puede versionar desde 'enviada' o 'rechazada'
  IF v_original.estado NOT IN ('enviada', 'rechazada') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: Solo se versionan cotizaciones enviadas o rechazadas';
  END IF;

  -- 4. Solo el dueño o supervisor
  IF v_original.vendedor_id <> v_usuario_id AND v_usuario_rol <> 'supervisor' THEN
    RAISE EXCEPTION 'ACCESO_DENEGADO';
  END IF;

  -- 5. Determinar la raíz y la nueva versión
  v_raiz_id := COALESCE(v_original.cotizacion_raiz_id, v_original.id);

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_nueva_version
  FROM public.cotizaciones
  WHERE cotizacion_raiz_id = v_raiz_id OR id = v_raiz_id;

  -- 6. Crear nueva cotización (copia del header)
  INSERT INTO public.cotizaciones (
    numero, version, cotizacion_raiz_id,
    cliente_id, vendedor_id, transportista_id,
    estado, valida_hasta,
    notas_cliente, notas_internas
  )
  VALUES (
    -- numero usa GENERATED ALWAYS AS IDENTITY — necesitamos override
    -- Las versiones usan el número del original
    DEFAULT,            -- nuevo numero propio (para INDEX)
    v_nueva_version,
    v_raiz_id,
    v_original.cliente_id,
    v_original.vendedor_id,
    v_original.transportista_id,
    'borrador',
    v_original.valida_hasta,
    v_original.notas_cliente,
    COALESCE(p_notas_cambio, v_original.notas_internas)
  )
  RETURNING id INTO v_nueva_cot_id;

  -- 7. Copiar los ítems de la cotización original
  INSERT INTO public.cotizacion_items (
    cotizacion_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  )
  SELECT
    v_nueva_cot_id, producto_id, codigo_snap, nombre_snap,
    unidad_snap, cantidad, precio_unit_usd, descuento_pct,
    total_linea_usd, orden
  FROM public.cotizacion_items
  WHERE cotizacion_id = p_cotizacion_id;

  -- 8. Recalcular totales en la nueva cotización (heredados del original)
  UPDATE public.cotizaciones
  SET
    subtotal_usd         = v_original.subtotal_usd,
    descuento_global_pct = v_original.descuento_global_pct,
    descuento_usd        = v_original.descuento_usd,
    costo_envio_usd      = v_original.costo_envio_usd,
    total_usd            = v_original.total_usd
  WHERE id = v_nueva_cot_id;

  -- 9. Auditoría
  PERFORM public.registrar_auditoria(
    p_usuario_id     := v_usuario_id,
    p_usuario_nombre := v_usuario_nombre,
    p_usuario_rol    := v_usuario_rol,
    p_categoria      := 'COTIZACION',
    p_accion         := 'CREAR_VERSION',
    p_entidad_tipo   := 'cotizacion',
    p_entidad_id     := v_nueva_cot_id,
    p_meta           := jsonb_build_object(
      'cotizacion_origen', p_cotizacion_id,
      'nueva_version', v_nueva_version
    )
  );

  RETURN v_nueva_cot_id;
END;
$$;
```

---

### MIGRATION 015 — Seed de configuración inicial

```sql
-- 015_seed_configuracion.sql
INSERT INTO public.configuracion_negocio (
  id, nombre_negocio, moneda_principal, validez_cotizacion_dias, pie_pagina_pdf
) VALUES (
  1, 'Mi Ferretería', 'USD', 15, 'Gracias por su preferencia. Precios sujetos a cambio sin previo aviso.'
)
ON CONFLICT (id) DO NOTHING;
```

---

## 4. VISIBILIDAD DE CLIENTES — REGLA DEFINITIVA

**Un vendedor NO puede ver ningún dato de clientes ajenos.**
Ni el nombre, ni el teléfono, ni que existen.

La única excepción controlada:

> Si un vendedor intenta registrar un cliente con un RIF que ya existe en el sistema,
> el mensaje de error será:
>
> *"Este RIF ya está registrado en el sistema. Si crees que hay un error, contacta a tu supervisor."*
>
> No se revela a quién pertenece, ni el nombre del cliente.

Esto se implementa capturando el error de violación de UNIQUE INDEX en el frontend y mostrando el mensaje genérico.

---

## 5. CAMPOS OBLIGATORIOS PARA COTIZAR

### Para REGISTRAR un cliente (mínimo para existir en el sistema):
| Campo | Tipo | Obligatorio |
|---|---|---|
| `nombre` | TEXT | ✅ Siempre |
| `telefono` | TEXT | ✅ Al menos uno (teléfono o email) |
| `email` | TEXT | ✅ Al menos uno (teléfono o email) |
| `rif_cedula` | TEXT | ❌ Opcional al registrar |
| `direccion` | TEXT | ❌ Opcional |

### Para EMITIR (enviar) una cotización — validación en `enviar_cotizacion()`:
| Requisito | Dónde se valida |
|---|---|
| El cliente debe existir y estar activo | RPC `enviar_cotizacion` |
| Al menos 1 ítem en la cotización | RPC `enviar_cotizacion` |
| El `total_usd` debe ser > 0 | CHECK constraint + lógica frontend |
| La tasa BCV debe ser proporcionada | Parámetro de la RPC |
| El cliente debe tener nombre Y (teléfono O email) | Trigger `BEFORE INSERT` en `cotizaciones` |

### Trigger adicional en `cotizaciones`:
```sql
-- Validar que el cliente tiene datos suficientes al crear la cotización
CREATE OR REPLACE FUNCTION public.validar_cliente_para_cotizar()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_cliente RECORD;
BEGIN
  SELECT nombre, telefono, email
  INTO v_cliente
  FROM public.clientes WHERE id = NEW.cliente_id AND activo = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENTE_INVALIDO: El cliente no existe o está inactivo';
  END IF;

  IF v_cliente.nombre IS NULL OR trim(v_cliente.nombre) = '' THEN
    RAISE EXCEPTION 'CLIENTE_SIN_NOMBRE: El cliente debe tener nombre para cotizar';
  END IF;

  IF (v_cliente.telefono IS NULL OR trim(v_cliente.telefono) = '')
     AND (v_cliente.email IS NULL OR trim(v_cliente.email) = '') THEN
    RAISE EXCEPTION 'CLIENTE_SIN_CONTACTO: El cliente debe tener teléfono o email para cotizar';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cotizacion_validar_cliente
  BEFORE INSERT ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.validar_cliente_para_cotizar();
```

---

## 6. MODELO DE VERSIONADO DE COTIZACIONES

### Regla definitiva

Una cotización `enviada` **nunca se modifica**. Para cambiarla se crea una nueva versión via `crear_version_cotizacion()`.

### Estructura de números

```
COT-00001        → numero=1, version=1, cotizacion_raiz_id=NULL
COT-00001 Rev.2  → numero=2, version=2, cotizacion_raiz_id=UUID_de_COT-00001
COT-00001 Rev.3  → numero=3, version=3, cotizacion_raiz_id=UUID_de_COT-00001
COT-00002        → numero=4, version=1, cotizacion_raiz_id=NULL  (cotización nueva, independiente)
```

**Display en la UI:**
```javascript
function formatearNumeroCotizacion(cotizacion) {
  const base = `COT-${String(cotizacion.numero).padStart(5, '0')}`;
  if (cotizacion.version > 1) return `${base} Rev.${cotizacion.version}`;
  return base;
}
```

**Listar versiones de una cotización:**
```sql
SELECT * FROM cotizaciones
WHERE id = :raiz_id OR cotizacion_raiz_id = :raiz_id
ORDER BY version ASC;
```

### Lo que se copia al crear una versión nueva:
- ✅ Todos los ítems (snapshot completo)
- ✅ Transportista
- ✅ Totales calculados
- ✅ Notas del cliente
- ✅ Fecha de validez
- ❌ Estado (la nueva versión siempre empieza como `borrador`)
- ❌ Fechas de envío/exportación

---

## 7. MÁQUINA DE ESTADOS DE COTIZACIONES

```
                    ┌──────────┐
              ┌────▶│ anulada  │◀────────────────────────┐
              │     └──────────┘                         │
              │                                          │
         [vendedor/sup]                            [solo supervisor]
              │                                          │
        ┌─────┴────┐    [vendedor/sup]    ┌──────────┐   │
  NEW→  │ borrador │──────────────────▶  │ enviada  │───┤
        └──────────┘                     └────┬─────┘   │
              │                               │          │
              │ [vendedor/sup]        ┌────────┴──────┐  │
              │                      │               │  │
              ▼                      ▼               ▼  │
         [borrador]            ┌──────────┐   ┌──────────┤
         puede hacer           │ aceptada │   │rechazada │
         nueva versión         └──────────┘   └──────────┘
         ← igual para                │               │
         enviada/rechazada           └───────────────┘
                                     pueden crear nueva versión
```

**Reglas de transición (enforced por trigger `trg_cotizaciones_estado`):**
| De | A | Quién |
|---|---|---|
| borrador | enviada | Vendedor dueño, Supervisor |
| borrador | anulada | Vendedor dueño, Supervisor |
| enviada | aceptada | Vendedor dueño, Supervisor |
| enviada | rechazada | Vendedor dueño, Supervisor |
| enviada | vencida | Automático (trigger o cron) |
| enviada | anulada | Solo Supervisor |
| aceptada | anulada | Solo Supervisor |
| vencida | anulada | Solo Supervisor |

---

## 8. STACK TÉCNICO DEFINITIVO

| Capa | Tecnología | Versión |
|---|---|---|
| Frontend | React | 19.x |
| Build | Vite | 7.x |
| Estilos | Tailwind CSS | 3.x |
| Estado global | Zustand | 5.x |
| Estado servidor | TanStack Query (React Query) | 5.x |
| Auth + DB | Supabase JS SDK | 2.x |
| PDF | jsPDF + html2canvas | últimas |
| Deploy | Vercel | — |

### Dependencias a agregar en `package.json`:
```json
"@tanstack/react-query": "^5.0.0"
```

### Dependencias a ELIMINAR:
```
@capacitor/android
@capacitor/core
@capacitor/filesystem
@capacitor/preferences
groq-sdk
vite-plugin-pwa
workbox-*
```

---

## 9. DISEÑO DEL PDF (sin cambios desde v1.0)

Los datos que el PDF necesita de `configuracion_negocio`:
- `nombre_negocio`, `rif_negocio`, `telefono_negocio`, `direccion_negocio`, `logo_url`, `pie_pagina_pdf`

Los datos que el PDF toma de la cotización:
- `numero`, `version`, `creado_en`, `valida_hasta`, `tasa_bcv_snapshot`
- `cliente.*` (nombre, rif_cedula, telefono, direccion)
- `cotizacion_items.*_snap` (snapshot del momento)
- `transportista.nombre` (si aplica)
- Totales: `subtotal_usd`, `descuento_usd`, `costo_envio_usd`, `total_usd`, `total_bs_snapshot`
- `notas_cliente` (NO `notas_internas`)

---

## 10. MVP POR FASES (sin cambios desde v1.0)

| Fase | Descripción | Estado |
|---|---|---|
| **Fase 0** | Arquitectura, BD y reglas de negocio | ✅ v1.1 completada |
| **Fase 1** | Limpieza + Auth + Navegación base | ⏳ Pendiente |
| **Fase 2** | Módulo de Clientes (con anti-robo) | ⏳ Pendiente |
| **Fase 3** | Inventario consultable | ⏳ Pendiente |
| **Fase 4** | Constructor de cotizaciones (wizard) | ⏳ Pendiente |
| **Fase 5** | Generador de PDF + WhatsApp | ⏳ Pendiente |
| **Fase 6** | Transportistas + Historial + Versioning | ⏳ Pendiente |
| **Fase 7** | Panel supervisor + Auditoría + Usuarios | ⏳ Pendiente |

---

*Documento revisado y corregido. Listo para ejecutar Fase 1.*
