-- 066: RLS para logística en cotizacion_items y cotizaciones
-- Logística necesita ver los artículos de las cotizaciones vinculadas a despachos
-- Sin esta política, los despachos se muestran sin artículos para el rol logística

-- Permitir a logística leer items de cotizaciones que tengan despacho
CREATE POLICY items_logistica_select ON public.cotizacion_items
  FOR SELECT
  USING (
    public.get_rol_actual() = 'logistica'
    AND EXISTS (
      SELECT 1 FROM public.notas_despacho nd
      WHERE nd.cotizacion_id = cotizacion_items.cotizacion_id
    )
  );

-- Permitir a logística leer cotizaciones que tengan despacho (necesario para joins)
CREATE POLICY cotizaciones_logistica_select ON public.cotizaciones
  FOR SELECT
  USING (
    public.get_rol_actual() = 'logistica'
    AND EXISTS (
      SELECT 1 FROM public.notas_despacho nd
      WHERE nd.cotizacion_id = cotizaciones.id
    )
  );

-- Permitir a logística leer clientes (necesario para mostrar nombre en despachos)
CREATE POLICY clientes_logistica_select ON public.clientes
  FOR SELECT
  USING (public.get_rol_actual() = 'logistica');
