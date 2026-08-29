import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { assertStagingConfig, parseEnvFile, STAGING_PROJECT_REF } from './test-e2e-staging.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const stagingRoot = path.resolve(here, '..')
const repoRoot = path.resolve(stagingRoot, '..')
const AUDIT_PAGE_SIZE = 1000
const EPSILON = 0.01

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function signedDelta(row) {
  const quantity = Number(row?.cantidad || 0)
  return row?.tipo === 'ingreso' ? quantity : -quantity
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? round2(number) : null
}

function classifyReason(row) {
  const type = String(row?.motivo_tipo || '').toLowerCase()
  const reason = String(row?.motivo || '').toLowerCase()
  if (type === 'devolucion' || /devoluci[oó]n|reintegro|retorno/.test(reason)) return 'devolucion'
  if (type === 'venta' || /entrega|despacho|venta|anulaci[oó]n|reversi[oó]n/.test(reason)) return 'venta/despacho'
  if (type === 'ajuste_inventario' || /ajuste|reconciliaci[oó]n|conteo|editar producto/.test(reason)) return 'ajuste_inventario'
  if (type === 'compra_proveedor' || /compra|proveedor|ingreso inicial/.test(reason)) return 'compra/ingreso'
  if (type === 'merma' || /merma|dañado|da[nñ]o|p[eé]rdida/.test(reason)) return 'merma'
  if (type === 'transferencia' || /transfer/.test(reason)) return 'transferencia'
  return type || 'otro'
}

function id8(value) {
  return value ? `${String(value).slice(0, 8)}...` : null
}

function compareNumber(left, right) {
  return Math.abs(Number(left) - Number(right)) > EPSILON
}

// PostgreSQL exposes TIMESTAMPTZ with microseconds, while Date#getTime()
// truncates them to milliseconds. Keeping the sub-millisecond remainder is
// required to place a compensating movement immediately before its anchor;
// otherwise the numeric Kardex sequence can be reordered by `numero` again.
function compareTimestamps(left, right) {
  const leftText = String(left || '')
  const rightText = String(right || '')
  const leftMs = Date.parse(leftText)
  const rightMs = Date.parse(rightText)
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs

  const fraction = value => {
    const match = String(value || '').match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)
    return Number((match?.[1] || '').padEnd(6, '0').slice(3, 6))
  }
  const subMillisecondDiff = fraction(leftText) - fraction(rightText)
  if (subMillisecondDiff !== 0) return subMillisecondDiff
  return leftText.localeCompare(rightText)
}

