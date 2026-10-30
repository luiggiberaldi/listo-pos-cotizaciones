#!/usr/bin/env node
// apply-283-286-flota-produccion.mjs — lleva el plan de flota (283 + 286) a la base
// de datos vía Management API (mismo canal que apply-282-retiro-16-produccion.mjs).
//
// Modos:
//   node scripts/apply-283-286-flota-produccion.mjs ensayo
//       → STAGING (spupqgkdsgohxxfoxydl). En UNA transacción que siempre se deshace:
//         quita la 286 y la 283 (con sus reversas de producción), instala 283 + 286
//         desde el paquete de producción y revisa el resultado. Nada queda escrito.
//         Guardia: FLOTA_ENSAYO_CONFIRM=ENSAYAR_EN_STAGING
//   node scripts/apply-283-286-flota-produccion.mjs preflight
//       → PRODUCCIÓN, SOLO LECTURA: corre 283_flota_preflight_readonly.sql.
//         Guardia: PROD_FLOTA_CONFIRM=LEER_PREFLIGHT_PRODUCCION
//   node scripts/apply-283-286-flota-produccion.mjs aplicar
//       → PRODUCCIÓN: preflight con expectativas → 283 → 286 → postflight y
//         comparación de la huella del dinero. Se detiene ante cualquier sorpresa.
//         Guardia: PROD_FLOTA_CONFIRM=APLICAR_283_286_PRODUCCION
//
// Reglas:
//   * Antes de todo verifica las huellas SHA-256 del paquete (283_286_flota_SHA256SUMS.txt).
//   * Quita la compuerta REVIEW_ONLY SOLO en memoria (nunca edita el archivo).
//   * Los tokens se leen de .env (raíz = producción; construacero-staging/.env = staging)
//     y nunca se imprimen.
//   * Evidencia en docs/operaciones/ (modos preflight y aplicar también en ensayo).
// Reversa: 286_flota_reporte_detallado_rollback_review.sql y luego
//          283_flota_vehiculos_locales_rollback_review.sql (Worker/web primero a la versión sin flota).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PROD_REF = 'oyfyuszgjwcepjpngclv'
const STAGING_REF = 'spupqgkdsgohxxfoxydl'
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const relDir = path.join(repoRoot, 'supabase', 'release', 'main')

const ARCHIVOS = {
  pre: '283_flota_preflight_readonly.sql',
  a283: '283_flota_vehiculos_locales_apply.sql',
  a286: '286_flota_reporte_detallado_apply.sql',
  post: '283_flota_postflight_readonly.sql',
  rb283: '283_flota_vehiculos_locales_rollback_review.sql',
  rb286: '286_flota_reporte_detallado_rollback_review.sql',
}
const SUMS = '283_286_flota_SHA256SUMS.txt'

const modo = process.argv[2]
const GUARDIAS = {
  ensayo: ['FLOTA_ENSAYO_CONFIRM', 'ENSAYAR_EN_STAGING'],
  preflight: ['PROD_FLOTA_CONFIRM', 'LEER_PREFLIGHT_PRODUCCION'],
  aplicar: ['PROD_FLOTA_CONFIRM', 'APLICAR_283_286_PRODUCCION'],
}
if (!GUARDIAS[modo]) {
  console.error('Uso: node scripts/apply-283-286-flota-produccion.mjs <ensayo|preflight|aplicar>')
  process.exit(2)
}
const [varGuardia, valorGuardia] = GUARDIAS[modo]
if (process.env[varGuardia] !== valorGuardia) {
  console.error(`Guardia: define ${varGuardia}=${valorGuardia} para el modo "${modo}".`)
  process.exit(2)
}

function parseEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw.trim())
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const REF = modo === 'ensayo' ? STAGING_REF : PROD_REF
const TOKEN = modo === 'ensayo'
  ? parseEnv(path.join(repoRoot, 'construacero-staging', '.env')).SUPABASE_ACCESS_TOKEN
  : parseEnv(path.join(repoRoot, '.env')).SUPABASE_ACCESS_TOKEN
