#!/usr/bin/env node
// scripts/ventana-release17-produccion.mjs — LA VENTANA COMPLETA del release 17
// (egreso de inventario al aprobar) en PRODUCCIÓN, en UN solo comando paso a paso:
// comprobaciones → respaldo con restauración probada → instalación → verificaciones.
// Si CUALQUIER paso falla, el comando se DETIENE ahí mismo, deja constancia y dice
// qué hacer; nada posterior se ejecuta.
//
// MODO DE USO:
//   node scripts/ventana-release17-produccion.mjs --dry-run
//       PRUEBA EN SECO de la ventana: ejecuta todo lo que NO escribe en producción
//       (comprobaciones + respaldo verificado) y se detiene antes de la instalación.
//       Es lo que se corre para ensayar la ventana de principio a fin.
//   node scripts/ventana-release17-produccion.mjs
//       LA VENTANA REAL. Hace los 4 pasos; antes del único paso que ESCRIBE en
//       producción pide escribir APLICAR con el teclado (nunca avanza solo).
//   node scripts/ventana-release17-produccion.mjs --confirmar APLICAR
//       VENTANA REAL con la confirmación dada por argumento (para ejecución asistida
//       sin teclado interactivo). La palabra debe ser exactamente APLICAR; la persona
//       que ejecuta la ventana queda registrada en la conversación/evidencia.
//   node scripts/ventana-release17-produccion.mjs --dry-run --simular-fallo 2
//       SOLO PARA ENSAYOS: hace fallar el paso indicado a propósito, para comprobar
//       que el comando se detiene sin continuar.
//
// Los 4 pasos (se detiene en el primero que falle):
//   1. COMPROBACIONES RÁPIDAS — paquete completo y sin cambios (huellas SHA-256),
//      destino correcto (producción), y preflight SOLO LECTURA contra la base real
//      (veredicto LISTO PARA LA VENTANA / YA INSTALADO).
//   2. RESPALDO — scripts/backup-release17-produccion.mjs --verify sobre una carpeta
//      NUEVA con fecha y hora (nunca pisa el respaldo de referencia): respalda las
//      4 tablas críticas, lo restaura ENTERO en un PostgreSQL desechable local y
//      compara fila por fila, más re-verificación contra producción viva.
//   3. INSTALACIÓN — scripts/apply-release17-produccion.mjs --apply (pre-imágenes →
//      apply → backfill → postflight → smoke). Solo con la palabra APLICAR escrita
//      con el teclado. Operador del kardex de migración: cuenta técnica
//      "Desarrollador" (RELEASE17_OPERADOR_ID puede cambiarla).
//   4. VERIFICACIONES — prueba en seco del plan B (scripts/rollback-release17-
//      produccion.mjs): deja constancia de que la reversión de emergencia está
//      LISTA por si hiciera falta, y cierra con el resumen de la ventana.
//
// Al terminar: resumen + evidencia en docs/operaciones/release17-ventana-<ts>.md y
// tmp/release17-ventana-<ts>.json. Este comando NO hace (van después, pasos 4-7 de
// la ventana del plan §4): commit + empuje a main, smokes en la aplicación real y
// aviso al equipo. Si la instalación fallara con la base ya tocada, el plan B de un
// comando es: PRODUCCION_RELEASE17_ROLLBACK_CONFIRM=REVERTIR_RELEASE17_PRODUCCION
// node scripts/rollback-release17-produccion.mjs --apply (+ revert del commit de app).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'

const ROOT = process.cwd()
const CONFIRM_APPLY = 'APLICAR_RELEASE17_PRODUCCION'
const OPERADOR_DEFECTO = '00000000-0000-0000-0000-000000000000' // cuenta técnica Desarrollador (plan §4)
const OPERADOR_NOMBRE_DEFECTO = 'MIGRACIÓN release 17'
const BACKUP_BASE = 'C:/Users/luigg/Desktop/construacero-backups'

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const has = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }
const SIMULAR_FALLO = val('--simular-fallo') ? Number(val('--simular-fallo')) : null

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const INICIO = new Date().toISOString()
const ARCHIVO = `release17-ventana-${stamp()}`
const CARPETA_RESPALDO = path.join(BACKUP_BASE, `ventana-release17-${stamp()}`)

