-- 084_reasignacion_motivo_opcional.sql

-- Eliminar la restricción NOT NULL de la columna motivo
ALTER TABLE public.reasignaciones_clientes ALTER COLUMN motivo DROP NOT NULL;

-- Eliminar el constraint CHECK de longitud mínima del motivo
-- El nombre por defecto si no se especificó es reasignaciones_clientes_motivo_check
-- Usamos DO para capturar dinámicamente el constraint en caso de que tenga otro nombre generado
DO $$
DECLARE 
    constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.reasignaciones_clientes'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%char_length(btrim(motivo))%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.reasignaciones_clientes DROP CONSTRAINT ' || constraint_name;
    ELSE
        -- Fallback a borrar el nombre por defecto común
        BEGIN
            ALTER TABLE public.reasignaciones_clientes DROP CONSTRAINT reasignaciones_clientes_motivo_check;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;
    END IF;
END $$;
