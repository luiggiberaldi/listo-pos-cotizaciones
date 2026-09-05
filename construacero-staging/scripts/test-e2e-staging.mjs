import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const STAGING_PROJECT_REF = 'spupqgkdsgohxxfoxydl'
export const STAGING_FRONTEND_ORIGIN = 'http://localhost:5174'
export const STAGING_WORKER_ORIGIN = 'http://127.0.0.1:8789'
export const SUPER_ADMIN_UUID = '00000000-0000-0000-0000-000000000000'

const here = path.dirname(fileURLToPath(import.meta.url))
const stagingRoot = path.resolve(here, '..')
const repoRoot = path.resolve(stagingRoot, '..')

export function parseEnvFile(text = '') {
  const values = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }
  return values
}

export function assertStagingConfig({ supabaseUrl, frontendOrigin = STAGING_FRONTEND_ORIGIN, workerOrigin = STAGING_WORKER_ORIGIN }) {
  const ref = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : ''
  if (ref !== STAGING_PROJECT_REF) {
    throw new Error(`Guardia staging: VITE_SUPABASE_URL debe apuntar a ${STAGING_PROJECT_REF}, no a ${ref || 'desconocido'}`)
  }

  const frontend = new URL(frontendOrigin)
  const worker = new URL(workerOrigin)
  if (frontend.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(frontend.hostname) || frontend.port !== '5174') {
    throw new Error(`Guardia staging: el frontend E2E debe ser http://localhost:5174, no ${frontendOrigin}`)
  }
  if (worker.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(worker.hostname) || worker.port !== '8789') {
    throw new Error(`Guardia staging: el Worker E2E debe ser local:8789, no ${workerOrigin}`)
  }
  if (/production|prod|oyfyuszgjwcepjpngclv/i.test(`${supabaseUrl} ${frontendOrigin} ${workerOrigin}`)) {
    throw new Error('Guardia staging: se detectó una referencia de producción en la configuración E2E')
  }
  return { projectRef: ref, frontendOrigin: frontend.origin, workerOrigin: worker.origin }
}

export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  const hidden = /token|secret|password|pin_hash|pin_salt|service.key|anon_key|access_token|refresh_token/i
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !hidden.test(key))
    .map(([key, entry]) => [key, sanitize(entry)]))
}

function getFlag(name) {
  return process.argv.includes(name)
}

async function readOptional(file) {
  try { return parseEnvFile(await readFile(file, 'utf8')) } catch { return {} }
}

async function loadConfig() {
  const [envFile, devVars, e2eEnv] = await Promise.all([
    readOptional(path.join(stagingRoot, '.env')),
    readOptional(path.join(stagingRoot, '.dev.vars')),
    readOptional(path.join(stagingRoot, '.env.e2e.local')),
  ])
  const config = { ...envFile, ...devVars, ...e2eEnv, ...process.env }
  const supabaseUrl = config.STAGING_E2E_SUPABASE_URL || config.VITE_SUPABASE_URL
  const anonKey = config.STAGING_E2E_ANON_KEY || config.VITE_SUPABASE_ANON_KEY
  const frontendOrigin = config.STAGING_E2E_FRONTEND_ORIGIN || STAGING_FRONTEND_ORIGIN
  const workerOrigin = config.STAGING_E2E_WORKER_ORIGIN || STAGING_WORKER_ORIGIN
  assertStagingConfig({ supabaseUrl, frontendOrigin, workerOrigin })
  if (!anonKey) throw new Error('Falta STAGING_E2E_ANON_KEY o VITE_SUPABASE_ANON_KEY en construacero-staging/.env')

  const email = config.STAGING_E2E_EMAIL
  const password = config.STAGING_E2E_PASSWORD
  const superCode = config.STAGING_E2E_SUPER_CODE || config.DEV_SUPER_CODE
  if (!email || !password) {
    throw new Error('Faltan STAGING_E2E_EMAIL y STAGING_E2E_PASSWORD. Configúralos solo en el entorno local de staging; nunca reutilices una sesión del navegador.')
  }
  if (!superCode && !(config.STAGING_E2E_OPERATOR_ID && config.STAGING_E2E_PIN)) {
    throw new Error('Falta STAGING_E2E_SUPER_CODE/DEV_SUPER_CODE o el par STAGING_E2E_OPERATOR_ID + STAGING_E2E_PIN')
  }

  return {
    ...config,
    supabaseUrl,
    anonKey,
    email,
    password,
    superCode,
    frontendOrigin,
    workerOrigin,
    keepData: getFlag('--keep-data') || config.STAGING_E2E_KEEP_DATA === '1',
    logDir: config.STAGING_E2E_LOG_DIR || path.join(repoRoot, 'tmp', 'e2e-staging'),
  }
}

class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function round2(number) {
  return Math.round((Number(number) + Number.EPSILON) * 100) / 100
}

