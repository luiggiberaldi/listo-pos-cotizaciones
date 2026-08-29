-- 047_fix_cotizaciones_anulacion.sql
-- Fix: permitir a los vendedores anular cotizaciones enviadas (no se permiten aceptadas ni con despacho)

DROP POLICY IF EXISTS cotizaciones_vendedor_update ON public.cotizaciones;
CREATE POLICY cotizaciones_vendedor_update ON public.cotizaciones
  FOR UPDATE
  USING (
    vendedor_id = public.get_operador_id()
    AND estado IN ('borrador', 'enviada')
  )
  WITH CHECK (
    vendedor_id = public.get_operador_id()
    AND estado IN ('borrador', 'enviada', 'anulada')
  );
