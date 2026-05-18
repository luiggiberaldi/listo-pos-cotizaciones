-- 143_clientes_codigo_unico.sql
-- Agregar columna codigo_cliente a public.clientes, autogenerada mediante Trigger y retroactivamente asignada.

-- 1. Agregar columna como nullable provisionalmente
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS codigo_cliente TEXT;

-- 2. Crear función de autogeneración única de 6 dígitos
CREATE OR REPLACE FUNCTION public.generar_codigo_cliente_unico()
RETURNS TEXT AS $$
DECLARE
  v_codigo TEXT;
  v_existe BOOLEAN;
BEGIN
  LOOP
    -- Genera un número aleatorio de 6 dígitos entre 100000 y 999999
    v_codigo := floor(random() * 900000 + 100000)::text;
    
    SELECT EXISTS(
      SELECT 1 FROM public.clientes WHERE codigo_cliente = v_codigo
    ) INTO v_existe;
    
    IF NOT v_existe THEN
      RETURN v_codigo;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 3. Migrar clientes existentes de manera segura
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.clientes WHERE codigo_cliente IS NULL LOOP
    UPDATE public.clientes 
    SET codigo_cliente = public.generar_codigo_cliente_unico() 
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- 4. Establecer NOT NULL y UNIQUE una vez poblada la data
ALTER TABLE public.clientes ALTER COLUMN codigo_cliente SET NOT NULL;

IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_clientes_codigo_cliente') THEN
  ALTER TABLE public.clientes ADD CONSTRAINT uq_clientes_codigo_cliente UNIQUE (codigo_cliente);
END IF;

-- 5. Crear trigger para automatizar el insert de nuevos clientes
CREATE OR REPLACE FUNCTION public.trg_clientes_generar_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo_cliente IS NULL OR NEW.codigo_cliente = '' THEN
    NEW.codigo_cliente := public.generar_codigo_cliente_unico();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clientes_auto_codigo ON public.clientes;
CREATE TRIGGER trg_clientes_auto_codigo
  BEFORE INSERT ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_clientes_generar_codigo();