if (!TOKEN) { console.error('Falta SUPABASE_ACCESS_TOKEN en el .env correspondiente'); process.exit(2) }
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`

// ── 1. Integridad del paquete ────────────────────────────────────────────────
const esperadas = Object.fromEntries(fs.readFileSync(path.join(relDir, SUMS), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(l => { const [h, f] = l.split(/\s+\*?/); return [f, h] }))
const sql = {}
for (const [clave, archivo] of Object.entries(ARCHIVOS)) {
  const contenido = fs.readFileSync(path.join(relDir, archivo))
  const hash = crypto.createHash('sha256').update(contenido).digest('hex')
  if (esperadas[archivo] !== hash) {
    console.error(`Huella distinta en ${archivo}: el paquete cambió desde su revisión. Abortado.`)
    process.exit(3)
  }
  sql[clave] = contenido.toString('utf8')
}

// La compuerta se quita SOLO en memoria y solo la línea exacta del candado.
function sinCandado(texto) {
  const lineas = texto.split(/\r?\n/)
  const candados = lineas.filter(l => /^DO \$\$ BEGIN RAISE EXCEPTION 'REVIEW_ONLY:.*END \$\$;\s*$/.test(l))
  if (candados.length !== 1) throw new Error('Se esperaba exactamente un candado REVIEW_ONLY')
  return lineas.filter(l => !candados.includes(l)).join('\n')
}
// Para el ensayo todo va en una sola transacción: se quitan los BEGIN;/COMMIT; sueltos.
function sinTransaccion(texto) {
  return texto.replace(/^\s*(BEGIN|COMMIT);\s*$/gim, '-- (transacción del ensayo)')
}
// Las consultas de preflight/postflight deben ser de solo lectura.
function bloquesLectura(texto) {
  const bloques = texto.split(/\n(?=-- \d+\. )/).map(b => b.trim()).filter(b => /^-- \d+\. /.test(b))
  for (const b of bloques) {
    // Sin comentarios ni textos entre comillas ('INSERT' en has_table_privilege es solo un texto).
    const codigo = b.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').replace(/'[^']*'/g, "''")
    if (/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\b/i.test(codigo)) {
      throw new Error(`Bloque no es de solo lectura: ${b.split('\n')[0]}`)
    }
  }
  return bloques
}

async function q(query) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  let data = null
  try { data = JSON.parse(text) } catch { /* texto plano */ }
  return { ok: r.ok, status: r.status, data, text }
}

const evidencia = []
function registrar(titulo, datos) {
  const cuerpo = typeof datos === 'string' ? datos : JSON.stringify(datos, null, 2)
  console.log(`\n### ${titulo}\n${cuerpo.slice(0, 1500)}`)
  evidencia.push(`### ${titulo}\n\`\`\`\n${cuerpo.slice(0, 6000)}\n\`\`\`\n`)
}
function guardar(resultado) {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const destino = modo === 'ensayo' ? 'staging' : 'produccion'
  const archivo = path.join(repoRoot, 'docs', 'operaciones', `flota-283-286-${modo}-${destino}-${ts}.md`)
  fs.writeFileSync(archivo,
    `# Flota 283 + 286 — modo ${modo} (${destino}) — ${new Date().toISOString()}\n\n` +
    `Proyecto \`${REF}\`, script \`scripts/apply-283-286-flota-produccion.mjs\`.\n\n` +
    `## En resumen\n\n${resultado}\n\n## Evidencia\n\n` + evidencia.join('\n'))
  console.log(`\nEvidencia: ${path.relative(repoRoot, archivo)}`)
}

async function correrLectura(texto, prefijo) {
  const res = {}
  for (const bloque of bloquesLectura(texto)) {
    const titulo = bloque.split('\n')[0].replace(/^-- /, '')
    const r = await q(bloque)
    registrar(`${prefijo} ${titulo}`, r.ok ? r.data : r.text)
    if (!r.ok) throw new Error(`Falló la consulta de solo lectura "${titulo}"`)
    res[titulo.slice(0, 2).trim()] = r.data
  }
  return res
}

