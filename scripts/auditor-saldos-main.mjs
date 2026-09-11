import fs from 'node:fs'

// ─── Auditor nocturno — PRINCIPAL (SOLO LECTURA) ─────────────────────────────
// SECCIÓN 1: saldos de clientes (replay del ledger vs columnas).
// SECCIÓN 2: integridad del ledger de comisiones vs despachos entregados.
//
// Regla sección 1: el ledger (cuentas_por_cobrar) es la fuente de verdad. Las
// columnas saldo_pendiente / saldo_a_favor de clientes deben coincidir con el
// replay canónico del ledger (fórmula validada en release 12, incluye consumo_credito).
//
// Regla sección 2: la fila de comisiones tiene invariantes internas de dinero
// (hard fail) y la cobertura de despachos entregados comisionables se vigila
// como warning (reporta, no tumba el run — hay flujos históricos/manuales que
// no generan fila y el historial no se repara masivamente).
//
// Guardarraíles:
//  - SOLO SELECT: nunca UPDATE/INSERT/DELETE (riesgo cero para producción).
//  - Guardia de proyecto: se niega a correr contra otro ref que no sea el principal.
//  - Exit 1 si hay divergencias de saldo O invariantes de comisiones rotas →
//    GitHub envía correo + dispara el webhook de alerta.
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

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 2: SQL de integridad de comisiones.
//   C1–C5: invariantes de dinero dentro de la fila (hard fail).
//   W1–W2: huecos de cobertura (warning, no tumban el run).
// W1 usa el helper VIVO comision_238b_cod_pendiente (release 09) para no
// duplicar la regla COD — paridad exacta con la RPC de comisiones. Ventana de
// 30 días mantiene el reporte accionable; lo viejo es histórico.
const VENTANA_DIAS = 30

const SQL_COMISIONES = `
-- C1: identidad básica total = cabilla + otros
SELECT 'C1_identidad' AS check_id, COUNT(*)::int AS n,
  COALESCE(jsonb_agg(jsonb_build_object('id', id, 'total', totalcomision, 'cab', comisioncabilla, 'otr', comisionotros) ORDER BY id), '[]'::jsonb) AS detalle
FROM public.comisiones WHERE ROUND(comisioncabilla+comisionotros,2) <> ROUND(totalcomision,2)
UNION ALL
-- C2: liberación proporcional rota (lib+ret != total, incluye lib>total)
SELECT 'C2_liberacion', COUNT(*)::int,
  COALESCE(jsonb_agg(jsonb_build_object('id', id, 'total', totalcomision, 'lib', comision_liberada, 'ret', comision_retenida) ORDER BY id), '[]'::jsonb)
FROM public.comisiones WHERE ROUND(comision_liberada+comision_retenida,2) <> ROUND(totalcomision,2)
UNION ALL
-- C3: duplicados (despacho, vendedor)
SELECT 'C3_duplicados', COUNT(*)::int, '[]'::jsonb
FROM (SELECT despachoid, vendedorid FROM public.comisiones GROUP BY 1,2 HAVING COUNT(*)>1) d
UNION ALL
-- C4: pagos imposibles (negativo o mayor al total)
SELECT 'C4_pagos_imposibles', COUNT(*)::int,
  COALESCE(jsonb_agg(jsonb_build_object('id', id, 'total', totalcomision, 'pagado', montopagado, 'estado', estado) ORDER BY id), '[]'::jsonb)
FROM public.comisiones WHERE montopagado < 0 OR montopagado > totalcomision
UNION ALL
-- C5: huérfanas (despacho no existe)
SELECT 'C5_huerfanas', COUNT(*)::int, '[]'::jsonb
FROM public.comisiones c WHERE NOT EXISTS (SELECT 1 FROM public.notas_despacho d WHERE d.id = c.despachoid)
UNION ALL
-- W1: entregados comisionables sin fila (ventana 30d).
--   Espejo EXACTO de las exclusiones by-design verificadas por auditoría (2026-09-11):
--   1) venta del card: rol <> vendedor_sin_comision (regla 136)
--   2) dueño del cliente NO comisionable (regla RPC 238b): jefe/admin/logistica/
--      administracion/desarrollador, o vendedor_sin_comision interno sin markup
--   3) COD pendiente (helper vivo, release 09)
--   4) donación en cualquier método (política del Worker: pagoEsDonacion)
SELECT 'W1_huecos_entregados', COUNT(*)::int,
  COALESCE(jsonb_agg(jsonb_build_object('numero', d.numero, 'fecha', d.creado_en::date, 'vendedor', u.nombre, 'total', d.total_usd) ORDER BY d.creado_en DESC), '[]'::jsonb)
FROM public.notas_despacho d
JOIN public.usuarios u ON u.id = d.vendedor_id
LEFT JOIN public.clientes cl ON cl.id = d.cliente_id
LEFT JOIN public.usuarios du ON du.id = cl.vendedor_id
WHERE d.estado = 'entregada'
  AND d.entregada_en > now() - interval '${VENTANA_DIAS} days'
  AND u.rol <> 'vendedor_sin_comision'
  AND NOT EXISTS (SELECT 1 FROM public.comisiones c WHERE c.despachoid = d.id)
  AND NOT public.comision_238b_cod_pendiente(d.forma_pago_cliente, d.forma_pago)
  AND NOT COALESCE(du.rol, '') IN ('admin','jefe','logistica','administracion','desarrollador')
  AND NOT (COALESCE(du.rol, '') = 'vendedor_sin_comision' AND NOT COALESCE(du.es_externo, FALSE) AND COALESCE(du.markup_pct, 0) <= 0)
  AND NOT (d.forma_pago_cliente::text ILIKE '%donaci%' OR d.forma_pago::text ILIKE '%donaci%')
UNION ALL
-- W2: anuladas con comisión viva (pendiente/cta_cobrar)
SELECT 'W2_anuladas_con_comision', COUNT(*)::int,
  COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'numero', d.numero, 'estado', c.estado, 'total', c.totalcomision) ORDER BY d.numero), '[]'::jsonb)
FROM public.comisiones c
JOIN public.notas_despacho d ON d.id = c.despachoid
WHERE d.estado = 'anulada' AND c.estado IN ('pendiente','cta_cobrar')
`

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

const fmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ─── Ejecución ───────────────────────────────────────────────────────────────
const started = Date.now()
const [rows, comRows] = await Promise.all([q(SQL), q(SQL_COMISIONES)])
const secs = ((Date.now() - started) / 1000).toFixed(1)

console.log(`Auditor de saldos y comisiones — principal (${ref})`)
console.log(`Replay completado en ${secs}s (solo lectura)`)

// ─── Sección 1: saldos ───────────────────────────────────────────────────────
const total = rows.length > 0 ? Number(rows[0].total) : 0
console.log(total === 0
  ? '✅ SALDOS: 0 clientes divergentes — columnas == ledger en toda la base.'
  : `❌ SALDOS: ${total} cliente(s) con columnas != ledger.`)

if (total > 0) {
  console.log('')
  console.log('Cliente | Deuda col/ledger (Δ) | Favor col/ledger (Δ)')
  for (const r of rows) {
    console.log(`  ${r.nombre}: ${fmt(r.deuda_col)}/${fmt(r.deuda_ok)} (Δ ${fmt(r.deuda_delta)}) · ${fmt(r.favor_col)}/${fmt(r.favor_ok)} (Δ ${fmt(r.favor_delta)})`)
  }
  if (total > rows.length) console.log(`  … y ${total - rows.length} más (mostrando top ${rows.length} por magnitud).`)
}

// ─── Sección 2: comisiones ───────────────────────────────────────────────────
// Hard fails: C1–C5 (corrupción de dinero). Warnings: W1–W2 (cobertura).
const HARD = new Set(['C1_identidad', 'C2_liberacion', 'C3_duplicados', 'C4_pagos_imposibles', 'C5_huerfanas'])
const hardFails = comRows.filter(r => HARD.has(r.check_id) && Number(r.n) > 0)
const warnings = comRows.filter(r => !HARD.has(r.check_id) && Number(r.n) > 0)

