-- 299_buzon_politicas_por_operador.sql
-- Buzón de sugerencias: el desarrollador no podía ver, marcar ni borrar los mensajes.
--
-- Causa: las reglas de la migración 195 miraban un dato del token de la cuenta compartida
-- (app_metadata.operator_rol), pero desde la migración 241 el rol real del operador sale de su
-- sesión (get_rol_actual()) y la cuenta compartida ya no lleva ese dato. Resultado: el Buzón del
-- desarrollador aparecía vacío aunque había mensajes guardados.
--
-- Efecto secundario que también se corrige: cuando la cuenta SÍ llevaba ese dato (staging), cualquier
-- operador podía cambiar el estado de su mensaje.
--
-- Solo cambia las 3 reglas de lectura/edición/borrado. Las de envío y aislamiento por cuenta no se tocan.

DROP POLICY IF EXISTS buzon_select ON public.buzon_sugerencias;
CREATE POLICY buzon_select ON public.buzon_sugerencias
  FOR SELECT TO authenticated
  USING (
    usuario_id = public.get_operador_id()
    OR public.get_rol_actual() = 'desarrollador'
  );

DROP POLICY IF EXISTS buzon_update ON public.buzon_sugerencias;
CREATE POLICY buzon_update ON public.buzon_sugerencias
  FOR UPDATE TO authenticated
  USING (public.get_rol_actual() = 'desarrollador')
  WITH CHECK (public.get_rol_actual() = 'desarrollador');

DROP POLICY IF EXISTS buzon_delete ON public.buzon_sugerencias;
CREATE POLICY buzon_delete ON public.buzon_sugerencias
  FOR DELETE TO authenticated
  USING (public.get_rol_actual() = 'desarrollador');
