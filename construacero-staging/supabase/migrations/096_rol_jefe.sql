-- 096_rol_jefe.sql
-- Implementación del rol "jefe"
-- 1. Agrega el rol al constraint
-- 2. Concede acceso omnipotente (ALL) a todas las tablas principales
-- 3. Excluye a los jefes de generar comisiones en calcular_comision_despacho

-- 1. Actualizar constraint de rol
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check 
  CHECK (rol IN ('supervisor', 'vendedor', 'administracion', 'logistica', 'desarrollador', 'jefe'));

-- 2. Políticas de Seguridad (Omnipotentes para Jefe)
CREATE POLICY usuarios_jefe_all ON public.usuarios FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY productos_jefe_all ON public.productos FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY clientes_jefe_all ON public.clientes FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY cotizaciones_jefe_all ON public.cotizaciones FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY cotizacion_items_jefe_all ON public.cotizacion_items FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY transportistas_jefe_all ON public.transportistas FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY notas_despacho_jefe_all ON public.notas_despacho FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY comisiones_jefe_all ON public.comisiones FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY inventario_movimientos_jefe_all ON public.inventario_movimientos FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY cuentas_por_cobrar_jefe_all ON public.cuentas_por_cobrar FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY reasignaciones_jefe_all ON public.reasignaciones_clientes FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY configuracion_jefe_all ON public.configuracion_negocio FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');
CREATE POLICY auditoria_jefe_all ON public.auditoria FOR ALL USING (public.get_rol_actual() = 'jefe') WITH CHECK (public.get_rol_actual() = 'jefe');

-- 3. Actualizar calcular_comision_despacho para omitir ventas de jefes
CREATE OR REPLACE FUNCTION public.calcular_comision_despacho(
  p_despacho_id UUID
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_despacho       RECORD;
  v_config         RECORD;
  v_monto_cabilla  NUMERIC(12,2) := 0;
  v_monto_otros    NUMERIC(12,2) := 0;
  v_item           RECORD;
  v_cat_cabilla    TEXT;
  v_comision_id    UUID;
  v_rol_vendedor   TEXT;
BEGIN
  -- Si ya existe comisión para este despacho, retornar NULL (idempotente)
  IF EXISTS (SELECT 1 FROM public.comisiones WHERE despacho_id = p_despacho_id) THEN
    RETURN NULL;
  END IF;

  -- Obtener despacho
  SELECT nd.*, c.vendedor_id AS cot_vendedor_id
  INTO v_despacho
  FROM public.notas_despacho nd
  JOIN public.cotizaciones c ON c.id = nd.cotizacion_id
  WHERE nd.id = p_despacho_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DESPACHO_NO_ENCONTRADO';
  END IF;

  -- Verificar el rol del vendedor
  SELECT rol INTO v_rol_vendedor
  FROM public.usuarios
  WHERE id = v_despacho.cot_vendedor_id;

  -- Si es un jefe, no genera comisiones
  IF v_rol_vendedor = 'jefe' THEN
    RETURN NULL;
  END IF;

  -- Obtener configuración de tasas
  SELECT comision_pct_cabilla, comision_pct_otros, comision_categoria_cabilla
  INTO v_config
  FROM public.configuracion_negocio
  WHERE id = 1;

  v_cat_cabilla := lower(trim(v_config.comision_categoria_cabilla));

  -- Recorrer items de la cotización y clasificar por categoría
  FOR v_item IN
    SELECT ci.total_linea_usd, p.categoria
    FROM public.cotizacion_items ci
    LEFT JOIN public.productos p ON p.id = ci.producto_id
    WHERE ci.cotizacion_id = v_despacho.cotizacion_id
  LOOP
    IF lower(trim(COALESCE(v_item.categoria, ''))) = v_cat_cabilla THEN
      v_monto_cabilla := v_monto_cabilla + COALESCE(v_item.total_linea_usd, 0);
    ELSE
      v_monto_otros := v_monto_otros + COALESCE(v_item.total_linea_usd, 0);
    END IF;
  END LOOP;

  -- Insertar comisión
  INSERT INTO public.comisiones (
    despacho_id, vendedor_id, cotizacion_id,
    monto_cabilla, monto_otros,
    pct_cabilla, pct_otros,
    comision_cabilla, comision_otros, total_comision
  ) VALUES (
    p_despacho_id,
    v_despacho.cot_vendedor_id,
    v_despacho.cotizacion_id,
    v_monto_cabilla,
    v_monto_otros,
    v_config.comision_pct_cabilla,
    v_config.comision_pct_otros,
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2),
    ROUND(v_monto_otros * v_config.comision_pct_otros / 100, 2),
    ROUND(v_monto_cabilla * v_config.comision_pct_cabilla / 100, 2)
      + ROUND(v_monto_otros * v_config.comision_pct_otros / 100, 2)
  )
  RETURNING id INTO v_comision_id;

  RETURN v_comision_id;
END;
$$;
