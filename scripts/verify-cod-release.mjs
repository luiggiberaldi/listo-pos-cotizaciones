#!/usr/bin/env node
// scripts/verify-cod-release.mjs
// Verificación unificada del release COD (Tarea 0 / runbook cutover-cod-release-14).
//
// Corre los 5 gates del runbook EN ORDEN y genera un reporte de evidencia en
// docs/operencias/ (markdown con huellas SHA-256 de los artefactos del release):
//
//   1. npm run test:cod                  → 45/45 unit + contract tests
//   2. npm run test:cod:browser          → Chromium, 12 aserciones de interfaz
//   3. npm run verify:cod:release-local  → PostgreSQL 17 desechable (ensayo migración 14)
//   4. npm test                          → suite completa
//   5. npm run build                     → vite build + PWA
//
// Uso:
//   npm run verify:cod:release           → se detiene en el primer gate en rojo
//   npm run verify:cod:release -- --all  → corre todos aunque falle alguno (reporte completo)
//
// Códigos de salida: 0 = GO (5/5 PASS) · 1 = NO-GO.

import { spawn, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUN_ALL = process.argv.includes('--all')

// Gates del runbook, en orden obligatorio (SQL→postflight→Worker→Frontend se
// verifican aquí en su orden de validación local: unit → UI → base → suite → build).
const GATES = [
  { id: 'test:cod',                 label: 'Tests COD (unit + contract)',   cmd: 'npm run test:cod',                 resumen: /Tests\s+(\d+ passed \(\d+\))/ },
  { id: 'test:cod:browser',         label: 'Interfaz COD en Chromium',      cmd: 'npm run test:cod:browser',         resumen: /^(PASS:.*\S)\s*$/m },
  { id: 'verify:cod:release-local', label: 'Migración 14 en PostgreSQL local', cmd: 'npm run verify:cod:release-local', resumen: /^(PASS:.*\S)\s*$/m },
  { id: 'test',                     label: 'Suite completa',                cmd: 'npm test',                         resumen: /Tests\s+(\d+ passed \(\d+\))/ },
  { id: 'build',                    label: 'Build de producción',           cmd: 'npm run build',                    resumen: /(\u2713 built in .+\S)/ },
]

// Artefactos cuya huella se fija en el reporte (manifest del release 14 + código
// que garantiza la paridad monetaria). Cualquier cambio de un release futuro
// queda visible como diferencia de hash entre reportes.
const ARTEFACTOS = [
  'supabase/release/main/14_cod_preflight_readonly.sql',
  'supabase/release/main/14_cod_financial_rpcs_review.sql',
  'supabase/release/main/14_cod_postflight_readonly.sql',
  'supabase/release/main/14_cod_rollback_review.sql',
  'supabase/release/main/README.md',
  'docs/runbooks/cutover-cod-release-14.md',
  'docs/runbooks/cod-release-14-review-packet.md',
  'docs/runbooks/rollback-base-de-datos.md',
  'src/components/despachos/ConciliarCodModal.jsx',
  'api/handlers/cod.js',
  'src/utils/codCurrency.js',
  'api/handlers/__tests__/cod.test.js',
  'src/components/despachos/__tests__/ConciliarCodModal.test.js',
  'src/utils/__tests__/codCurrency.test.js',
  'scripts/lib/__tests__/codMainRelease.test.js',
  'scripts/lib/__tests__/invariantes.test.js',
  'scripts/lib/invariantes.mjs',
  'scripts/test-cod-main-release-local.mjs',
  'scripts/test-cod-modal-browser.mjs',
  'src/test-fixtures/cod-modal/authFetchMock.js',
  'src/test-fixtures/cod-modal/index.html',
  'src/test-fixtures/cod-modal/main.jsx',
  'src/test-fixtures/cod-modal/rateHookMock.js',
  'src/test-fixtures/cod-modal/vite.config.js',
]

function ejecutar(cmd) {
  return new Promise((resolve) => {
    const inicio = Date.now()
    const child = spawn(cmd, { shell: true, cwd: ROOT, env: process.env })
    let salida = ''
    child.stdout.on('data', (d) => { const s = d.toString(); salida += s; process.stdout.write(s) })
    child.stderr.on('data', (d) => { const s = d.toString(); salida += s; process.stderr.write(s) })
    child.on('error', (err) => resolve({ code: 1, salida: `${salida}\n[spawn error] ${err.message}`, ms: Date.now() - inicio }))
    // close entrega el código real del proceso: no se reinterpretan fallos.
    child.on('close', (code) => resolve({ code: code ?? 1, salida, ms: Date.now() - inicio }))
  })
}

function duracion(ms) {
  const s = ms / 1000
  return s >= 60 ? `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s` : `${s.toFixed(1)}s`
}

function sinAnsi(t) {
  return t.replace(new RegExp(String.fromCharCode(27) + '[[]' + '[0-9;]*m', 'g'), '')
}

function extraerResumen(re, salida) {
  const matches = [...sinAnsi(salida).matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))]
  if (matches.length > 0) return matches[0][1] ?? matches[0][0]
  const lineas = sinAnsi(salida).split('\n').map((l) => l.trim()).filter(Boolean)
  return lineas.length ? lineas[lineas.length - 1].slice(0, 120) : '(sin salida)'
}

