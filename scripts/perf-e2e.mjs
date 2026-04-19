// scripts/perf-e2e.mjs
// E2E Performance Test — mide tiempos de flujos reales con Playwright
// Ejecutar:
//   GATE_EMAIL=... GATE_PASSWORD=... USER_PIN=... node scripts/perf-e2e.mjs
//
// Variables de entorno opcionales:
//   APP_URL          — URL de la app (default: https://listo-pos-cotizaciones.camelai.app)
//   GATE_EMAIL       — Email del gate de acceso
//   GATE_PASSWORD    — Contraseña del gate
//   USER_PIN         — PIN del usuario a seleccionar
//   USER_INDEX       — Índice del usuario en la lista (default: 0 = primero)

import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(__dirname, '..', 'perf-results')

const APP_URL = process.env.APP_URL || 'https://listo-pos-cotizaciones.camelai.app'
const GATE_EMAIL = process.env.GATE_EMAIL
const GATE_PASSWORD = process.env.GATE_PASSWORD
const USER_PIN = process.env.USER_PIN
const USER_INDEX = parseInt(process.env.USER_INDEX || '0')

if (!GATE_EMAIL || !GATE_PASSWORD || !USER_PIN) {
  console.error('✗ Variables requeridas: GATE_EMAIL, GATE_PASSWORD, USER_PIN')
  console.error('  Ejemplo: GATE_EMAIL=admin@test.com GATE_PASSWORD=secret USER_PIN=1234 node scripts/perf-e2e.mjs')
  process.exit(1)
}

// ── Timer helper ────────────────────────────────────────────────────────────
class StepTimer {
  constructor() {
    this.steps = []
    this.start = null
  }
  begin(name) {
    this.start = performance.now()
    this.currentStep = name
  }
  end() {
    const ms = Math.round(performance.now() - this.start)
    this.steps.push({ name: this.currentStep, ms })
    return ms
  }
  total() {
    return this.steps.reduce((s, step) => s + step.ms, 0)
  }
}

// ── Flujo 1: Login completo (Gate → Selección → PIN → Dashboard) ─────────
async function flowLogin(page) {
  const timer = new StepTimer()
  const flow = { name: 'Login Completo', steps: [], success: false }

  try {
    // Paso 1: Cargar login
    timer.begin('Carga página login')
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 })
    flow.steps.push({ name: 'Carga página login', ms: timer.end() })

    // Paso 2: Gate — llenar email y contraseña
    timer.begin('Completar gate de acceso')
    // Esperar que aparezca el form del gate
    const emailInput = page.locator('input[type="email"]')
    await emailInput.waitFor({ timeout: 10000 })
    await emailInput.fill(GATE_EMAIL)
    await page.locator('input[type="password"]').fill(GATE_PASSWORD)
    await page.locator('button[type="submit"]').click()
    // Esperar que aparezca la selección de usuarios
    await page.waitForFunction(() => {
      return document.querySelector('h1')?.textContent?.includes('Quién está operando') ||
             document.querySelector('[class*="grid"]')?.children?.length > 0
    }, { timeout: 15000 })
    flow.steps.push({ name: 'Completar gate de acceso', ms: timer.end() })

    // Paso 3: Seleccionar usuario
    timer.begin('Seleccionar usuario')
    // Esperar a que las tarjetas de usuario estén visibles
    await page.waitForTimeout(1000) // animaciones
    const userCards = page.locator('[class*="cursor-pointer"]').filter({ has: page.locator('p[class*="font-black"]') })
    const count = await userCards.count()
    if (count === 0) throw new Error('No se encontraron tarjetas de usuario')
    const targetIndex = Math.min(USER_INDEX, count - 1)
    await userCards.nth(targetIndex).click()
    flow.steps.push({ name: 'Seleccionar usuario', ms: timer.end() })

    // Paso 4: Ingresar PIN
    timer.begin('Ingresar PIN y autenticar')
    // Esperar modal de PIN
    await page.waitForTimeout(500)
    // Buscar inputs del PIN (generalmente 4-6 inputs individuales)
    const pinInputs = page.locator('input[inputmode="numeric"], input[type="tel"], input[maxlength="1"]')
    const pinCount = await pinInputs.count()
    if (pinCount > 0) {
      // PIN con inputs individuales
      for (let i = 0; i < Math.min(USER_PIN.length, pinCount); i++) {
        await pinInputs.nth(i).fill(USER_PIN[i])
      }
    } else {
      // PIN con un solo input
      const singlePin = page.locator('input[type="password"]').last()
      await singlePin.fill(USER_PIN)
      // Buscar botón de submit en el modal
      const submitBtn = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acceder")').last()
      if (await submitBtn.isVisible()) await submitBtn.click()
    }

    // Esperar navegación al dashboard o primera vista
    await page.waitForURL(/\/(dashboard|clientes|cotizaciones)/, { timeout: 15000 }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    flow.steps.push({ name: 'Ingresar PIN y autenticar', ms: timer.end() })

    flow.success = true
    flow.totalMs = timer.total()
  } catch (err) {
    flow.error = err.message
    flow.totalMs = timer.total()
  }

  return flow
}

