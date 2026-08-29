-- 105_tenant_isolation_unique_indexes.sql
-- Drop global UNIQUE indexes and replace them with tenant-scoped UNIQUE indexes
-- This ensures that multiple tenants can have clients with the same RIF or products with the same Code.

-- 1. Clientes RIF
DROP INDEX IF EXISTS idx_clientes_rif_unico;

CREATE UNIQUE INDEX idx_clientes_rif_cuenta_unico
  ON public.clientes(cuenta_id, rif_cedula)
  WHERE rif_cedula IS NOT NULL AND trim(rif_cedula) <> '';

-- 2. Productos Codigo
DROP INDEX IF EXISTS idx_productos_codigo_unico;

CREATE UNIQUE INDEX idx_productos_codigo_cuenta_unico
  ON public.productos(cuenta_id, codigo)
  WHERE codigo IS NOT NULL AND trim(codigo) <> '';
