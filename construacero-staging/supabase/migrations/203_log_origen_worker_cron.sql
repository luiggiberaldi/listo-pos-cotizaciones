-- 203_log_origen_worker_cron.sql
-- Fix: "invalid input value for enum log_origen: 'worker-cron'" (error 22P02
-- en logs de Postgres cada día a las 03:00 UTC, hora del cron del Worker).
--
-- Causa: los crons del Worker (limpieza de cotizaciones y purga de imágenes
-- de seguimiento) registran logs con origen 'worker-cron', pero el enum
-- log_origen (migración 056) solo acepta 'frontend' | 'worker' | 'supabase'.
-- El Worker DESPLEGADO aún inserta en system_logs (el código actual del repo
-- ya no lo hace — commit f16adbf), así que cada corrida del cron falla al
-- escribir su log.
--
-- Solución definitiva: desplegar el Worker actualizado (wrangler deploy).
-- Esta migración es el cinturón de seguridad: acepta el valor para que
-- ninguna versión (vieja o futura) falle al registrar logs de cron.
--
-- NOTA: ALTER TYPE ... ADD VALUE no puede ejecutarse dentro de una
-- transacción — correr esta sentencia sola en el SQL Editor.

ALTER TYPE log_origen ADD VALUE IF NOT EXISTS 'worker-cron';
