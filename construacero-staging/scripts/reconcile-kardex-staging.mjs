import { createClient } from '@supabase/supabase-js'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const STAGING_PROJECT_REF = 'spupqgkdsgohxxfoxydl'

const here = path.dirname(fileURLToPath(import.meta.url))
const stagingRoot = path.resolve(here, '..')
const repoRoot = path.resolve(stagingRoot, '..')
const outputDir = path.join(repoRoot, 'tmp', 'e2e-staging')

function parseEnvFile(text = '') {
  const values = {}
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[match[1]] = value
  }
  return values
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
  const serviceKey = config.SUPABASE_SERVICE_KEY || config.STAGING_E2E_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Faltan URL o service key local de staging')
  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  if (ref !== STAGING_PROJECT_REF) throw new Error(`Guardia staging: se esperaba ${STAGING_PROJECT_REF}, se encontró ${ref}`)
  if (/production|prod|oyfyuszgjwcepjpngclv/i.test(supabaseUrl)) throw new Error('Guardia staging: URL de producción detectada')
  return { supabaseUrl, serviceKey }
}

function flag(name) {
  return process.argv.includes(name)
}

function option(name) {
  const prefix = `${name}=`
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) || null
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000
}

function id8(value) {
  return value ? `${String(value).slice(0, 8)}...` : 'null'
}

export function proposalFromAnomaly(anomaly) {
  if (anomaly.reason_type === 'stock_actual_vs_kardex') {
    return {
      clase: 'stock_actual_vs_kardex',
      producto_id: anomaly.product_id,
      movimiento_id: anomaly.movement_id,
      movimiento_numero: anomaly.movement_number,
      stock_anterior_esperado: round4(anomaly.last_kardex_stock),
      stock_actual_catalogo: round4(anomaly.stock_actual),
      delta: round4(anomaly.difference),
      reason: `Producto ${anomaly.product_code || anomaly.product_id}: stock_actual ${anomaly.stock_actual} vs último Kardex ${anomaly.last_kardex_stock}`,
    }
  }

  if (!anomaly.continuity_gap || !anomaly.previous_movement?.movement_id) return null
  return {
    clase: 'continuity_gap',
    producto_id: anomaly.product_id,
    movimiento_id: anomaly.movement_id,
    movimiento_numero: anomaly.movement_number,
    movimiento_anterior_id: anomaly.previous_movement.movement_id,
    stock_anterior_esperado: round4(anomaly.previous_movement.stock_after),
    stock_actual_movimiento: round4(anomaly.stock_before),
    delta: round4(anomaly.continuity_delta),
    reason: `${anomaly.product_code || anomaly.product_id}: ${anomaly.reason || 'brecha de continuidad'}`,
  }
}

async function fetchByIds(queryFactory, ids, chunkSize = 100) {
  const rows = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const result = await queryFactory(chunk)
    if (result.error) throw new Error(result.error.message)
    rows.push(...(result.data || []))
  }
  return rows
}

