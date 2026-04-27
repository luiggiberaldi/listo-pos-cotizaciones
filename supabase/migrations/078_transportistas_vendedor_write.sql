-- 078_transportistas_vendedor_write.sql
-- Permitir a vendedores crear y editar transportistas

-- INSERT para vendedores
CREATE POLICY transportistas_vendedor_insert ON public.transportistas
  FOR INSERT
  WITH CHECK (public.get_rol_actual() = 'vendedor');

-- UPDATE para vendedores
CREATE POLICY transportistas_vendedor_update ON public.transportistas
  FOR UPDATE
  USING (public.get_rol_actual() = 'vendedor');
