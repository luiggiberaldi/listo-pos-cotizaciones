// scripts/perf-webvitals.mjs
// Métricas de rendimiento web: LCP, CLS, TTFB, FCP, bundle size, DOM nodes
// Usa Playwright + Chrome DevTools Protocol
// Ejecutar: node scripts/perf-webvitals.mjs [--url https://listo-pos-cotizaciones.camelai.app]

import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(__dirname, '..', 'perf-results')

const APP_URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
  || process.argv[process.argv.indexOf('--url') + 1]
  || 'https://listo-pos-cotizaciones.camelai.app'

const PAGES_TO_TEST = [
  { name: 'Login', path: '/' },
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Clientes', path: '/clientes' },
  { name: 'Cotizaciones', path: '/cotizaciones' },
  { name: 'Inventario', path: '/inventario' },
]

// Número de veces que se carga cada página para promediar
const RUNS_PER_PAGE = 3

async function measurePage(browser, url, pageName) {
  const results = []

  for (let run = 0; run < RUNS_PER_PAGE; run++) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    })
    const page = await context.newPage()

    // Habilitar CDP para métricas detalladas
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')

    // Capturar network requests para medir bundle size
    const networkRequests = []
    page.on('response', async (response) => {
      try {
        const url = response.url()
        const status = response.status()
        if (status === 200 && (url.endsWith('.js') || url.endsWith('.css') || url.includes('.js?') || url.includes('.css?'))) {
          const body = await response.body().catch(() => null)
          networkRequests.push({
            url: url.split('/').pop().split('?')[0],
            type: url.includes('.css') ? 'css' : 'js',
            size: body ? body.length : 0,
            gzipSize: parseInt(response.headers()['content-length'] || '0'),
          })
        }
      } catch { /* ignore */ }
    })

    const navStart = performance.now()
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    const navEnd = performance.now()

    // Esperar un poco para que se estabilice
    await page.waitForTimeout(1000)

    // Extraer Web Vitals del navegador
    const metrics = await page.evaluate(() => {
      return new Promise((resolve) => {
        const result = {
          domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
          loadComplete: performance.timing.loadEventEnd - performance.timing.navigationStart,
          domNodes: document.querySelectorAll('*').length,
          domDepth: (() => {
            let max = 0
            const walk = (el, depth) => {
              max = Math.max(max, depth)
              for (const child of el.children) walk(child, depth + 1)
            }
            walk(document.documentElement, 0)
            return max
          })(),
          memoryUsed: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) : null,
          lcp: null,
          cls: 0,
          fcp: null,
          ttfb: null,
        }

        // Paint timing
        const paintEntries = performance.getEntriesByType('paint')
        for (const entry of paintEntries) {
          if (entry.name === 'first-contentful-paint') result.fcp = Math.round(entry.startTime)
        }

        // Navigation timing
        const navEntries = performance.getEntriesByType('navigation')
        if (navEntries.length) {
          result.ttfb = Math.round(navEntries[0].responseStart)
        }

        // LCP observer (retardado)
        let lcpValue = 0
        try {
          const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries()
            if (entries.length) lcpValue = Math.round(entries[entries.length - 1].startTime)
          })
          observer.observe({ type: 'largest-contentful-paint', buffered: true })
          setTimeout(() => {
            observer.disconnect()
            result.lcp = lcpValue || null
            resolve(result)
          }, 500)
        } catch {
          resolve(result)
        }
      })
    })

    // CDP Performance metrics
    const cdpMetrics = await cdp.send('Performance.getMetrics')
    const cdpMap = {}
    for (const m of cdpMetrics.metrics) {
      cdpMap[m.name] = m.value
    }

    results.push({
      run: run + 1,
      navigationMs: Math.round(navEnd - navStart),
      ...metrics,
      jsHeapUsedMB: cdpMap.JSHeapUsedSize ? Math.round(cdpMap.JSHeapUsedSize / 1024 / 1024) : null,
      jsHeapTotalMB: cdpMap.JSHeapTotalSize ? Math.round(cdpMap.JSHeapTotalSize / 1024 / 1024) : null,
      layoutCount: cdpMap.LayoutCount || 0,
      recalcStyleCount: cdpMap.RecalcStyleCount || 0,
      scriptDuration: cdpMap.ScriptDuration ? Math.round(cdpMap.ScriptDuration * 1000) : 0,
      layoutDuration: cdpMap.LayoutDuration ? Math.round(cdpMap.LayoutDuration * 1000) : 0,
      networkAssets: [...networkRequests],
    })

    await context.close()
  }

  // Promediar resultados
  const avg = (key) => {
    const vals = results.map(r => r[key]).filter(v => v != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }

  // Bundle sizes del último run
  const lastAssets = results[results.length - 1].networkAssets
  const totalJsSize = lastAssets.filter(a => a.type === 'js').reduce((s, a) => s + a.size, 0)
  const totalCssSize = lastAssets.filter(a => a.type === 'css').reduce((s, a) => s + a.size, 0)

  return {
    page: pageName,
    url,
    runs: RUNS_PER_PAGE,
    avg: {
      navigationMs: avg('navigationMs'),
      ttfb: avg('ttfb'),
      fcp: avg('fcp'),
      lcp: avg('lcp'),
      domContentLoaded: avg('domContentLoaded'),
      loadComplete: avg('loadComplete'),
      domNodes: avg('domNodes'),
      domDepth: avg('domDepth'),
      jsHeapUsedMB: avg('jsHeapUsedMB'),
      layoutCount: avg('layoutCount'),
      recalcStyleCount: avg('recalcStyleCount'),
      scriptDurationMs: avg('scriptDuration'),
      layoutDurationMs: avg('layoutDuration'),
    },
    bundle: {
      jsFiles: lastAssets.filter(a => a.type === 'js').length,
      cssFiles: lastAssets.filter(a => a.type === 'css').length,
      totalJsKB: Math.round(totalJsSize / 1024),
      totalCssKB: Math.round(totalCssSize / 1024),
      totalKB: Math.round((totalJsSize + totalCssSize) / 1024),
      largestAssets: lastAssets
        .sort((a, b) => b.size - a.size)
        .slice(0, 5)
        .map(a => ({ name: a.url, type: a.type, sizeKB: Math.round(a.size / 1024) })),
    },
    rawRuns: results.map(r => ({
      run: r.run,
      navigationMs: r.navigationMs,
      ttfb: r.ttfb,
      fcp: r.fcp,
      lcp: r.lcp,
      domNodes: r.domNodes,
    })),
  }
}