export function auditKardex(products = [], movements = []) {
  const byProduct = new Map()
  for (const movement of movements) {
    if (!movement?.producto_id) continue
    const rows = byProduct.get(movement.producto_id) || []
    rows.push(movement)
    byProduct.set(movement.producto_id, rows)
  }

  const productsById = new Map(products.map(product => [product.id, product]))
  const productReports = []
  const anomalies = []

  for (const [productId, rows] of byProduct) {
    const chronological = [...rows].sort((a, b) => {
      const dateDiff = compareTimestamps(a.creado_en, b.creado_en)
      if (dateDiff !== 0) return dateDiff
      const numberDiff = Number(a.numero || 0) - Number(b.numero || 0)
      if (numberDiff !== 0) return numberDiff
      return String(a.id).localeCompare(String(b.id))
    })

    let internalMathErrors = 0
    let continuityGaps = 0
    let missingProvenance = 0
    let structuredProvenanceMissing = 0
    let previous = null
    const productAnomalies = []

    for (const row of chronological) {
      const expectedNew = round2(Number(row.stock_anterior) + signedDelta(row))
      const actualNew = round2(Number(row.stock_nuevo))
      const internalMathError = compareNumber(expectedNew, actualNew)
      const continuityGap = previous && compareNumber(previous.stock_nuevo, row.stock_anterior)
      const missingRowProvenance = !row.cuenta_id || !row.usuario_id || !row.usuario_nombre || !row.motivo || !row.motivo_tipo
      const missingStructuredRowProvenance = !row.origen_tipo || !row.origen_id || !row.idempotency_key

      if (internalMathError) internalMathErrors += 1
      if (continuityGap) continuityGaps += 1
      if (missingRowProvenance) missingProvenance += 1
      if (missingStructuredRowProvenance) structuredProvenanceMissing += 1

      // La ausencia de provenance estructurado se reporta como deuda, pero no
      // se convierte por sí sola en un ajuste de stock histórico.
      if (internalMathError || continuityGap || missingRowProvenance) {
        const anomaly = {
          product_id: productId,
          product_code: productsById.get(productId)?.codigo || null,
          product_name: productsById.get(productId)?.nombre || row.producto_nombre || null,
          movement_id: row.id,
          movement_number: row.numero ?? null,
          created_at: row.creado_en,
          type: row.tipo,
          quantity: numberOrNull(row.cantidad),
          stock_before: numberOrNull(row.stock_anterior),
          stock_after: numberOrNull(row.stock_nuevo),
          expected_stock_after: expectedNew,
          reason_type: classifyReason(row),
          reason: row.motivo || null,
          batch_id: row.lote_id || null,
          operator_id: id8(row.usuario_id),
          operator_name: row.usuario_nombre || null,
          account_id: id8(row.cuenta_id),
          origin_type: row.origen_tipo || null,
          origin_id: row.origen_id || null,
          origin_reference: row.origen_referencia || null,
          idempotency_key: row.idempotency_key || null,
          internal_math_error: internalMathError,
          continuity_gap: continuityGap,
          continuity_delta: continuityGap ? round2(Number(row.stock_anterior) - Number(previous.stock_nuevo)) : 0,
          missing_provenance: missingRowProvenance,
          missing_structured_provenance: missingStructuredRowProvenance,
          previous_movement: previous ? {
            movement_id: previous.id,
            movement_number: previous.numero ?? null,
            stock_after: numberOrNull(previous.stock_nuevo),
            created_at: previous.creado_en,
            reason_type: classifyReason(previous),
            reason: previous.motivo || null,
          } : null,
        }
        productAnomalies.push(anomaly)
        anomalies.push(anomaly)
      }
      previous = row
    }

    const product = productsById.get(productId)
    const last = chronological.at(-1)
    const stockCurrent = product ? numberOrNull(product.stock_actual) : null
    const lastKardexStock = last ? numberOrNull(last.stock_nuevo) : null
    const currentStockMismatch = stockCurrent !== null && lastKardexStock !== null && compareNumber(stockCurrent, lastKardexStock)
    if (currentStockMismatch) {
      const anomaly = {
        product_id: productId,
        product_code: product?.codigo || null,
        product_name: product?.nombre || last?.producto_nombre || null,
        movement_id: last?.id || null,
        movement_number: last?.numero ?? null,
        created_at: last?.creado_en || null,
        reason_type: 'stock_actual_vs_kardex',
        stock_actual: stockCurrent,
        last_kardex_stock: lastKardexStock,
        difference: round2(stockCurrent - lastKardexStock),
        internal_math_error: false,
        continuity_gap: false,
        missing_provenance: false,
        missing_structured_provenance: last ? (!last.origen_tipo || !last.origen_id || !last.idempotency_key) : false,
      }
      productAnomalies.push(anomaly)
      anomalies.push(anomaly)
    }

    productReports.push({
      product_id: productId,
      product_code: product?.codigo || null,
      product_name: product?.nombre || rows[0]?.producto_nombre || null,
      account_id: id8(product?.cuenta_id || rows[0]?.cuenta_id),
      active: product?.activo ?? null,
      stock_actual: stockCurrent,
      last_kardex_stock: lastKardexStock,
      movement_count: chronological.length,
      internal_math_errors: internalMathErrors,
      continuity_gaps: continuityGaps,
      missing_provenance: missingProvenance,
      structured_provenance_missing: structuredProvenanceMissing,
      current_stock_mismatch: currentStockMismatch,
      anomaly_count: productAnomalies.length,
      anomalies: productAnomalies,
    })
  }

  for (const product of products) {
    if (byProduct.has(product.id)) continue
    productReports.push({
      product_id: product.id,
      product_code: product.codigo || null,
      product_name: product.nombre || null,
      account_id: id8(product.cuenta_id),
      active: product.activo ?? null,
      stock_actual: numberOrNull(product.stock_actual),
      last_kardex_stock: null,
      movement_count: 0,
      internal_math_errors: 0,
      continuity_gaps: 0,
      missing_provenance: 0,
      structured_provenance_missing: 0,
      current_stock_mismatch: false,
      anomaly_count: 0,
      anomalies: [],
    })
  }

  productReports.sort((a, b) => b.anomaly_count - a.anomaly_count || String(a.product_code || '').localeCompare(String(b.product_code || '')))
  const byReason = {}
  for (const anomaly of anomalies) byReason[anomaly.reason_type] = (byReason[anomaly.reason_type] || 0) + 1

  return {
    generated_at: new Date().toISOString(),
    project_ref: STAGING_PROJECT_REF,
    read_only: true,
    products_scanned: products.length,
    movements_scanned: movements.length,
    products_with_anomalies: productReports.filter(report => report.anomaly_count > 0).length,
    anomalies_total: anomalies.length,
    movements_missing_structured_provenance: productReports.reduce((total, report) => total + report.structured_provenance_missing, 0),
    summary_by_reason: byReason,
    anomalies,
    products: productReports,
  }
}

