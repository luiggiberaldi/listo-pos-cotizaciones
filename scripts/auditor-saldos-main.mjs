import fs from 'node:fs'

// ─── Auditor nocturno de saldos — PRINCIPAL (SOLO LECTURA) ───────────────────
// Regla: el ledger (cuentas_por_cobrar) es la fuente de verdad. Las columnas
// saldo_pendiente / saldo_a_favor de clientes deben coincidir con el replay
// canónico del ledger (fórmula validada en release 12, incluye consumo_credito).
//
// Guardarraíles:
//  - SOLO SELECT: nunca UPDATE/INSERT/DELETE (riesgo cero para producción).
//  - Guardia de proyecto: se niega a correr contra otro ref que no sea el principal.
//  - Exit 1 si hay divergencias → GitHub envía correo + dispara el webhook de alerta.
//  - La reparación NO es automática: tras revisar el reporte se usa el script
//    de reparación con guardas (mismo flujo deliberado del release 12).
//
// Uso local:  node scripts/auditor-saldos-main.mjs   (lee .env del principal)
// Uso en CI:  MAIN_SUPABASE_ACCESS_TOKEN + MAIN_PROJECT_REF por entorno.

const MAIN_REF = 'oyfyuszgjwcepjpngclv'

function readEnvFile(p) {
  try {
    return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/\r?\n/)
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
  } catch { return {} }
}

const fileEnv = readEnvFile('.env')
// Precedencia: secreto de CI (MAIN_SUPABASE_ACCESS_TOKEN) → .env local → var
// de sistema genérica (último recurso; en esta máquina una SUPABASE_ACCESS_TOKEN
// de sistema NO válida pisa el .env, por eso el archivo va antes).
const token = process.env.MAIN_SUPABASE_ACCESS_TOKEN || fileEnv.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.error('Falta MAIN_SUPABASE_ACCESS_TOKEN (CI) o SUPABASE_ACCESS_TOKEN en .env (local).')
  process.exit(2)
}

// Guardia: SOLO el principal, nunca staging ni otro proyecto.
const ref = process.env.MAIN_PROJECT_REF || MAIN_REF
if (ref !== MAIN_REF) {
  console.error(`Guardia: ref "${ref}" no permitido — el auditor solo corre contra el principal (${MAIN_REF}).`)
  process.exit(2)
}

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`Management API ${r.status}: ${t.slice(0, 400)}`)
  return JSON.parse(t)
}

// Replay canónico (idéntico al validado en release 12) + deltas por cliente.
// COUNT(*) OVER() trae el total real aunque LIMIT recorte la lista mostrada.
const SQL = `
WITH replay AS (
  SELECT c.cliente_id,
    GREATEST(0, ROUND(COALESCE(SUM(CASE WHEN c.tipo='cargo' THEN c.monto_usd WHEN c.tipo='abono' THEN -c.monto_usd ELSE 0 END),0)::NUMERIC,4)) AS deuda_ok,
    GREATEST(0, ROUND(COALESCE(SUM(CASE WHEN c.tipo='credito' THEN c.monto_usd WHEN c.tipo='abono' AND lower(COALESCE(c.forma_pago_abono,''))='saldo a favor' THEN -c.monto_usd WHEN c.tipo='devolucion_credito' THEN -c.monto_usd WHEN c.tipo='consumo_credito' THEN -c.monto_usd ELSE 0 END),0)::NUMERIC,4)) AS favor_ok
  FROM public.cuentas_por_cobrar c GROUP BY c.cliente_id)
SELECT COUNT(*) OVER() AS total,
  cl.id AS cliente_id, cl.nombre,
  cl.saldo_pendiente::numeric(14,2) AS deuda_col,
  COALESCE(r.deuda_ok,0)::numeric(14,2) AS deuda_ok,
  (GREATEST(0, ROUND(cl.saldo_pendiente::numeric,4)) - COALESCE(r.deuda_ok,0))::numeric(14,2) AS deuda_delta,
  cl.saldo_a_favor::numeric(14,2) AS favor_col,
  COALESCE(r.favor_ok,0)::numeric(14,2) AS favor_ok,
  (GREATEST(0, ROUND(cl.saldo_a_favor::numeric,4)) - COALESCE(r.favor_ok,0))::numeric(14,2) AS favor_delta
FROM public.clientes cl LEFT JOIN replay r ON r.cliente_id = cl.id
WHERE GREATEST(0, ROUND(cl.saldo_pendiente::numeric,4)) <> COALESCE(r.deuda_ok,0)
   OR GREATEST(0, ROUND(cl.saldo_a_favor::numeric,4)) <> COALESCE(r.favor_ok,0)
ORDER BY GREATEST(ABS(GREATEST(0, ROUND(cl.saldo_pendiente::numeric,4)) - COALESCE(r.deuda_ok,0)),
                  ABS(GREATEST(0, ROUND(cl.saldo_a_favor::numeric,4)) - COALESCE(r.favor_ok,0))) DESC
LIMIT 50`

const started = Date.now()
const rows = await q(SQL)
const total = rows.length > 0 ? Number(rows[0].total) : 0
const secs = ((Date.now() - started) / 1000).toFixed(1)

console.log(`Auditor de saldos — principal (${ref})`)
console.log(`Replay del ledger completado en ${secs}s`)
console.log(total === 0
  ? '✅ CONSISTENTE: 0 clientes divergentes — columnas == ledger en toda la base.'
  : `❌ DIVERGENCIAS: ${total} cliente(s) con columnas != ledger.`)

const fmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

if (total > 0) {
  console.log('')
  console.log('Cliente | Deuda col/ledger (Δ) | Favor col/ledger (Δ)')
  for (const r of rows) {
    console.log(`  ${r.nombre}: ${fmt(r.deuda_col)}/${fmt(r.deuda_ok)} (Δ ${fmt(r.deuda_delta)}) · ${fmt(r.favor_col)}/${fmt(r.favor_ok)} (Δ ${fmt(r.favor_delta)})`)
  }
  if (total > rows.length) console.log(`  … y ${total - rows.length} más (mostrando top ${rows.length} por magnitud).`)
  console.log('\nAcción deliberada: revisar el reporte y reparar con el script con guardas (NO auto-reparar).')
}

// Resumen en GitHub Actions (visible en la pestaña Summary del run)
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ['## Auditor de saldos — principal', '',
    `- Proyecto: \`${ref}\``,
    `- Replay: ${secs}s · Solo lectura`,
    total === 0
      ? '- Resultado: ✅ **0 clientes divergentes**'
      : `- Resultado: ❌ **${total} cliente(s) divergente(s)**`, '']
  if (total > 0) {
    lines.push('| Cliente | Deuda col | Deuda ledger | Δ | Favor col | Favor ledger | Δ |',
      '|---|---|---|---|---|---|---|')
    for (const r of rows) {
      lines.push(`| ${r.nombre} | ${fmt(r.deuda_col)} | ${fmt(r.deuda_ok)} | ${fmt(r.deuda_delta)} | ${fmt(r.favor_col)} | ${fmt(r.favor_ok)} | ${fmt(r.favor_delta)} |`)
    }
    if (total > rows.length) lines.push('', `_… y ${total - rows.length} más (top ${rows.length} por magnitud)._`)
    lines.push('', '**Acción:** reparación deliberada con script con guardas tras revisar el reporte.')
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
}

process.exit(total > 0 ? 1 : 0)
