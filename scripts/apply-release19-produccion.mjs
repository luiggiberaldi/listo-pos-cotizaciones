#!/usr/bin/env node
// scripts/apply-release19-produccion.mjs — aplica el release 19 (cobro COD en
// pedidos de pago mixto) al proyecto PRINCIPAL (producción). Orden obligatorio
// (docs/operaciones/checklist-release.md §3): preflight read-only → pre-imágenes
// (backup de cuerpos vivos) → apply → postflight → smoke read-only → evidencia.
//
// Canal: Management API HTTPS (mismo que scripts/apply-release17-staging.mjs).
// Credenciales: SUPABASE_ACCESS_TOKEN_PRODUCCION o SUPABASE_ACCESS_TOKEN desde
// .env — NUNCA se imprimen.
//
// Guardas:
//   * PRODUCCION_RELEASE19_CONFIRM=APLICAR_RELEASE19_PRODUCCION (obligatorio).
//   * El destino sale de .supabase/project-ref y debe ser oyfyuszgjwcepjpngclv
//     (proyecto principal); jamás apunta a staging.
//   * Huellas SHA-256 de los artefactos verificadas antes de tocar nada
//     (supabase/release/main/19_cod_mixto_SHA256SUMS.txt). Si un archivo cambió,
//     aborta: ese paquete ya no es el probado en staging.
//   * Estado previo: solo procede si el contrato vivo es EXACTAMENTE release 14
//     (hoja 19_cod_preflight_readonly.sql), o si las funciones COD no existen y
//     las precondiciones del baseline 14 están completas (entonces instala el
//     baseline 14 primero y re-verifica). Cualquier otro estado aborta sin
//     mutar nada. Si el release 19 ya está instalado, lo confirma y sale 0.
//
// Modo sin red: --dry-run-parse imprime huellas, árbol de decisión y archivos
// de pre-imagen que se generarían, y sale.
//
// Evidencia: docs/operaciones/release19-produccion-cutover-<timestamp>.md,
// pre-imágenes en supabase/release/main/19_backup_cuerpos/*.live.sql (SHA-256)
// y tmp/release19-produccion-evidence-<timestamp>.json.
// Exit 0 solo si postflight 19 = 11/11 y el smoke no falla.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const CONFIRM_VALUE = 'APLICAR_RELEASE19_PRODUCCION'
const EXPECTED_REF = 'oyfyuszgjwcepjpngclv'
const BASE14_PATH = path.join(ROOT, 'supabase/release/main/14_cod_financial_rpcs_apply.sql')
const PREFLIGHT14_PATH = path.join(ROOT, 'supabase/release/main/14_cod_preflight_readonly.sql')
const APPLY19_PATH = path.join(ROOT, 'supabase/release/main/19_cod_mixto_apply.sql')
const PREFLIGHT19_PATH = path.join(ROOT, 'supabase/release/main/19_cod_preflight_readonly.sql')
const POSTFLIGHT19_PATH = path.join(ROOT, 'supabase/release/main/19_cod_postflight_readonly.sql')
const PREIMG_DIR = path.join(ROOT, 'supabase/release/main/19_backup_cuerpos')
const SUMS_PATH = path.join(ROOT, 'supabase/release/main/19_cod_mixto_SHA256SUMS.txt')