// ── Flujo 2: Navegar por secciones principales ──────────────────────────────
async function flowNavigation(page) {
  const timer = new StepTimer()
  const flow = { name: 'Navegación entre secciones', steps: [], success: false }

  const sections = [
    { name: 'Dashboard', path: '/dashboard', wait: '[class*="grid"]' },
    { name: 'Clientes', path: '/clientes', wait: 'input[placeholder*="uscar"], [class*="grid"]' },
    { name: 'Cotizaciones', path: '/cotizaciones', wait: '[class*="grid"], [class*="empty"]' },
    { name: 'Inventario', path: '/inventario', wait: 'input[placeholder*="uscar"], [class*="grid"]' },
  ]

  try {
    for (const section of sections) {
      timer.begin(`Navegar a ${section.name}`)
      await page.goto(`${APP_URL}${section.path}`, { waitUntil: 'networkidle', timeout: 20000 })
      try {
        await page.locator(section.wait).first().waitFor({ timeout: 10000 })
      } catch { /* vista puede estar vacía */ }
      const ms = timer.end()
      flow.steps.push({ name: `Navegar a ${section.name}`, ms })
    }

    flow.success = true
    flow.totalMs = timer.total()
  } catch (err) {
    flow.error = err.message
    flow.totalMs = timer.total()
  }

  return flow
}

// ── Flujo 3: Buscar productos en inventario ─────────────────────────────────
async function flowSearchProducts(page) {
  const timer = new StepTimer()
  const flow = { name: 'Búsqueda de productos', steps: [], success: false }

  try {
    // Ir a inventario
    timer.begin('Cargar inventario')
    await page.goto(`${APP_URL}/inventario`, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1000)
    flow.steps.push({ name: 'Cargar inventario', ms: timer.end() })

    // Buscar "cemento"
    timer.begin('Buscar "cemento"')
    const searchInput = page.locator('input[placeholder*="uscar"], input[type="search"], input[type="text"]').first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('cemento')
      await page.waitForTimeout(800) // debounce
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    }
    flow.steps.push({ name: 'Buscar "cemento"', ms: timer.end() })

    // Limpiar y buscar otra cosa
    timer.begin('Buscar "pintura"')
    if (await searchInput.isVisible()) {
      await searchInput.fill('')
      await page.waitForTimeout(300)
      await searchInput.fill('pintura')
      await page.waitForTimeout(800)
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    }
    flow.steps.push({ name: 'Buscar "pintura"', ms: timer.end() })

    // Buscar con texto largo
    timer.begin('Buscar "tornillo drywall"')
    if (await searchInput.isVisible()) {
      await searchInput.fill('')
      await page.waitForTimeout(300)
      await searchInput.fill('tornillo drywall')
      await page.waitForTimeout(800)
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    }
    flow.steps.push({ name: 'Buscar "tornillo drywall"', ms: timer.end() })

    flow.success = true
    flow.totalMs = timer.total()
  } catch (err) {
    flow.error = err.message
    flow.totalMs = timer.total()
  }

  return flow
}