// ── 2. Modos ─────────────────────────────────────────────────────────────────
if (modo === 'ensayo') {
  const cuerpo = [
    'BEGIN;',
    sinTransaccion(sinCandado(sql.rb286)),
    sinTransaccion(sinCandado(sql.rb283)),
    sinTransaccion(sinCandado(sql.a283)),
    sinTransaccion(sinCandado(sql.a286)),
    `DO $ensayo$
DECLARE
  v_tabla BOOLEAN := to_regclass('public.vehiculos') IS NOT NULL;
  v_cols INT; v_funcs INT; v_trig INT; v_abiertas INT; v_veh INT; v_est INT; v_ext INT; v_detalle BOOLEAN; v_ampliado BOOLEAN;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns WHERE table_schema = 'public'
    AND ((table_name = 'transportistas' AND column_name = 'vehiculo_habitual_id')
      OR (table_name = 'cotizaciones' AND column_name = 'vehiculo_id')
      OR (table_name = 'notas_despacho' AND column_name IN ('vehiculo_id', 'vehiculo_origen'))
      OR (table_name = 'vehiculos' AND column_name IN ('modelo', 'placa_batea')));
  SELECT count(*) INTO v_funcs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('fn_autocompletar_vehiculo_despacho', 'eliminar_o_desactivar_vehiculo_atomico',
      'eliminar_o_desactivar_transportista_atomico', 'obtener_reporte_flota_y_choferes', 'obtener_detalle_viajes_flota');
  SELECT count(*) INTO v_trig FROM pg_trigger WHERE tgname = 'trg_autocompletar_vehiculo_despacho' AND NOT tgisinternal;
  SELECT count(*) INTO v_abiertas FROM (VALUES
      ('public.eliminar_o_desactivar_vehiculo_atomico(uuid,uuid)'),
      ('public.eliminar_o_desactivar_transportista_atomico(uuid,uuid)'),
      ('public.obtener_reporte_flota_y_choferes(uuid,timestamptz,timestamptz)'),
      ('public.obtener_detalle_viajes_flota(uuid,timestamptz,timestamptz,uuid,boolean)')) f(sig)
    WHERE has_function_privilege('authenticated', f.sig, 'EXECUTE') OR has_function_privilege('anon', f.sig, 'EXECUTE');
  SELECT count(*) INTO v_veh FROM public.vehiculos;
  SELECT count(*) INTO v_est FROM public.notas_despacho WHERE vehiculo_origen = 'backfill';
  SELECT count(*) INTO v_ext FROM public.notas_despacho nd JOIN public.transportistas t ON t.id = nd.transportista_id
    WHERE nd.vehiculo_id IS NOT NULL AND t.es_local = false;
  v_detalle := pg_get_functiondef('public.obtener_detalle_viajes_flota(uuid,timestamptz,timestamptz,uuid,boolean)'::regprocedure) IS NOT NULL;
  v_ampliado := pg_get_functiondef('public.obtener_reporte_flota_y_choferes(uuid,timestamptz,timestamptz)'::regprocedure) LIKE '%empresa_usd%';
  RAISE EXCEPTION 'ENSAYO_FLOTA tabla=% columnas=% funciones=% trigger=% abiertas=% vehiculos=% estimados=% externos=% detalle=% ampliado=%',
    v_tabla, v_cols, v_funcs, v_trig, v_abiertas, v_veh, v_est, v_ext, v_detalle, v_ampliado;
END
$ensayo$;`,
  ].join('\n\n')

  const antes = await correrLectura(sql.post, 'ANTES (staging, solo lectura)')
  const r = await q(cuerpo)
  const m = String(r.text).match(/ENSAYO_FLOTA tabla=(\w+) columnas=(\d+) funciones=(\d+) trigger=(\d+) abiertas=(\d+) vehiculos=(\d+) estimados=(\d+) externos=(\d+) detalle=(\w+) ampliado=(\w+)/)
  if (!m) {
    registrar('ENSAYO: error inesperado (la transacción se deshizo)', r.text)
    guardar('REVISAR — el ensayo no llegó al final; ver el error. Staging quedó como estaba (todo se deshizo).')
    process.exit(1)
  }
  const [, tabla, columnas, funciones, trigger, abiertas, vehiculos, estimados, externos, detalle, ampliado] = m
  const resultado = { tabla, columnas: +columnas, funciones: +funciones, trigger: +trigger, abiertas: +abiertas, vehiculos: +vehiculos, estimados: +estimados, externos: +externos, detalle, ampliado }
  registrar('ENSAYO: dentro de la transacción (esperado tabla=true columnas=6 funciones=5 trigger=1 abiertas=0 externos=0 detalle=true ampliado=true)', resultado)
  const despues = await correrLectura(sql.post, 'DESPUÉS (staging, solo lectura)')
  const huellaIgual = JSON.stringify(antes['4.']) === JSON.stringify(despues['4.'])
  const estructuraIgual = JSON.stringify(antes['1.']) === JSON.stringify(despues['1.'])
  registrar('Staging intacto tras el ensayo', { huella_dinero_igual: huellaIgual, estructura_igual: estructuraIgual })
  const si = v => v === 't' || v === 'true'  // RAISE escribe los booleanos como t/f
  const ok = si(tabla) && +columnas === 6 && +funciones === 5 && +trigger === 1 && +abiertas === 0 && +externos === 0
    && si(detalle) && si(ampliado) && huellaIgual && estructuraIgual
  guardar(ok
    ? 'OK — el paquete de producción (reversas + 283 + 286) se instaló completo sobre datos reales de staging y se deshizo sin dejar rastro.'
    : 'REVISAR — algún control del ensayo no dio lo esperado.')
  process.exit(ok ? 0 : 1)
}