export async function buildPlan(supabase, audit) {
  if (audit?.project_ref !== STAGING_PROJECT_REF || audit?.read_only !== true) {
    throw new Error('La auditoría fuente no está marcada como read-only del proyecto staging esperado')
  }

  const anomalies = (audit.anomalies || []).filter(anomaly => anomaly.continuity_gap || anomaly.reason_type === 'stock_actual_vs_kardex')
  const proposals = anomalies.map(proposalFromAnomaly).filter(Boolean)
  const unique = new Map()
  for (const proposal of proposals) {
    const key = `${proposal.clase}:${proposal.producto_id}:${proposal.movimiento_id}`
    if (!unique.has(key)) unique.set(key, proposal)
  }

  const productIds = [...new Set([...unique.values()].map(proposal => proposal.producto_id))]
  const products = await fetchByIds(
    ids => supabase.from('productos').select('id,codigo,nombre,cuenta_id,stock_actual').in('id', ids),
    productIds,
  )
  const productMap = new Map(products.map(product => [product.id, product]))
  const missing = productIds.filter(id => !productMap.has(id))
  if (missing.length) throw new Error(`Productos de auditoría no encontrados: ${missing.map(id8).join(', ')}`)

  const byAccount = new Map()
  for (const proposal of unique.values()) {
    const product = productMap.get(proposal.producto_id)
    if (!product.cuenta_id) throw new Error(`Producto ${id8(product.id)} no tiene cuenta_id; no se puede reconciliar de forma tenant-safe`)
    const account = byAccount.get(product.cuenta_id) || { cuenta_id: product.cuenta_id, proposals: [], products: [] }
    account.proposals.push(proposal)
    if (!account.products.some(row => row.id === product.id)) account.products.push(product)
    byAccount.set(product.cuenta_id, account)
  }

  return {
    generated_at: new Date().toISOString(),
    project_ref: STAGING_PROJECT_REF,
    read_only_plan: true,
    source_audit: audit.generated_at,
    source_audit_file: audit.file || null,
    anomalies_considered: anomalies.length,
    proposals_total: unique.size,
    products_affected: productIds.length,
    accounts_affected: byAccount.size,
    summary_by_class: [...unique.values()].reduce((summary, proposal) => {
      summary[proposal.clase] = (summary[proposal.clase] || 0) + 1
      return summary
    }, {}),
    accounts: [...byAccount.values()].map(account => ({
      cuenta_id: account.cuenta_id,
      products: account.products,
      proposals: account.proposals,
    })),
  }
}

function limitPlan(plan, limit) {
  if (!Number.isInteger(limit) || limit <= 0) return plan
  let remaining = limit
  const accounts = []
  for (const account of plan.accounts) {
    if (remaining <= 0) break
    const proposals = account.proposals.slice(0, remaining)
    if (proposals.length) accounts.push({ ...account, proposals })
    remaining -= proposals.length
  }
  const proposals = accounts.flatMap(account => account.proposals)
  return {
    ...plan,
    limited_from_total: plan.proposals_total,
    proposals_total: proposals.length,
    products_affected: new Set(proposals.map(proposal => proposal.producto_id)).size,
    accounts_affected: accounts.length,
    summary_by_class: proposals.reduce((summary, proposal) => {
      summary[proposal.clase] = (summary[proposal.clase] || 0) + 1
      return summary
    }, {}),
    accounts,
  }
}

