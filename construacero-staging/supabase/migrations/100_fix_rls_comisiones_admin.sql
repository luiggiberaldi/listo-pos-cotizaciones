-- 100_fix_rls_comisiones_admin.sql
-- Amplía la política SELECT de comisiones para incluir
-- administracion, desarrollador y jefe (no solo supervisor)

DROP POLICY IF EXISTS "comisiones_select" ON public.comisiones;

CREATE POLICY "comisiones_select" ON public.comisiones
  FOR SELECT USING (
    vendedor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid()
        AND rol IN ('supervisor', 'administracion', 'desarrollador', 'jefe')
        AND activo = true
    )
  );