function formatMarkdown(report) {
  const lines = [
    '# Auditoría read-only de Kardex — staging',
    '',
    `- Generado: ${report.generated_at}`,
    `- Proyecto: \`${report.project_ref}\``,
    '- Modo: **read-only**; no se ejecutaron INSERT, UPDATE ni DELETE.',
    `- Productos revisados: **${report.products_scanned}**`,
    `- Movimientos revisados contra productos actuales: **${report.movements_scanned}**`,
    `- Movimientos leídos en total: **${report.movements_fetched ?? report.movements_scanned}**`,
    `- Movimientos excluidos por producto eliminado/otro tenant: **${report.movements_excluded_missing_current_product ?? 0}**`,
    `- Productos con anomalías: **${report.products_with_anomalies}**`,
    `- Anomalías totales: **${report.anomalies_total}**`,
    `- Movimientos sin provenance estructurado: **${report.movements_missing_structured_provenance}**`,
    '',
    '## Clasificación',
    '',
  ]
  const reasons = Object.entries(report.summary_by_reason)
  if (!reasons.length) lines.push('No se detectaron anomalías matemáticas, de continuidad ni de sincronización.')
  else for (const [reason, count] of reasons) lines.push(`- ${reason}: ${count}`)

  lines.push('', '## Productos afectados', '')
  const affected = report.products.filter(product => product.anomaly_count > 0)
  if (!affected.length) lines.push('Ninguno.')
  for (const product of affected) {
    lines.push(`### ${product.product_code || '(sin código)'} — ${product.product_name || '(sin nombre)'}`)
    lines.push(`- Stock actual: ${product.stock_actual}; último saldo Kardex: ${product.last_kardex_stock}`)
    lines.push(`- Movimientos: ${product.movement_count}; anomalías: ${product.anomaly_count}`)
    for (const anomaly of product.anomalies) {
      lines.push(`- [${anomaly.reason_type}] movimiento ${anomaly.movement_number || id8(anomaly.movement_id) || '(sin id)'}: ${JSON.stringify(anomaly)}`)
    }
    lines.push('')
  }
  lines.push('## Interpretación', '', '- Un `internal_math_error` significa que `stock_anterior ± cantidad` no coincide con `stock_nuevo`.', '- Un `continuity_gap` significa que el saldo final de un movimiento no coincide con el saldo inicial del siguiente movimiento del mismo producto.', '- `stock_actual_vs_kardex` significa que el catálogo y el último saldo del Kardex no representan el mismo estado.', '- `movements_missing_structured_provenance` es deuda histórica de trazabilidad; no se convierte automáticamente en una corrección de stock.', '- Los movimientos excluidos por producto eliminado se conservan como historial de auditoría y no se usan para inferir el saldo de un producto actual; deben revisarse por tenant si se pretende purgar fixtures.', '- La clasificación de motivo es evidencia del origen declarado, no prueba de causalidad; la causa final debe contrastarse con despacho, devolución, auditoría y fecha de operación.')
  return `${lines.join('\n')}\n`
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
  const supabaseUrl = config.STAGING_AUDIT_SUPABASE_URL || config.STAGING_E2E_SUPABASE_URL || config.VITE_SUPABASE_URL
  const serviceKey = config.STAGING_AUDIT_SERVICE_KEY || config.SUPABASE_SERVICE_KEY
  const anonKey = config.STAGING_AUDIT_ANON_KEY || config.STAGING_E2E_ANON_KEY || config.VITE_SUPABASE_ANON_KEY
  assertStagingConfig({ supabaseUrl, frontendOrigin: 'http://localhost:5174', workerOrigin: 'http://127.0.0.1:8789' })
  if (!serviceKey && !anonKey) throw new Error('Falta una clave local de staging para auditar')
  return {
    ...config,
    supabaseUrl,
    key: serviceKey || anonKey,
    serviceKey: !!serviceKey,
    email: config.STAGING_AUDIT_EMAIL || config.STAGING_E2E_EMAIL,
    password: config.STAGING_AUDIT_PASSWORD || config.STAGING_E2E_PASSWORD,
    outputDir: config.STAGING_AUDIT_OUTPUT_DIR || path.join(repoRoot, 'tmp', 'e2e-staging'),
  }
}