// ── Registro de la ventana (evidencia del propio comando) ─────────────────────
const resumen = {
  tool: 'ventana-release17-produccion.mjs',
  modo: DRY_RUN ? 'dry-run (sin escritura en producción)' : 'ventana real',
  started_at: INICIO,
  carpeta_respaldo: CARPETA_RESPALDO,
  pasos: [],
  resultado: null,
}

function log(msg) { console.log(msg) }

// Ejecuta un comando hijo dejando que su salida se vea en pantalla. Devuelve el
// código de salida (null = no arrancó). timeout en ms.
function correr(cmd, args, { timeout, env } = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, env: env ? { ...process.env, ...env } : process.env, timeout })
  return r.status ?? 1
}

async function pedirConfirmacion() {
  const confirmArg = val('--confirmar')
  if (confirmArg !== null) {
    const ok = confirmArg === 'APLICAR'
    console.log(ok
      ? 'Confirmación recibida por argumento (--confirmar APLICAR): la persona que ejecuta la ventana autorizó la escritura en producción.'
      : 'ABORT: --confirmar exige la palabra exacta APLICAR.')
    return ok
  }
  if (!process.stdin.isTTY) {
    console.error('ABORT: el paso de instalación exige escribir APLICAR (con el teclado, o con --confirmar APLICAR en ejecución asistida) y no hay ninguno de los dos.')
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const respuesta = await new Promise((res) => rl.question(
    '\nEste paso ESCRIBE en la base de producción (es la ventana real).\nEscribe APLICAR para continuar, o ENTER para cancelar: ', res))
  rl.close()
  return respuesta.trim() === 'APLICAR'
}

function guardarEvidencia() {
  resumen.finished_at = new Date().toISOString()
  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
  const json = path.join(ROOT, `tmp/${ARCHIVO}.json`)
  fs.writeFileSync(json, JSON.stringify(resumen, null, 2))
  const md = [
    `# Ventana release 17 (egreso al aprobar) en PRODUCCIÓN — ${INICIO}`,
    ``,
    `- Comando: \`scripts/ventana-release17-produccion.mjs\`${DRY_RUN ? ' --dry-run' : ''} · Resultado: **${resumen.resultado}**`,
    `- Modo: ${resumen.modo}`,
    `- Respaldo: \`${resumen.carpeta_respaldo}\``,
    ``,
    `## Pasos`,
    ...resumen.pasos.map((p) => `- ${p.ok ? '✅' : '❌'} Paso ${p.n} — ${p.nombre}` +
      ` (${p.duracion_s}s${p.codigo === null ? '' : ` · exit ${p.codigo}`})${p.nota ? ` — ${p.nota}` : ''}`),
    ``,
    `## Recordatorio`,
    `- Si la instalación tocó la base y hay que volver atrás: plan B en un comando`,
    `  (\`PRODUCCION_RELEASE17_ROLLBACK_CONFIRM=REVERTIR_RELEASE17_PRODUCCION node scripts/rollback-release17-produccion.mjs --apply\`),`,
    `  más revert del commit de app en la misma ventana.`,
    `- Lo que queda fuera de este comando (plan §4, pasos 4-7): commit + empuje a main,`,
    `  smokes en la aplicación real y aviso al equipo.`,
    ``,
  ].join('\n')
  const mdPath = path.join(ROOT, `docs/operaciones/${ARCHIVO}.md`)
  fs.writeFileSync(mdPath, md)
  console.log(`\nEvidencia de la ventana: ${path.relative(ROOT, mdPath)} · ${path.relative(ROOT, json)}`)
}

function abortar(paso, detalle) {
  resumen.resultado = 'ABORTADO'
  guardarEvidencia()
  console.error(`\n═══ VENTANA DETENIDA en el paso ${paso.n} — ${paso.nombre} ═══`)
  if (detalle) console.error(detalle)
  if (paso.n < 3) {
    console.error('Nada fue escrito en producción (los pasos 1-2 son solo lectura): corrige el problema y vuelve a ejecutar el mismo comando.')
  } else {
    console.error('La instalación puede haber tocado la base. Revisa su evidencia en docs/operaciones/release17-produccion-cutover-*.md.')
    console.error('Si hace falta volver atrás, el plan B de un comando es:')
    console.error('  PRODUCCION_RELEASE17_ROLLBACK_CONFIRM=REVERTIR_RELEASE17_PRODUCCION node scripts/rollback-release17-produccion.mjs --apply')
    console.error('  (y revertir también el commit de app en la misma ventana)')
  }
  process.exit(1)
}

async function paso(n, nombre, fn) {
  const t0 = Date.now()
  console.log(`\n${'═'.repeat(78)}\n═══ PASO ${n} — ${nombre}\n${'═'.repeat(78)}`)
  if (SIMULAR_FALLO === n) {
    console.log('(SIMULACIÓN DE FALLO — ensayo del mecanismo de parada; este paso no se ejecuta)')
    resumen.pasos.push({ n, nombre, ok: false, codigo: 1, duracion_s: 0, nota: 'fallo simulado (--simular-fallo)' })
    abortar({ n, nombre }, 'Fallo simulado a propósito con --simular-fallo (esto es un ensayo).')
  }
  const codigo = await fn()
  const duracion_s = Math.round((Date.now() - t0) / 1000)
  const ok = codigo === 0
  resumen.pasos.push({ n, nombre, ok, codigo, duracion_s })
  if (!ok) abortar({ n, nombre }, `El paso terminó con código de error ${codigo}.`)
  console.log(`\n═══ PASO ${n} completado (${duracion_s}s) ═══`)
}

const node = process.execPath
const script = (s) => path.join(ROOT, 'scripts', s)

// Operador del kardex de migración: el MISMO en el preflight y en la instalación,
// para que el veredicto del paso 1 corresponda exactamente a lo que hará el paso 3.
const OPERADOR_ID = process.env.RELEASE17_OPERADOR_ID || OPERADOR_DEFECTO
const OPERADOR_NOMBRE = process.env.RELEASE17_OPERADOR_NOMBRE || OPERADOR_NOMBRE_DEFECTO
const envOperador = { RELEASE17_OPERADOR_ID: OPERADOR_ID, RELEASE17_OPERADOR_NOMBRE: OPERADOR_NOMBRE }

// ═══════════════════════════════════════════════════════════════════════════
console.log(`== VENTANA release 17 en PRODUCCIÓN — ${DRY_RUN ? 'PRUEBA EN SECO (sin escritura)' : 'VENTANA REAL'} ==`)
console.log(`Inicio: ${INICIO}`)
console.log(`Respaldo de esta ventana: ${CARPETA_RESPALDO}`)

// ── PASO 1 — COMPROBACIONES RÁPIDAS ──────────────────────────────────────────
await paso(1, 'Comprobaciones rápidas (paquete, destino y preflight solo lectura)', async () => {
  for (const f of [
    'scripts/apply-release17-produccion.mjs',
    'scripts/backup-release17-produccion.mjs',
    'scripts/verify-release17-backup-local.mjs',
    'scripts/rollback-release17-produccion.mjs',
    'supabase/release/main/17_egreso_inventario_aprobacion_apply.sql',
    'supabase/release/main/17_egreso_inventario_backfill.sql',
    'supabase/release/main/17_egreso_inventario_postflight_readonly.sql',
    'supabase/release/main/17_egreso_inventario_rollback_review.sql',
    'supabase/release/main/17_egreso_inventario_SHA256SUMS.txt',
  ]) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`Falta el archivo del paquete: ${f}`)
      return 1
    }
  }
  const env = {}
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) { console.error('Falta el archivo .env (con el token de Supabase)'); return 1 }
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); const i = line.indexOf('=')
    if (i > 0 && !line.startsWith('#')) env[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['\"]|['\"]$/g, '')
  }
  if (!(env.SUPABASE_ACCESS_TOKEN_PRODUCCION || env.SUPABASE_ACCESS_TOKEN)) {
    console.error('Falta SUPABASE_ACCESS_TOKEN_PRODUCCION o SUPABASE_ACCESS_TOKEN en .env'); return 1
  }
  const refPath = path.join(ROOT, '.supabase/project-ref')
  if (!fs.existsSync(refPath)) { console.error('Falta .supabase/project-ref'); return 1 }
  const ref = fs.readFileSync(refPath, 'utf8').trim()
  if (ref !== 'oyfyuszgjwcepjpngclv') {
    console.error(`Destino inesperado: ${ref} (la ventana solo apunta a producción oyfyuszgjwcepjpngclv)`); return 1
  }
  console.log('OK   paquete completo · destino producción · credenciales presentes')
  console.log(`Operador del kardex de migración: ${OPERADOR_NOMBRE} · ${OPERADOR_ID}`)
  console.log('\n-- Comprobación local de huellas y firmas (sin red) --')
  if (correr(node, [script('apply-release17-produccion.mjs'), '--dry-run-parse'], { timeout: 120000, env: envOperador }) !== 0) return 1
  console.log('\n-- Preflight contra producción (SOLO LECTURA) --')
  return correr(node, [script('apply-release17-produccion.mjs')], { timeout: 300000, env: envOperador })
})