function hashArchivo(rel) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) return '(falta)'
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

function infoGit() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
    const sucio = execSync('git status --porcelain', { cwd: ROOT }).toString().trim()
    return { commit, sucio: sucio.length > 0 }
  } catch {
    return { commit: '(desconocido)', sucio: false }
  }
}

function tail(texto, n) {
  return sinAnsi(texto).split('\n').filter((l) => l.trim() !== '').slice(-n).join('\n')
}

const marca = new Date()
const sello = marca.toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')
const git = infoGit()

console.log(`\n\u2550\u2550 verify:cod:release \u2014 5 gates del runbook COD ${RUN_ALL ? '(modo --all)' : '(fail-fast)'}\n`)

// Precondición: todos los artefactos del manifest presentes. Sin ellos los gates
// podrían pasar corriendo MENOS tests de los esperados (vitest ignora archivos
// inexistentes si al menos uno resuelve), y un GO con manifest incompleto es falso.
const faltantes = ARTEFACTOS.filter((rel) => !existsSync(join(ROOT, rel)))
const precond = faltantes.length === 0
  ? ARTEFACTOS.length + '/' + ARTEFACTOS.length + ' artefactos presentes'
  : '**' + faltantes.length + ' artefacto(s) FALTANTES:**' + faltantes.map((f) => String.fromCharCode(10) + '- `' + f + '`').join('');

const resultados = []
let falloPrevio = faltantes.length > 0

for (const gate of GATES) {
  if (falloPrevio && !RUN_ALL) {
    resultados.push({ ...gate, estado: 'NO EJECUTADO', ms: 0, resumen: '(omitido por fallo previo)', salida: '' })
    console.log(`\u25a0 ${gate.id} \u2026 omitido (fallo previo)`)
    continue
  }
  console.log(`\n\u2550\u2550\u2550 ${gate.id} \u2014 ${gate.label} \u2026 ${gate.cmd} ${'\u2550'.repeat(20)}`)
  const { code, salida, ms } = await ejecutar(gate.cmd)
  const estado = code === 0 ? 'PASS' : 'FAIL'
  if (code !== 0) falloPrevio = true
  resultados.push({ ...gate, estado, code, ms, resumen: extraerResumen(gate.resumen, salida), salida })
  console.log(`\u2192 ${gate.id}: ${estado} (exit ${code}, ${duracion(ms)})`)
}

const pasaron = resultados.filter((r) => r.estado === 'PASS').length
const go = pasaron === GATES.length

const filas = resultados
  .map((r, i) => `| ${i + 1} | \`${r.id}\` | ${r.label} | ${r.estado === 'PASS' ? '\u2705 PASS' : r.estado === 'FAIL' ? `\u274c FAIL (exit ${r.code})` : '\u23ed\ufe0e no ejecutado'} | ${r.ms ? duracion(r.ms) : '\u2014'} | ${r.resumen.replace(/\|/g, '\\|')} |`)
  .join('\n')

const hashes = ARTEFACTOS.map((rel) => `${hashArchivo(rel)}  ${rel}`).join('\n')

const fallas = resultados
  .filter((r) => r.estado === 'FAIL')
  .map((r) => `### \`${r.id}\` \u2014 \u00faltimas 40 l\u00edneas\n\`\`\`\n${tail(r.salida, 40)}\n\`\`\``)
  .join('\n\n')

const reporte = `# Verificaci\u00f3n unificada del release COD \u2014 verify:cod:release

- **Fecha:** ${marca.toISOString()}
- **Resultado:** ${go ? `\ud83d\udfe2 **GO** (${pasaron}/${GATES.length} gates PASS)` : `\ud83d\udd34 **NO-GO** (${pasaron}/${GATES.length} gates PASS)`}
- **Modo:** ${RUN_ALL ? '--all (corre todos los gates)' : 'fail-fast (se detiene en el primer rojo)'}
- **Commit:** ${git.commit}${git.sucio ? ' \u00b7 \u26a0 \u00e1rbol con cambios locales' : ' \u00b7 \u00e1rbol limpio'}
- **Entorno:** node ${process.version} \u00b7 ${process.platform} \u00b7 generado por \`npm run verify:cod:release\`

## Precondiciones

${precond}

## Gates

| # | Gate | Descripci\u00f3n | Resultado | Duraci\u00f3n | Resumen extra\u00eddo |
|---|---|---|---|---|---|
${filas}

## Huellas SHA-256 de los artefactos del release 14

\`\`\`
${hashes}
\`\`\`

${fallas ? `## Detalle de fallas\n\n${fallas}\n` : ''}\u00a1\u00a1
`

const dir = join(ROOT, 'docs', 'operaciones')
mkdirSync(dir, { recursive: true })
const ruta = join(dir, `verify-cod-release-${sello}.md`)
writeFileSync(ruta, reporte.replace('\u00a1\u00a1\n', ''))

console.log(`\n${'\u2550'.repeat(60)}`)
console.log(go ? `\ud83d\udfe2 GO \u2014 ${pasaron}/${GATES.length} gates PASS` : `\ud83d\udd34 NO-GO \u2014 ${pasaron}/${GATES.length} gates PASS`)
console.log(`Reporte de evidencia: ${ruta.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`)
process.exitCode = go ? 0 : 1