function parseEnv(file) {
  const out = {}
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    const i = line.indexOf('=')
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')
const sqlLiteral = (s) => "'" + String(s).replace(/'/g, "''") + "'"
const okJson = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }

// ── Huellas: los artefactos deben ser byte-idénticos a los probados en staging ──
const sums = {}
for (const line of fs.readFileSync(SUMS_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([0-9a-f]{64}) \*(.+)$/)
  if (m) sums[m[2]] = m[1]
}
function verifySums() {
  let allOk = true
  for (const [rel, want] of Object.entries(sums)) {
    const got = sha256(fs.readFileSync(path.join(ROOT, rel)))
    const ok = got === want
    console.log(`${ok ? 'OK  ' : 'FAIL'} huella ${rel} ${got.slice(0, 12)}…`)
    if (!ok) allOk = false
  }
  return allOk
}

if (process.argv.includes('--dry-run-parse')) {
  console.log('== Dry-run (sin red, sin mutaciones) ==')
  const ok = verifySums()
  console.log('\nÁrbol de decisión del instalador:')
  console.log('  1. Postflight 19 = 11/11            → "YA INSTALADO", evidencia y exit 0.')
  console.log('  2. Preflight 19 verde (contrato release 14 exacto, sin marcadores 19)')
  console.log('                                    → APPLY 19 → postflight → smoke.')
  console.log('  3. Funciones COD ausentes + precondiciones baseline 14 completas')
  console.log('                                    → APPLY 14 → re-verificar → APPLY 19.')
  console.log('  4. Cualquier otro estado           → ABORTA sin mutar nada.')
  console.log('\nPre-imágenes que se generarían en supabase/release/main/19_backup_cuerpos/:')
  console.log('  resumen_financiero_despacho(uuid,uuid).live.sql')
  console.log('  registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text).live.sql')
  process.exit(ok ? 0 : 1)
}

// ── Guardas previas ──────────────────────────────────────────────────────────
if (process.env.PRODUCCION_RELEASE19_CONFIRM !== CONFIRM_VALUE) {
  console.error(`Falta PRODUCCION_RELEASE19_CONFIRM=${CONFIRM_VALUE}`)
  process.exit(1)
}
if (!verifySums()) {
  console.error('ABORT: las huellas de los artefactos no coinciden con las probadas en staging.')
  process.exit(1)
}
const env = parseEnv(path.join(ROOT, '.env'))
const TOKEN = env.SUPABASE_ACCESS_TOKEN_PRODUCCION || env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN_PRODUCCION o SUPABASE_ACCESS_TOKEN en .env'); process.exit(1) }
const REF = fs.readFileSync(path.join(ROOT, '.supabase/project-ref'), 'utf8').trim()
if (REF !== EXPECTED_REF) { console.error(`Destino inesperado: ${REF} (se exige producción ${EXPECTED_REF})`); process.exit(1) }

const API = `https://api.supabase.com/v1/projects/${REF}/database/query`
async function q(sql) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  let rows = null
  try { rows = JSON.parse(text) } catch { /* cuerpo no-JSON: se conserva como texto */ }
  return { ok: r.ok, status: r.status, body: text, rows }
}
const evidence = { tool: 'apply-release19-produccion.mjs', project_ref: REF, environment: 'produccion', started_at: new Date().toISOString(), stages: [], asserts: [] }
const record = (name, res) => {
  evidence.stages.push({ name, at: new Date().toISOString(), status: res.status, body: res.body.slice(0, 4000) })
  console.log(`\n== ${name} ==\nstatus=${res.status} ${res.body.slice(0, 300).replace(/\s+/g, ' ')}`)
}
let failed = false
function assert(cond, label, detail = '') {
  evidence.asserts.push({ label, ok: !!cond, detail: String(detail).slice(0, 500) })
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' — ' + String(detail).slice(0, 200)}`)
  if (!cond) failed = true
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)

// ── 1. Conexión y estado previo (todo read-only) ─────────────────────────────
const pre1 = await q("SELECT current_database() AS db, now() AS ts")
record('PRE 1: conexión', pre1)
assert(pre1.ok, 'PRE: conexión a producción OK', pre1.body)

const pf19src = fs.readFileSync(PREFLIGHT19_PATH, 'utf8')
const pre2 = await q(pf19src)
record('PRE 2: hoja 19_cod_preflight_readonly.sql', pre2)
const pf19 = okJson(pre2.rows?.[0]?.cod_mixto_preflight) || {}
const readyFor19 = pf19.functions_present === true && pf19.summary_contract_is_release14 === true
  && pf19.reconcile_contract_is_release14 === true && pf19.release19_markers_absent === true
  && pf19.ledger_tables_present === true && pf19.recalc_stub_present === true

let mode = null
if (readyFor19) {
  mode = 'apply19'
  console.log('Estado: contrato release 14 exacto → se aplica el release 19.')
} else {
  const postCheck = await q(fs.readFileSync(POSTFLIGHT19_PATH, 'utf8'))
  record('PRE 2b: ¿el release 19 ya está instalado?', postCheck)
  const already = okJson(postCheck.rows?.[0]?.cod_mixto_postflight) || {}
  if (Object.values(already).length === 11 && Object.values(already).every((v) => v === true)) {
    mode = 'already'
    console.log('Estado: el release 19 YA está instalado y verificado (11/11). No se muta nada.')
  } else {
    const pf14res = await q(fs.readFileSync(PREFLIGHT14_PATH, 'utf8'))
    record('PRE 2c: hoja 14_cod_preflight_readonly.sql', pf14res)
    const pf14 = okJson(pf14res.rows?.[0]?.cod_main_preflight) || {}
    const baselineOk = pf14.current_cod_release_present === false
      && pf14.recalcularcomisiondespacho_238b_present === true
      && pf14.pg_input_is_valid_available === true
      && !pf14.missing_columns
    if (baselineOk) {
      mode = 'apply14then19'
      console.log('Estado: funciones COD ausentes, precondiciones completas → baseline 14 y luego release 19.')
    } else {
      mode = 'abort'
      console.error('ABORT: estado previo inesperado. Preflight 19:', JSON.stringify(pf19))
      console.error('Preflight 14:', JSON.stringify(pf14))
    }
  }
}
assert(mode !== 'abort', 'PRE: estado previo reconocido (release 14 / release 19 / baseline ausente)', String(mode))

// ── 2. Pre-imágenes (backup de cuerpos vivos, SHA-256) ───────────────────────
fs.mkdirSync(PREIMG_DIR, { recursive: true })
const functions = [
  { name: 'resumen_financiero_despacho', args: 'uuid, uuid', file: 'resumen_financiero_despacho(uuid,uuid).live.sql' },
  { name: 'registrar_pago_externo_cobro_idempotente', args: 'uuid, uuid, uuid, uuid, text, jsonb, text, text', file: 'registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text).live.sql' },
]
let preimgCount = 0
for (const f of functions) {
  const res = await q(`SELECT pg_get_functiondef(p.oid) AS def
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = ${sqlLiteral(f.name)}
  AND pg_get_function_identity_arguments(p.oid) = ${sqlLiteral(f.args)}`)
  const def = res.rows?.[0]?.def
  if (!def) { console.log(`INFO  ${f.name} no está viva aún (se instalará en esta ventana)`); continue }
  const file = path.join(PREIMG_DIR, f.file)
  fs.writeFileSync(file, def + '\n')
  preimgCount++
  evidence.stages.push({ name: `PRE-IMG ${f.name}`, at: new Date().toISOString(), sha256: sha256(def), file: path.relative(ROOT, file) })
  console.log(`OK   PRE-IMG ${f.name} → ${path.relative(ROOT, file)} sha256=${sha256(def).slice(0, 12)}…`)
}

// ── 3. Apply (solo si el estado lo permite; los SQL traen sus propias guardas) ─
if (failed || mode === 'abort') {
  console.error('\nABORT: preflight con fallos — NO se aplica nada.')
  evidence.finished_at = new Date().toISOString()
  fs.writeFileSync(path.join(ROOT, `tmp/release19-produccion-evidence-${stamp()}.json`), JSON.stringify(evidence, null, 2))
  process.exit(1)
}

if (mode !== 'already') {
  if (mode === 'apply14then19') {
    const base = await q(fs.readFileSync(BASE14_PATH, 'utf8'))
    record('APPLY: 14_cod_financial_rpcs_apply.sql (baseline)', base)
    assert(base.ok, 'APPLY: baseline release 14 aplicado sin errores', base.body)
    const recheck = await q(pf19src)
    record('APPLY: re-verificación del contrato release 14', recheck)
    const rc = okJson(recheck.rows?.[0]?.cod_mixto_preflight) || {}
    assert(rc.summary_contract_is_release14 === true && rc.reconcile_contract_is_release14 === true,
      'APPLY: contrato release 14 vivo tras el baseline', recheck.body)
    if (failed) {
      console.error('\nABORT: el baseline no dejó el contrato release 14 esperado — NO se aplica el 19.')
      evidence.finished_at = new Date().toISOString()
      fs.writeFileSync(path.join(ROOT, `tmp/release19-produccion-evidence-${stamp()}.json`), JSON.stringify(evidence, null, 2))
      process.exit(1)
    }
  }
  const applyRes = await q(fs.readFileSync(APPLY19_PATH, 'utf8'))
  record('APPLY: 19_cod_mixto_apply.sql', applyRes)
  assert(applyRes.ok, 'APPLY: release 19 aplicado sin errores', applyRes.body)
}

// ── 4. Postflight 19 (read-only): 11/11 ──────────────────────────────────────
const postRes = await q(fs.readFileSync(POSTFLIGHT19_PATH, 'utf8'))
record('POSTFLIGHT: 19_cod_postflight_readonly.sql', postRes)
assert(postRes.ok, 'POSTFLIGHT: ejecutado sin errores', postRes.body)
const post = okJson(postRes.rows?.[0]?.cod_mixto_postflight) || {}
const keys = Object.keys(post)
assert(keys.length === 11, `POSTFLIGHT: 11 comprobaciones presentes (llegaron ${keys.length})`, JSON.stringify(post))
for (const k of keys) assert(post[k] === true, `POSTFLIGHT: ${k}`)

// ── 5. Smoke read-only sobre despachos reales (resumen financiero) ───────────
const smoke = await q(`SELECT nd.cuenta_id, nd.id, nd.numero
FROM public.notas_despacho nd
WHERE nd.estado IN ('despachada','entregada')
  AND EXISTS (SELECT 1 FROM public.cuentas_por_cobrar c WHERE c.despacho_id = nd.id)
