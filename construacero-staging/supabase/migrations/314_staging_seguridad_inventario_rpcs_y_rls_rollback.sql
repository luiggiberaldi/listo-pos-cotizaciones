-- Rollback de 314_staging_seguridad_inventario_rpcs_y_rls.sql (Staging)
-- Restaura permisos anteriores en caso de necesitar reversión manual en staging.

-- ¡PELIGROSO! Vuelve a dar escritura directa a authenticated y crea reglas USING (true) que abren
-- préstamos y devoluciones a TODAS las empresas. Solo en emergencia y por poco tiempo.
-- OP-2026-086 (B1): todo dentro de una transacción; si algo falla, no queda nada a medias.
BEGIN;

GRANT INSERT, UPDATE, DELETE ON TABLE
  public.productos,
  public.inventario_movimientos,
  public.notas_despacho,
  public.notas_despacho_items,
  public.cliente_prestamos,
  public.despacho_devoluciones,
  public.despacho_devolucion_intercambios
TO authenticated;

DROP POLICY IF EXISTS "inventario_movimientos_authenticated_select" ON public.inventario_movimientos;
DROP POLICY IF EXISTS "nd_items_authenticated_select" ON public.notas_despacho_items;
DROP POLICY IF EXISTS "cliente_prestamos_authenticated_select" ON public.cliente_prestamos;
DROP POLICY IF EXISTS "despacho_devoluciones_authenticated_select" ON public.despacho_devoluciones;
DROP POLICY IF EXISTS "despacho_devolucion_intercambios_authenticated_select" ON public.despacho_devolucion_intercambios;

CREATE POLICY "Permitir todo a operadores autorizados en cliente_prestamos"
  ON public.cliente_prestamos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a operadores autorizados en despacho_devoluciones"
  ON public.despacho_devoluciones FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a operadores autorizados en despacho_devolucion_i"
  ON public.despacho_devolucion_intercambios FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
