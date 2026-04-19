// scripts/perf-runner.mjs
// Runner principal — ejecuta todo el suite de performance y genera reporte
//
// Ejecutar suite completo:
//   SUPABASE_SERVICE_KEY=... GATE_EMAIL=... GATE_PASSWORD=... USER_PIN=... \
//   node scripts/perf-runner.mjs [--stress-level medium] [--skip-stress] [--skip-vitals] [--skip-e2e]
//
// Ejemplos:
//   node scripts/perf-runner.mjs                              # Todo con stress level medium
//   node scripts/perf-runner.mjs --stress-level large         # Stress con datos grandes
//   node scripts/perf-runner.mjs --skip-stress                # Solo vitals + e2e (sin regenerar datos)
//   node scripts/perf-runner.mjs --skip-e2e                   # Solo stress + vitals

import { execSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = join(__dirname, '..')
const RESULTS_DIR = join(PROJECT_DIR, 'perf-results')

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const skipStress = args.includes('--skip-stress')
const skipVitals = args.includes('--skip-vitals')
const skipE2e = args.includes('--skip-e2e')
const stressLevel = args.find(a => a.startsWith('--stress-level='))?.split('=')[1]
  || args[args.indexOf('--stress-level') + 1]
  || 'medium'

// Validar env vars requeridas
const hasStressEnv = !!process.env.SUPABASE_SERVICE_KEY
const hasE2eEnv = !!(process.env.GATE_EMAIL && process.env.GATE_PASSWORD && process.env.USER_PIN)

if (!skipStress && !hasStressEnv) {
  console.warn('⚠ SUPABASE_SERVICE_KEY no configurada — se omitirá stress test')
}
if (!skipE2e && !hasE2eEnv) {
  console.warn('⚠ GATE_EMAIL/GATE_PASSWORD/USER_PIN no configuradas — se omitirá E2E test')
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function runScript(name, scriptPath, extraArgs = [], extraEnv = {}) {
  return new Promise((resolve) => {
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`▶ Ejecutando: ${name}`)
    console.log('═'.repeat(60))

    const start = performance.now()
    const child = spawn('node', [scriptPath, ...extraArgs], {
      cwd: PROJECT_DIR,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    })

    child.on('close', (code) => {
      const ms = Math.round(performance.now() - start)
      resolve({ name, exitCode: code, durationMs: ms, success: code === 0 })
    })

    child.on('error', (err) => {
      const ms = Math.round(performance.now() - start)
      resolve({ name, exitCode: -1, durationMs: ms, success: false, error: err.message })
    })
  })
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const totalStart = performance.now()
  mkdirSync(RESULTS_DIR, { recursive: true })

  console.log('\n' + '▓'.repeat(60))
  console.log('▓  SUITE COMPLETO DE PERFORMANCE — Construacero Carabobo')
  console.log('▓'.repeat(60))
  console.log(`  Stress: ${skipStress ? 'OMITIDO' : `nivel ${stressLevel}`}`)
  console.log(`  Web Vitals: ${skipVitals ? 'OMITIDO' : 'HABILITADO'}`)
  console.log(`  E2E: ${skipE2e ? 'OMITIDO' : 'HABILITADO'}`)
  console.log(`  Fecha: ${new Date().toLocaleString('es-VE')}`)

  const runResults = []

  // ── 1. Stress Test ──
  if (!skipStress && hasStressEnv) {
    const result = await runScript(
      'Stress Test de Datos',
      join(__dirname, 'stress-seed.mjs'),
      [`--level=${stressLevel}`],
    )
    runResults.push(result)
  }

  // ── 2. Web Vitals ──
  if (!skipVitals) {
    const result = await runScript(
      'Web Vitals & Métricas',
      join(__dirname, 'perf-webvitals.mjs'),
    )
    runResults.push(result)
  }

  // ── 3. E2E Performance ──
  if (!skipE2e && hasE2eEnv) {
    const result = await runScript(
      'E2E Performance Flows',
      join(__dirname, 'perf-e2e.mjs'),
    )
    runResults.push(result)
  }

  // ── Recopilar resultados ──
  const stressResults = readJson(join(RESULTS_DIR, 'stress-results.json'))
  const vitalsResults = readJson(join(RESULTS_DIR, 'webvitals-results.json'))
  const e2eResults = readJson(join(RESULTS_DIR, 'e2e-results.json'))

  const totalMs = Math.round(performance.now() - totalStart)

  // ── Generar reporte consolidado ──
  console.log('\n\n' + '▓'.repeat(60))
  console.log('▓  REPORTE CONSOLIDADO')
  console.log('▓'.repeat(60))

  // Tabla de ejecución
  console.log('\n📋 Ejecución de tests:')
  console.table(runResults.map(r => ({
    Test: r.name,
    Estado: r.success ? '✅ OK' : '❌ FALLÓ',
    Duración: formatMs(r.durationMs),
  })))

  // Stress Summary
  if (stressResults) {
    console.log('\n📦 STRESS TEST:')
    console.log(`  Nivel: ${stressResults.level}`)
    console.log(`  Registros totales: ${Object.values(stressResults.counts).reduce((a, b) => a + b, 0)}`)
    for (const [k, v] of Object.entries(stressResults.counts)) {
      console.log(`    ${k}: ${v}`)
    }
    console.log(`  Tiempo total: ${formatMs(stressResults.timestamps.total)}`)

    // Calcular throughput
    const totalRecords = Object.values(stressResults.counts).reduce((a, b) => a + b, 0)
    const seconds = stressResults.timestamps.total / 1000
    console.log(`  Throughput: ${Math.round(totalRecords / seconds)} registros/segundo`)
  }

  // Vitals Summary
  if (vitalsResults) {
    console.log('\n🌐 WEB VITALS:')
    const pages = vitalsResults.pages.filter(p => !p.error)
    for (const p of pages) {
      const score = getVitalsScore(p.avg)
      console.log(`  ${score} ${p.page}:  TTFB=${p.avg.ttfb ?? '—'}ms  FCP=${p.avg.fcp ?? '—'}ms  LCP=${p.avg.lcp ?? '—'}ms  DOM=${p.avg.domNodes}  JS=${p.bundle.totalJsKB}KB`)
    }
    if (vitalsResults.buildAnalysis) {
      console.log(`  Bundle total: ${vitalsResults.buildAnalysis.totalSizeKB}KB (JS: ${vitalsResults.buildAnalysis.jsKB}KB, CSS: ${vitalsResults.buildAnalysis.cssKB}KB)`)
    }
  }

  // E2E Summary
  if (e2eResults) {
    console.log('\n⏱️ E2E FLOWS:')
    for (const f of e2eResults.flows) {
      const icon = f.success ? '✅' : '❌'
      console.log(`  ${icon} ${f.name}: ${formatMs(f.totalMs)}`)
      if (f.steps) {
        const slowest = [...f.steps].sort((a, b) => b.ms - a.ms)[0]
        if (slowest) console.log(`     Paso más lento: ${slowest.name} (${formatMs(slowest.ms)})`)
      }
    }
    console.log(`  Total E2E: ${formatMs(e2eResults.summary.totalMs)} | ${e2eResults.summary.passed}/${e2eResults.summary.totalFlows} pasaron`)
  }

  // ── Score global ──
  console.log('\n' + '─'.repeat(60))
  const { score, details } = calculateGlobalScore(stressResults, vitalsResults, e2eResults)
  console.log(`\n🏆 SCORE GLOBAL DE PERFORMANCE: ${score}/100`)
  for (const d of details) {
    console.log(`  ${d}`)
  }

  console.log(`\n⏱️ Duración total del suite: ${formatMs(totalMs)}`)

  // ── Guardar reporte final ──
  const finalReport = {
    timestamp: new Date().toISOString(),
    totalDurationMs: totalMs,
    score,
    scoreDetails: details,
    runs: runResults,
    stress: stressResults,
    vitals: vitalsResults,
    e2e: e2eResults,
  }

  writeFileSync(join(RESULTS_DIR, 'full-report.json'), JSON.stringify(finalReport, null, 2))
  console.log(`\n💾 Reporte completo: perf-results/full-report.json`)
  console.log('═'.repeat(60))
}

function getVitalsScore(avg) {
  if (avg.lcp && avg.lcp > 4000) return '🔴'
  if (avg.lcp && avg.lcp > 2500) return '🟡'
  if (avg.fcp && avg.fcp > 3000) return '🔴'
  if (avg.fcp && avg.fcp > 1800) return '🟡'
  return '🟢'
}

function calculateGlobalScore(stress, vitals, e2e) {
  let score = 100
  const details = []

  // Stress scoring (30 pts)
  if (stress) {
    const throughput = Object.values(stress.counts).reduce((a, b) => a + b, 0) / (stress.timestamps.total / 1000)
    if (throughput > 100) {
      details.push('🟢 Stress: throughput excelente (>100 reg/s)')
    } else if (throughput > 50) {
      score -= 5
      details.push('🟡 Stress: throughput aceptable (50-100 reg/s)')
    } else {
      score -= 15
      details.push('🔴 Stress: throughput bajo (<50 reg/s)')
    }
  }

  // Vitals scoring (40 pts)
  if (vitals) {
    const pages = vitals.pages.filter(p => !p.error)
    for (const p of pages) {
      if (p.avg.lcp && p.avg.lcp > 4000) { score -= 10; details.push(`🔴 ${p.page}: LCP ${p.avg.lcp}ms (crítico >4s)`) }
      else if (p.avg.lcp && p.avg.lcp > 2500) { score -= 5; details.push(`🟡 ${p.page}: LCP ${p.avg.lcp}ms (lento >2.5s)`) }

      if (p.avg.fcp && p.avg.fcp > 3000) { score -= 5; details.push(`🔴 ${p.page}: FCP ${p.avg.fcp}ms (lento)`) }

      if (p.bundle?.totalJsKB > 1000) { score -= 10; details.push(`🔴 ${p.page}: Bundle ${p.bundle.totalJsKB}KB (excesivo)`) }
      else if (p.bundle?.totalJsKB > 500) { score -= 5; details.push(`🟡 ${p.page}: Bundle ${p.bundle.totalJsKB}KB (grande)`) }

      if (p.avg.domNodes > 3000) { score -= 5; details.push(`🔴 ${p.page}: ${p.avg.domNodes} DOM nodes`) }
    }
  }

  // E2E scoring (30 pts)
  if (e2e) {
    const failed = e2e.flows.filter(f => !f.success).length
    if (failed > 0) {
      score -= failed * 10
      details.push(`🔴 E2E: ${failed} flujo(s) fallaron`)
    }
    for (const f of e2e.flows.filter(f => f.success)) {
      if (f.totalMs > 15000) { score -= 5; details.push(`🟡 ${f.name}: ${formatMs(f.totalMs)} (lento)`) }
    }
  }

  if (details.length === 0) details.push('🟢 Todas las métricas dentro de umbrales óptimos')

  return { score: Math.max(0, score), details }
}

function formatMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

main().catch(err => {
  console.error('✗ Error fatal:', err.message)
  process.exit(1)
})
