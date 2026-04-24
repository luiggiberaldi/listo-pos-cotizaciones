-- Agregar columnas estado y ciudad a clientes para dirección estructurada
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS estado  TEXT,
  ADD COLUMN IF NOT EXISTS ciudad  TEXT;

-- Migrar datos existentes: intentar parsear "dirección, ciudad, estado" del campo direccion
-- Solo si direccion tiene al menos 2 comas (indica formato estructurado)
UPDATE public.clientes
SET
  estado = trim(split_part(direccion, ',', array_length(string_to_array(direccion, ','), 1))),
  ciudad = trim(split_part(direccion, ',', array_length(string_to_array(direccion, ','), 1) - 1)),
  direccion = trim(
    left(direccion,
      length(direccion)
      - length(split_part(direccion, ',', array_length(string_to_array(direccion, ','), 1)))
      - length(split_part(direccion, ',', array_length(string_to_array(direccion, ','), 1) - 1))
      - 2  -- las 2 comas
    )
  )
WHERE direccion IS NOT NULL
  AND array_length(string_to_array(direccion, ','), 1) >= 3;