// ── Flujo 4: Scroll y paginación de listas ──────────────────────────────────
async function flowScrollPerformance(page) {
  const timer = new StepTimer()
  const flow = { name: 'Scroll y renderizado de listas', steps: [], success: false }

  try {
    // Ir a clientes (probablemente la lista más larga con stress data)
    timer.begin('Cargar lista de clientes')
    await page.goto(`${APP_URL}/clientes`, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1000)
    flow.steps.push({ name: 'Cargar lista de clientes', ms: timer.end() })

    // Medir scroll performance
    timer.begin('Scroll al fondo de la lista')
    const scrollResult = await page.evaluate(async () => {
      const start = performance.now()
      const container = document.querySelector('[class*="overflow-y-auto"], main, [role="main"]') || document.documentElement
      const totalHeight = container.scrollHeight
      let scrolled = 0
      const step = 500

      while (scrolled < totalHeight) {
        container.scrollBy(0, step)
        scrolled += step
        await new Promise(r => requestAnimationFrame(r))
      }
      const end = performance.now()
      return {
        scrollMs: Math.round(end - start),
        totalHeight,
        fps: null, // calculado por PerformanceObserver si disponible
      }
    })
    const scrollMs = timer.end()
    flow.steps.push({ name: 'Scroll al fondo de la lista', ms: scrollMs, detail: scrollResult })

    // Volver arriba
    timer.begin('Scroll al inicio')
    await page.evaluate(() => {
      const container = document.querySelector('[class*="overflow-y-auto"], main, [role="main"]') || document.documentElement
      container.scrollTo(0, 0)
    })
    await page.waitForTimeout(200)
    flow.steps.push({ name: 'Scroll al inicio', ms: timer.end() })

    // Ir a cotizaciones
    timer.begin('Cargar lista de cotizaciones')
    await page.goto(`${APP_URL}/cotizaciones`, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1000)
    flow.steps.push({ name: 'Cargar lista de cotizaciones', ms: timer.end() })

    // Medir DOM node count
    timer.begin('Contar nodos DOM')
    const domStats = await page.evaluate(() => ({
      totalNodes: document.querySelectorAll('*').length,
      visibleCards: document.querySelectorAll('[class*="card"], [class*="Card"]').length,
    }))
    flow.steps.push({ name: 'Contar nodos DOM', ms: timer.end(), detail: domStats })

    flow.success = true
    flow.totalMs = timer.total()
  } catch (err) {
    flow.error = err.message
    flow.totalMs = timer.total()
  }

  return flow
}