if (modo === 'preflight') {
  await correrLectura(sql.pre, 'PREFLIGHT')
  guardar('Preflight de solo lectura completado. Revisar a mano la lista de choferes locales (los "sin_placa" quedarán sin camión).')
  process.exit(0)
}

// modo aplicar
const pre = await correrLectura(sql.pre, 'PRE')
const estado = pre['1.']?.[0] || {}
const req = pre['2.']?.[0] || {}
const preOk = estado.tabla_vehiculos_existe === false && Number(estado.columnas_nuevas_existentes) === 0
  && Number(estado.funciones_283_existentes) === 0 && estado.set_updated_at_existe === true
  && Number(req.columnas_requeridas_faltantes) === 0
if (!preOk) {
  registrar('ABORTADO antes de escribir', { estado, requeridas: req })
  guardar('ABORTADO — el preflight no dio lo esperado; no se escribió nada en producción.')
  process.exit(1)
}
const huellaPre = pre['5.']

const r283 = await q(sinCandado(sql.a283))
registrar('APPLY 283', r283.ok ? (r283.data ?? 'ok') : r283.text)
if (!r283.ok) { guardar('FALLÓ la 283 (su transacción se deshizo; producción sin cambios).'); process.exit(1) }

const r286 = await q(sinCandado(sql.a286))
registrar('APPLY 286', r286.ok ? (r286.data ?? 'ok') : r286.text)

const post = await correrLectura(sql.post, 'POST')
const est = post['1.']?.[0] || {}
const perm = post['2.']?.[0] || {}
const back = post['3.']?.[0] || {}
const huellaIgual = JSON.stringify(huellaPre) === JSON.stringify(post['4.'])
const postOk = r286.ok && est.tabla_vehiculos_existe === true && est.rls_vehiculos === true
  && Number(est.columnas_nuevas) === 4 && Number(est.funciones_283) === 4 && Number(est.trigger_despacho) === 1
  && Number(perm.funciones_abiertas_a_navegador) === 0 && Number(perm.escritura_directa_navegador) === 0
  && perm.worker_puede_leer_y_escribir === true && perm.navegador_puede_leer === true
  && perm.navegador_puede_escribir_debe_ser_false === false
  && Number(back.externos_con_camion_propio_debe_ser_0) === 0 && huellaIgual
registrar('Comparación de huella del dinero (PRE vs POST)', { igual: huellaIgual, pre: huellaPre, post: post['4.'] })
guardar(postOk
  ? `OK — 283 y 286 aplicadas en producción; permisos correctos; ${back.vehiculos_creados} camiones creados, ${back.viajes_estimados} viajes marcados como estimados (≈); dinero y documentos intactos. Siguiente paso: unir el código (PR) para publicar la web y el Worker.`
  : 'REVISAR — algún control posterior no dio lo esperado. NO unir el código todavía; evaluar la reversa.')
process.exit(postOk ? 0 : 1)
