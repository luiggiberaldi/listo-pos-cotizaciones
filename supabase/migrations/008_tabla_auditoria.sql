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