// ── Flujo 5: Rendimiento de interacciones UI ─────────────────────────────────
async function flowUIInteractions(page) {
  const timer = new StepTimer()
  const flow = { name: 'Interacciones UI', steps: [], success: false }

  try {
    // Ir a clientes
    await page.goto(`${APP_URL}/clientes`, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1000)

    // Abrir modal de nuevo cliente
    timer.begin('Abrir formulario nuevo cliente')
    const newBtn = page.locator('button:has-text("Nuevo"), button:has-text("Agregar"), button:has-text("Crear")')
    if (await newBtn.first().isVisible()) {
      await newBtn.first().click()
      await page.waitForTimeout(500) // animación modal
    }
    flow.steps.push({ name: 'Abrir formulario nuevo cliente', ms: timer.end() })

    // Cerrar modal
    timer.begin('Cerrar modal')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    flow.steps.push({ name: 'Cerrar modal', ms: timer.end() })

    // Abrir/cerrar sidebar (si existe toggle)
    timer.begin('Toggle sidebar')
    const menuBtn = page.locator('button[aria-label*="menu"], button[aria-label*="Menu"], button:has(svg[class*="menu"])')
    if (await menuBtn.first().isVisible().catch(() => false)) {
      await menuBtn.first().click()
      await page.waitForTimeout(300)
      await menuBtn.first().click()
      await page.waitForTimeout(300)
    }
    flow.steps.push({ name: 'Toggle sidebar', ms: timer.end() })

    flow.success = true
    flow.totalMs = timer.total()
  } catch (err) {
    flow.error = err.message
    flow.totalMs = timer.total()
  }

  return flow
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n⏱️ E2E PERFORMANCE TEST — Flujos con cronómetro')
  console.log(`   URL: ${APP_URL}`)
  console.log('═'.repeat(60))

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  })
  const page = await context.newPage()

  const allFlows = []

  // ── Flujo 1: Login ──
  console.log('\n🔐 Flujo 1: Login Completo')
  const loginResult = await flowLogin(page)
  allFlows.push(loginResult)
  printFlow(loginResult)

  if (!loginResult.success) {
    console.error('\n✗ Login falló — no se pueden ejecutar los flujos restantes')
    console.error(`  Error: ${loginResult.error}`)
    await browser.close()
    saveResults(allFlows)
    return
  }

  // ── Flujo 2: Navegación ──
  console.log('\n📍 Flujo 2: Navegación entre secciones')
  const navResult = await flowNavigation(page)
  allFlows.push(navResult)
  printFlow(navResult)

  // ── Flujo 3: Búsqueda ──
  console.log('\n🔍 Flujo 3: Búsqueda de productos')
  const searchResult = await flowSearchProducts(page)
  allFlows.push(searchResult)
  printFlow(searchResult)

  // ── Flujo 4: Scroll ──
  console.log('\n📜 Flujo 4: Scroll y renderizado de listas')
  const scrollResult = await flowScrollPerformance(page)
  allFlows.push(scrollResult)
  printFlow(scrollResult)

  // ── Flujo 5: UI ──
  console.log('\n🖱️ Flujo 5: Interacciones UI')
  const uiResult = await flowUIInteractions(page)
  allFlows.push(uiResult)
  printFlow(uiResult)

  await browser.close()

  // ── Resumen ──
  console.log('\n' + '═'.repeat(60))
  console.log('📊 RESUMEN E2E PERFORMANCE')
  console.log('═'.repeat(60))

  const table = allFlows.map(f => ({
    Flujo: f.name,
    Estado: f.success ? '✅' : '❌',
    'Total(ms)': f.totalMs || '—',
    Pasos: f.steps?.length || 0,
    'Paso más lento': f.steps?.length
      ? `${f.steps.sort((a, b) => b.ms - a.ms)[0].name} (${f.steps.sort((a, b) => b.ms - a.ms)[0].ms}ms)`
      : '—',
  }))
  console.table(table)

  // Alertas
  console.log('\n⚠️ ALERTAS:')
  let alertCount = 0
  for (const f of allFlows) {
    if (!f.success) {
      console.log(`  🔴 ${f.name}: FALLÓ — ${f.error}`)
      alertCount++
    }
    if (f.totalMs > 10000) {
      console.log(`  🔴 ${f.name}: ${f.totalMs}ms total > 10s`)
      alertCount++
    }
    for (const step of (f.steps || [])) {
      if (step.ms > 5000) {
        console.log(`  🟡 ${f.name} → ${step.name}: ${step.ms}ms > 5s`)
        alertCount++
      }
    }
  }
  if (alertCount === 0) console.log('  ✅ Todos los flujos dentro de umbrales aceptables')

  saveResults(allFlows)
}

function printFlow(flow) {
  for (const step of (flow.steps || [])) {
    const icon = step.ms > 3000 ? '🟡' : '✓'
    console.log(`   ${icon} ${step.name}: ${step.ms}ms`)
    if (step.detail) {
      for (const [k, v] of Object.entries(step.detail)) {
        if (v != null) console.log(`     ${k}: ${v}`)
      }
    }
  }
  if (flow.error) console.log(`   ✗ Error: ${flow.error}`)
  console.log(`   TOTAL: ${flow.totalMs}ms`)
}

function saveResults(flows) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const output = {
    timestamp: new Date().toISOString(),
    url: APP_URL,
    flows,
    summary: {
      totalFlows: flows.length,
      passed: flows.filter(f => f.success).length,
      failed: flows.filter(f => !f.success).length,
      totalMs: flows.reduce((s, f) => s + (f.totalMs || 0), 0),
    },
  }
  writeFileSync(join(RESULTS_DIR, 'e2e-results.json'), JSON.stringify(output, null, 2))
  console.log(`\n💾 Resultados guardados en: perf-results/e2e-results.json`)
}

main().catch(err => {
  console.error('✗ Error fatal:', err.message)
  process.exit(1)
})
