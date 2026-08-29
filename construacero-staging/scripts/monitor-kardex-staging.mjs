import process from 'node:process'
import { main as auditKardexStaging } from './audit-kardex-staging.mjs'

export const STAGING_PROJECT_REF = 'spupqgkdsgohxxfoxydl'

export function evaluateKardexReport(report) {
  const checks = {
    project_ref: report?.project_ref === STAGING_PROJECT_REF,
    read_only: report?.read_only === true,
    anomalies: Number(report?.anomalies_total || 0) === 0,
    products_with_anomalies: Number(report?.products_with_anomalies || 0) === 0,
    structured_provenance: Number(report?.movements_missing_structured_provenance || 0) === 0,
  }
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)

  return {
    ok: failures.length === 0,
    checks,
    failures,
    metrics: {
      products: Number(report?.products_scanned || 0),
      movements: Number(report?.movements_scanned || 0),
      movements_fetched: Number(report?.movements_fetched || report?.movements_scanned || 0),
      movements_excluded_missing_current_product: Number(report?.movements_excluded_missing_current_product || 0),
      anomalies: Number(report?.anomalies_total || 0),
      products_with_anomalies: Number(report?.products_with_anomalies || 0),
      missing_structured_provenance: Number(report?.movements_missing_structured_provenance || 0),
    },
  }
}

async function notifyWebhook(result) {
  const webhook = process.env.STAGING_KARDEX_ALERT_WEBHOOK || process.env.STAGING_E2E_ALERT_WEBHOOK
  if (!webhook) return { sent: false, reason: 'webhook_not_configured' }

  const message = [
    '❌ Staging Kardex monitor detectó una condición no saludable',
    `Proyecto: ${STAGING_PROJECT_REF}`,
    `Checks fallidos: ${result.failures.join(', ') || 'desconocido'}`,
    `Anomalías: ${result.metrics.anomalies}`,
    `Productos afectados: ${result.metrics.products_with_anomalies}`,
    `Provenance incompleto: ${result.metrics.missing_structured_provenance}`,
  ].join('\n')

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message, content: message }),
    })
    if (!response.ok) return { sent: false, reason: `http_${response.status}` }
    return { sent: true }
  } catch (error) {
    return { sent: false, reason: error?.message || 'webhook_error' }
  }
}

export async function main() {
  const report = await auditKardexStaging()
  const result = evaluateKardexReport(report)
  const notification = result.ok ? { sent: false, reason: 'healthy' } : await notifyWebhook(result)

  console.log(JSON.stringify({
    ok: result.ok,
    project_ref: STAGING_PROJECT_REF,
    read_only: true,
    ...result,
    notification,
  }, null, 2))

  if (!result.ok) {
    throw new Error(`Kardex staging no saludable: ${result.failures.join(', ')}`)
  }
  return result
}

if (process.argv[1] && process.argv[1].endsWith('monitor-kardex-staging.mjs')) {
  try {
    await main()
  } catch (error) {
    console.error(`MONITOR KARDEX STAGING FALLÓ: ${error.message}`)
    process.exitCode = 2
  }
}
