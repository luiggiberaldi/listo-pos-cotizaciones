-- supabase/migrations/166_fix_prestamos_rls.sql
-- Asegurar aislamiento multitenant (tenant isolation) en cliente_prestamos.

-- 1. Eliminar la política permisiva vieja
DROP POLICY IF EXISTS "Permitir todo a operadores autorizados en cliente_prestamos" ON public.cliente_prestamos;

-- 2. Recrear la política permisiva básica para operadores autenticados
CREATE POLICY "Permitir todo a operadores autorizados en cliente_prestamos"
ON public.cliente_prestamos
FOR ALL
TO authenticated
USING (TRUE)
WITH CHECK (TRUE);

-- 3. Crear una política restrictiva que asegure que el cliente pertenece al tenant del operador
DROP POLICY IF EXISTS isolation_cliente_prestamos ON public.cliente_prestamos;
CREATE POLICY isolation_cliente_prestamos
ON public.cliente_prestamos
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = cliente_id
      AND c.cuenta_id = auth.uid()
  )
);