// ── PASO 2 — RESPALDO CON RESTAURACIÓN PROBADA ───────────────────────────────
await paso(2, 'Respaldo de producción + prueba de restauración (fila por fila)', async () => {
  return correr(node, [script('backup-release17-produccion.mjs'), CARPETA_RESPALDO, '--verify'], { timeout: 2400000 })
})

if (DRY_RUN) {
  resumen.resultado = 'PRUEBA EN SECO COMPLETADA (todo listo menos la instalación)'
  resumen.pasos.push({ n: 3, nombre: 'Instalación (omitida en --dry-run)', ok: true, codigo: null, duracion_s: 0, nota: 'solo se ejecuta en la ventana real' })
  resumen.pasos.push({ n: 4, nombre: 'Verificaciones (omitidas en --dry-run)', ok: true, codigo: null, duracion_s: 0, nota: 'solo se ejecuta en la ventana real' })
  guardarEvidencia()
  console.log(`\n== PRUEBA EN SECO COMPLETADA ==`)
  console.log('Los pasos 1 y 2 pasaron. La instalación NO se ejecutó (nada escrito en producción).')
  console.log('La ventana real se ejecuta con:')
  console.log('  node scripts/ventana-release17-produccion.mjs')
  process.exit(0)
}

// ── PASO 3 — INSTALACIÓN (el único paso que escribe) ─────────────────────────
await paso(3, 'Instalación del release 17 (pre-imágenes → apply → backfill → postflight → smoke)', async () => {
  console.log('Plan de este paso: se sellan las entregadas viejas SIN tocar su stock y se descuenta')
  console.log('solo lo "en vuelo" no excluido (#1930/#1933/#2144 jamás se tocan).')
  const confirmada = await pedirConfirmacion()
  if (!confirmada) {
    console.error('Cancelado por quien ejecuta la ventana: no se escribió nada en producción.')
    return 1
  }
  return correr(node, [script('apply-release17-produccion.mjs'), '--apply'], {
    timeout: 1200000,
    env: { PRODUCCION_RELEASE17_CONFIRM: CONFIRM_APPLY, ...envOperador },
  })
})

// ── PASO 4 — VERIFICACIONES (plan B disponible) ──────────────────────────────
await paso(4, 'Verificaciones: el plan B de reversión queda probado en seco', async () => {
  return correr(node, [script('rollback-release17-produccion.mjs')], {
    timeout: 300000,
    env: envOperador,
  })
})

// ── Cierre ───────────────────────────────────────────────────────────────────
resumen.resultado = 'VENTANA COMPLETADA'
guardarEvidencia()
console.log(`\n${'═'.repeat(78)}\n== VENTANA COMPLETADA — los 4 pasos en verde ==\n${'═'.repeat(78)}`)
console.log('Respaldo de esta ventana: ' + CARPETA_RESPALDO)
console.log('\nLo que sigue (plan §4, pasos 4-7) — este comando NO lo hace:')
console.log('  1. Commit + empuje del release a main (Vercel y GitHub Actions despliegan solos).')
console.log('  2. Verificar la aplicación nueva activa (/api/ping, versión del Worker).')
console.log('  3. Smoke semántico con producto de prueba y smoke del reporte Crédito/CxC.')
console.log('  4. Avisar al equipo: "ventana cerrada, pueden trabajar".')
process.exit(0)