async function main() {
  console.log('\n🌐 WEB VITALS & PERFORMANCE METRICS')
  console.log(`   URL: ${APP_URL}`)
  console.log(`   Páginas: ${PAGES_TO_TEST.length} | Runs por página: ${RUNS_PER_PAGE}`)
  console.log('═'.repeat(60))

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  })

  const allResults = []

  for (const pageConfig of PAGES_TO_TEST) {
    const url = `${APP_URL}${pageConfig.path}`
    console.log(`\n📄 ${pageConfig.name} (${pageConfig.path})`)

    try {
      const result = await measurePage(browser, url, pageConfig.name)
      allResults.push(result)

      console.log(`   TTFB: ${result.avg.ttfb ?? '—'}ms | FCP: ${result.avg.fcp ?? '—'}ms | LCP: ${result.avg.lcp ?? '—'}ms`)
      console.log(`   Nav: ${result.avg.navigationMs}ms | DOM nodes: ${result.avg.domNodes} | Depth: ${result.avg.domDepth}`)
      console.log(`   Bundle: ${result.bundle.totalKB}KB (JS: ${result.bundle.totalJsKB}KB, CSS: ${result.bundle.totalCssKB}KB)`)
      console.log(`   JS Heap: ${result.avg.jsHeapUsedMB ?? '—'}MB | Scripts: ${result.avg.scriptDurationMs}ms | Layouts: ${result.avg.layoutCount}`)
    } catch (err) {
      console.log(`   ✗ Error: ${err.message}`)
      allResults.push({ page: pageConfig.name, error: err.message })
    }
  }

  await browser.close()

  // ── Análisis build (vite) ──
  console.log('\n📦 Analizando build de Vite...')
  let buildAnalysis = null
  try {
    const { readdirSync, statSync } = await import('node:fs')
    const distPath = join(__dirname, '..', 'dist', 'assets')
    const files = readdirSync(distPath)
    const assets = files.map(f => {
      const stat = statSync(join(distPath, f))
      return { name: f, sizeKB: Math.round(stat.size / 1024), type: f.endsWith('.js') ? 'js' : f.endsWith('.css') ? 'css' : 'other' }
    }).sort((a, b) => b.sizeKB - a.sizeKB)

    buildAnalysis = {
      totalFiles: assets.length,
      totalSizeKB: assets.reduce((s, a) => s + a.sizeKB, 0),
      jsKB: assets.filter(a => a.type === 'js').reduce((s, a) => s + a.sizeKB, 0),
      cssKB: assets.filter(a => a.type === 'css').reduce((s, a) => s + a.sizeKB, 0),
      largestFiles: assets.slice(0, 10),
    }

    console.log(`   Total: ${buildAnalysis.totalSizeKB}KB | JS: ${buildAnalysis.jsKB}KB | CSS: ${buildAnalysis.cssKB}KB`)
    console.log(`   Archivos más grandes:`)
    for (const f of buildAnalysis.largestFiles.slice(0, 5)) {
      console.log(`     ${f.name}: ${f.sizeKB}KB`)
    }
  } catch (err) {
    console.log(`   ⚠ No se encontró dist/assets: ${err.message}`)
  }

  // ── Resumen ──
  console.log('\n' + '═'.repeat(60))
  console.log('📊 RESUMEN WEB VITALS')
  console.log('═'.repeat(60))

  const table = allResults
    .filter(r => !r.error)
    .map(r => ({
      Página: r.page,
      'TTFB(ms)': r.avg.ttfb ?? '—',
      'FCP(ms)': r.avg.fcp ?? '—',
      'LCP(ms)': r.avg.lcp ?? '—',
      'Nav(ms)': r.avg.navigationMs,
      DOM: r.avg.domNodes,
      'JS(KB)': r.bundle.totalJsKB,
      'Heap(MB)': r.avg.jsHeapUsedMB ?? '—',
    }))

  console.table(table)

  // Thresholds y warnings
  console.log('\n⚠ ALERTAS:')
  let alertCount = 0
  for (const r of allResults.filter(r => !r.error)) {
    if (r.avg.lcp && r.avg.lcp > 2500) {
      console.log(`  🔴 ${r.page}: LCP ${r.avg.lcp}ms > 2500ms (Google recomienda < 2.5s)`)
      alertCount++
    }
    if (r.avg.fcp && r.avg.fcp > 1800) {
      console.log(`  🟡 ${r.page}: FCP ${r.avg.fcp}ms > 1800ms`)
      alertCount++
    }
    if (r.avg.domNodes > 1500) {
      console.log(`  🟡 ${r.page}: ${r.avg.domNodes} DOM nodes (recomendado < 1500)`)
      alertCount++
    }
    if (r.bundle.totalJsKB > 500) {
      console.log(`  🟡 ${r.page}: Bundle JS ${r.bundle.totalJsKB}KB (recomendado < 500KB)`)
      alertCount++
    }
    if (r.avg.jsHeapUsedMB && r.avg.jsHeapUsedMB > 50) {
      console.log(`  🔴 ${r.page}: JS Heap ${r.avg.jsHeapUsedMB}MB > 50MB`)
      alertCount++
    }
  }
  if (alertCount === 0) console.log('  ✅ Todas las métricas dentro de umbrales aceptables')

  // Guardar resultados
  mkdirSync(RESULTS_DIR, { recursive: true })
  const output = { timestamp: new Date().toISOString(), url: APP_URL, pages: allResults, buildAnalysis }
  writeFileSync(join(RESULTS_DIR, 'webvitals-results.json'), JSON.stringify(output, null, 2))
  console.log(`\n💾 Resultados guardados en: perf-results/webvitals-results.json`)
}

main().catch(err => {
  console.error('✗ Error fatal:', err.message)
  process.exit(1)
})