function assert(condition, expected, actual, label) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${label}\n  Esperado: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`)
}

function id8(value) {
  return value ? `${String(value).slice(0, 8)}...` : 'null'
}

export function selectCommissionSeller(rows = []) {
  return [...rows]
    .filter(row => row?.id && row.rol === 'vendedor' && row.activo !== false)
    .sort((a, b) => `${a.nombre || ''}:${a.id}`.localeCompare(`${b.nombre || ''}:${b.id}`))[0] || null
}

export function commissionStateContract(commission = {}) {
  const retained = round2(commission.comision_retenida)
  return {
    expectedState: retained > 0.01 ? 'cta_cobrar' : 'pendiente',
    requiresManualRelease: retained > 0.01,
    released: round2(commission.comision_liberada),
    retained,
  }
}

const TEST = {
  producto: { codigo: 'TEST-DET-001', nombre: 'Producto Determinista Test', unidad: 'und', precio_usd: 25, costo_usd: 15, stock_inicial: 100, stock_minimo: 5, categoria: 'TESTER' },
  cliente: { nombre: 'Cliente Determinista Test', rif_cedula: 'J-88888888-0', telefono: '0414-0000001', email: 'determinista@test.local', direccion: 'Calle Test #1, Determinista', estado: 'Aragua' },
  cotizacion: { cantidad: 10, precio_unit: 25, costo_envio: 10, total_linea: 250, subtotal: 250, total_usd: 260 },
  producto2: { codigo: 'TEST-DET-002', nombre: 'Producto Secundario Test', unidad: 'mt', precio_usd: 40, precio_2: 38, precio_3: 35, costo_usd: 25, stock_inicial: 50, stock_minimo: 3, categoria: 'TESTER' },
  transportista: { nombre: 'Transportista Determinista Test', rif: 'V-99999999', telefono: '0412-0000000', vehiculo: 'Camión Test', placa_chuto: 'TEST-00', es_local: true, tipo_relacion: 'contratista' },
  ventaRapida: { cantidad: 5, precio_unit: 25, flete_usd: 50, forma_pago: 'Efectivo $', total_usd: 175 },
  movimientoLote: { cantidad: 20, motivo: 'Ajuste de inventario por tester determinista' },
  reasignacion: { motivo: 'Reasignación de prueba determinista para el tester' },
}

const STEPS = [
  ['pre_cleanup', '0. Limpiar datos residuales'],
  ['assert_staging_schema', '0.1. Preflight: esquema staging requerido'],
  ['create_product', '1. Crear producto'],
  ['assert_product', '2. Assert: producto en BD con valores exactos'],
  ['assert_kardex_ingreso', '3. Assert: kardex tiene ingreso 0→100'],
  ['create_client', '4. Crear cliente'],
  ['assert_client', '5. Assert: cliente en BD con saldo_pendiente=0'],
  ['search_improved', '6. Búsqueda mejorada: RIF sin formato y typo de cliente'],
  ['create_draft', '7. Crear cotización borrador'],
  ['assert_draft', '7. Assert: cotización estado=borrador, total=$260.00'],
  ['assert_items', '8. Assert: items con total_linea=$250.00'],
  ['assert_stock_comprometido_pre', '9. Assert: stock comprometido tras borrador = 0'],
  ['send_quote', '10. Enviar cotización'],
  ['assert_sent', '11. Assert: estado=enviada'],
  ['accept_quote', '12. Aceptar cotización'],
  ['assert_accepted', '13. Assert: estado=aceptada'],
  ['assert_stock_comprometido_aceptada', '14. Assert: stock comprometido tras aceptar = 0'],
  ['create_despacho', '15. Crear despacho (Cta por cobrar)'],
  ['assert_despacho', '16. Assert: despacho estado=pendiente, total=$260.00'],
  ['assert_stock_post', '17. Assert: stock_actual=100 (pendiente no descuenta)'],
  ['assert_kardex_egreso', '18. Assert: sin egreso Kardex antes de entrega'],
  ['assert_stock_comprometido_post', '19. Assert: despacho pendiente no compromete stock'],
  ['assert_cxc_cargo', '20. Assert: CxC aún no se crea en pendiente'],
  ['apply_descuento', '21. Aplicar descuento $2/u al artículo (10u → -$20)'],
  ['assert_descuento', '22. Assert: descuento_total=$20, CxC aún pendiente'],
  ['mark_dispatched', '23. Marcar despachada'],
  ['assert_dispatched', '24. Assert: estado=despachada, despachada_en≠null'],
  ['assert_stock_comprometido_aprobado', '25. Assert: aprobado compromete 10u y crea CxC=$240'],
  ['mark_delivered', '26. Marcar entregada'],
  ['assert_delivered', '27. Assert: estado=entregada, entregada_en≠null'],
  ['replay_delivery', '27.1. Replay de entrega: no duplica stock, Kardex, CxC ni comisión'],
  ['assert_stock_comprometido_entregado', '28. Assert: entrega libera comprometido'],
  ['register_partial_return', '29. Devolución parcial por API: 1u neta $23'],
  ['assert_partial_return', '29.1. Assert: devolución atómica restaura stock, Kardex y CxC'],
  ['assert_partial_return_idempotent', '29.2. Assert: replay de devolución no duplica stock, Kardex ni CxC'],
  ['assert_cobro_diferencia_sobrepago', '29.3. Assert: sobrepago de la diferencia se rechaza'],
  ['assert_commission', '30. Assert: comisión 238b pre-cobro (100% CxC => $0, excluida registrada)'],
  ['register_partial_return_sin_pagos', '30.1. Devolución con diferencia sin cobro: queda deuda total'],
  ['assert_partial_return_sin_pagos', '30.2. Assert: segundo cargo de diferencia sin abonos'],
  ['change_delivery_date', '31. Corregir fecha efectiva sin tocar correlativo ni finanzas'],
  ['assert_delivery_date_change', '32. Assert: fecha ajustada e historial financiero inmutables'],
  ['assert_delivery_date_idempotent', '33. Assert: replay idempotente no duplica ni cambia la fecha'],
  ['pay_commission', '34. Liberar CxC y pagar comisión'],
  ['assert_commission_paid', '31. Assert: comisión estado=pagada'],
  ['register_payment', '32. Registrar abono CxC ($100)'],
  ['assert_cxc_abono', '33. Assert: saldo tras abono CxC $100 coherente con cargos/cobros'],
  ['assert_report_ventas', '34. Assert: reporte ventas refleja devoluciones con intercambio'],
  ['assert_report_pipeline', '35. Assert: reporte pipeline incluye cotización'],
  ['assert_report_inventario', '36. Assert: reporte inventario stock=90 (devoluciones con intercambio)'],
  ['create_transportista', '37. Crear transportista'],
  ['assert_transportista', '38. Assert: transportista en BD'],
  ['create_product_2', '39. Crear producto 2 (con precio_2/precio_3)'],
  ['assert_product_2_prices', '40. Assert: 3 precios correctos'],
  ['apply_inventory_batch', '41. Movimiento lote: ingreso +20u producto 1'],
  ['assert_inventory_batch', '42. Assert: stock=110 y kardex lote'],
  ['batch_ingest_idempotent', '42.1. Ingesta masiva atómica por RPC'],
  ['assert_batch_ingest_idempotent', '42.2. Assert: replay de ingesta no duplica stock ni Kardex'],
  ['assert_kardex_provenance', '42.3. Assert: provenance e idempotencia quedan estructurados'],
  ['assert_inventory_batch_rollback', '42.4. Assert: lote insuficiente — guarda reverte ou venta anticipada aplica e restaura'],
  ['transform_inventory', '42.5. Transformación atómica entre dos productos'],
  ['assert_transform_inventory', '42.6. Assert: transformación registra egreso/ingreso coherentes'],
  ['return_loan', '42.7. Devolución atómica de préstamo'],
  ['assert_loan_return', '42.8. Assert: préstamo, stock y Kardex coherentes'],
  ['create_draft_for_anular', '43. Crear cotización para anular'],
  ['send_quote_for_anular', '44. Enviar cotización'],
  ['anular_cotizacion', '45. Anular cotización'],
  ['assert_anulada', '46. Assert: estado=anulada'],
  ['reciclar_cotizacion', '47. Reciclar cotización anulada'],
  ['assert_reciclada', '48. Assert: nueva cotización borrador con items'],
  ['crear_version', '49. Enviar reciclada y crear versión'],
  ['assert_version', '50. Assert: versión ≥2, cotizacion_raiz_id≠null'],
  ['venta_rapida', '51. Venta rápida (cotización+despacho atómico)'],
  ['assert_vr_cotizacion', '52. Assert: cotización aceptada, total=$175'],
  ['assert_vr_despacho', '53. Assert: despacho pendiente, pago=Efectivo $'],
  ['deliver_vr_for_reversal', '53.1. Entregar despacho aislado para probar reversión financiera'],
  ['assert_vr_delivered', '53.2. Assert: reversión aislada descontó stock y creó comisión'],
  ['revert_vr_delivery', '53.3. Revertir entrega aislada con rollback financiero'],
  ['assert_vr_reverted', '53.4. Assert: reversión restauró stock y eliminó finanzas'],
  ['replay_vr_reversal', '53.5. Replay de reversión no duplica el rollback'],
  ['assert_vr_reversal_replay', '53.6. Assert: replay mantiene stock, Kardex y finanzas'],
  ['assert_transportista_report', '54. Assert: transportista local aparece en reporte'],
  ['assert_stock_post_vr', '55. Assert: stock=110 después de reversión'],
  ['anular_despacho', '56. Anular despacho de venta rápida'],
  ['assert_despacho_anulado', '57. Assert: estado=anulada, stock permanece=110'],
  ['reciclar_despacho', '58. Reciclar despacho → nueva cotización'],
  ['assert_despacho_reciclado', '59. Assert: cotización borrador con items'],
  ['reasignar_cliente', '60. Reasignar cliente a otro vendedor'],
  ['assert_reasignacion', '61. Assert: vendedor_id y motivo actualizados'],
  ['health_api_endpoints', '62. Health: endpoints API responden'],
  ['health_rls_policies', '63. Health: RLS permite lectura de tablas clave'],
  ['health_config', '64. Health: configuración carga correctamente'],
  ['health_nav_routes', '65. Health: rutas principales existen'],
  ['health_kardex_continuity', '66. Health: continuidad matemática de Kardex'],
  ['health_stock_negativo_guard', '67. Health: guardarraíl stock negativo operativo'],
  ['split_setup', '29.4. Split designado v3: fixture (jefe, designado, dueño) y config'],
  ['split_t0_designar', '29.5. Designación: jefe designa vendedor del día (POST)'],
  ['split_assert_t0', '29.6. Designación: upsert idempotente, una fila por fecha'],
  ['split_t0b_no_jefe', '29.7. Designación: un vendedor NO puede designar (403)'],
  ['split_t0c_invalido', '29.8. Designación: un jefe no puede ser designado (400)'],
  ['split_t1_crear', '29.9. Split T1: venta a cliente ajeno en día designado'],
  ['split_assert_t1', '29.10. Split T1: 2 filas (dueño 1.5% / designado 0.5%), vendedor que vendió no cobra'],
  ['split_t2_replay', '29.11. Split T2: replay de entrega no duplica filas'],
  ['split_t3_cliente_propio', '29.12. Split T3: cliente propio → 1 fila normal del vendedor'],
  ['split_assert_t3', '29.12.1 Assert T3: 1 fila normal del vendedor que vendió'],
  ['split_t4_dia_no_config', '29.13. Split T4: día no configurado → sin split aunque haya designado'],
  ['split_assert_t4', '29.13.1 Assert T4: 1 fila del dueño con % normal'],
  ['split_t4b_sin_designacion', '29.14. Split T4b: día configurado sin designación → sin split'],
  ['split_assert_t4b', '29.14.1 Assert T4b: 1 fila del dueño con % normal'],
  ['split_t5_switch_off', '29.15. Split T5: switch apagado → sin split'],
  ['split_assert_t5', '29.15.1 Assert T5: 1 fila del dueño'],
  ['split_t6_devolucion', '29.16. Split T6: devolución escala ambas filas'],
  ['split_assert_t6', '29.17. Split T6: factor aplicado a las 2 filas'],
  ['split_t7_pago_fila', '29.18. Split T7: pagar fila del designado no toca la del dueño'],
  ['split_assert_t7', '29.19. Split T7: estados independientes'],
  ['split_t8_cxc', '29.20. Split T8: CxC → ambas filas excluidas 238b'],
  ['split_assert_t8', '29.21. Split T8: comisión 0 + excluida proporcional'],
  ['split_t9_designado_dueno', '29.22. Split T9: designado = dueño del cliente → 1 fila con % normal'],
  ['split_assert_t9', '29.23. Split T9: fila única al dueño sin evidencia split'],
  ['split_assert_lista', '29.24. Split: tipos designado/cliente_ajeno_dueno visibles en lista API'],
  ['split_cleanup_designacion', '29.25. Split: quitar designación (DELETE)'],
  ['split_restore_config', '29.26. Split: restaurar configuración'],
  ['cleanup', '68. Limpiar datos de prueba'],
  ['assert_cleanup', '69. Assert: datos eliminados completamente'],
].map(([id, label]) => ({ id, label }))

class StagingE2ERunner {
  constructor(config) {
    this.config = config
    this.supabase = createClient(config.supabaseUrl, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    this.data = {}
    this.lines = []
    this.results = []
    this.logFile = null
    this.user = null
    this.operator = { id: SUPER_ADMIN_UUID, nombre: 'Desarrollador', rol: 'desarrollador' }
    this.salesperson = null
  }

  async initLog() {
    await mkdir(this.config.logDir, { recursive: true })
    function fechaCaracas(offsetDays = 0) {
  // Fecha (YYYY-MM-DD) y dow en hora Venezuela (UTC-4), no UTC
  const d = new Date(Date.now() + offsetDays * 86400000 - 4 * 3600000)
  return { fecha: d.toISOString().slice(0, 10), dow: d.getUTCDay() }
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.logFile = path.join(this.config.logDir, `tester-${stamp}.log`)
    await this.persist()
  }

  async persist() {
    if (this.logFile) await writeFile(this.logFile, `${this.lines.join('\n')}\n`, 'utf8')
  }

  log(message, type = 'INFO', step = '') {
    const line = `[${new Date().toISOString()}] [${type}]${step ? ` [${step}]` : ''} ${message}`
    this.lines.push(line)
    console.log(line)
  }

  // v3: las designaciones las autoriza el rol jefe — el E2E actúa como jefe
  // usando el header X-Operator-Id (verifyAuth resuelve el rol desde usuarios).
  async apiAsJefe(pathname, method = 'GET', body = null) {
    if (!this.data?.splitJefeId) throw new Error('apiAsJefe: no hay jefe fixture')
    return this.api(pathname, method, body, this.data.splitJefeId)
  }

  async api(pathname, method = 'GET', body = null, operatorId = null) {
    const session = (await this.supabase.auth.getSession()).data.session
    if (!session?.access_token) throw new Error('No hay sesión de staging')
    const headers = { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json' }
    if (operatorId) headers['X-Operator-Id'] = operatorId
    if (body !== null) {
      headers['Content-Type'] = 'application/json'
    }
    const response = await fetch(`${this.config.frontendOrigin}${pathname}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let data = null
    if (text) {
      try { data = JSON.parse(text) } catch { data = { raw: text } }
    }
    if (!response.ok) {
      const message = data?.error || data?.message || text || `HTTP ${response.status}`
      throw new ApiError(`${method} ${pathname}: ${message}`, response.status, sanitize(data))
    }
    return data
  }

  async db(promise, label) {
    const result = await promise
    if (result.error) throw new Error(`${label}: ${result.error.message}`)
    return result.data
  }

  async auth() {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email: this.config.email.trim().toLowerCase(), password: this.config.password })
    if (error) throw new Error(`Login E2E de staging rechazado: ${error.message}`)
    this.user = data.user
    this.log(`Sesión E2E creada para ${this.user.email}; tenant=${id8(this.user.id)}`)

    if (this.config.superCode) {
      await this.api('/api/auth/super-admin', 'POST', { code: this.config.superCode })
      const refreshed = await this.supabase.auth.refreshSession()
      if (refreshed.error) throw new Error(`No se pudo refrescar metadata del operador: ${refreshed.error.message}`)
    } else {
      const operatorId = this.config.STAGING_E2E_OPERATOR_ID
      await this.api('/api/auth/switch-operator', 'POST', { operator_id: operatorId, pin: this.config.STAGING_E2E_PIN })
      this.operator = { id: operatorId, nombre: 'Operador E2E', rol: 'desarrollador' }
    }

    const { data: authUser, error: authError } = await this.supabase.auth.getUser()
    if (authError) throw new Error(`No se pudo verificar el usuario E2E: ${authError.message}`)
    const operatorId = authUser.user?.app_metadata?.operator_id
    if (this.config.superCode && operatorId !== SUPER_ADMIN_UUID) {
      throw new Error(`La sesión de staging no activó el desarrollador virtual: ${operatorId || 'sin operador'}`)
    }
    this.user = authUser.user
    this.log(`Operador activo: ${this.operator.nombre} (${this.operator.rol})`, 'OK')
  }

  async resolveCommissionSeller() {
    const rows = await this.db(
      this.supabase
        .from('usuarios')
        .select('id,nombre,rol,activo')
        .eq('cuenta_id', this.user.id)
        .eq('rol', 'vendedor')
        .eq('activo', true)
        .order('nombre', { ascending: true }),
      'buscar vendedor de comisión E2E'
    )
    const seller = selectCommissionSeller(rows)
    if (!seller) {
      throw new Error('Staging E2E requiere al menos un vendedor activo en la cuenta para validar comisiones; el desarrollador virtual no es vendedor comisionable.')
    }
    this.salesperson = seller
    this.log(`Vendedor de comisión: ${seller.nombre} (${id8(seller.id)})`, 'OK')
  }

  async ping() {
    const check = async (origin, label) => {
      const response = await fetch(`${origin}/api/ping`, { headers: { Accept: 'application/json' } })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = null }
      assert(response.ok, 200, response.status, `${label} HTTP`)
      const ref = response.headers.get('X-Supabase-Project-Ref') || body?.projectRef || body?.project_ref
      assert(ref === STAGING_PROJECT_REF, STAGING_PROJECT_REF, ref, `${label} proyecto Supabase`)
      this.log(`${label}: HTTP ${response.status} → ${ref} ✓`, 'OK')
    }
    await check(this.config.workerOrigin, 'Worker staging :8789')
    await check(this.config.frontendOrigin, 'Proxy Vite staging :5174')
  }

  async stockCommitted() {
    const rows = await this.db(this.supabase.rpc('obtener_stock_comprometido'), 'obtener_stock_comprometido')
    const row = (rows || []).find(item => item.producto_id === this.data.productoId)
    return row ? Number(row.total_comprometido) : 0
  }

  async productRpc(product) {
    const result = await this.db(this.supabase.rpc('crear_producto_con_kardex_staging', {
      p_codigo: product.codigo, p_nombre: product.nombre, p_descripcion: null, p_categoria: product.categoria,
      p_unidad: product.unidad, p_precio_usd: product.precio_usd, p_precio_2: product.precio_2 ?? null,
      p_precio_3: product.precio_3 ?? null, p_costo_usd: product.costo_usd, p_stock_actual: product.stock_inicial,
      p_stock_minimo: product.stock_minimo, p_imagen_url: null, p_precio1_porcentaje: null,
      p_precio2_porcentaje: null, p_precio3_porcentaje: null,
    }), `crear_producto_con_kardex(${product.codigo})`)
    return typeof result === 'object' ? result.id : result
  }

  async cleanCotizacion(cotizacionId, label) {
    if (!cotizacionId) return

    const rpcResult = await this.supabase.rpc('tester_cleanup_cotizacion', { p_cotizacion_id: cotizacionId })
    if (!rpcResult.error) {
      this.log(`DELETE ${label} ✓`, 'OK')
      return
    }

    // Algunas bases staging antiguas ya migraron despacho_descuentos a
    // despacho_item_id, pero aún conservan la RPC 075 que intenta usar
    // columnas legacy (despacho_id/cotizacion_id). El fallback mantiene la
    // limpieza del fixture sin ampliar permisos ni tocar filas fuera del
    // tenant autenticado.
    const detail = String(rpcResult.error.message || '')
    this.log(`Detalle error RPC limpieza (${label}): ${detail}`, 'WARN')
    if (!/(?:despacho_id|cotizacion_id).*does not exist/i.test(detail)) {
      throw new Error(`limpiar ${label}: ${detail}`)
    }

    this.log(`RPC de limpieza incompatible; usando fallback tenant-safe para ${label}`, 'WARN')
    const dispatchesForCleanup = await this.db(
      this.supabase.from('notas_despacho').select('id').eq('cotizacion_id', cotizacionId),
      `buscar despachos ${label}`
    )
    const dispatchIdsForCleanup = (dispatchesForCleanup || []).map(row => row.id).filter(Boolean)
    const cotItems = await this.db(
      this.supabase.from('cotizacion_items').select('id').eq('cotizacion_id', cotizacionId),
      `buscar ítems ${label}`
    )
    const cotItemIds = (cotItems || []).map(row => row.id).filter(Boolean)
    if (cotItemIds.length) {
      let discountResult = await this.supabase
        .from('despacho_descuentos')
        .delete()
        .in('cotizacion_item_id', cotItemIds)
      if (discountResult.error) {
        const dispatchItems = dispatchIdsForCleanup.length
          ? await this.db(
              this.supabase
                .from('notas_despacho_items')
                .select('id')
                .in('despacho_id', dispatchIdsForCleanup),
              `buscar ítems de despacho ${label}`
            )
          : []
        const dispatchItemIds = (dispatchItems || []).map(row => row.id).filter(Boolean)
        if (dispatchItemIds.length) {
          discountResult = await this.supabase
            .from('despacho_descuentos')
            .delete()
            .in('despacho_item_id', dispatchItemIds)
        }
      }
      if (discountResult.error) throw new Error(`limpiar descuentos ${label}: ${discountResult.error.message}`)
    }

    const dispatches = await this.db(
      this.supabase.from('notas_despacho').select('id').eq('cotizacion_id', cotizacionId),
      `buscar despachos ${label}`
    )
    const dispatchIds = (dispatches || []).map(row => row.id).filter(Boolean)
    if (dispatchIds.length) {
      const cxc = await this.supabase.from('cuentas_por_cobrar').delete().in('despacho_id', dispatchIds)
      if (cxc.error) throw new Error(`limpiar CxC ${label}: ${cxc.error.message}`)
      const commissions = await this.db(
        this.supabase.from('comisiones').select('id').in('despachoid', dispatchIds),
        `buscar comisiones ${label}`
      )
      const commissionIds = (commissions || []).map(row => row.id).filter(Boolean)
      if (commissionIds.length) {
        const releases = await this.supabase.from('comision_liberaciones').delete().in('comision_id', commissionIds)
        if (releases.error) throw new Error(`limpiar liberaciones ${label}: ${releases.error.message}`)
      }
      const commissionDelete = await this.supabase.from('comisiones').delete().in('despachoid', dispatchIds)
      if (commissionDelete.error) throw new Error(`limpiar comisiones ${label}: ${commissionDelete.error.message}`)
      const itemDelete = await this.supabase.from('notas_despacho_items').delete().in('despacho_id', dispatchIds)
      if (itemDelete.error) throw new Error(`limpiar ítems de despacho ${label}: ${itemDelete.error.message}`)
      const dispatchDelete = await this.supabase.from('notas_despacho').delete().in('id', dispatchIds)
      if (dispatchDelete.error) throw new Error(`limpiar despachos ${label}: ${dispatchDelete.error.message}`)
    }

    const itemDelete = await this.supabase.from('cotizacion_items').delete().eq('cotizacion_id', cotizacionId)
    if (itemDelete.error) throw new Error(`limpiar ítems ${label}: ${itemDelete.error.message}`)
    const quoteDelete = await this.supabase.from('cotizaciones').delete().eq('id', cotizacionId)
    if (quoteDelete.error) throw new Error(`limpiar cotización ${label}: ${quoteDelete.error.message}`)
    this.log(`DELETE ${label} ✓ (fallback compatible)`, 'OK')
  }

  async cleanProduct(productId, label) {
    if (!productId) return
    const { error } = await this.supabase.rpc('borrar_producto_con_kardex_staging', { p_producto_id: productId })
    if (error) throw new Error(`limpiar ${label}: ${error.message}`)
    this.log(`DELETE ${label} + movimientos ✓`, 'OK')
  }

  async ensureSplitClient(rif, nombre, vendedorId) {
    const payload = { rif_cedula: rif, nombre, tipo_cliente: 'particular', vendedor_id: vendedorId, cuenta_id: this.user.id, activo: true, saldo_pendiente: 0, telefono: '0414-0000042', email: `${rif.toLowerCase().replace(/[^a-z0-9]/g, '')}@split.test` }
    const existing = await this.db(this.supabase.from('clientes').select('id').eq('rif_cedula', rif).eq('cuenta_id', this.user.id).maybeSingle(), `buscar ${nombre}`)
    if (existing) {
      const row = await this.db(this.supabase.from('clientes').update(payload).eq('id', existing.id).eq('cuenta_id', this.user.id).select('id').single(), `reactivar ${nombre}`)
      return row.id
    }
    const row = await this.db(this.supabase.from('clientes').insert(payload).select('id').single(), `crear ${nombre}`)
    return row.id
  }

  async ensureSplitUser(nombre, rol, pin) {
    const rows = await this.db(
      this.supabase.from('usuarios').select('id,nombre,rol').eq('cuenta_id', this.user.id).eq('nombre', nombre).limit(1),
      `buscar usuario split ${nombre}`
    )
    if (rows?.length) return rows[0].id
    // El rol jefe es el único que puede designar; el E2E opera como él vía
    // X-Operator-Id. Los usuarios live en public.usuarios (sin auth.users),
    // así que se crean vía el endpoint admin del Worker.
    const created = await this.api('/api/admin/users', 'POST', { nombre, rol, pin, color: rol === 'jefe' ? '#059669' : '#7C3AED' })
    const createdRows = await this.db(
      this.supabase.from('usuarios').select('id').eq('cuenta_id', this.user.id).eq('nombre', nombre).limit(1),
      `leer usuario split ${nombre}`
    )
    if (!createdRows?.length) throw new Error(`No se pudo crear el usuario split ${nombre} (rol ${rol})`)
    this.log(`Usuario split creado: ${nombre} (${rol}) ${id8(createdRows[0].id)}`, 'OK')
    return createdRows[0].id
  }

  async splitSetup() {
    const d = this.data
    d.splitCotizacionIds = []
    d.splitDespachoIds = []
    d.splitDesignacionesCreadas = []
    const sellers = await this.db(
      this.supabase.from('usuarios').select('id,nombre,es_externo,rol').eq('cuenta_id', this.user.id).eq('rol', 'vendedor').eq('activo', true).order('nombre'),
      'buscar vendedores para split'
    )
    // Excluir usuarios fixture del propio split (p. ej. 'Vendedor E2E
    // Designado' sobreviviente de una corrida interrumpida): nunca deben
    // salir como candidatos a dueño de cliente.
    const other = (sellers || []).find(s => s.id !== this.salesperson.id && !s.es_externo && !/E2E Designado/.test(s.nombre || ''))
    if (!other) {
      d.splitSkip = 'no hay segundo vendedor interno activo en staging'
      this.log(`SKIP split: ${d.splitSkip}`, 'WARN')
      return
    }
    d.splitDuenoId = other.id
    // Tercer vendedor interno: será el designado del día (≠ vendedor que vende, ≠ dueño)
    d.splitDesignadoId = await this.ensureSplitUser('Vendedor E2E Designado', 'vendedor', '4821')
    if (d.splitDesignadoId === this.salesperson.id || d.splitDesignadoId === d.splitDuenoId) {
      d.splitSkip = 'el designado colisiona con los vendedores existentes'
      this.log(`SKIP split: ${d.splitSkip}`, 'WARN')
      return
    }
    d.splitJefeId = await this.ensureSplitUser('Jefe E2E Staging', 'jefe', '482160')
    d.splitTodayDow = fechaCaracas().dow
    const cfg = await this.db(
      this.supabase.from('configuracion_negocio').select('comision_split_activo,comision_split_pct_vendedor,comision_split_pct_dueno,comision_split_dias').eq('cuenta_id', this.user.id).limit(1).maybeSingle(),
      'config split original'
    )
    d.splitCfgOriginal = cfg || {}
    await this.api('/api/admin/config', 'PUT', {
      comision_split_activo: true,
      comision_split_pct_vendedor: 0.5,
      comision_split_pct_dueno: 1.5,
      comision_split_dias: String(d.splitTodayDow),
    })
    d.splitPctV = 0.5
    d.splitPctD = 1.5
    d.splitClienteAjenoId = await this.ensureSplitClient(`V-${id8(d.splitDuenoId)}1`, 'Cliente Ajeno Split E2E', d.splitDuenoId)
    d.splitClientePropioId = await this.ensureSplitClient(`V-${id8(this.salesperson.id)}1`, 'Cliente Propio Split E2E', this.salesperson.id)
    d.splitClienteDesignadoId = await this.ensureSplitClient(`V-${id8(d.splitDesignadoId)}1`, 'Cliente Designado Split E2E', d.splitDesignadoId)
    this.log(`Split v3 activo HOY (dow=${d.splitTodayDow}); jefe ${id8(d.splitJefeId)}, designado ${id8(d.splitDesignadoId)}, dueño ${id8(d.splitDuenoId)}`, 'OK')
  }

  async splitSetConfig(patch) {
    await this.api('/api/admin/config', 'PUT', patch)
  }

  async runSplitSale({ cantidad, formaPago, clienteId, vendedorId }) {
    const d = this.data
    const sellerId = vendedorId || this.salesperson.id
    const total = round2(cantidad * 25)
    const cot = await this.api('/api/cotizaciones/guardar', 'POST', {
      headerData: { cliente_id: clienteId, vendedor_id: sellerId, notas_cliente: 'Split E2E', notas_internas: 'Split E2E', descuento_global_pct: 0, costo_envio_usd: 0, subtotal_usd: total, descuento_usd: 0, total_usd: total },
      items: [{ producto_id: d.productoId, codigo_snap: TEST.producto.codigo, nombre_snap: TEST.producto.nombre, unidad_snap: TEST.producto.unidad, cantidad, precio_unit_usd: 25, descuento_pct: 0, total_linea_usd: total }],
    }, sellerId)
    await this.api('/api/cotizaciones/enviar', 'POST', { cotizacionId: cot.id, tasaBcv: 100 }, sellerId)
    await this.db(this.supabase.from('cotizaciones').update({ estado: 'aceptada' }).eq('id', cot.id), 'aceptar split')
    const desp = await this.api('/api/despachos/crear', 'POST', { cotizacionId: cot.id, formaPago, transportistaId: null, fleteUsd: 0 }, sellerId)
    await this.api('/api/despachos/estado', 'POST', { despachoId: desp.id, nuevoEstado: 'despachada' })
    await this.api('/api/despachos/estado', 'POST', { despachoId: desp.id, nuevoEstado: 'entregada' })
    d.splitCotizacionIds.push(cot.id)
    d.splitDespachoIds.push(desp.id)
    return { cotizacionId: cot.id, despachoId: desp.id }
  }

  async cleanupFixtures() {
    const d = this.data
    if (Array.isArray(d.splitCotizacionIds) && d.splitCotizacionIds.length) {
      for (const cotId of [...new Set(d.splitCotizacionIds)]) await this.cleanCotizacion(cotId, `split ${id8(cotId)}`)
    }
    if (d.splitClienteAjenoId) {
      await this.db(this.supabase.from('clientes').update({ saldo_pendiente: 0, activo: false }).eq('id', d.splitClienteAjenoId).eq('cuenta_id', this.user.id), 'desactivar cliente ajeno split')
    }
    if (d.splitClientePropioId) {
      await this.db(this.supabase.from('clientes').update({ saldo_pendiente: 0, activo: false }).eq('id', d.splitClientePropioId).eq('cuenta_id', this.user.id), 'desactivar cliente propio split')
    }
    if (d.splitClienteDesignadoId) {
      await this.db(this.supabase.from('clientes').update({ saldo_pendiente: 0, activo: false }).eq('id', d.splitClienteDesignadoId).eq('cuenta_id', this.user.id), 'desactivar cliente designado split')
    }
    if (d.splitFechaHoy) {
      // La designación del día se elimina (si quedó) y luego los usuarios fixture
      const del = await this.supabase.from('comision_designacion_diaria').delete().eq('cuenta_id', this.user.id).eq('fecha', d.splitFechaHoy)
      if (del.error) this.log(`Detalle limpieza designación: ${del.error.message}`, 'WARN')
    }
    if (d.splitDesignadoId) {
      const delU = await this.supabase.from('usuarios').delete().eq('id', d.splitDesignadoId).eq('cuenta_id', this.user.id)
      if (delU.error) this.log(`Detalle limpieza designado: ${delU.error.message}`, 'WARN')
      d.splitDesignadoId = null
    }
    if (d.splitJefeId) {
      const delJ = await this.supabase.from('usuarios').delete().eq('id', d.splitJefeId).eq('cuenta_id', this.user.id)
      if (delJ.error) this.log(`Detalle limpieza jefe: ${delJ.error.message}`, 'WARN')
      d.splitJefeId = null
    }
    const cotizaciones = [d.cotizacionDesdeDespachoId, d.ventaRapidaCotizacionId, d.cotizacionVersionId, d.cotizacionRecicladaId, d.cotizacion2Id, d.cotizacionId]
    const unique = [...new Set(cotizaciones.filter(Boolean))]
    for (const cotId of unique) await this.cleanCotizacion(cotId, `cotización ${id8(cotId)}`)
    if (d.prestamoId) {
      await this.db(this.supabase.from('cliente_prestamos').delete().eq('id', d.prestamoId), 'limpiar préstamo E2E')
    }
    await this.cleanProduct(d.producto2Id, 'producto 2')
    await this.cleanProduct(d.productoId, 'producto 1')
    if (d.loteId) {
      await this.db(this.supabase.from('inventario_movimientos').delete().eq('lote_id', d.loteId), 'limpiar movimientos lote')
    }
    if (d.transportistaTestId) {
      await this.db(this.supabase.from('transportistas').update({ activo: false }).eq('id', d.transportistaTestId).eq('cuenta_id', this.user.id), 'desactivar transportista E2E')
    }
    if (d.clienteId) {
      await this.db(this.supabase.from('cliente_prestamos').delete().eq('cliente_id', d.clienteId), 'limpiar préstamos E2E')
      await this.db(this.supabase.from('seguimiento_operativo').delete().eq('cliente_id', d.clienteId), 'limpiar seguimientos E2E')
      await this.db(this.supabase.from('reasignaciones_clientes').delete().eq('cliente_id', d.clienteId), 'limpiar reasignaciones E2E')
      await this.db(this.supabase.from('cuentas_por_cobrar').delete().eq('cliente_id', d.clienteId).eq('cuenta_id', this.user.id), 'limpiar CxC E2E')
      await this.db(this.supabase.from('clientes').update({ saldo_pendiente: 0, activo: false }).eq('id', d.clienteId).eq('cuenta_id', this.user.id), 'desactivar cliente E2E')
    }
  }

  async preCleanup() {
    const products = await this.db(this.supabase.from('productos').select('id').in('codigo', [TEST.producto.codigo, TEST.producto2.codigo]), 'buscar productos residuales')
    for (const product of products || []) {
      const items = await this.db(this.supabase.from('cotizacion_items').select('cotizacion_id').eq('producto_id', product.id), 'buscar cotizaciones residuales')
      for (const { cotizacion_id: cotId } of items || []) await this.cleanCotizacion(cotId, `residual ${id8(cotId)}`)
      await this.cleanProduct(product.id, `producto residual ${id8(product.id)}`)
    }
    const clients = await this.db(this.supabase.from('clientes').select('id').eq('rif_cedula', TEST.cliente.rif_cedula).eq('cuenta_id', this.user.id), 'buscar clientes residuales')
    for (const client of clients || []) {
      // Si una corrida anterior eliminó el producto antes de completar la
      // limpieza, sus cotizaciones ya no aparecen al buscar por producto.
      // Recuperarlas por el fixture de cliente evita dejar despachos o
      // versiones huérfanas en staging.
      const residualQuotes = await this.db(
        this.supabase
          .from('cotizaciones')
          .select('id')
          .eq('cliente_id', client.id)
          .eq('cuenta_id', this.user.id)
          .order('version', { ascending: false })
          .order('creado_en', { ascending: false }),
        'buscar cotizaciones residuales por cliente'
      )
      for (const quote of residualQuotes || []) {
        await this.cleanCotizacion(quote.id, `residual ${id8(quote.id)}`)
      }
      await this.db(this.supabase.from('cliente_prestamos').delete().eq('cliente_id', client.id), 'limpiar préstamos residuales')
      await this.db(this.supabase.from('seguimiento_operativo').delete().eq('cliente_id', client.id), 'limpiar seguimientos residuales')
      await this.db(this.supabase.from('reasignaciones_clientes').delete().eq('cliente_id', client.id), 'limpiar reasignaciones residuales')
      await this.db(this.supabase.from('cuentas_por_cobrar').delete().eq('cliente_id', client.id).eq('cuenta_id', this.user.id), 'limpiar CxC residuales')
      await this.db(this.supabase.from('clientes').update({ saldo_pendiente: 0, activo: false }).eq('id', client.id).eq('cuenta_id', this.user.id), 'desactivar cliente residual')
    }
    await this.db(this.supabase.from('transportistas').update({ activo: false }).eq('nombre', TEST.transportista.nombre).eq('cuenta_id', this.user.id), 'desactivar transportistas residuales')
    // Usuarios fixture del split v3 que pudieron quedar de corridas
    // interrumpidas antes de llegar a su limpieza.
    for (const nombre of ['Vendedor E2E Designado', 'Jefe E2E Staging']) {
      const rows = await this.db(this.supabase.from('usuarios').select('id').eq('cuenta_id', this.user.id).eq('nombre', nombre), `buscar usuario split residual ${nombre}`)
      const ids = (rows || []).map(r => r.id)
      if (!ids.length) continue
      const delDesig = await this.supabase.from('comision_designacion_diaria').delete().in('designado_id', ids)
      if (delDesig.error) this.log(`Detalle limpieza designaciones residuales: ${delDesig.error.message}`, 'WARN')
      const delU = await this.supabase.from('usuarios').delete().in('id', ids)
      if (delU.error) this.log(`Detalle limpieza usuario split residual ${nombre}: ${delU.error.message}`, 'WARN')
      else this.log(`Usuario split residual eliminado: ${nombre}`, 'OK')
    }
    this.log(`Pre-limpieza completa (${products?.length || 0} productos, ${clients?.length || 0} clientes residuales)`, 'OK')
  }

  async assertStagingSchema() {
    const required = [
      ['configuracion_negocio', 'permitir_stock_negativo', '205_venta_anticipada.sql'],
      ['despacho_descuentos', 'despacho_id', '068_despacho_descuentos.sql / 238_sync_shared_schema.sql'],
      ['notas_despacho', 'entregada_en_ajustada', '241_cambio_fecha_entrega_despacho.sql'],
    ]
    const missing = []
    for (const [table, column, migration] of required) {
      const result = await this.supabase.from(table).select(column).limit(1)
      if (result.error) missing.push(`${table}.${column} → ${migration}`)
    }
    if (missing.length) {
      throw new Error(`Esquema staging incompleto; aplicar antes de repetir el E2E: ${missing.join('; ')}`)
    }
    this.log('Columnas requeridas para entrega, descuentos y fecha efectiva presentes ✓', 'OK')
  }

  async createClient() {
    const payload = { ...TEST.cliente, vendedor_id: this.salesperson.id, cuenta_id: this.user.id, activo: true, saldo_pendiente: 0 }
    const existing = await this.db(this.supabase.from('clientes').select('id').eq('rif_cedula', TEST.cliente.rif_cedula).eq('cuenta_id', this.user.id).maybeSingle(), 'buscar cliente E2E')
    if (existing) {
      const client = await this.db(this.supabase.from('clientes').update(payload).eq('id', existing.id).eq('cuenta_id', this.user.id).select('id').single(), 'reactivar cliente E2E')
      this.data.clienteId = client.id
      return
    }
    const client = await this.db(this.supabase.from('clientes').insert(payload).select('id').single(), 'crear cliente E2E')
    this.data.clienteId = client.id
  }

  async createDraft() {
    const result = await this.api('/api/cotizaciones/guardar', 'POST', {
      headerData: { cliente_id: this.data.clienteId, vendedor_id: this.salesperson.id, notas_cliente: 'Test determinista', notas_internas: 'Generado por tester', descuento_global_pct: 0, costo_envio_usd: 10, subtotal_usd: 250, descuento_usd: 0, total_usd: 260 },
      items: [{ producto_id: this.data.productoId, codigo_snap: TEST.producto.codigo, nombre_snap: TEST.producto.nombre, unidad_snap: TEST.producto.unidad, cantidad: 10, precio_unit_usd: 25, descuento_pct: 0, total_linea_usd: 250 }],
    }, this.salesperson.id)
    this.data.cotizacionId = result.id
  }

  async createSecondDraft() {
    const result = await this.api('/api/cotizaciones/guardar', 'POST', {
      headerData: { cliente_id: this.data.clienteId, vendedor_id: this.salesperson.id, descuento_global_pct: 0, costo_envio_usd: 0, subtotal_usd: 125, descuento_usd: 0, total_usd: 125 },
      items: [{ producto_id: this.data.producto2Id, codigo_snap: TEST.producto2.codigo, nombre_snap: TEST.producto2.nombre, unidad_snap: TEST.producto2.unidad, cantidad: 5, precio_unit_usd: 25, descuento_pct: 0, total_linea_usd: 125 }],
    }, this.salesperson.id)
    this.data.cotizacion2Id = result.id
  }

  async runStep(step, fn) {
    this.log(`═══ INICIO: ${step.label} ═══`, 'INFO', step.label)
    const started = Date.now()
    try {
      await fn()
      const duration = Date.now() - started
      this.results.push({ id: step.id, status: 'pass', duration })
      this.log(`═══ PASS: ${step.label} (${duration}ms) ═══`, 'PASS', step.label)
    } catch (error) {
      const duration = Date.now() - started
      this.results.push({ id: step.id, status: 'fail', duration, error: error.message })
      this.log(`═══ FAIL: ${step.label} (${duration}ms) ═══\nError: ${error.message}\nStack: ${error.stack || 'N/A'}`, 'FAIL', step.label)
      throw error
    }
  }

  async execute() {
    const d = this.data
    const dbSingle = async (table, columns, id) => this.db(this.supabase.from(table).select(columns).eq('id', id).single(), `${table} ${id8(id)}`)
    const assertStock = async (expected, label) => {
      const product = await dbSingle('productos', 'stock_actual', d.productoId)
      assert(Number(product.stock_actual) === expected, expected, product.stock_actual, label)
      return Number(product.stock_actual)
    }
    const rpcProduct = async (product) => { const id = await this.productRpc(product); return id }

    const fns = {
      pre_cleanup: () => this.preCleanup(),
      create_product: async () => { d.productoId = await rpcProduct(TEST.producto); this.log(`productoId=${id8(d.productoId)}`) },
      assert_product: async () => {
        const p = await dbSingle('productos', '*', d.productoId)
        for (const [key, expected] of Object.entries({ codigo: TEST.producto.codigo, nombre: TEST.producto.nombre, precio_usd: 25, costo_usd: 15, stock_actual: 100, stock_minimo: 5, activo: true })) assert(key === 'activo' ? p[key] === expected : (typeof expected === 'number' ? Number(p[key]) === expected : p[key] === expected), expected, p[key], `producto.${key}`)
      },
      assert_kardex_ingreso: async () => {
        const rows = await this.db(this.supabase.from('inventario_movimientos').select('tipo,cantidad,stock_anterior,stock_nuevo').eq('producto_id', d.productoId).eq('tipo', 'ingreso').order('creado_en', { ascending: false }).limit(1), 'kardex ingreso')
        assert(rows?.length === 1, 1, rows?.length, 'ingreso inicial')
        assert(Number(rows[0].cantidad) === 100 && Number(rows[0].stock_anterior) === 0 && Number(rows[0].stock_nuevo) === 100, '0→100', `${rows[0].stock_anterior}→${rows[0].stock_nuevo}`, 'kardex ingreso 0→100')
      },
      create_client: () => this.createClient(),
      assert_client: async () => { const c = await dbSingle('clientes', 'nombre,rif_cedula,saldo_pendiente,vendedor_id,activo', d.clienteId); assert(c.nombre === TEST.cliente.nombre, TEST.cliente.nombre, c.nombre, 'cliente.nombre'); assert(c.rif_cedula === TEST.cliente.rif_cedula, TEST.cliente.rif_cedula, c.rif_cedula, 'cliente.rif_cedula'); assert(Number(c.saldo_pendiente) === 0, 0, c.saldo_pendiente, 'cliente.saldo_pendiente'); assert(c.vendedor_id === this.salesperson.id, this.operator.id, c.vendedor_id, 'cliente.vendedor_id'); assert(c.activo === true, true, c.activo, 'cliente.activo') },
      create_draft: () => this.createDraft(),
      assert_draft: async () => { const c = await dbSingle('cotizaciones', 'numero,estado,subtotal_usd,descuento_usd,descuento_global_pct,costo_envio_usd,total_usd,cliente_id,vendedor_id', d.cotizacionId); d.cotizacionNumero = c.numero; assert(c.estado === 'borrador', 'borrador', c.estado, 'cotización.estado'); assert(Number(c.subtotal_usd) === 250 && Number(c.total_usd) === 260, '$250/$260', `${c.subtotal_usd}/$${c.total_usd}`, 'totales cotización'); assert(c.cliente_id === d.clienteId, d.clienteId, c.cliente_id, 'cotización.cliente_id'); assert(c.vendedor_id === this.salesperson.id, this.operator.id, c.vendedor_id, 'cotización.vendedor_id') },
      assert_items: async () => { const rows = await this.db(this.supabase.from('cotizacion_items').select('producto_id,cantidad,precio_unit_usd,total_linea_usd,codigo_snap').eq('cotizacion_id', d.cotizacionId), 'items cotización'); assert(rows?.length === 1, 1, rows?.length, 'items cotización'); const item = rows[0]; assert(Number(item.cantidad) === 10 && Number(item.precio_unit_usd) === 25 && Number(item.total_linea_usd) === 250, '10×25=$250', item, 'item cotización'); assert(item.producto_id === d.productoId, d.productoId, item.producto_id, 'item.producto_id') },
      assert_stock_comprometido_pre: async () => assert(await this.stockCommitted() === 0, 0, await this.stockCommitted(), 'stock comprometido borrador'),
      send_quote: async () => { await this.api('/api/cotizaciones/enviar', 'POST', { cotizacionId: d.cotizacionId, tasaBcv: 100 }, this.salesperson.id) },
      assert_sent: async () => { const c = await dbSingle('cotizaciones', 'estado,enviada_en', d.cotizacionId); assert(c.estado === 'enviada', 'enviada', c.estado, 'cotización enviada'); assert(!!c.enviada_en, 'no null', c.enviada_en, 'enviada_en') },
      accept_quote: async () => { await this.db(this.supabase.from('cotizaciones').update({ estado: 'aceptada' }).eq('id', d.cotizacionId), 'aceptar cotización') },
      assert_accepted: async () => { const c = await dbSingle('cotizaciones', 'estado', d.cotizacionId); assert(c.estado === 'aceptada', 'aceptada', c.estado, 'cotización aceptada') },
      assert_stock_comprometido_aceptada: async () => assert(await this.stockCommitted() === 0, 0, await this.stockCommitted(), 'stock comprometido aceptada'),
      create_despacho: async () => { const result = await this.api('/api/despachos/crear', 'POST', { cotizacionId: d.cotizacionId, formaPago: 'Cta por cobrar', transportistaId: null, fleteUsd: 10 }, this.salesperson.id); d.despachoId = result.id; d.despachoNumero = result.numero },
      assert_despacho: async () => { const des = await dbSingle('notas_despacho', 'estado,total_usd,forma_pago,cotizacion_id,cliente_id', d.despachoId); assert(des.estado === 'pendiente', 'pendiente', des.estado, 'despacho.estado'); assert(Number(des.total_usd) === 260, 260, des.total_usd, 'despacho.total_usd'); assert(des.forma_pago === 'Cta por cobrar', 'Cta por cobrar', des.forma_pago, 'despacho.forma_pago'); assert(des.cotizacion_id === d.cotizacionId && des.cliente_id === d.clienteId, 'IDs correctos', des, 'despacho referencias') },
      assert_stock_post: () => assertStock(100, 'stock pendiente'),
      assert_kardex_egreso: async () => { const rows = await this.db(this.supabase.from('inventario_movimientos').select('tipo').eq('producto_id', d.productoId), 'kardex pendiente'); assert(!(rows || []).some(row => row.tipo === 'egreso'), 0, rows?.filter(row => row.tipo === 'egreso').length, 'egreso antes de entrega') },
      assert_stock_comprometido_post: async () => assert(await this.stockCommitted() === 0, 0, await this.stockCommitted(), 'stock comprometido pendiente'),
      assert_cxc_cargo: async () => { const rows = await this.db(this.supabase.from('cuentas_por_cobrar').select('id').eq('despacho_id', d.despachoId).eq('tipo', 'cargo'), 'CxC pendiente'); assert(rows?.length === 0, 0, rows?.length, 'CxC antes de aprobar') },
      apply_descuento: async () => { const item = await this.db(this.supabase.from('cotizacion_items').select('id').eq('cotizacion_id', d.cotizacionId).single(), 'item para descuento'); d.cotizacionItemId = item.id; d.descuentoTotal = 20; await this.api('/api/despachos/descuentos', 'POST', { despachoId: d.despachoId, descuentos: [{ cotizacionItemId: item.id, tipo: 'monto_unitario', valor: 2 }] }) },
      assert_descuento: async () => { const des = await dbSingle('notas_despacho', 'descuento_total_usd', d.despachoId); assert(Number(des.descuento_total_usd) === 20, 20, des.descuento_total_usd, 'descuento_total_usd'); const rows = await this.api(`/api/despachos/${d.despachoId}/descuentos`); assert(rows?.length === 1, 1, rows?.length, 'descuentos registrados'); assert(rows[0].cotizacion_item_id === d.cotizacionItemId && rows[0].tipo === 'monto_unitario' && Number(rows[0].monto_usd) === 20, 'descuento $20', rows[0], 'descuento persistido'); },
      mark_dispatched: async () => { await this.api('/api/despachos/estado', 'POST', { despachoId: d.despachoId, nuevoEstado: 'despachada' }) },
      assert_dispatched: async () => { const des = await dbSingle('notas_despacho', 'estado,despachada_en', d.despachoId); assert(des.estado === 'despachada', 'despachada', des.estado, 'despacho aprobado'); assert(!!des.despachada_en, 'no null', des.despachada_en, 'despachada_en') },
      assert_stock_comprometido_aprobado: async () => { const committed = await this.stockCommitted(); assert(committed === 10, 10, committed, 'stock comprometido aprobado'); const cxc = await this.db(this.supabase.from('cuentas_por_cobrar').select('monto_usd').eq('despacho_id', d.despachoId).eq('tipo', 'cargo'), 'CxC aprobado'); assert(cxc?.length === 1, 1, cxc?.length, 'cargo CxC'); assert(Number(cxc[0].monto_usd) === 240, 240, cxc[0].monto_usd, 'cargo CxC neto'); const client = await dbSingle('clientes', 'saldo_pendiente', d.clienteId); assert(Number(client.saldo_pendiente) === 240, 240, client.saldo_pendiente, 'saldo CxC aprobado') },
      mark_delivered: async () => { await this.api('/api/despachos/estado', 'POST', { despachoId: d.despachoId, nuevoEstado: 'entregada' }) },
      assert_delivered: async () => { const des = await dbSingle('notas_despacho', 'estado,entregada_en', d.despachoId); assert(des.estado === 'entregada', 'entregada', des.estado, 'despacho entregado'); assert(!!des.entregada_en, 'no null', des.entregada_en, 'entregada_en') },
      assert_stock_comprometido_entregado: async () => assert(await this.stockCommitted() === 0, 0, await this.stockCommitted(), 'stock comprometido entregado'),
      assert_commission: async () => {
        const config = await this.db(this.supabase.from('configuracion_negocio').select('comision_pct_cabilla,comision_pct_otros,comision_categoria_cabilla').eq('cuenta_id', this.user.id).limit(1).maybeSingle(), 'config comisión')
        const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.despachoId), 'comisión')
        assert(rows?.length === 1, 1, rows?.length, 'comisión generada')
        const commission = rows[0]
        d.comisionId = commission.id
        const isCabilla = TEST.producto.categoria.toLowerCase() === String(config?.comision_categoria_cabilla || '').toLowerCase().trim()
        const pct = Number(isCabilla ? config?.comision_pct_cabilla : config?.comision_pct_otros)
        const expected = round2(230 * pct / 100)
        const field = isCabilla ? 'comisioncabilla' : 'comisionotros'
        const contract = commissionStateContract(commission)
        assert(Number(commission[field]) === expected && Number(commission.totalcomision) === expected, expected, commission, 'comisión neta')
        assert(commission.estado === contract.expectedState && commission.vendedorid === this.salesperson.id, contract.expectedState, commission, 'comisión metadata')
      },
      pay_commission: async () => {
        const commission = await dbSingle('comisiones', 'estado,comision_liberada,comision_retenida,totalcomision', d.comisionId)
        if (commissionStateContract(commission).requiresManualRelease) {
          await this.api('/api/comisiones/liberar-cxc', 'POST', { comisionId: d.comisionId })
        }
        await this.api('/api/comisiones/pagar', 'POST', { comisionId: d.comisionId })
      },
      assert_commission_paid: async () => { const row = await dbSingle('comisiones', 'estado,pagadaen', d.comisionId); assert(row.estado === 'pagada', 'pagada', row.estado, 'comisión pagada'); assert(!!row.pagadaen, 'no null', row.pagadaen, 'comisión.pagadaen') },
      register_payment: async () => { d.montoAbono = 100; await this.api('/api/cxc/abono', 'POST', { clienteId: d.clienteId, monto: 100, formaPago: 'Transf. / Pago Móvil', referencia: 'TEST-DET-001', descripcion: 'Abono test determinista' }) },
      assert_cxc_abono: async () => { const client = await dbSingle('clientes', 'saldo_pendiente', d.clienteId); assert(round2(Number(client.saldo_pendiente)) === 140, 140, client.saldo_pendiente, 'saldo post-abono'); const rows = await this.db(this.supabase.from('cuentas_por_cobrar').select('monto_usd').eq('cliente_id', d.clienteId).eq('tipo', 'abono'), 'abono CxC'); assert((rows || []).some(row => Number(row.monto_usd) === 100), 100, rows, 'abono CxC') },
      assert_report_ventas: async () => { const row = await dbSingle('notas_despacho', 'total_usd,estado,forma_pago', d.despachoId); assert(row.estado === 'entregada' && Number(row.total_usd) === 260 && row.forma_pago === 'Cta por cobrar', 'despacho entregado $260', row, 'reporte ventas') },
      assert_report_pipeline: async () => { const row = await dbSingle('cotizaciones', 'estado,total_usd', d.cotizacionId); assert(row.estado === 'aceptada' && Number(row.total_usd) === 260, 'aceptada/$260', row, 'reporte pipeline') },
      assert_report_inventario: async () => { const row = await dbSingle('productos', 'stock_actual,activo', d.productoId); assert(Number(row.stock_actual) === 90 && row.activo === true, 'stock 90/activo', row, 'reporte inventario') },
      create_transportista: async () => { const row = await this.db(this.supabase.from('transportistas').insert({ ...TEST.transportista, cuenta_id: this.user.id, activo: true }).select('id').single(), 'crear transportista'); d.transportistaTestId = row.id },
      assert_transportista: async () => { const row = await dbSingle('transportistas', 'nombre,rif,activo,es_local,tipo_relacion', d.transportistaTestId); assert(row.nombre === TEST.transportista.nombre && row.rif === TEST.transportista.rif && row.activo === true && row.es_local === true && row.tipo_relacion === 'contratista', 'transportista local', row, 'transportista') },
      create_product_2: async () => { d.producto2Id = await rpcProduct(TEST.producto2) },
      assert_product_2_prices: async () => { const row = await dbSingle('productos', 'precio_usd,precio_2,precio_3,stock_actual', d.producto2Id); assert(Number(row.precio_usd) === 40 && Number(row.precio_2) === 38 && Number(row.precio_3) === 35 && Number(row.stock_actual) === 50, '40/38/35/50', row, 'producto 2 multi-precio') },
      apply_inventory_batch: async () => { const result = await this.api('/api/inventario/movimiento', 'POST', { tipo: 'ingreso', motivo: TEST.movimientoLote.motivo, motivo_tipo: 'ajuste_inventario', items: [{ producto_id: d.productoId, cantidad: 20 }] }); d.loteId = result.lote_id },
      assert_inventory_batch: async () => { await assertStock(110, 'stock tras lote'); const rows = await this.db(this.supabase.from('inventario_movimientos').select('tipo,cantidad').eq('lote_id', d.loteId), 'kardex lote'); assert((rows || []).some(row => row.tipo === 'ingreso' && Number(row.cantidad) === 20), 'ingreso +20', rows, 'movimiento lote') },
      create_draft_for_anular: () => this.createSecondDraft(),
      send_quote_for_anular: async () => { await this.api('/api/cotizaciones/enviar', 'POST', { cotizacionId: d.cotizacion2Id, tasaBcv: 100 }, this.salesperson.id) },
      anular_cotizacion: async () => { await this.db(this.supabase.from('cotizaciones').update({ estado: 'anulada' }).eq('id', d.cotizacion2Id), 'anular cotización') },
      assert_anulada: async () => { const row = await dbSingle('cotizaciones', 'estado', d.cotizacion2Id); assert(row.estado === 'anulada', 'anulada', row.estado, 'cotización anulada') },
      reciclar_cotizacion: async () => { const result = await this.api('/api/cotizaciones/reciclar', 'POST', { cotizacionId: d.cotizacion2Id, vendedorDestinoId: this.salesperson.id }); d.cotizacionRecicladaId = result.id },
      assert_reciclada: async () => { const row = await dbSingle('cotizaciones', 'estado,cliente_id,vendedor_id', d.cotizacionRecicladaId); assert(row.estado === 'borrador' && row.cliente_id === d.clienteId && row.vendedor_id === this.salesperson.id, 'borrador/referencias', row, 'cotización reciclada'); const rows = await this.db(this.supabase.from('cotizacion_items').select('id').eq('cotizacion_id', d.cotizacionRecicladaId), 'items reciclados'); assert(rows?.length > 0, '>0', rows?.length, 'items reciclados') },
      crear_version: async () => { await this.api('/api/cotizaciones/enviar', 'POST', { cotizacionId: d.cotizacionRecicladaId, tasaBcv: 100 }, this.salesperson.id); const result = await this.api('/api/cotizaciones/crear-version', 'POST', { cotizacionId: d.cotizacionRecicladaId, notasCambio: 'Versión de prueba determinista' }, this.salesperson.id); d.cotizacionVersionId = result.id },
      assert_version: async () => { const row = await dbSingle('cotizaciones', 'estado,version,cotizacion_raiz_id', d.cotizacionVersionId); assert(row.estado === 'borrador' && Number(row.version) >= 2 && !!row.cotizacion_raiz_id, 'borrador/version/lineaje', row, 'versión') },
      venta_rapida: async () => { const result = await this.api('/api/ventas-rapidas/crear', 'POST', { clienteId: d.clienteId, transportistaId: d.transportistaTestId, fleteUsd: 50, formaPago: 'Efectivo $', formaPagoCliente: '', referenciaPago: 'REF-TEST-VR', notas: 'Venta rápida determinista', notasCliente: '', direccionEnvioEstado: 'Aragua', direccionEnvioCiudad: 'Maracay', items: [{ productoId: d.productoId, cantidad: 5, precioUnitUsd: 25 }], descuentoGlobalPct: 0, costoEnvioUsd: 0, tasaBcv: 100 }, this.salesperson.id); d.ventaRapidaDespachoId = result.id; d.ventaRapidaCotizacionId = result.cotizacionId },
      assert_vr_cotizacion: async () => { const row = await dbSingle('cotizaciones', 'estado,total_usd', d.ventaRapidaCotizacionId); assert(row.estado === 'aceptada' && Number(row.total_usd) === 175, 'aceptada/$175', row, 'venta rápida cotización') },
      assert_vr_despacho: async () => { const row = await dbSingle('notas_despacho', 'estado,forma_pago,total_usd,transportista_id,flete_usd,flete_neto_transportista_usd,flete_comisionable,flete_regla_aplicada,flete_estado_destino_snapshot,flete_pagado', d.ventaRapidaDespachoId); assert(row.estado === 'pendiente' && row.forma_pago === 'Efectivo $' && Number(row.total_usd) === 175 && row.transportista_id === d.transportistaTestId && Number(row.flete_usd) === 50 && Number(row.flete_neto_transportista_usd) > 0 && row.flete_comisionable === true && row.flete_regla_aplicada === 'comision_fuera_carabobo' && row.flete_estado_destino_snapshot === 'Aragua' && row.flete_pagado === false, 'VR despacho fuera de Carabobo', row, 'venta rápida despacho'); d.transportistaNeto = Number(row.flete_neto_transportista_usd) },
      assert_transportista_report: async () => { const result = await this.api('/api/transportistas/reporte'); const row = (result.items || []).find(item => item.id === d.transportistaTestId); assert(!!row, 'transportista en reporte', row, 'reporte transportistas'); assert(row.es_local === true && Number(row.despachos) >= 1 && Number(row.despachos_comisionables) >= 1 && Number(row.flete_total_usd) >= 50 && Number(row.saldo_usd) >= d.transportistaNeto - 0.01 && Number(row.flete_nomina_usd || 0) === 0, 'reporte transportista externo', row, 'reporte transportista') },
      assert_stock_post_vr: () => assertStock(110, 'stock VR pendiente'),
      anular_despacho: async () => { await this.api('/api/despachos/estado', 'POST', { despachoId: d.ventaRapidaDespachoId, nuevoEstado: 'anulada' }) },
      assert_despacho_anulado: async () => { const row = await dbSingle('notas_despacho', 'estado', d.ventaRapidaDespachoId); assert(row.estado === 'anulada', 'anulada', row.estado, 'VR anulada'); await assertStock(110, 'stock tras anular VR') },
      reciclar_despacho: async () => { const result = await this.api('/api/despachos/reciclar', 'POST', { despachoId: d.ventaRapidaDespachoId }); d.cotizacionDesdeDespachoId = result.id },
      assert_despacho_reciclado: async () => { const row = await dbSingle('cotizaciones', 'estado,cliente_id', d.cotizacionDesdeDespachoId); assert(row.estado === 'borrador' && row.cliente_id === d.clienteId, 'borrador/cliente', row, 'cotización desde despacho'); const rows = await this.db(this.supabase.from('cotizacion_items').select('id').eq('cotizacion_id', d.cotizacionDesdeDespachoId), 'items desde despacho'); assert(rows?.length > 0, '>0', rows?.length, 'items desde despacho') },
      reasignar_cliente: async () => { const sellers = await this.db(this.supabase.from('usuarios').select('id').eq('rol', 'vendedor').eq('activo', true).limit(10), 'buscar vendedor alterno'); const alternate = (sellers || []).find(row => row.id !== this.salesperson.id); if (!alternate) { this.log('SKIP: no hay vendedor alterno en staging', 'WARN'); return } d.otroVendedorId = alternate.id; await this.api('/api/clientes/reasignar', 'POST', { clienteId: d.clienteId, nuevoVendedorId: alternate.id, motivo: TEST.reasignacion.motivo }) },
      assert_reasignacion: async () => { if (!d.otroVendedorId) { this.log('SKIP: reasignación no ejecutada porque no había vendedor alterno', 'WARN'); return } const row = await dbSingle('clientes', 'vendedor_id,ultima_reasig_motivo', d.clienteId); assert(row.vendedor_id === d.otroVendedorId && row.ultima_reasig_motivo === TEST.reasignacion.motivo, 'vendedor/motivo', row, 'reasignación') },
      health_api_endpoints: async () => { for (const route of ['/api/config', '/api/comisiones/config']) { const value = await this.api(route); assert(value !== null && value !== undefined, 'respuesta', value, route); this.log(`${route} → OK ✓`, 'OK') } },
      health_rls_policies: async () => { for (const table of ['productos', 'clientes', 'usuarios', 'cotizaciones', 'transportistas', 'inventario_movimientos']) { const result = await this.supabase.from(table).select('id', { count: 'exact', head: true }).limit(1); if (result.error) throw new Error(`RLS ${table}: ${result.error.message}`); this.log(`${table}: accesible (${result.count ?? 0} filas) ✓`) } },
      health_config: async () => { const cfg = await this.db(this.supabase.from('configuracion_negocio').select('comision_pct_cabilla,comision_pct_otros,comision_categoria_cabilla').limit(1).maybeSingle(), 'configuración'); assert(cfg !== null, 'registro', cfg, 'configuración existe'); for (const key of ['comision_pct_cabilla', 'comision_pct_otros', 'comision_categoria_cabilla']) assert(cfg[key] !== null && cfg[key] !== undefined, 'definido', cfg[key], `config.${key}`) },
      health_nav_routes: async () => { for (const route of ['/', '/cotizaciones', '/clientes', '/inventario', '/despachos', '/configuracion', '/reportes', '/tester']) { const response = await fetch(`${this.config.frontendOrigin}${route}`, { headers: { Accept: 'text/html' } }); assert(response.ok, 200, response.status, `ruta ${route}`) } },
      health_kardex_continuity: async () => { const rows = await this.db(this.supabase.from('inventario_movimientos').select('tipo,cantidad,stock_anterior,stock_nuevo').order('creado_en', { ascending: false }).limit(100), 'continuidad Kardex'); const invalid = (rows || []).filter(row => { const delta = row.tipo === 'ingreso' ? Number(row.cantidad) : -Number(row.cantidad); return Math.abs(round2(Number(row.stock_anterior) + delta) - Number(row.stock_nuevo)) > 0.01 }); assert(invalid.length === 0, 0, invalid.length, 'continuidad matemática Kardex') },
      health_stock_negativo_guard: async () => { const row = await dbSingle('productos', 'stock_actual', d.productoId); assert(Number(row.stock_actual) >= 0, '>=0', row.stock_actual, 'stock operativo no negativo') },
      cleanup: async () => { if (this.config.keepData) { this.log('SKIP por --keep-data: los fixtures quedan para diagnóstico manual', 'WARN'); return } await this.cleanupFixtures() },
      assert_cleanup: async () => { if (this.config.keepData) { this.log('SKIP por --keep-data', 'WARN'); return } const checks = [['productos', d.productoId], ['productos', d.producto2Id], ['cotizaciones', d.cotizacionId], ['cotizaciones', d.cotizacion2Id], ['notas_despacho', d.despachoId], ['notas_despacho', d.ventaRapidaDespachoId]]; for (const [table, id] of checks) { if (!id) continue; const rows = await this.db(this.supabase.from(table).select('id').eq('id', id), `verificar limpieza ${table}`); assert(!rows?.length, 0, rows?.length, `${table}.${id8(id)} eliminado`) } const client = await this.db(this.supabase.from('clientes').select('activo').eq('id', d.clienteId), 'verificar cliente limpieza'); assert(!client?.length || client[0].activo === false, 'inactivo/eliminado', client?.[0]?.activo, 'cliente E2E limpio') },
    }

    for (const step of STEPS) await this.runStep(step, fns[step.id] || (async () => { this.log(`SKIP ${step.id}: no implementado en modo legacy`, 'WARN') }))
  }

  async run() {
    const started = Date.now()
    await this.initLog()
    this.log('╔══════════════════════════════════════════════════════════════╗')
    this.log('║  TESTER E2E AUTOMÁTICO — SOLO STAGING                       ║')
    this.log('╚══════════════════════════════════════════════════════════════╝')
    this.log(`Proyecto esperado: ${STAGING_PROJECT_REF}; frontend: ${this.config.frontendOrigin}; worker: ${this.config.workerOrigin}`)
    this.log(`Fixtures: ${TEST.producto.codigo}, ${TEST.producto2.codigo}, ${TEST.cliente.rif_cedula}`)
    let failure = null
    let cleanupAttempted = false
    try {
      await this.ping()
      await this.auth()
      await this.runStep(STEPS[0], () => this.preCleanup())
      for (const step of STEPS.slice(1, -2)) await this.runStep(step, this.executeStep.bind(this, step.id))
      // executeStep is replaced below by the map created in execute(); this branch is never used.
      throw new Error('Runner interno no inicializado')
    } catch (error) {
      failure = error
    }
    // The actual sequence is run separately so every failure path shares cleanup.
    if (!failure) {
      try { await this.execute() } catch (error) { failure = error }
    }
    if (failure && !cleanupAttempted && !this.config.keepData && this.user && Object.keys(this.data).length > 0) {
      cleanupAttempted = true
      try {
        this.log('Limpieza de emergencia tras fallo...', 'WARN')
        await this.cleanupFixtures()
        this.log('Limpieza de emergencia completada', 'OK')
      } catch (cleanupError) {
        this.log(`Limpieza de emergencia incompleta: ${cleanupError.message}`, 'FAIL')
      }
    }
    const passed = this.results.filter(result => result.status === 'pass').length
    const failed = this.results.filter(result => result.status === 'fail').length
    const resultText = failure ? `FALLÓ: ${failure.message}` : 'TODOS LOS PASOS PASARON ✓'
    this.log(`\nResultado: ${resultText}`)
    this.log(`Pasos pasados: ${passed}/${STEPS.length}; fallidos: ${failed}; tiempo: ${((Date.now() - started) / 1000).toFixed(2)}s`)
    this.log(`Log persistido en: ${this.logFile}`, 'OK')
    await this.persist()
    return { ok: !failure, failure, passed, failed, logFile: this.logFile }
  }

  async executeStep(id) {
    // This method is populated by execute's local map through the bound registry.
    if (!this._fns?.[id]) throw new Error(`Paso no implementado: ${id}`)
    return this._fns[id]()
  }
}