async function fetchAll(client, table, select, order = 'id') {
  const rows = []
  for (let offset = 0; ; offset += AUDIT_PAGE_SIZE) {
    const result = await client.from(table).select(select).order(order, { ascending: true }).range(offset, offset + AUDIT_PAGE_SIZE - 1)
    if (result.error) throw new Error(`${table}: ${result.error.message}`)
    rows.push(...(result.data || []))
    if (!result.data || result.data.length < AUDIT_PAGE_SIZE) break
  }
  return rows
}

export async function main() {
  const config = await loadConfig()
  const client = createClient(config.supabaseUrl, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  let tenantId = null
  if (!config.serviceKey) {
    if (!config.email || !config.password) throw new Error('Sin service key: faltan STAGING_AUDIT_EMAIL/STAGING_E2E_PASSWORD')
    const login = await client.auth.signInWithPassword({ email: config.email.trim().toLowerCase(), password: config.password })
    if (login.error) throw new Error(`Login staging rechazado: ${login.error.message}`)
    tenantId = login.data.user?.id || null
  }

  const [products, movements] = await Promise.all([
    fetchAll(client, 'productos', 'id,codigo,nombre,stock_actual,cuenta_id,activo', 'id'),
    fetchAll(client, 'inventario_movimientos', 'id,numero,lote_id,producto_id,producto_nombre,tipo,cantidad,stock_anterior,stock_nuevo,motivo,motivo_tipo,usuario_id,usuario_nombre,usuario_color,cuenta_id,origen_tipo,origen_id,origen_referencia,idempotency_key,creado_en', 'id'),
  ])
  const scopedProducts = tenantId ? products.filter(row => row.cuenta_id === tenantId) : products
  const scopedProductIds = new Set(scopedProducts.map(row => row.id))
  const scopedMovements = movements.filter(row => scopedProductIds.has(row.producto_id) && (!tenantId || row.cuenta_id === tenantId))
  const excludedMovements = movements.filter(row => !scopedProductIds.has(row.producto_id) || (tenantId && row.cuenta_id !== tenantId))
  const report = auditKardex(scopedProducts, scopedMovements)
  report.tenant_id = id8(tenantId)
  report.credentials_mode = config.serviceKey ? 'service_role_local' : 'authenticated_read_only'
  report.movements_fetched = movements.length
  report.movements_excluded_missing_current_product = excludedMovements.length

  await mkdir(config.outputDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(config.outputDir, `kardex-audit-${stamp}.json`)
  const markdownPath = path.join(config.outputDir, `kardex-audit-${stamp}.md`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, formatMarkdown(report), 'utf8')
  console.log(JSON.stringify({
    ok: true,
    readOnly: true,
    projectRef: STAGING_PROJECT_REF,
    products: report.products_scanned,
    movements: report.movements_scanned,
    movementsFetched: report.movements_fetched,
    movementsExcludedMissingCurrentProduct: report.movements_excluded_missing_current_product,
    productsWithAnomalies: report.products_with_anomalies,
    anomalies: report.anomalies_total,
    movementsMissingStructuredProvenance: report.movements_missing_structured_provenance,
    summaryByReason: report.summary_by_reason,
    jsonPath,
    markdownPath,
  }, null, 2))
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`AUDITORÍA KARDEX STAGING NO EJECUTADA: ${error.message}`)
    process.exitCode = 1
  }
}
