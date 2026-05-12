-- 064: RLS para logística en notas_despacho
-- Logística necesita ver despachos despachados para marcar entregada
-- Sin esta política, las queries directas a Supabase retornan vacío para logística

CREATE POLICY despachos_logistica_select ON public.notas_despacho
  FOR SELECT
  USING (public.get_rol_actual() = 'logistica');
