-- Rollback de 328_staging_devolucion_origen_y_precios.sql: re-aplicar 321_staging_devolucion_valida_totales.sql.
-- No se elimina la función para no romper devoluciones parciales en curso.
SELECT 1;
