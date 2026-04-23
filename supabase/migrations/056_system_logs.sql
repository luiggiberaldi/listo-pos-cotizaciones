-- ============================================================
-- 056_system_logs.sql
-- Sistema de logging persistente para auditoría y análisis AI
-- ============================================================

-- Tipos ENUM para logs
DO $$ BEGIN
  CREATE TYPE log_nivel AS ENUM ('error', 'warn', 'info');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE log_origen AS ENUM ('frontend', 'worker', 'supabase');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tabla principal de logs del sistema
CREATE TABLE IF NOT EXISTS system_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  nivel      log_nivel NOT NULL DEFAULT 'error',
  origen     log_origen NOT NULL,
  categoria  TEXT,
  mensaje    TEXT NOT NULL,
  stack      TEXT,
  endpoint   TEXT,
  usuario_id UUID,
  usuario_nombre TEXT,
  meta       JSONB DEFAULT '{}',
  resuelto   BOOLEAN DEFAULT false
);

-- Índices para consultas eficientes
CREATE INDEX IF NOT EXISTS idx_logs_ts     ON system_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_nivel  ON system_logs (nivel);
CREATE INDEX IF NOT EXISTS idx_logs_origen ON system_logs (origen);
CREATE INDEX IF NOT EXISTS idx_logs_cat    ON system_logs (categoria);

-- RLS
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- Solo supervisores pueden leer
DO $$ BEGIN
  CREATE POLICY logs_supervisor_select ON system_logs
    FOR SELECT USING (public.get_rol_actual() = 'supervisor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Nadie puede borrar (append-only, solo purga via función)
DO $$ BEGIN
  CREATE POLICY logs_no_delete ON system_logs
    FOR DELETE USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Función de purga de logs antiguos (>90 días)
CREATE OR REPLACE FUNCTION purgar_logs_antiguos()
RETURNS integer AS $$
DECLARE
  filas integer;
BEGIN
  DELETE FROM system_logs WHERE ts < now() - interval '90 days';
  GET DIAGNOSTICS filas = ROW_COUNT;
  RETURN filas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tabla para guardar resultados de análisis AI (cache)
CREATE TABLE IF NOT EXISTS system_log_analysis (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo       TEXT NOT NULL,  -- 'errores', 'mejoras', 'seguridad'
  resultado  TEXT NOT NULL,
  logs_count INTEGER DEFAULT 0,
  modelo     TEXT DEFAULT 'llama-3.3-70b-versatile'
);

ALTER TABLE system_log_analysis ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY analysis_supervisor_select ON system_log_analysis
    FOR SELECT USING (public.get_rol_actual() = 'supervisor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY analysis_no_delete ON system_log_analysis
    FOR DELETE USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