ORDER BY nd.numero DESC LIMIT 2`)
record('SMOKE: selección de despachos reales', smoke)
const smokeRows = smoke.rows || []
if (!smokeRows.length) {
  console.log('INFO  SMOKE: sin despachos reales con libro CxC; se omite (marcado como manual)')
} else {
  const argsRes = await q(`SELECT pg_get_function_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'resumen_financiero_despacho'`)
  const argNames = String(argsRes.rows?.[0]?.args || '').split(',').map((a) => a.trim().split(/\s+/)[0])
  const cuentaParam = argNames.find((a) => a && a.includes('cuenta'))
  const despachoParam = argNames.find((a) => a && a.includes('despacho'))
  if (!cuentaParam || !despachoParam) {
    console.log(`INFO  SMOKE: nombres de parámetros no reconocidos (${argNames.join(', ')}); smoke manual`)
  } else {
    for (const row of smokeRows) {
      const call = await q(`SELECT public.resumen_financiero_despacho(${cuentaParam} => ${sqlLiteral(row.cuenta_id)}, ${despachoParam} => ${sqlLiteral(row.id)}) AS resumen`)
      record(`SMOKE: resumen_financiero_despacho despacho #${row.numero}`, call)
      assert(call.ok, `SMOKE: resumen financiero del despacho #${row.numero} responde sin errores`, call.body)
    }
  }
}

