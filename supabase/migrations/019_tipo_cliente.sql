-- 019: Campo tipo de cliente
-- Valores: ferreteria, constructor, particular, empresa

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS tipo_cliente TEXT DEFAULT 'particular';