console.log('')
if (comRows.length === 0) {
  console.log('⚠️ COMISIONES: sin resultados (¿existe la tabla?)')
  hardFails.push({ check_id: 'sin_resultados', n: 1, detalle: [] })
} else if (hardFails.length === 0 && warnings.length === 0) {
  console.log(`✅ COMISIONES: invariantes íntegros y 0 huecos en entregados de los últimos ${VENTANA_DIAS} días.`)
} else {
  if (hardFails.length === 0) {
    console.log(`✅ COMISIONES: invariantes íntegros (identidad, liberación, duplicados, pagos, huérfanas).`)
  }
  for (const r of hardFails) {
    console.log(`❌ COMISIONES ${r.check_id}: ${r.n} fila(s) con invariantes de dinero rotas.`)
    for (const d of (r.detalle || []).slice(0, 10)) console.log(`   ${JSON.stringify(d)}`)
    if ((r.detalle || []).length > 10) console.log(`   … y ${r.detalle.length - 10} más.`)
  }
  for (const r of warnings) {
    const etiqueta = r.check_id === 'W1_huecos_entregados'
      ? `entregados comisionables SIN fila de comisión (últimos ${VENTANA_DIAS} días, excluye sin_comision y COD pendiente)`
      : 'despachos ANULADOS con comisión viva (pendiente/cta_cobrar)'
    console.log(`⚠️ COMISIONES ${r.check_id}: ${r.n} caso(s) — ${etiqueta}.`)
    for (const d of (r.detalle || []).slice(0, 15)) console.log(`   ${JSON.stringify(d)}`)
    if ((r.detalle || []).length > 15) console.log(`   … y ${r.detalle.length - 15} más.`)
  }
  console.log('\nAcción deliberada: revisar el reporte y reparar con script con guardas (NO auto-reparar).')
}

// ─── Resumen en GitHub Actions (pestaña Summary del run) ─────────────────────
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ['## Auditor de saldos y comisiones — principal', '',
    `- Proyecto: \`${ref}\``,
    `- Replay: ${secs}s · Solo lectura`,
    total === 0
      ? '- Saldos: ✅ **0 clientes divergentes**'
      : `- Saldos: ❌ **${total} cliente(s) divergente(s)**`,
    hardFails.length === 0
      ? '- Comisiones (invariantes): ✅ íntegras'
      : `- Comisiones (invariantes): ❌ ${hardFails.map(r => `${r.check_id}=${r.n}`).join(', ')}`,
    warnings.length === 0
      ? `- Comisiones (cobertura ${VENTANA_DIAS}d): ✅ sin huecos`
      : `- Comisiones (cobertura ${VENTANA_DIAS}d): ⚠️ ${warnings.map(r => `${r.check_id}=${r.n}`).join(', ')}`, '']
  if (total > 0) {
    lines.push('| Cliente | Deuda col | Deuda ledger | Δ | Favor col | Favor ledger | Δ |',
      '|---|---|---|---|---|---|---|')
    for (const r of rows) {
      lines.push(`| ${r.nombre} | ${fmt(r.deuda_col)} | ${fmt(r.deuda_ok)} | ${fmt(r.deuda_delta)} | ${fmt(r.favor_col)} | ${fmt(r.favor_ok)} | ${fmt(r.favor_delta)} |`)
    }
    if (total > rows.length) lines.push('', `_… y ${total - rows.length} más (top ${rows.length} por magnitud)._`)
  }
  for (const r of [...hardFails, ...warnings]) {
    lines.push('', `### ${r.check_id} (${r.n})`, '',
      '| detalle |', '|---|')
    for (const d of (r.detalle || []).slice(0, 20)) lines.push(`| \`${JSON.stringify(d)}\` |`)
  }
  if (hardFails.length > 0 || warnings.length > 0 || total > 0) {
    lines.push('', '**Acción:** reparación deliberada con script con guardas tras revisar el reporte.')
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
}

// Exit: hard fails de comisiones o divergencias de saldo tumban el run (correo +
// webhook). Warnings solo se reportan.
const exitCode = (total > 0 || hardFails.length > 0) ? 1 : 0
if (exitCode === 1) {
  console.log('\n❌ Resultado: FALLO (saldos divergentes o invariantes de comisiones rotos).')
} else if (warnings.length > 0) {
  console.log('\n⚠️ Resultado: OK con advertencias (revisar reporte).')
} else {
  console.log('\n✅ Resultado: todo consistente.')
}
process.exit(exitCode)