// ── 6. Evidencia ─────────────────────────────────────────────────────────────
evidence.finished_at = new Date().toISOString()
evidence.result = failed ? 'FAIL' : 'PASS'
evidence.pre_images = preimgCount
const evJson = path.join(ROOT, `tmp/release19-produccion-evidence-${stamp()}.json`)
fs.writeFileSync(evJson, JSON.stringify(evidence, null, 2))
const md = [
  `# Cutover release 19 (COD mixto) en PRODUCCIÓN — ${evidence.started_at}`,
  ``,
  `- Proyecto: \`${REF}\` (principal) · Resultado: **${evidence.result}**`,
  `- Aplicado por: scripts/apply-release19-produccion.mjs (Management API HTTPS)`,
  `- Modo: ${mode === 'already' ? 'ya instalado (sin mutaciones)' : mode}`,
  `- Pre-imágenes: \`supabase/release/main/19_backup_cuerpos/*.live.sql\` (${preimgCount} cuerpos)`,
  `- Evidencia JSON: \`${path.relative(ROOT, evJson)}\``,
  ``,
  `## Aserciones`,
  ...evidence.asserts.map((a) => `- ${a.ok ? '✅' : '❌'} ${a.label}${a.ok ? '' : ` — \`${a.detail}\``}`),
  ``,
  `## Etapas`,
  ...evidence.stages.map((s) => `### ${s.name} (${s.at})\n\`\`\`\n${String(s.body || s.sha256 || '').slice(0, 1200)}\n\`\`\``),
  ``,
].join('\n')
const evMd = path.join(ROOT, `docs/operaciones/release19-produccion-cutover-${stamp()}.md`)
fs.writeFileSync(evMd, md)
console.log(`\nEvidencia: ${path.relative(ROOT, evMd)} · ${path.relative(ROOT, evJson)}`)
console.log(failed ? 'RESULTADO: FAIL' : 'RESULTADO: PASS')
process.exit(failed ? 1 : 0)
