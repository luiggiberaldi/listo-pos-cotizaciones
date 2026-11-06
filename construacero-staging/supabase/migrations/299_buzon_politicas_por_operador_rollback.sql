-- 299_buzon_politicas_por_operador_rollback.sql
-- Devuelve las 3 reglas del Buzón a como estaban (migración 195).

DROP POLICY IF EXISTS buzon_select ON public.buzon_sugerencias;
CREATE POLICY buzon_select ON public.buzon_sugerencias
  FOR SELECT TO authenticated
  USING (
    usuario_id = public.get_operador_id() OR
    COALESCE(auth.jwt()->'app_metadata'->>'operator_rol', '') = 'desarrollador'
  );

DROP POLICY IF EXISTS buzon_update ON public.buzon_sugerencias;
CREATE POLICY buzon_update ON public.buzon_sugerencias
  FOR UPDATE TO authenticated
  USING (COALESCE(auth.jwt()->'app_metadata'->>'operator_rol', '') = 'desarrollador')
  WITH CHECK (COALESCE(auth.jwt()->'app_metadata'->>'operator_rol', '') = 'desarrollador');

DROP POLICY IF EXISTS buzon_delete ON public.buzon_sugerencias;
CREATE POLICY buzon_delete ON public.buzon_sugerencias
  FOR DELETE TO authenticated
  USING (COALESCE(auth.jwt()->'app_metadata'->>'operator_rol', '') = 'desarrollador');
