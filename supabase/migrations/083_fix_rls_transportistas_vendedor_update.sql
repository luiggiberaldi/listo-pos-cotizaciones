-- ═══════════════════════════════════════════════════════════════════════════
-- 083: Fix RLS - agregar WITH CHECK a policy de update para vendedores
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLEMA: La policy transportistas_vendedor_update solo tenía USING sin
--           WITH CHECK, lo que permitía al vendedor seleccionar filas pero
--           Supabase rechazaba silenciosamente la escritura.
--
-- APLICAR EN: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS transportistas_vendedor_update ON public.transportistas;

CREATE POLICY transportistas_vendedor_update ON public.transportistas
  FOR UPDATE
  USING (public.get_rol_actual() = 'vendedor')
  WITH CHECK (public.get_rol_actual() = 'vendedor');