async function saveJson(prefix, value) {
  await mkdir(outputDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(outputDir, `${prefix}-${stamp}.json`)
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return file
}

async function applyPlan(supabase, plan, batchKey) {
  const results = []
  for (const account of plan.accounts) {
    const result = await supabase.rpc('reconciliar_kardex_staging', {
      p_cuenta_id: account.cuenta_id,
      p_batch_key: batchKey,
      p_propuestas: account.proposals,
      p_usuario_id: null,
      p_usuario_nombre: 'Reconciliación Kardex staging',
      p_usuario_color: null,
    })
    if (result.error) throw new Error(`Cuenta ${id8(account.cuenta_id)}: ${result.error.message}`)
    results.push({ cuenta_id: account.cuenta_id, result: result.data })
  }
  return results
}

async function rollbackBatch(supabase, batchKey) {
  const accounts = await supabase
    .from('kardex_reconciliaciones_staging')
    .select('cuenta_id')
    .eq('batch_key', batchKey)
  if (accounts.error) throw new Error(accounts.error.message)
  const uniqueAccounts = [...new Set((accounts.data || []).map(row => row.cuenta_id).filter(Boolean))]
  const results = []
  for (const cuentaId of uniqueAccounts) {
    const result = await supabase.rpc('revertir_reconciliacion_kardex_staging', {
      p_cuenta_id: cuentaId,
      p_batch_key: batchKey,
      p_usuario_id: null,
      p_usuario_nombre: 'Rollback reconciliación Kardex staging',
    })
    if (result.error) throw new Error(`Cuenta ${id8(cuentaId)}: ${result.error.message}`)
    results.push({ cuenta_id: cuentaId, result: result.data })
  }
  return results
}

export async function main() {
  const config = await loadConfig()
  const supabase = createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  if (flag('--rollback')) {
    const batchKey = option('--batch-key')
    if (!batchKey) throw new Error('--rollback requiere --batch-key=<UUID>')
    if (!flag('--confirm-staging-reconciliation')) throw new Error('Rollback bloqueado: agrega --confirm-staging-reconciliation')
    const results = await rollbackBatch(supabase, batchKey)
    const file = await saveJson('kardex-reconciliation-rollback', { project_ref: STAGING_PROJECT_REF, batch_key: batchKey, results })
    console.log(JSON.stringify({ mode: 'rollback', project_ref: STAGING_PROJECT_REF, batch_key: batchKey, results, evidence: file }, null, 2))
    return 0
  }

  const auditFile = option('--audit') ? path.resolve(process.cwd(), option('--audit')) : await latestAuditFile()
  const audit = JSON.parse(await readFile(auditFile, 'utf8'))
  audit.file = auditFile
  const rawPlan = await buildPlan(supabase, audit)
  const limit = Number(option('--limit'))
  const plan = limit > 0 ? limitPlan(rawPlan, limit) : rawPlan
  const planFile = await saveJson('kardex-reconciliation-plan', plan)
  const drySummary = {
    mode: 'dry-run',
    project_ref: STAGING_PROJECT_REF,
    source_audit: auditFile,
    plan: planFile,
    anomalies_considered: plan.anomalies_considered,
    proposals_total: plan.proposals_total,
    products_affected: plan.products_affected,
    accounts_affected: plan.accounts_affected,
    summary_by_class: plan.summary_by_class,
    limited_from_total: plan.limited_from_total || null,
  }

  if (!flag('--apply')) {
    console.log(JSON.stringify(drySummary, null, 2))
    return 0
  }
  if (!flag('--confirm-staging-reconciliation')) {
    throw new Error('Aplicación bloqueada: agrega --confirm-staging-reconciliation')
  }
  if (!plan.proposals_total) {
    console.log(JSON.stringify({ ...drySummary, mode: 'apply-noop' }, null, 2))
    return 0
  }

  const batchKey = option('--batch-key') || globalThis.crypto.randomUUID()
  const before = {
    project_ref: STAGING_PROJECT_REF,
    batch_key: batchKey,
    source_audit: auditFile,
    captured_at: new Date().toISOString(),
    accounts: plan.accounts.map(account => ({
      cuenta_id: account.cuenta_id,
      products: account.products,
      proposals: account.proposals,
    })),
  }
  const beforeFile = await saveJson('kardex-reconciliation-before', before)
  const results = await applyPlan(supabase, plan, batchKey)
  const resultFile = await saveJson('kardex-reconciliation-applied', {
    project_ref: STAGING_PROJECT_REF,
    batch_key: batchKey,
    applied_at: new Date().toISOString(),
    source_audit: auditFile,
    before_file: beforeFile,
    results,
  })
  console.log(JSON.stringify({ mode: 'applied', project_ref: STAGING_PROJECT_REF, batch_key: batchKey, before: beforeFile, evidence: resultFile, results }, null, 2))
  return 0
}

async function latestAuditFile() {
  const explicit = option('--audit')
  if (explicit) return path.resolve(process.cwd(), explicit)
  const files = (await readdir(outputDir)).filter(file => file.startsWith('kardex-audit-') && file.endsWith('.json')).sort()
  if (!files.length) throw new Error('No existe auditoría Kardex JSON; ejecuta primero npm run audit:kardex:staging')
  return path.join(outputDir, files.at(-1))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(`RECONCILIACIÓN STAGING NO EJECUTADA: ${error.message}`)
    process.exitCode = 1
  }
}
