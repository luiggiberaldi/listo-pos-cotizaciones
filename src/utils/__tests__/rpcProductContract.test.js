import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readProjectFile = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')

const tenantSafeCreateParams = [
  'p_cuenta_id',
  'p_usuario_id',
  'p_usuario_nombre',
  'p_usuario_color',
  'p_codigo',
  'p_nombre',
  'p_descripcion',
  'p_categoria',
  'p_unidad',
  'p_precio_usd',
  'p_costo_usd',
  'p_stock_actual',
  'p_stock_minimo',
  'p_imagen_url',
  'p_precio_2',
  'p_precio_3',
  'p_precio1_porcentaje',
  'p_precio2_porcentaje',
  'p_precio3_porcentaje',
  'p_idempotency_key',
]

function assertParamsPresent(source, params, label) {
  for (const param of params) {
    expect(source, `${label} debe manejar ${param}`).toContain(param)
  }
}

describe('contrato RPC de productos y Tester', () => {
  it('elimina overloads históricos y conserva las firmas canónicas', () => {
    const migration = readProjectFile('supabase/migrations/233_unificar_rpc_productos.sql')

    expect(migration).toContain('DROP FUNCTION IF EXISTS public.crear_producto_con_kardex(')
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.actualizar_producto_con_kardex(')
    expect(migration).toContain('crear_producto_con_kardex: 15 parámetros')
    expect(migration).toContain('actualizar_producto_con_kardex: 16 parámetros')
    expect(migration).toContain('NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC\n) TO authenticated;')
  })

  it('el frontend usa el Worker y el handler conserva el contrato tenant-safe', () => {
    const inventoryHook = readProjectFile('src/hooks/useInventario.js')
    const tester = readProjectFile('src/views/TesterFlowView.jsx')
    const handler = readProjectFile('api/handlers/inventario.js')

    expect(inventoryHook).toContain("'/api/productos/crear'")
    expect(inventoryHook).toContain("'/api/productos/actualizar'")
    expect(inventoryHook).toContain("'/api/productos/borrar'")
    expect(inventoryHook).not.toMatch(/supabase\.rpc\(['"](?:crear|actualizar|borrar)_producto_con_kardex['"]/) 
    expect(tester).toContain("apiCall('/api/productos/crear'")
    expect(tester).toContain("apiCall('/api/productos/borrar'")
    expect(tester).not.toMatch(/supabase\.rpc\(['"](?:crear|actualizar|borrar)_producto_con_kardex['"]/) 
    expect(tester).toContain('idempotencyKey: crypto.randomUUID()')

    assertParamsPresent(handler, tenantSafeCreateParams, 'handler de producto')
    expect(handler).toContain('crear_producto_con_kardex_tenant_safe')
    expect(handler).toContain('actualizar_producto_con_kardex_tenant_safe')
    expect(handler).toContain('borrar_producto_con_kardex_tenant_safe')
  })

  it('mantiene el aislamiento de cuenta del desarrollador virtual y del Tester', () => {
    const auth = readProjectFile('api/lib/auth.js')
    const tester = readProjectFile('src/views/TesterFlowView.jsx')

    expect(auth).toContain('cuenta_id: user.id')
    expect(tester).toContain('const transportistaId = null')
    expect(tester).toContain('el caso local se crea en el paso 35')
  })

  it('protege la limpieza del Tester, usa el esquema final y evita claves React duplicadas', () => {
    const migration = readProjectFile('supabase/migrations/234_tester_cleanup_tenant_safe.sql')
    const tester = readProjectFile('src/views/TesterFlowView.jsx')

    expect(migration).toContain("auth.jwt()->'app_metadata'->>'operator_rol'")
    expect(migration).toContain("v_rol NOT IN ('supervisor', 'administracion', 'jefe', 'desarrollador')")
    expect(migration).toContain('v_cotizacion_cuenta_id IS DISTINCT FROM v_cuenta_id')
    expect(migration).toContain('pagos_transportistas_despachos')
    expect(migration).toContain('despachoid = ANY(v_despacho_ids)')
    expect(migration).toContain('cotizacionid = p_cotizacion_id')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.tester_cleanup_cotizacion(UUID) FROM PUBLIC, anon;')
    expect(tester).toContain('groups.map((group, groupIndex) =>')
    expect(tester).toContain('key={`tester-group-${groupIndex}-${group.name}`}')
    expect(tester).toContain(".eq('despachoid', dataRef.current.despachoId)")
    expect(tester).toContain('com.totalcomision')
    expect(tester).toContain('if (cleanupError) throw new Error')
    expect(tester).toContain("apiCall('/api/admin/tester/cleanup-fixtures'")
    expect(tester).not.toContain("supabase.from('cuentas_por_cobrar').delete()")
    expect(tester).not.toContain("supabase.from('inventario_movimientos').delete()")
    expect(tester).not.toContain("supabase.from('reasignaciones_clientes').delete()")
    expect(tester).not.toContain("supabase.from('transportistas').delete()")
  })
})