// Replace the small orchestration shim with a deterministic implementation that
// keeps cleanup outside the 75-step sequence and does not execute a fixture twice.
const originalExecute = StagingE2ERunner.prototype.execute
StagingE2ERunner.prototype.execute = async function executeDeterministic() {
  const d = this.data
  const dbSingle = async (table, columns, id) => this.db(this.supabase.from(table).select(columns).eq('id', id).single(), `${table} ${id8(id)}`)
  const assertStock = async (expected, label) => { const row = await dbSingle('productos', 'stock_actual', d.productoId); assert(Number(row.stock_actual) === expected, expected, row.stock_actual, label) }
  const f = {}
  f.pre_cleanup = () => this.preCleanup()
  f.assert_staging_schema = () => this.assertStagingSchema()
  f.create_product = async () => { d.productoId = await this.productRpc(TEST.producto) }
  f.assert_product = async () => { const p = await dbSingle('productos', '*', d.productoId); assert(p.codigo === TEST.producto.codigo && p.nombre === TEST.producto.nombre && Number(p.precio_usd) === 25 && Number(p.costo_usd) === 15 && Number(p.stock_actual) === 100 && Number(p.stock_minimo) === 5 && p.activo === true, 'producto exacto', sanitize(p), 'producto') }
  f.assert_kardex_ingreso = async () => { const rows = await this.db(this.supabase.from('inventario_movimientos').select('tipo,cantidad,stock_anterior,stock_nuevo').eq('producto_id', d.productoId).eq('tipo', 'ingreso').order('creado_en', { ascending: false }).limit(1), 'kardex ingreso'); assert(rows?.length === 1, 1, rows?.length, 'ingreso inicial'); assert(Number(rows[0].cantidad) === 100 && Number(rows[0].stock_anterior) === 0 && Number(rows[0].stock_nuevo) === 100, '0→100', rows[0], 'kardex 0→100') }
  f.create_client = () => this.createClient()
  f.assert_client = async () => { const c = await dbSingle('clientes', 'nombre,rif_cedula,saldo_pendiente,vendedor_id,activo', d.clienteId); assert(c.nombre === TEST.cliente.nombre && c.rif_cedula === TEST.cliente.rif_cedula && Number(c.saldo_pendiente) === 0 && c.vendedor_id === this.salesperson.id && c.activo === true, 'cliente exacto', c, 'cliente') }
  f.search_improved = async () => {
    const byRif = await this.api(`/api/clientes?busqueda=${encodeURIComponent('j888888880')}`)
    assert(Array.isArray(byRif) && byRif.some(row => row.id === d.clienteId), true, byRif, 'búsqueda cliente por RIF compacto')
    const byTypo = await this.api(`/api/clientes?busqueda=${encodeURIComponent('determinista clente')}`)
    assert(Array.isArray(byTypo) && byTypo.some(row => row.id === d.clienteId), true, byTypo, 'búsqueda cliente con typo')
    this.log('Búsqueda API: RIF compacto + typo de nombre ✓', 'OK')
  }
  f.create_draft = () => this.createDraft()
  f.assert_draft = async () => { const c = await dbSingle('cotizaciones', 'numero,estado,subtotal_usd,descuento_usd,descuento_global_pct,costo_envio_usd,total_usd,cliente_id,vendedor_id', d.cotizacionId); d.cotizacionNumero = c.numero; assert(c.estado === 'borrador' && Number(c.subtotal_usd) === 250 && Number(c.descuento_usd) === 0 && Number(c.descuento_global_pct) === 0 && Number(c.costo_envio_usd) === 10 && Number(c.total_usd) === 260 && c.cliente_id === d.clienteId && c.vendedor_id === this.salesperson.id, 'cotización $260', c, 'cotización borrador') }
  f.assert_items = async () => { const rows = await this.db(this.supabase.from('cotizacion_items').select('producto_id,cantidad,precio_unit_usd,total_linea_usd,codigo_snap').eq('cotizacion_id', d.cotizacionId), 'items cotización'); assert(rows?.length === 1 && rows[0].producto_id === d.productoId && Number(rows[0].cantidad) === 10 && Number(rows[0].precio_unit_usd) === 25 && Number(rows[0].total_linea_usd) === 250, 'item 10×$25', rows, 'items cotización') }
  f.assert_stock_comprometido_pre = async () => { const n = await this.stockCommitted(); assert(n === 0, 0, n, 'comprometido borrador') }
  f.send_quote = async () => { await this.api('/api/cotizaciones/enviar', 'POST', { cotizacionId: d.cotizacionId, tasaBcv: 100 }, this.salesperson.id) }
  f.assert_sent = async () => { const c = await dbSingle('cotizaciones', 'estado,enviada_en', d.cotizacionId); assert(c.estado === 'enviada' && !!c.enviada_en, 'enviada', c, 'cotización enviada') }
  f.accept_quote = async () => { await this.db(this.supabase.from('cotizaciones').update({ estado: 'aceptada' }).eq('id', d.cotizacionId), 'aceptar cotización') }
  f.assert_accepted = async () => { const c = await dbSingle('cotizaciones', 'estado', d.cotizacionId); assert(c.estado === 'aceptada', 'aceptada', c.estado, 'cotización aceptada') }
  f.assert_stock_comprometido_aceptada = async () => { const n = await this.stockCommitted(); assert(n === 0, 0, n, 'comprometido aceptada') }
  f.create_despacho = async () => { const r = await this.api('/api/despachos/crear', 'POST', { cotizacionId: d.cotizacionId, formaPago: 'Cta por cobrar', transportistaId: null, fleteUsd: 10 }, this.salesperson.id); d.despachoId = r.id; d.despachoNumero = r.numero }
  f.assert_despacho = async () => { const row = await dbSingle('notas_despacho', 'estado,total_usd,forma_pago,cotizacion_id,cliente_id', d.despachoId); assert(row.estado === 'pendiente' && Number(row.total_usd) === 260 && row.forma_pago === 'Cta por cobrar' && row.cotizacion_id === d.cotizacionId && row.cliente_id === d.clienteId, 'despacho pendiente $260', row, 'despacho') }
  f.assert_stock_post = () => assertStock(100, 'stock pendiente')
  f.assert_kardex_egreso = async () => { const rows = await this.db(this.supabase.from('inventario_movimientos').select('tipo').eq('producto_id', d.productoId), 'kardex pendiente'); assert(!(rows || []).some(row => row.tipo === 'egreso'), 0, rows, 'sin egreso pendiente') }
  f.assert_stock_comprometido_post = async () => { const n = await this.stockCommitted(); assert(n === 0, 0, n, 'comprometido pendiente') }
  f.assert_cxc_cargo = async () => { const rows = await this.db(this.supabase.from('cuentas_por_cobrar').select('id').eq('despacho_id', d.despachoId).eq('tipo', 'cargo'), 'CxC pendiente'); assert(!rows?.length, 0, rows?.length, 'CxC pendiente') }
  f.apply_descuento = async () => { const item = await this.db(this.supabase.from('cotizacion_items').select('id').eq('cotizacion_id', d.cotizacionId).single(), 'item descuento'); d.cotizacionItemId = item.id; d.descuentoTotal = 20; await this.api('/api/despachos/descuentos', 'POST', { despachoId: d.despachoId, descuentos: [{ cotizacionItemId: item.id, tipo: 'monto_unitario', valor: 2 }] }) }
  f.assert_descuento = async () => { const row = await dbSingle('notas_despacho', 'descuento_total_usd', d.despachoId); assert(Number(row.descuento_total_usd) === 20, 20, row.descuento_total_usd, 'descuento total'); const rows = await this.api(`/api/despachos/${d.despachoId}/descuentos`); assert(rows?.length === 1 && rows[0].cotizacion_item_id === d.cotizacionItemId && Number(rows[0].monto_usd) === 20, 'descuento persistido', rows, 'descuento') }
  f.mark_dispatched = async () => { await this.api('/api/despachos/estado', 'POST', { despachoId: d.despachoId, nuevoEstado: 'despachada' }) }
  f.assert_dispatched = async () => { const row = await dbSingle('notas_despacho', 'estado,despachada_en', d.despachoId); assert(row.estado === 'despachada' && !!row.despachada_en, 'despachada', row, 'despacho aprobado') }
  f.assert_stock_comprometido_aprobado = async () => { const n = await this.stockCommitted(); assert(n === 10, 10, n, 'comprometido aprobado'); const cxc = await this.db(this.supabase.from('cuentas_por_cobrar').select('monto_usd').eq('despacho_id', d.despachoId).eq('tipo', 'cargo'), 'CxC aprobado'); assert(cxc?.length === 1 && Number(cxc[0].monto_usd) === 240, '$240', cxc, 'CxC neto'); const client = await dbSingle('clientes', 'saldo_pendiente', d.clienteId); assert(Number(client.saldo_pendiente) === 240, 240, client.saldo_pendiente, 'saldo aprobado') }
  f.mark_delivered = async () => {
    // La prueba de fecha efectiva necesita una ventana cronológica real entre
    // aprobación y entrega; la RPC exige al menos un segundo de margen en
    // ambos extremos. Dar tiempo aquí evita que un E2E demasiado rápido haga
    // fallar la aserción por falta de una fecha intermedia válida.
    await new Promise(resolve => setTimeout(resolve, 2500))
    d.deliveryKey = globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000026'
    d.deliveryPayload = { despachoId: d.despachoId, nuevoEstado: 'entregada', idempotencyKey: d.deliveryKey }
    d.deliveryResult = await this.api('/api/despachos/estado', 'POST', d.deliveryPayload)
  }
  f.assert_delivered = async () => { const row = await dbSingle('notas_despacho', 'estado,entregada_en', d.despachoId); assert(row.estado === 'entregada' && !!row.entregada_en, 'entregada', row, 'despacho entregado') }
  f.replay_delivery = async () => {
    const replay = await this.api('/api/despachos/estado', 'POST', d.deliveryPayload)
    assert(replay?.ok === true && replay?.idempotent === true && replay?.nuevoEstado === 'entregada', 'replay entrega idempotente', replay, 'replay entrega')
    const movements = await this.db(this.supabase.from('inventario_movimientos').select('id').eq('producto_id', d.productoId).eq('idempotency_key', d.deliveryKey), 'movimientos replay entrega')
    const cxc = await this.db(this.supabase.from('cuentas_por_cobrar').select('id').eq('despacho_id', d.despachoId), 'CxC replay entrega')
    const commissions = await this.db(this.supabase.from('comisiones').select('id').eq('despachoid', d.despachoId), 'comisión replay entrega')
    assert(movements?.length === 1, 1, movements?.length, 'sin Kardex duplicado por replay de entrega')
    assert(cxc?.length === 1, 1, cxc?.length, 'sin CxC duplicada por replay de entrega')
    assert(commissions?.length === 1, 1, commissions?.length, 'sin comisión duplicada por replay de entrega')
  }
  f.assert_stock_comprometido_entregado = async () => { const n = await this.stockCommitted(); assert(n === 0, 0, n, 'comprometido entregado') }
  f.register_partial_return = async () => {
    const item = await this.db(this.supabase.from('notas_despacho_items').select('id,producto_id,precio_unit_usd,descuento_pct').eq('despacho_id', d.despachoId).eq('producto_id', d.productoId).single(), 'item devolución parcial')
    d.partialReturnQuantity = 1
    d.partialReturnKey = globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000029'
    d.netUnitDevuelto = round2(Number(item.precio_unit_usd) * (1 - Number(item.descuento_pct || 0) / 100))
    d.exchangePrecioUnit = Number(item.precio_unit_usd)
    d.diferenciaEsperada = round2(d.exchangePrecioUnit - d.netUnitDevuelto)
    d.partialReturnPayload = {
      despachoId: d.despachoId,
      items: [{ despacho_item_id: item.id, producto_id: item.producto_id, cantidad_devuelta: d.partialReturnQuantity }],
      motivo: 'Devolución E2E por descuento aplicado',
      generarReemplazo: false,
      exchangeItems: [{ producto_id: d.productoId, cantidad: 1, precio_unit_usd: d.exchangePrecioUnit }],
      // La diferencia neta ($2) queda a cargo del cliente y se abona con dos
      // métodos: el cargo completo se registra y los pagos cubren parte.
      pagosDiferencia: [
        { metodo: 'Efectivo $', monto: 1 },
        { metodo: 'Zelle', monto: 0.75, referencia: 'E2E-ZELLE-DIF' },
      ],
      idempotencyKey: d.partialReturnKey,
    }
    d.partialReturn = await this.api('/api/despachos/devolucion-parcial', 'POST', d.partialReturnPayload)
  }
  f.assert_partial_return_idempotent = async () => {
    const replay = await this.api('/api/despachos/devolucion-parcial', 'POST', d.partialReturnPayload)
    assert(replay?.ok === true && replay?.idempotent === true && Number(replay.totalDevueltoUsd) === 23, 'replay idempotente/$23', replay, 'replay devolución')
    const rows = await this.db(this.supabase.from('despacho_devoluciones').select('id').eq('despacho_id', d.despachoId).eq('despacho_item_id', d.partialReturnPayload.items[0].despacho_item_id), 'filas devolución replay')
    assert(rows?.length === 1, 1, rows?.length, 'sin devolución duplicada')
    const movements = await this.db(this.supabase.from('inventario_movimientos').select('id').eq('producto_id', d.productoId).eq('idempotency_key', d.partialReturnKey), 'movimientos devolución replay')
    assert(movements?.length === 2, 2, movements?.length, 'sin Kardex duplicado (1 ingreso devolución + 1 egreso intercambio)')
    const cargosDifReplay = await this.db(this.supabase.from('cuentas_por_cobrar').select('id,descripcion').eq('despacho_id', d.despachoId).eq('tipo', 'cargo'), 'cargos replay devolución')
    assert((cargosDifReplay || []).filter(c => /Cargo por diferencia en intercambio/.test(c.descripcion || '')).length === 1, 1, cargosDifReplay, 'sin cargo de diferencia duplicado por replay')
    const abonosDifReplay = await this.db(this.supabase.from('cuentas_por_cobrar').select('id,forma_pago_abono').eq('despacho_id', d.despachoId).eq('tipo', 'abono'), 'abonos replay devolución')
    assert((abonosDifReplay || []).filter(a => a.forma_pago_abono !== 'Devolución').length === 2, 2, abonosDifReplay, 'sin abonos de cobro duplicados por replay')
  }
  f.assert_partial_return = async () => {
    const product = await dbSingle('productos', 'stock_actual', d.productoId)
    assert(Number(product.stock_actual) === 90, 90, product.stock_actual, 'stock tras devolución con intercambio (90 +1 devolución −1 intercambio)')
    // Valores reales según la respuesta del Worker (el neto devuelto aplica el
    // descuento unitario; no se precomputa desde la fila del item).
    d.devueltoReal = Number(d.partialReturn?.totalDevueltoUsd)
    d.intercambioReal = Number(d.partialReturn?.totalIntercambioUsd)
    d.diferenciaReal = round2(d.intercambioReal - d.devueltoReal)
    const totalEsperado = round2(260 - d.devueltoReal + d.intercambioReal)
    const despacho = await dbSingle('notas_despacho', 'total_usd,estado,tiene_devoluciones', d.despachoId)
    assert(despacho.estado === 'entregada' && despacho.tiene_devoluciones === true && Number(despacho.total_usd) === totalEsperado, `entregada/$${totalEsperado}/devolución`, despacho, 'despacho devuelto con intercambio')
    assert(d.devueltoReal === 23 && d.intercambioReal === 25 && d.diferenciaReal === 2, { devuelto: 23, intercambio: 25, balance: 2 }, d.partialReturn, 'totales devolución con intercambio')
    const movements = await this.db(this.supabase.from('inventario_movimientos').select('tipo,cantidad,motivo_tipo').eq('producto_id', d.productoId).eq('motivo_tipo', 'devolucion'), 'Kardex devolución con intercambio')
    assert((movements || []).some(m => m.tipo === 'ingreso' && Number(m.cantidad) === 1), 'ingreso +1', movements, 'ingreso por devolución')
    assert((movements || []).some(m => m.tipo === 'egreso' && Number(m.cantidad) === 1), 'egreso −1', movements, 'egreso por intercambio')
    const cargos = await this.db(this.supabase.from('cuentas_por_cobrar').select('tipo,monto_usd,descripcion').eq('despacho_id', d.despachoId).eq('tipo', 'cargo'), 'cargo diferencia')
    const cargoDif = (cargos || []).find(c => /Cargo por diferencia en intercambio/.test(c.descripcion || ''))
    assert(cargoDif && Number(cargoDif.monto_usd) === d.diferenciaReal, `$${d.diferenciaReal}`, cargoDif, 'cargo por diferencia en intercambio')
    const abonos = await this.db(this.supabase.from('cuentas_por_cobrar').select('tipo,monto_usd,forma_pago_abono,referencia').eq('despacho_id', d.despachoId).eq('tipo', 'abono'), 'abonos cobro diferencia')
    const abEfectivo = (abonos || []).find(a => a.forma_pago_abono === 'Efectivo $')
    const abZelle = (abonos || []).find(a => a.forma_pago_abono === 'Zelle')
    assert(abEfectivo && Number(abEfectivo.monto_usd) === 1, { metodo: 'Efectivo $', monto: 1 }, abEfectivo, 'abono Efectivo $ de la diferencia')
    assert(abZelle && Number(abZelle.monto_usd) === 0.75 && abZelle.referencia === 'E2E-ZELLE-DIF', { metodo: 'Zelle', monto: 0.75, referencia: 'E2E-ZELLE-DIF' }, abZelle, 'abono Zelle con referencia')
    const saldoEsperado = round2(240 + d.diferenciaReal - 1.75)
    const client = await dbSingle('clientes', 'saldo_pendiente', d.clienteId)
    assert(Number(client.saldo_pendiente) === saldoEsperado, saldoEsperado, client.saldo_pendiente, 'saldo cliente tras cobro parcial de la diferencia')
  }
  f.assert_cobro_diferencia_sobrepago = async () => {
    const item = d.partialReturnPayload.items[0]
    try {
      await this.api('/api/despachos/devolucion-parcial', 'POST', {
        despachoId: d.despachoId,
        items: [{ despacho_item_id: item.despacho_item_id, producto_id: item.producto_id, cantidad_devuelta: 1 }],
        motivo: 'Intento de sobrepago E2E',
        generarReemplazo: false,
        exchangeItems: [{ producto_id: d.productoId, cantidad: 1, precio_unit_usd: d.exchangePrecioUnit }],
        pagosDiferencia: [{ metodo: 'Efectivo $', monto: d.diferenciaReal + 1 }],
        idempotencyKey: globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-00000000005a',
      })
      throw new Error('ASSERTION FAILED: el sobrepago de la diferencia fue aceptado')
    } catch (error) {
      if (String(error.message || '').includes('ASSERTION FAILED')) throw error
      assert(error instanceof ApiError && error.status === 400 && /diferencia/i.test(error.message), '400 con mensaje de diferencia', { status: error.status, message: error.message }, 'sobrepago rechazado')
    }
    const cargos = await this.db(this.supabase.from('cuentas_por_cobrar').select('id,descripcion').eq('despacho_id', d.despachoId).eq('tipo', 'cargo'), 'cargos tras sobrepago')
    assert((cargos || []).filter(c => /Cargo por diferencia en intercambio/.test(c.descripcion || '')).length === 1, 1, cargos, 'el sobrepago no creó cargos extra')
    this.log('Sobrepago de diferencia rechazado ✓', 'OK')
  }
  f.register_partial_return_sin_pagos = async () => {
    const item = await this.db(this.supabase.from('notas_despacho_items').select('id,producto_id').eq('despacho_id', d.despachoId).eq('producto_id', d.productoId).single(), 'item devolución sin pagos')
    d.sinPagosKey = globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-00000000005b'
    d.sinPagosResult = await this.api('/api/despachos/devolucion-parcial', 'POST', {
      despachoId: d.despachoId,
      items: [{ despacho_item_id: item.id, producto_id: item.producto_id, cantidad_devuelta: 1 }],
      motivo: 'Devolución E2E sin cobro de diferencia',
      generarReemplazo: false,
      exchangeItems: [{ producto_id: d.productoId, cantidad: 1, precio_unit_usd: d.exchangePrecioUnit }],
      idempotencyKey: d.sinPagosKey,
    })
  }
  f.assert_partial_return_sin_pagos = async () => {
    const devuelto2 = Number(d.sinPagosResult?.totalDevueltoUsd)
    const intercambio2 = Number(d.sinPagosResult?.totalIntercambioUsd)
    const dif2 = round2(intercambio2 - devuelto2)
    d.dif2 = dif2
    assert(dif2 === d.diferenciaReal && devuelto2 === d.devueltoReal && intercambio2 === d.intercambioReal, { devuelto2, intercambio2, dif2 }, d.sinPagosResult, 'segunda devolución con diferencia')
    const product = await dbSingle('productos', 'stock_actual', d.productoId)
    assert(Number(product.stock_actual) === 90, 90, product.stock_actual, 'stock tras segunda devolución con intercambio')
    const totalEsperado = round2(260 - d.devueltoReal - devuelto2 + d.intercambioReal + intercambio2)
    d.totalTrasDevoluciones = totalEsperado
    const despacho = await dbSingle('notas_despacho', 'total_usd', d.despachoId)
    assert(Number(despacho.total_usd) === totalEsperado, totalEsperado, despacho.total_usd, 'total tras segunda devolución')
    const cargos = await this.db(this.supabase.from('cuentas_por_cobrar').select('id,monto_usd,descripcion').eq('despacho_id', d.despachoId).eq('tipo', 'cargo'), 'cargos diferencia sin pagos')
    const difCargos = (cargos || []).filter(c => /Cargo por diferencia en intercambio/.test(c.descripcion || ''))
    assert(difCargos.length === 2 && Math.round(difCargos.reduce((s, c) => s + Number(c.monto_usd), 0)) === Math.round(d.diferenciaReal + dif2), { count: 2, total: round2(d.diferenciaReal + dif2) }, difCargos, 'dos cargos de diferencia sin abonos')
    const abonos = await this.db(this.supabase.from('cuentas_por_cobrar').select('id,forma_pago_abono').eq('despacho_id', d.despachoId).eq('tipo', 'abono'), 'abonos tras sin pagos')
    assert((abonos || []).filter(a => a.forma_pago_abono !== 'Devolución').length === 2, 2, abonos, 'sin pagos no agrega abonos')
    const saldoEsperado = round2(240 + d.diferenciaReal + dif2 - 1.75)
    d.saldoTrasDevoluciones = saldoEsperado
    const client = await dbSingle('clientes', 'saldo_pendiente', d.clienteId)
    assert(Number(client.saldo_pendiente) === saldoEsperado, saldoEsperado, client.saldo_pendiente, 'saldo cliente: diferencia no cobrada queda como deuda')
  }
  f.assert_commission = async () => {
    const cfg = await this.db(this.supabase.from('configuracion_negocio').select('comision_pct_cabilla,comision_pct_otros,comision_categoria_cabilla').eq('cuenta_id', this.user.id).limit(1).maybeSingle(), 'config comisión')
    const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.despachoId), 'comisión')
    assert(rows?.length === 1, 1, rows?.length, 'comisión')
    const commission = rows[0]
    d.comisionId = commission.id
    const cabilla = TEST.producto.categoria.toLowerCase() === String(cfg?.comision_categoria_cabilla || '').toLowerCase().trim()
    const pct = Number(cabilla ? cfg?.comision_pct_cabilla : cfg?.comision_pct_otros)
    const field = cabilla ? 'comisioncabilla' : 'comisionotros'
    // Política 238b (fecha_despacho_no_cxc): el despacho es 100% "Cta por cobrar",
    // así que ANTES de conciliar cobros la comisión es $0 y el 100% queda excluido
    // en comision_cxc_excluida (se libera al cobrar el crédito). La base 238b son
    // las líneas brutas actuales: 10×25 − 25 devuelto + 25 intercambio = 250.
    const baseBruto = round2(TEST.cotizacion.cantidad * TEST.producto.precio_usd - d.exchangePrecioUnit + d.exchangePrecioUnit)
    const expectedExcluida = round2(baseBruto * pct / 100)
    const evidencia = commission.calculo_evidencia || {}
    const split = evidencia.payment_split || {}
    assert(commission.calculo_version === '238b' && commission.fuente_calculo === 'stored_net_238b', '238b/stored_net_238b', { version: commission.calculo_version, fuente: commission.fuente_calculo }, 'versión de cálculo 238b')
    assert(Number(commission.totalcomision) === 0 && Number(commission[field]) === 0, 0, commission, 'comisión $0 antes de cobrar (100% CxC)')
    assert(Number(commission.comision_liberada) === 0 && Number(commission.comision_retenida) === 0, { liberada: 0, retenida: 0 }, commission, 'sin liberada/retenida pre-conciliación')
    assert(round2(Number(commission.comision_cxc_excluida)) === expectedExcluida, expectedExcluida, commission.comision_cxc_excluida, `comisión excluida CxC = base bruto $${baseBruto} × ${pct}%`)
    assert(round2(Number(split.fraction)) === 0 && (split.methods || []).every(m => m.metodo === 'Cta por cobrar'), { fraction: split.fraction, methods: split.methods }, evidencia, 'payment_split 100% CxC')
    assert(commission.estado === 'pendiente', 'pendiente', commission.estado, 'estado comisión')
    assert(commission.vendedorid === this.salesperson.id, this.salesperson.id, commission.vendedorid, 'vendedor de la comisión')
    this.log(`Comisión 238b pre-cobro: total=$0; excluida CxC=$${expectedExcluida}; estado=${commission.estado}`, 'OK')
  }
  f.change_delivery_date = async () => {
    const despacho = await dbSingle('notas_despacho', 'numero,entregada_en,despachada_en,creado_en,entregada_en_ajustada', d.despachoId)
    const commission = await dbSingle('comisiones', 'estado,totalcomision,comision_liberada,comision_retenida,montopagado,pagadaen,pagadapor', d.comisionId)
    const originalMs = new Date(despacho.entregada_en).getTime()
    const approvalMs = new Date(despacho.despachada_en || despacho.creado_en).getTime()
    const latestValidMs = Math.min(originalMs - 1000, Date.now() - 1000)
    const earliestValidMs = approvalMs + 1000
    if (!Number.isFinite(originalMs) || !Number.isFinite(approvalMs) || latestValidMs <= earliestValidMs) {
      throw new Error('No existe una fecha intermedia válida para la prueba de corrección')
    }

    const nuevaFechaEntrega = new Date(Math.floor((earliestValidMs + latestValidMs) / 2)).toISOString()
    const idempotencyKey = `STAGING-DATE-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const result = await this.api('/api/despachos/cambiar-fecha-entrega', 'POST', {
      despachoId: d.despachoId,
      nuevaFechaEntrega,
      motivo: 'Corrección E2E de fecha de entrega',
      idempotencyKey,
    })

    assert(result?.ok === true && result?.idempotent === false, 'corrección aplicada', result, 'cambio de fecha')
    d.dateChange = {
      idempotencyKey,
      nuevaFechaEntrega,
      numero: despacho.numero,
      entregadaOriginal: despacho.entregada_en,
      commission,
      cambioId: result.cambio_id,
    }
  }
  f.assert_delivery_date_change = async () => {
    const despacho = await dbSingle('notas_despacho', 'numero,entregada_en,entregada_en_ajustada', d.despachoId)
    assert(despacho.numero === d.dateChange.numero, d.dateChange.numero, despacho.numero, 'correlativo inmutable')
    assert(despacho.entregada_en === d.dateChange.entregadaOriginal, d.dateChange.entregadaOriginal, despacho.entregada_en, 'fecha original inmutable')
    assert(new Date(despacho.entregada_en_ajustada).getTime() === new Date(d.dateChange.nuevaFechaEntrega).getTime(), d.dateChange.nuevaFechaEntrega, despacho.entregada_en_ajustada, 'fecha efectiva ajustada')

    const commission = await dbSingle('comisiones', 'estado,totalcomision,comision_liberada,comision_retenida,montopagado,pagadaen,pagadapor', d.comisionId)
    for (const key of ['estado', 'totalcomision', 'comision_liberada', 'comision_retenida', 'montopagado', 'pagadaen', 'pagadapor']) {
      const before = d.dateChange.commission[key]
      const after = commission[key]
      if (typeof before === 'number' || typeof after === 'number') {
        assert(Number(after || 0) === Number(before || 0), before, after, `comisión.${key} inmutable`)
      } else {
        assert(after === before, before, after, `comisión.${key} inmutable`)
      }
    }
  }
  f.assert_delivery_date_idempotent = async () => {
    const replay = await this.api('/api/despachos/cambiar-fecha-entrega', 'POST', {
      despachoId: d.despachoId,
      nuevaFechaEntrega: new Date(Date.now() - 2000).toISOString(),
      motivo: 'Otra fecha que no debe reemplazar la primera',
      idempotencyKey: d.dateChange.idempotencyKey,
    })
    assert(replay?.ok === true && replay?.idempotent === true && replay?.cambio_id === d.dateChange.cambioId, 'replay idempotente', replay, 'idempotencia fecha')
    const despacho = await dbSingle('notas_despacho', 'numero,entregada_en_ajustada', d.despachoId)
    assert(new Date(despacho.entregada_en_ajustada).getTime() === new Date(d.dateChange.nuevaFechaEntrega).getTime(), d.dateChange.nuevaFechaEntrega, despacho.entregada_en_ajustada, 'fecha no reemplazada por replay')
  }
  f.pay_commission = async () => {
    const commission = await dbSingle('comisiones', 'estado,comision_liberada,comision_retenida,totalcomision', d.comisionId)
    const contract = commissionStateContract(commission)
    if (contract.requiresManualRelease) {
      await this.api('/api/comisiones/liberar-cxc', 'POST', { comisionId: d.comisionId })
      const released = await dbSingle('comisiones', 'estado,comision_liberada,comision_retenida,totalcomision', d.comisionId)
      assert(released.estado === 'pendiente' && Number(released.comision_liberada) === Number(released.totalcomision) && Number(released.comision_retenida) === 0, 'comisión liberada', released, 'liberación CxC')
    }
    await this.api('/api/comisiones/pagar', 'POST', { comisionId: d.comisionId })
  }
  f.assert_commission_paid = async () => { const row = await dbSingle('comisiones', 'estado,pagadaen', d.comisionId); assert(row.estado === 'pagada' && !!row.pagadaen, 'pagada', row, 'comisión pagada') }
  f.register_payment = async () => { d.montoAbono = 100; await this.api('/api/cxc/abono', 'POST', { clienteId: d.clienteId, monto: 100, formaPago: 'Transf. / Pago Móvil', referencia: 'TEST-DET-001', descripcion: 'Abono test determinista' }) }
  f.assert_cxc_abono = async () => { const client = await dbSingle('clientes', 'saldo_pendiente', d.clienteId); const esperado = round2(d.saldoTrasDevoluciones - d.montoAbono); assert(round2(Number(client.saldo_pendiente)) === esperado, esperado, client.saldo_pendiente, 'saldo tras abono CxC'); const rows = await this.db(this.supabase.from('cuentas_por_cobrar').select('monto_usd').eq('cliente_id', d.clienteId).eq('tipo', 'abono'), 'abono CxC'); assert((rows || []).some(row => Number(row.monto_usd) === 100), 100, rows, 'abono') }
  f.assert_report_ventas = async () => { const row = await dbSingle('notas_despacho', 'total_usd,estado,forma_pago', d.despachoId); assert(row.estado === 'entregada' && Number(row.total_usd) === d.totalTrasDevoluciones && row.forma_pago === 'Cta por cobrar', row, 'despacho en ventas') }
  f.assert_report_pipeline = async () => { const row = await dbSingle('cotizaciones', 'estado,total_usd', d.cotizacionId); assert(row.estado === 'aceptada' && Number(row.total_usd) === 260, row, 'cotización pipeline') }
  f.assert_report_inventario = async () => { const row = await dbSingle('productos', 'stock_actual,activo', d.productoId); assert(Number(row.stock_actual) === 90 && row.activo === true, 90, row.stock_actual, 'inventario tras devoluciones con intercambio (100 −10 +1 −1 +1 −1)') }
  f.create_transportista = async () => { const row = await this.db(this.supabase.from('transportistas').insert({ ...TEST.transportista, cuenta_id: this.user.id, activo: true }).select('id').single(), 'crear transportista'); d.transportistaTestId = row.id }
  f.assert_transportista = async () => { const row = await dbSingle('transportistas', 'nombre,rif,activo,es_local,tipo_relacion', d.transportistaTestId); assert(row.nombre === TEST.transportista.nombre && row.rif === TEST.transportista.rif && row.activo === true && row.es_local === true && row.tipo_relacion === 'contratista', row, 'transportista') }
  f.create_product_2 = async () => { d.producto2Id = await this.productRpc(TEST.producto2) }
  f.assert_product_2_prices = async () => { const row = await dbSingle('productos', 'precio_usd,precio_2,precio_3,stock_actual', d.producto2Id); assert(Number(row.precio_usd) === 40 && Number(row.precio_2) === 38 && Number(row.precio_3) === 35 && Number(row.stock_actual) === 50, row, 'producto 2') }
  f.apply_inventory_batch = async () => { const result = await this.api('/api/inventario/movimiento', 'POST', { tipo: 'ingreso', motivo: TEST.movimientoLote.motivo, motivo_tipo: 'ajuste_inventario', items: [{ producto_id: d.productoId, cantidad: 20 }] }); d.loteId = result.lote_id }
  f.assert_inventory_batch = async () => { await assertStock(110, 'stock lote'); const rows = await this.db(this.supabase.from('inventario_movimientos').select('tipo,cantidad').eq('lote_id', d.loteId), 'kardex lote'); assert((rows || []).some(row => row.tipo === 'ingreso' && Number(row.cantidad) === 20), rows, 'lote') }
  f.batch_ingest_idempotent = async () => {
    d.batchIngestKey = globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000042'
    d.batchIngestPayload = {
      motivo: 'Ingreso masivo E2E idempotente',
      idempotencyKey: d.batchIngestKey,
      productos: [{ id: d.producto2Id, codigo: TEST.producto2.codigo, nombre: TEST.producto2.nombre, cantidad: 5, costo: 25, precio: 40, categoria: TEST.producto2.categoria, unidad: TEST.producto2.unidad, isNuevo: false, modoExistente: 'sumar', actualizarCosto: false }],
    }
    d.batchIngestResult = await this.api('/api/inventario/batch-ingest', 'POST', d.batchIngestPayload)
  }
  f.assert_batch_ingest_idempotent = async () => {
    const replay = await this.api('/api/inventario/batch-ingest', 'POST', d.batchIngestPayload)
    const product = await dbSingle('productos', 'stock_actual', d.producto2Id)
    assert(Number(product.stock_actual) === 55, 55, product.stock_actual, 'stock ingesta masiva')
    assert(replay?.ok === true && replay?.idempotent === true && replay.lote_id === d.batchIngestResult.lote_id, 'replay lote', replay, 'replay ingesta')
    const rows = await this.db(this.supabase.from('inventario_movimientos').select('id,cantidad,origen_tipo,idempotency_key').eq('producto_id', d.producto2Id).eq('idempotency_key', d.batchIngestKey), 'movimientos ingesta replay')
    assert(rows?.length === 1 && Number(rows[0].cantidad) === 5 && rows[0].origen_tipo === 'batch_ingest', rows, 'un movimiento batch')
  }
  f.assert_kardex_provenance = async () => {
    const rows = await this.db(this.supabase.from('inventario_movimientos').select('origen_tipo,origen_id,origen_referencia,idempotency_key').in('idempotency_key', [d.batchIngestKey, d.partialReturnKey].filter(Boolean)), 'provenance Kardex')
    assert(rows?.length >= 1 && rows.every(row => row.origen_tipo && row.origen_id && row.idempotency_key), rows, 'origen estructurado')
  }
  f.assert_inventory_batch_rollback = async () => {
    // El comportamiento del lote con stock insuficiente depende del flag de la cuenta:
    // permitir_stock_negativo=false → guardarraíl estricto (rechazo 400, rollback total);
    // permitir_stock_negativo=true  → Venta Anticipada (aplicación atómica con stock
    // negativo, Kardex continuo y reposición espejo para los pasos siguientes).
    const beforeProduct = await dbSingle('productos', 'stock_actual', d.productoId)
    const beforeProduct2 = await dbSingle('productos', 'stock_actual', d.producto2Id)
    const cfg = await this.db(
      this.supabase.from('configuracion_negocio').select('permitir_stock_negativo').eq('cuenta_id', this.user.id).limit(1).maybeSingle(),
      'config permitir_stock_negativo',
    )
    // La cuenta autenticada puede estar representada por el operador virtual;
    // para evitar que RLS o el fallback de configuración oculten el valor real,
    // usa también la configuración que devuelve el Worker autenticado.
    const workerConfig = await this.api('/api/config')
    const allowNegative = workerConfig?.permitir_stock_negativo === true || cfg?.permitir_stock_negativo === true
    this.log(`permitir_stock_negativo=${allowNegative} (DB=${cfg?.permitir_stock_negativo}, Worker=${workerConfig?.permitir_stock_negativo})`, 'INFO')
    const rollbackReason = `Lote insuficiente E2E — guardarraíl o venta anticipada — ${globalThis.crypto?.randomUUID?.() || Date.now()}`
    const insufficientLote = {
      tipo: 'egreso',
      motivo: rollbackReason,
      motivo_tipo: 'ajuste_inventario',
      items: [
        { producto_id: d.productoId, cantidad: 1 },
        { producto_id: d.producto2Id, cantidad: 100000 },
      ],
    }
    let failed = false
    try {
      await this.api('/api/inventario/movimiento', 'POST', insufficientLote)
    } catch (error) {
      failed = true
      assert(error.status === 400, 400, error.status, 'lote insuficiente rechaza con 400')
    }
    if (!allowNegative) {
      // Guardarraíl estricto: el lote completo se rechaza atómicamente.
      assert(failed, true, failed, 'guardarraíl: lote insuficiente debe fallar')
      const afterProduct = await dbSingle('productos', 'stock_actual', d.productoId)
      const afterProduct2 = await dbSingle('productos', 'stock_actual', d.producto2Id)
      assert(Number(afterProduct.stock_actual) === Number(beforeProduct.stock_actual), beforeProduct.stock_actual, afterProduct.stock_actual, 'rollback stock producto 1')
      assert(Number(afterProduct2.stock_actual) === Number(beforeProduct2.stock_actual), beforeProduct2.stock_actual, afterProduct2.stock_actual, 'rollback stock producto 2')
      const partialRows = await this.db(this.supabase.from('inventario_movimientos').select('id').eq('motivo', rollbackReason), 'buscar movimiento parcial')
      assert(!partialRows?.length, 0, partialRows?.length, 'rollback sin Kardex parcial')
      return
    }
    // Venta Anticipada: el egreso se aplica atómicamente aunque el stock quede negativo.
    // Si la cuenta está habilitada pero la RPC aún aplica el guardarraíl estricto,
    // reportamos esa discrepancia explícitamente (sin intentar continuar con un
    // estado de inventario incierto).
    if (failed) {
      throw new Error('permitir_stock_negativo=true pero la RPC rechazó el lote insuficiente; revisar migración/RPC de staging')
    }
    const midProduct = await dbSingle('productos', 'stock_actual', d.productoId)
    const midProduct2 = await dbSingle('productos', 'stock_actual', d.producto2Id)
    assert(Number(midProduct.stock_actual) === Number(beforeProduct.stock_actual) - 1, beforeProduct.stock_actual - 1, midProduct.stock_actual, 'venta anticipada descuenta producto 1')
    assert(Number(midProduct2.stock_actual) === Number(beforeProduct2.stock_actual) - 100000, beforeProduct2.stock_actual - 100000, midProduct2.stock_actual, 'venta anticipada descuenta producto 2 (negativo)')
    const appliedRows = await this.db(
      this.supabase.from('inventario_movimientos').select('producto_id,cantidad,stock_anterior,stock_nuevo').eq('motivo', rollbackReason).eq('cuenta_id', this.user.id),
      'kardex venta anticipada',
    )
    assert(appliedRows?.length === 2, 2, appliedRows?.length, 'venta anticipada registra ambos items')
    for (const row of appliedRows || []) {
      const delta = -Number(row.cantidad)
      assert(Math.abs(Number(row.stock_anterior) + delta - Number(row.stock_nuevo)) <= 0.01, true, `${row.stock_anterior}→${row.stock_nuevo}`, 'continuidad kardex venta anticipada')
    }
    // Reposición espejo para no contaminar los pasos siguientes de la batería.
    await this.api('/api/inventario/movimiento', 'POST', {
      tipo: 'ingreso',
      motivo: 'Reposición del lote venta anticipada E2E',
      motivo_tipo: 'ajuste_inventario',
      items: insufficientLote.items,
    })
    const afterProduct = await dbSingle('productos', 'stock_actual', d.productoId)
    const afterProduct2 = await dbSingle('productos', 'stock_actual', d.producto2Id)
    assert(Number(afterProduct.stock_actual) === Number(beforeProduct.stock_actual), beforeProduct.stock_actual, afterProduct.stock_actual, 'reposición stock producto 1')
    assert(Number(afterProduct2.stock_actual) === Number(beforeProduct2.stock_actual), beforeProduct2.stock_actual, afterProduct2.stock_actual, 'reposición stock producto 2')
  }
  f.transform_inventory = async () => {
    const result = await this.api('/api/inventario/transformacion', 'POST', {
      origen: { producto_id: d.productoId, cantidad: 2 },
      destino: { producto_id: d.producto2Id, cantidad: 3 },
      motivo: 'Transformación atómica E2E de staging',
    })
    d.transformLoteId = result.lote_id
    const reverse = await this.api('/api/inventario/transformacion', 'POST', {
      origen: { producto_id: d.producto2Id, cantidad: 3 },
      destino: { producto_id: d.productoId, cantidad: 2 },
      motivo: 'Reversión de transformación atómica E2E',
    })
    d.transformReverseLoteId = reverse.lote_id
  }
  f.assert_transform_inventory = async () => {
    const product = await dbSingle('productos', 'stock_actual', d.productoId)
    const product2 = await dbSingle('productos', 'stock_actual', d.producto2Id)
    assert(Number(product.stock_actual) === 110, 110, product.stock_actual, 'stock origen restaurado')
    assert(Number(product2.stock_actual) === 55, 55, product2.stock_actual, 'stock destino restaurado')
    const rows = await this.db(this.supabase.from('inventario_movimientos').select('producto_id,tipo,cantidad,stock_anterior,stock_nuevo,motivo_tipo').in('lote_id', [d.transformLoteId, d.transformReverseLoteId]), 'Kardex transformación')
    assert(rows?.length === 4, 4, rows?.length, 'dos pares de transformación')
    assert(rows.some(row => row.producto_id === d.productoId && row.tipo === 'egreso' && Number(row.cantidad) === 2 && Number(row.stock_anterior) === 110 && Number(row.stock_nuevo) === 108 && row.motivo_tipo === 'transferencia'), rows, 'egreso transformación')
    assert(rows.some(row => row.producto_id === d.producto2Id && row.tipo === 'ingreso' && Number(row.cantidad) === 3 && Number(row.stock_anterior) === 55 && Number(row.stock_nuevo) === 58 && row.motivo_tipo === 'transferencia'), rows, 'ingreso transformación')
  }
  f.return_loan = async () => {
    const loan = await this.db(this.supabase.from('cliente_prestamos').insert({
      cliente_id: d.clienteId,
      producto_id: d.producto2Id,
      cantidad_prestada: 3,
      cantidad_devuelta: 0,
      cantidad_facturada: 0,
      estado: 'pendiente',
    }).select('id').single(), 'crear préstamo E2E')
    d.prestamoId = loan.id
    d.loanStartingStock = Number((await dbSingle('productos', 'stock_actual', d.producto2Id)).stock_actual)
    await this.api('/api/clientes/prestamos/devolver', 'POST', { prestamoId: d.prestamoId, cantidad: 1 })
  }
  f.assert_loan_return = async () => {
    const product = await dbSingle('productos', 'stock_actual', d.producto2Id)
    const loan = await dbSingle('cliente_prestamos', 'cantidad_prestada,cantidad_devuelta,cantidad_facturada,estado', d.prestamoId)
    assert(Number(product.stock_actual) === d.loanStartingStock + 1, d.loanStartingStock + 1, product.stock_actual, 'stock por devolución de préstamo')
    assert(Number(loan.cantidad_devuelta) === 1 && Number(loan.cantidad_facturada) === 0 && loan.estado === 'devuelto_parcial', 'préstamo parcial', loan, 'préstamo actualizado')
    const rows = await this.db(this.supabase.from('inventario_movimientos').select('tipo,cantidad,stock_anterior,stock_nuevo,motivo_tipo').eq('producto_id', d.producto2Id).eq('motivo_tipo', 'devolucion').order('creado_en', { ascending: false }).limit(1), 'Kardex devolución préstamo')
    assert(rows?.length === 1 && rows[0].tipo === 'ingreso' && Number(rows[0].cantidad) === 1 && Number(rows[0].stock_anterior) === d.loanStartingStock && Number(rows[0].stock_nuevo) === d.loanStartingStock + 1, 'movimiento préstamo', rows, 'Kardex préstamo')
  }
  f.create_draft_for_anular = () => this.createSecondDraft()
  f.send_quote_for_anular = async () => { await this.api('/api/cotizaciones/enviar', 'POST', { cotizacionId: d.cotizacion2Id, tasaBcv: 100 }, this.salesperson.id) }
  f.anular_cotizacion = async () => { await this.db(this.supabase.from('cotizaciones').update({ estado: 'anulada' }).eq('id', d.cotizacion2Id), 'anular cotización') }
  f.assert_anulada = async () => { const row = await dbSingle('cotizaciones', 'estado', d.cotizacion2Id); assert(row.estado === 'anulada', 'anulada', row.estado, 'cotización anulada') }
  f.reciclar_cotizacion = async () => { const result = await this.api('/api/cotizaciones/reciclar', 'POST', { cotizacionId: d.cotizacion2Id, vendedorDestinoId: this.salesperson.id }); d.cotizacionRecicladaId = result.id }
  f.assert_reciclada = async () => { const row = await dbSingle('cotizaciones', 'estado,cliente_id,vendedor_id', d.cotizacionRecicladaId); assert(row.estado === 'borrador' && row.cliente_id === d.clienteId && row.vendedor_id === this.salesperson.id, row, 'cotización reciclada'); const items = await this.db(this.supabase.from('cotizacion_items').select('id').eq('cotizacion_id', d.cotizacionRecicladaId), 'items reciclados'); assert(items?.length > 0, items, 'items reciclados') }
  f.crear_version = async () => { await this.api('/api/cotizaciones/enviar', 'POST', { cotizacionId: d.cotizacionRecicladaId, tasaBcv: 100 }, this.salesperson.id); const result = await this.api('/api/cotizaciones/crear-version', 'POST', { cotizacionId: d.cotizacionRecicladaId, notasCambio: 'Versión de prueba determinista' }, this.salesperson.id); d.cotizacionVersionId = result.id }
  f.assert_version = async () => { const row = await dbSingle('cotizaciones', 'estado,version,cotizacion_raiz_id', d.cotizacionVersionId); assert(row.estado === 'borrador' && Number(row.version) >= 2 && !!row.cotizacion_raiz_id, row, 'versión') }
  f.venta_rapida = async () => { const result = await this.api('/api/ventas-rapidas/crear', 'POST', { clienteId: d.clienteId, transportistaId: d.transportistaTestId, fleteUsd: 50, formaPago: 'Efectivo $', formaPagoCliente: '', referenciaPago: 'REF-TEST-VR', notas: 'Venta rápida determinista', notasCliente: '', direccionEnvioEstado: 'Aragua', direccionEnvioCiudad: 'Maracay', items: [{ productoId: d.productoId, cantidad: 5, precioUnitUsd: 25 }], descuentoGlobalPct: 0, costoEnvioUsd: 0, tasaBcv: 100 }, this.salesperson.id); d.ventaRapidaDespachoId = result.id; d.ventaRapidaCotizacionId = result.cotizacionId }
  f.assert_vr_cotizacion = async () => { const row = await dbSingle('cotizaciones', 'estado,total_usd', d.ventaRapidaCotizacionId); assert(row.estado === 'aceptada' && Number(row.total_usd) === 175, row, 'VR cotización') }
  f.assert_vr_despacho = async () => { const row = await dbSingle('notas_despacho', 'estado,forma_pago,total_usd,transportista_id,flete_usd,flete_neto_transportista_usd,flete_comisionable,flete_regla_aplicada,flete_estado_destino_snapshot,flete_pagado', d.ventaRapidaDespachoId); assert(row.estado === 'pendiente' && row.forma_pago === 'Efectivo $' && Number(row.total_usd) === 175 && row.transportista_id === d.transportistaTestId && Number(row.flete_usd) === 50 && Number(row.flete_neto_transportista_usd) > 0 && row.flete_comisionable === true && row.flete_regla_aplicada === 'comision_fuera_carabobo' && row.flete_estado_destino_snapshot === 'Aragua' && row.flete_pagado === false, row, 'VR despacho fuera de Carabobo'); d.transportistaNeto = Number(row.flete_neto_transportista_usd) }
  f.deliver_vr_for_reversal = async () => {
    d.vrApprovalKey = globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000053'
    await this.api('/api/despachos/estado', 'POST', { despachoId: d.ventaRapidaDespachoId, nuevoEstado: 'despachada', idempotencyKey: d.vrApprovalKey })
    d.vrDeliveryKey = globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000054'
    await this.api('/api/despachos/estado', 'POST', { despachoId: d.ventaRapidaDespachoId, nuevoEstado: 'entregada', idempotencyKey: d.vrDeliveryKey })
  }
  f.assert_vr_delivered = async () => {
    const row = await dbSingle('notas_despacho', 'estado', d.ventaRapidaDespachoId)
    assert(row.estado === 'entregada', 'entregada', row, 'VR entregada para reversión')
    await assertStock(105, 'stock VR entregada')
    const movements = await this.db(this.supabase.from('inventario_movimientos').select('id').eq('producto_id', d.productoId).eq('idempotency_key', d.vrDeliveryKey), 'Kardex VR entrega')
    const commissions = await this.db(this.supabase.from('comisiones').select('id').eq('despachoid', d.ventaRapidaDespachoId), 'comisión VR entrega')
    assert(movements?.length === 1, 1, movements?.length, 'Kardex VR entrega')
    assert(commissions?.length === 1, 1, commissions?.length, 'comisión VR entrega')
  }
  f.revert_vr_delivery = async () => {
    d.vrReverseKey = globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000055'
    await this.api('/api/despachos/estado', 'POST', { despachoId: d.ventaRapidaDespachoId, nuevoEstado: 'despachada', idempotencyKey: d.vrReverseKey })
  }
  f.assert_vr_reverted = async () => {
    const row = await dbSingle('notas_despacho', 'estado', d.ventaRapidaDespachoId)
    assert(row.estado === 'despachada', 'despachada', row, 'VR revertida')
    await assertStock(110, 'stock VR restaurado')
    const movements = await this.db(this.supabase.from('inventario_movimientos').select('id').eq('producto_id', d.productoId).eq('idempotency_key', d.vrReverseKey), 'Kardex reversión VR')
    const commissions = await this.db(this.supabase.from('comisiones').select('id').eq('despachoid', d.ventaRapidaDespachoId), 'comisión reversión VR')
    assert(movements?.length === 1, 1, movements?.length, 'un Kardex de reversión VR')
    assert(commissions?.length === 0, 0, commissions?.length, 'comisión revertida VR')
  }
  f.replay_vr_reversal = async () => {
    const replay = await this.api('/api/despachos/estado', 'POST', { despachoId: d.ventaRapidaDespachoId, nuevoEstado: 'despachada', idempotencyKey: d.vrReverseKey })
    assert(replay?.ok === true && replay?.idempotent === true && replay?.nuevoEstado === 'despachada', 'replay reversión idempotente', replay, 'replay reversión VR')
  }
  f.assert_vr_reversal_replay = async () => {
    await assertStock(110, 'stock sin doble reversión VR')
    const movements = await this.db(this.supabase.from('inventario_movimientos').select('id').eq('producto_id', d.productoId).eq('idempotency_key', d.vrReverseKey), 'Kardex replay reversión VR')
    const commissions = await this.db(this.supabase.from('comisiones').select('id').eq('despachoid', d.ventaRapidaDespachoId), 'comisión replay reversión VR')
    assert(movements?.length === 1, 1, movements?.length, 'sin Kardex duplicado por replay de reversión')
    assert(commissions?.length === 0, 0, commissions?.length, 'sin comisión recreada por replay de reversión')
  }
  f.assert_transportista_report = async () => { const result = await this.api('/api/transportistas/reporte'); const row = (result.items || []).find(item => item.id === d.transportistaTestId); assert(!!row, row, 'transportista reporte'); assert(row.es_local === true && Number(row.despachos) >= 1 && Number(row.despachos_comisionables) >= 1 && Number(row.flete_total_usd) >= 50 && Number(row.saldo_usd) >= d.transportistaNeto - 0.01 && Number(row.flete_nomina_usd || 0) === 0, row, 'reporte transportista externo') }
  f.assert_stock_post_vr = () => assertStock(110, 'stock VR después de reversión')
  f.anular_despacho = async () => {
    await this.api('/api/despachos/estado', 'POST', {
      despachoId: d.ventaRapidaDespachoId,
      nuevoEstado: 'pendiente',
      motivo_devolucion: 'Reapertura controlada para anulación E2E',
      idempotencyKey: globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000056',
    })
    await this.api('/api/despachos/estado', 'POST', {
      despachoId: d.ventaRapidaDespachoId,
      nuevoEstado: 'anulada',
      motivo_anulacion: 'Anulación posterior a reversión E2E',
      idempotencyKey: globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000057',
    })
  }
  f.assert_despacho_anulado = async () => { const row = await dbSingle('notas_despacho', 'estado', d.ventaRapidaDespachoId); assert(row.estado === 'anulada', 'anulada', row.estado, 'VR anulada'); await assertStock(110, 'stock tras anular VR') }
  f.reciclar_despacho = async () => { const result = await this.api('/api/despachos/reciclar', 'POST', { despachoId: d.ventaRapidaDespachoId }); d.cotizacionDesdeDespachoId = result.id }
  f.assert_despacho_reciclado = async () => { const row = await dbSingle('cotizaciones', 'estado,cliente_id', d.cotizacionDesdeDespachoId); assert(row.estado === 'borrador' && row.cliente_id === d.clienteId, row, 'cotización desde despacho'); const items = await this.db(this.supabase.from('cotizacion_items').select('id').eq('cotizacion_id', d.cotizacionDesdeDespachoId), 'items desde despacho'); assert(items?.length > 0, items, 'items desde despacho') }
  f.reasignar_cliente = async () => { const sellers = await this.db(this.supabase.from('usuarios').select('id').eq('rol', 'vendedor').eq('activo', true).limit(10), 'buscar vendedor alterno'); const alternate = (sellers || []).find(row => row.id !== this.salesperson.id); if (!alternate) { this.log('SKIP: no hay vendedor alterno en staging', 'WARN'); return } d.otroVendedorId = alternate.id; await this.api('/api/clientes/reasignar', 'POST', { clienteId: d.clienteId, nuevoVendedorId: alternate.id, motivo: TEST.reasignacion.motivo }) }
  f.assert_reasignacion = async () => { if (!d.otroVendedorId) { this.log('SKIP: no había vendedor alterno', 'WARN'); return } const row = await dbSingle('clientes', 'vendedor_id,ultima_reasig_motivo', d.clienteId); assert(row.vendedor_id === d.otroVendedorId && row.ultima_reasig_motivo === TEST.reasignacion.motivo, row, 'reasignación') }
  f.health_api_endpoints = async () => { for (const route of ['/api/config', '/api/comisiones/config']) { await this.api(route); this.log(`${route} → OK ✓`, 'OK') } }
  f.health_rls_policies = async () => { for (const table of ['productos', 'clientes', 'usuarios', 'cotizaciones', 'transportistas', 'inventario_movimientos']) { const result = await this.supabase.from(table).select('id', { count: 'exact', head: true }).limit(1); if (result.error) throw new Error(`RLS ${table}: ${result.error.message}`) } }
  f.health_config = async () => { const cfg = await this.db(this.supabase.from('configuracion_negocio').select('comision_pct_cabilla,comision_pct_otros,comision_categoria_cabilla').limit(1).maybeSingle(), 'configuración'); assert(cfg !== null, 'registro', cfg, 'configuración'); for (const key of ['comision_pct_cabilla', 'comision_pct_otros', 'comision_categoria_cabilla']) assert(cfg[key] !== null && cfg[key] !== undefined, 'definido', cfg[key], key) }
  f.health_nav_routes = async () => { for (const route of ['/', '/cotizaciones', '/clientes', '/inventario', '/despachos', '/configuracion', '/reportes', '/tester']) { const response = await fetch(`${this.config.frontendOrigin}${route}`, { headers: { Accept: 'text/html' } }); assert(response.ok, 200, response.status, route) } }
  f.health_kardex_continuity = async () => {
    const productIds = [d.productoId, d.producto2Id].filter(Boolean)
    const rows = await this.db(this.supabase.from('inventario_movimientos').select('producto_id,tipo,cantidad,stock_anterior,stock_nuevo,creado_en,numero').in('producto_id', productIds).order('creado_en', { ascending: true }).order('numero', { ascending: true }), 'Kardex fixtures')
    const invalid = []
    for (const productId of productIds) {
      const productRows = (rows || []).filter(row => row.producto_id === productId)
      let previous = null
      for (const row of productRows) {
        const expected = round2(Number(row.stock_anterior) + (row.tipo === 'ingreso' ? Number(row.cantidad) : -Number(row.cantidad)))
        if (Math.abs(expected - Number(row.stock_nuevo)) > 0.01 || (previous && Math.abs(Number(previous.stock_nuevo) - Number(row.stock_anterior)) > 0.01)) invalid.push(row)
        previous = row
      }
      const product = await dbSingle('productos', 'stock_actual', productId)
      if (previous && Math.abs(Number(product.stock_actual) - Number(previous.stock_nuevo)) > 0.01) invalid.push({ productId, current: product.stock_actual, last: previous.stock_nuevo })
    }
    assert(invalid.length === 0, 0, invalid, 'continuidad matemática y stock actual de fixtures')
  }
  f.health_stock_negativo_guard = async () => { const row = await dbSingle('productos', 'stock_actual', d.productoId); assert(Number(row.stock_actual) >= 0, '>=0', row.stock_actual, 'guardarraíl stock') }
  f.cleanup = async () => { if (this.config.keepData) { this.log('SKIP por --keep-data', 'WARN'); return } await this.cleanupFixtures() }
  f.assert_cleanup = async () => { if (this.config.keepData) { this.log('SKIP por --keep-data', 'WARN'); return } for (const [table, id] of [['productos', d.productoId], ['productos', d.producto2Id], ['cotizaciones', d.cotizacionId], ['cotizaciones', d.cotizacion2Id], ['notas_despacho', d.despachoId], ['notas_despacho', d.ventaRapidaDespachoId]]) { if (!id) continue; const rows = await this.db(this.supabase.from(table).select('id').eq('id', id), `verificar ${table}`); assert(!rows?.length, 0, rows?.length, `${table}.${id8(id)} eliminado`) } const client = await this.db(this.supabase.from('clientes').select('activo').eq('id', d.clienteId), 'verificar cliente'); assert(!client?.length || client[0].activo === false, 'inactivo/eliminado', client?.[0]?.activo, 'cliente limpio') }
  f.split_setup = async () => { await this.splitSetup() }
  // ── T0: designación del vendedor del día (solo jefe) ──────────────────
  f.split_t0_designar = async () => {
    if (d.splitSkip) return
    d.splitFechaHoy = fechaCaracas().fecha
    const res = await this.apiAsJefe('/api/comisiones/designacion', 'POST', { fecha: d.splitFechaHoy, designado_id: d.splitDesignadoId })
    assert(res?.ok === true && res.designacion?.designado_id === d.splitDesignadoId, res, 'T0: designación creada')
  }
  f.split_assert_t0 = async () => {
    if (d.splitSkip) return
    const rows = await this.db(
      this.supabase.from('comision_designacion_diaria').select('*').eq('cuenta_id', this.user.id).eq('fecha', d.splitFechaHoy),
      'designación hoy'
    )
    assert(rows?.length === 1, 1, rows?.length, 'T0: una sola designación para la fecha (UNIQUE cuenta+fecha)')
    assert(rows[0].designado_id === d.splitDesignadoId && rows[0].creado_por === d.splitJefeId, rows[0], 'T0: designado y creado_por')
  }
  f.split_t0b_no_jefe = async () => {
    if (d.splitSkip) return
    try {
      await this.api('/api/comisiones/designacion', 'POST', { fecha: d.splitFechaHoy, designado_id: d.splitDesignadoId }, this.salesperson.id)
      throw new Error('ASSERTION FAILED: un vendedor pudo designar')
    } catch (error) {
      if (String(error.message || '').includes('ASSERTION FAILED')) throw error
      assert(error instanceof ApiError && error.status === 403, '403', { status: error.status, message: error.message }, 'T0b: vendedor no puede designar')
    }
  }
  f.split_t0c_invalido = async () => {
    if (d.splitSkip) return
    try {
      await this.apiAsJefe('/api/comisiones/designacion', 'POST', { fecha: d.splitFechaHoy, designado_id: d.splitJefeId })
      throw new Error('ASSERTION FAILED: se designó a un jefe')
    } catch (error) {
      if (String(error.message || '').includes('ASSERTION FAILED')) throw error
      assert(error instanceof ApiError && error.status === 400, '400', { status: error.status, message: error.message }, 'T0c: jefe no puede ser designado')
    }
    // G8 del Worker: los % del split nunca superan el % general vigente
    try {
      await this.api('/api/admin/config', 'PUT', { comision_split_pct_vendedor: 9 })
      throw new Error('ASSERTION FAILED: G8 aceptó pct split 9% > general')
    } catch (error) {
      if (String(error.message || '').includes('ASSERTION FAILED')) throw error
      assert(error instanceof ApiError && error.status === 400, '400', { status: error.status, message: error.message }, 'T0c: G8 rechaza % split > % general')
    }
  }
  f.split_t1_crear = async () => { if (d.splitSkip) return; d.splitT1 = await this.runSplitSale({ cantidad: 4, formaPago: 'Efectivo $', clienteId: d.splitClienteAjenoId }) }
  f.split_assert_t1 = async () => {
    if (d.splitSkip) return
    const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.splitT1.despachoId), 'comisiones T1')
    assert(rows?.length === 2, 2, rows?.length, 'T1: exactamente 2 filas')
    const owner = rows.find(r => r.vendedorid === d.splitDuenoId)
    const designated = rows.find(r => r.vendedorid === d.splitDesignadoId)
    assert(!!owner && !!designated, 'dueño+designado', rows.map(r => r.vendedorid), 'T1 beneficiarios')
    const base = 100
    const expOwner = round2(base * d.splitPctD / 100)
    const expDesig = round2(base * d.splitPctV / 100)
    assert(Number(owner.totalcomision) === expOwner, expOwner, owner.totalcomision, 'T1 comisión dueño (1.5%)')
    assert(Number(designated.totalcomision) === expDesig, expDesig, designated.totalcomision, 'T1 comisión designado (0.5%)')
    assert(!rows.some(r => r.vendedorid === this.salesperson.id), 'sin fila del vendedor que vendió', rows.map(r => r.vendedorid), 'T1: el vendedor que vendió NO cobra')
    assert(Number(owner.pctcabilla) === d.splitPctD && Number(designated.pctcabilla) === d.splitPctV, 'pcts planos', rows.map(r => r.pctcabilla), 'T1 pcts')
    assert(owner.calculo_evidencia?.split_cliente_ajeno === true && designated.calculo_evidencia?.split_cliente_ajeno === true, true, 'evidencia', 'T1 evidencia split')
    assert(owner.calculo_evidencia?.split_designado_id === d.splitDesignadoId, d.splitDesignadoId, owner.calculo_evidencia?.split_designado_id, 'T1 evidencia designado')
    assert(rows.every(r => r.estado === 'generada'), 'generada', rows.map(r => r.estado), 'T1 estado')
    assert(Number(owner.comision_liberada) === expOwner && Number(designated.comision_liberada) === expDesig, 'liberada=total', rows, 'T1 liberada')
    d.splitT1OwnerId = owner.id
    d.splitT1DesignadoId = designated.id
  }
  f.split_t2_replay = async () => {
      if (d.splitSkip) return
      try { await this.api('/api/despachos/estado', 'POST', { despachoId: d.splitT1.despachoId, nuevoEstado: 'entregada' }) } catch (e) { this.log(`replay entrega rechazado (aceptable): ${e.message}`, 'INFO') }
      const rows = await this.db(this.supabase.from('comisiones').select('id,totalcomision').eq('despachoid', d.splitT1.despachoId), 'comisiones T1 replay')
      assert(rows?.length === 2, 2, rows?.length, 'T2: replay no duplica filas')
  }
  f.split_t3_cliente_propio = async () => { if (d.splitSkip) return; d.splitT3 = await this.runSplitSale({ cantidad: 2, formaPago: 'Efectivo $', clienteId: d.splitClientePropioId }) }
  f.split_assert_t3 = async () => {
      if (d.splitSkip) return
      const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.splitT3.despachoId), 'comisiones T3')
      assert(rows?.length === 1, 1, rows?.length, 'T3: cliente propio → 1 fila')
      const cfg = await this.db(this.supabase.from('configuracion_negocio').select('comision_pct_cabilla,comision_pct_otros,comision_categoria_cabilla').eq('cuenta_id', this.user.id).limit(1).maybeSingle(), 'config T3')
      const isCab = TEST.producto.categoria.toLowerCase() === String(cfg?.comision_categoria_cabilla || '').toLowerCase().trim()
      const pct = Number(isCab ? cfg?.comision_pct_cabilla : cfg?.comision_pct_otros)
      const exp = round2(50 * pct / 100)
      assert(Number(rows[0].totalcomision) === exp, exp, rows[0].totalcomision, 'T3 comisión normal')
      assert(rows[0].vendedorid === this.salesperson.id, this.salesperson.id, rows[0].vendedorid, 'T3 beneficiario=dueño')
      assert(rows[0].calculo_evidencia?.split_cliente_ajeno !== true, false, rows[0].calculo_evidencia?.split_cliente_ajeno, 'T3 sin split')
  }
  f.split_t4_dia_no_config = async () => {
      if (d.splitSkip) return
      await this.splitSetConfig({ comision_split_dias: String((d.splitTodayDow + 1) % 7) })
      d.splitT4 = await this.runSplitSale({ cantidad: 2, formaPago: 'Efectivo $', clienteId: d.splitClienteAjenoId })
  }
  f.split_assert_t4 = async () => {
      if (d.splitSkip) return
      const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.splitT4.despachoId), 'comisiones T4')
      assert(rows?.length === 1, 1, rows?.length, 'T4: día no configurado → sin split (aunque haya designado)')
      assert(rows[0].vendedorid === d.splitDuenoId, d.splitDuenoId, rows[0].vendedorid, 'T4 dueño con % normal')
      assert(rows[0].calculo_evidencia?.split_cliente_ajeno !== true, false, rows[0].calculo_evidencia?.split_cliente_ajeno, 'T4 sin split')
      await this.splitSetConfig({ comision_split_dias: String(d.splitTodayDow) })
  }
  f.split_t4b_sin_designacion = async () => {
      if (d.splitSkip) return
      await this.apiAsJefe('/api/comisiones/designacion', 'DELETE', { fecha: d.splitFechaHoy })
      d.splitT4b = await this.runSplitSale({ cantidad: 2, formaPago: 'Efectivo $', clienteId: d.splitClienteAjenoId })
  }
  f.split_assert_t4b = async () => {
      if (d.splitSkip) return
      const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.splitT4b.despachoId), 'comisiones T4b')
      assert(rows?.length === 1, 1, rows?.length, 'T4b: sin designación → sin split')
      assert(rows[0].vendedorid === d.splitDuenoId, d.splitDuenoId, rows[0].vendedorid, 'T4b: el dueño cobra su % normal completo')
      assert(rows[0].calculo_evidencia?.split_cliente_ajeno !== true, false, rows[0].calculo_evidencia?.split_cliente_ajeno, 'T4b sin split')
  }
  f.split_t5_switch_off = async () => {
      if (d.splitSkip) return
      await this.splitSetConfig({ comision_split_activo: false, comision_split_dias: '' })
      d.splitT5 = await this.runSplitSale({ cantidad: 2, formaPago: 'Efectivo $', clienteId: d.splitClienteAjenoId })
      await this.splitSetConfig({ comision_split_activo: true, comision_split_dias: String(d.splitTodayDow) })
  }
  f.split_assert_t5 = async () => {
      if (d.splitSkip) return
      const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.splitT5.despachoId), 'comisiones T5')
      assert(rows?.length === 1, 1, rows?.length, 'T5: switch apagado → sin split')
      assert(rows[0].vendedorid === d.splitDuenoId, 'dueño', rows[0].vendedorid, 'T5 beneficiario')
  }
  f.split_t6_devolucion = async () => {
      if (d.splitSkip) return
      // Re-designar (T4b quitó la designación) para probar la devolución sobre un despacho split activo
      await this.apiAsJefe('/api/comisiones/designacion', 'POST', { fecha: d.splitFechaHoy, designado_id: d.splitDesignadoId })
      const item = await this.db(this.supabase.from('notas_despacho_items').select('id,producto_id').eq('despacho_id', d.splitT1.despachoId).single(), 'item T6')
      d.splitT6Key = globalThis.crypto?.randomUUID?.()
      await this.api('/api/despachos/devolucion-parcial', 'POST', {
        despachoId: d.splitT1.despachoId,
        items: [{ despacho_item_id: item.id, producto_id: item.producto_id, cantidad_devuelta: 1 }],
        motivo: 'Devolución split E2E',
        generarReemplazo: false,
        exchangeItems: [],
        pagosDiferencia: [],
        idempotencyKey: d.splitT6Key,
      })
  }
  f.split_assert_t6 = async () => {
      if (d.splitSkip) return
      const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.splitT1.despachoId), 'comisiones T6')
      assert(rows?.length === 2, 2, rows?.length, 'T6: 2 filas tras devolución')
      const factor = 0.75
      const expOwner = round2(round2(100 * d.splitPctD / 100) * factor)
      const expDesig = round2(round2(100 * d.splitPctV / 100) * factor)
      const owner = rows.find(r => r.id === d.splitT1OwnerId)
      const designated = rows.find(r => r.id === d.splitT1DesignadoId)
      assert(Number(owner.totalcomision) === expOwner, expOwner, owner.totalcomision, 'T6 dueño escalada')
      assert(Number(designated.totalcomision) === expDesig, expDesig, designated.totalcomision, 'T6 designado escalada')
      assert(owner.estado === 'pendiente' && designated.estado === 'pendiente', 'pendiente', rows.map(r => r.estado), 'T6 estado tras devolución')
  }
  f.split_t7_pago_fila = async () => {
      if (d.splitSkip) return
      await this.api('/api/comisiones/pagar', 'POST', { comisionId: d.splitT1DesignadoId })
  }
  f.split_assert_t7 = async () => {
      if (d.splitSkip) return
      const rows = await this.db(this.supabase.from('comisiones').select('id,estado,montopagado').eq('despachoid', d.splitT1.despachoId), 'comisiones T7')
      const designated = rows.find(r => r.id === d.splitT1DesignadoId)
      const owner = rows.find(r => r.id === d.splitT1OwnerId)
      assert(designated.estado === 'pagada' && Number(designated.montopagado) > 0, 'pagada', designated, 'T7 fila designado pagada')
      assert(owner.estado !== 'pagada' && Number(owner.montopagado || 0) === 0, 'intacta', owner, 'T7 fila dueño intacta')
  }
  f.split_t8_cxc = async () => { if (d.splitSkip) return; d.splitT8 = await this.runSplitSale({ cantidad: 2, formaPago: 'Cta por cobrar', clienteId: d.splitClienteAjenoId }) }
  f.split_assert_t8 = async () => {
      if (d.splitSkip) return
      const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.splitT8.despachoId), 'comisiones T8')
      assert(rows?.length === 2, 2, rows?.length, 'T8: 2 filas CxC')
      const owner = rows.find(r => r.vendedorid === d.splitDuenoId)
      const designated = rows.find(r => r.vendedorid === d.splitDesignadoId)
      for (const r of rows) {
        assert(Number(r.totalcomision) === 0, 0, r.totalcomision, 'T8 comisión 0')
        assert(Number(r.fraccion_no_cxc) === 0, 0, r.fraccion_no_cxc, 'T8 fracción 0')
        assert(r.calculo_evidencia?.payment_split?.fraction === 0, 0, r.calculo_evidencia?.payment_split, 'T8 payment_split')
      }
      assert(Number(owner.comision_cxc_excluida) === round2(50 * d.splitPctD / 100), round2(50 * d.splitPctD / 100), owner.comision_cxc_excluida, 'T8 excluida dueño')
      assert(Number(designated.comision_cxc_excluida) === round2(50 * d.splitPctV / 100), round2(50 * d.splitPctV / 100), designated.comision_cxc_excluida, 'T8 excluida designado')
  }
  f.split_t9_designado_dueno = async () => {
      if (d.splitSkip) return
      // El designado del día vende a SU PROPIO cliente → cobra su % normal (es dueño), sin split
      d.splitT9 = await this.runSplitSale({ cantidad: 2, formaPago: 'Efectivo $', clienteId: d.splitClienteDesignadoId, vendedorId: d.splitDesignadoId })
  }
  f.split_assert_t9 = async () => {
      if (d.splitSkip) return
      const rows = await this.db(this.supabase.from('comisiones').select('*').eq('despachoid', d.splitT9.despachoId), 'comisiones T9')
      assert(rows?.length === 1, 1, rows?.length, 'T9: designado=dueño → 1 fila')
      const cfg = await this.db(this.supabase.from('configuracion_negocio').select('comision_pct_cabilla,comision_pct_otros,comision_categoria_cabilla').eq('cuenta_id', this.user.id).limit(1).maybeSingle(), 'config T9')
      const isCab = TEST.producto.categoria.toLowerCase() === String(cfg?.comision_categoria_cabilla || '').toLowerCase().trim()
      const pct = Number(isCab ? cfg?.comision_pct_cabilla : cfg?.comision_pct_otros)
      const exp = round2(50 * pct / 100)
      assert(Number(rows[0].totalcomision) === exp, exp, rows[0].totalcomision, 'T9 comisión normal del dueño')
      assert(rows[0].vendedorid === d.splitDesignadoId, d.splitDesignadoId, rows[0].vendedorid, 'T9 beneficiario=designado/dueño')
      assert(rows[0].calculo_evidencia?.split_cliente_ajeno !== true, false, rows[0].calculo_evidencia?.split_cliente_ajeno, 'T9 sin split')
  }
  f.split_assert_lista = async () => {
      if (d.splitSkip) return
      const lista = await this.api(`/api/comisiones/lista?despachoId=${d.splitT1.despachoId}`)
      const items = lista?.data || []
      assert(items.length === 2, 2, items.length, 'lista: 2 filas T1')
      const dueno = items.find(i => i.vendedorid === d.splitDuenoId)
      const designado = items.find(i => i.vendedorid === d.splitDesignadoId)
      assert(dueno?.tipo === 'cliente_ajeno_dueno', 'cliente_ajeno_dueno', dueno?.tipo, 'lista tipo dueño')
      assert(designado?.tipo === 'designado', 'designado', designado?.tipo, 'lista tipo designado')
  }
  f.split_cleanup_designacion = async () => {
      if (d.splitSkip) return
      const res = await this.apiAsJefe('/api/comisiones/designacion', 'DELETE', { fecha: d.splitFechaHoy })
      assert(res?.ok === true, res, 'designación eliminada')
      const rows = await this.db(this.supabase.from('comision_designacion_diaria').select('id').eq('cuenta_id', this.user.id).eq('fecha', d.splitFechaHoy), 'designación tras DELETE')
      assert(!rows?.length, 0, rows?.length, 'designación eliminada en BD')
  }
  f.split_restore_config = async () => {
      if (!d.splitCfgOriginal) return
      await this.splitSetConfig({
        comision_split_activo: d.splitCfgOriginal.comision_split_activo ?? true,
        comision_split_pct_vendedor: d.splitCfgOriginal.comision_split_pct_vendedor ?? 0.5,
        comision_split_pct_dueno: d.splitCfgOriginal.comision_split_pct_dueno ?? 1.5,
        comision_split_dias: d.splitCfgOriginal.comision_split_dias ?? '6',
      })
      this.log('Config split restaurada ✓', 'OK')
  }
  for (const step of STEPS) await this.runStep(step, f[step.id])
}

export async function main() {
  let config
  try { config = await loadConfig() } catch (error) {
    console.error(`E2E STAGING NO EJECUTADO: ${error.message}`)
    return 2
  }
  const runner = new StagingE2ERunner(config)
  await runner.initLog()
  const started = Date.now()
  let failure = null
  try {
    runner.log('╔══════════════════════════════════════════════════════════════╗')
    runner.log('║  TESTER E2E AUTOMÁTICO — SOLO STAGING                       ║')
    runner.log('╚══════════════════════════════════════════════════════════════╝')
    runner.log(`Proyecto esperado: ${STAGING_PROJECT_REF}; frontend=${config.frontendOrigin}; worker=${config.workerOrigin}`)
    runner.log(`Fixtures: ${TEST.producto.codigo}, ${TEST.producto2.codigo}, ${TEST.cliente.rif_cedula}`)
    await runner.ping()
    await runner.auth()
    await runner.resolveCommissionSeller()
    await runner.execute()
  } catch (error) {
    failure = error
    runner.log(`Fallo principal: ${error.message}`, 'FAIL')
    if (!config.keepData && runner.user && Object.keys(runner.data).length > 0) {
      try {
        runner.log('Limpieza de emergencia tras fallo...', 'WARN')
        await runner.cleanupFixtures()
        runner.log('Limpieza de emergencia completada', 'OK')
      } catch (cleanupError) {
        runner.log(`Limpieza de emergencia incompleta: ${cleanupError.message}`, 'FAIL')
      }
    }
  }
  const passed = runner.results.filter(result => result.status === 'pass').length
  const failed = runner.results.filter(result => result.status === 'fail').length + (failure && !failedResult(runner) ? 1 : 0)
  runner.log(`\nResultado: ${failure ? `FALLÓ — ${failure.message}` : 'TODOS LOS PASOS PASARON ✓'}`)
  runner.log(`Pasos pasados: ${passed}/${STEPS.length}; pasos fallidos: ${failed}; tiempo: ${((Date.now() - started) / 1000).toFixed(2)}s`)
  runner.log(`Log persistido en: ${runner.logFile}`, 'OK')
  await runner.persist()
  if (failure) return 1
  return 0
}

function failedResult(runner) {
  return runner.results.some(result => result.status === 'fail')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
