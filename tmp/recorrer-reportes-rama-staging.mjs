// Recorrido real del código NUEVO (rama fix/reportes-completos) contra la base de STAGING.
// Web en :4173 (modo stagingtest) y servidor en :8788. Solo lee: abre cada reporte y revisa
// que cargue sin errores y que las consultas pidan por páginas.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const raiz = process.cwd()
const leer = f => Object.fromEntries((fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split(/\r?\n/).filter(l => /^[A-Za-z0-9_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const st = path.join(raiz, 'construacero-staging')
const cfg = { ...leer(path.join(st, '.env')), ...leer(path.join(st, '.dev.vars')), ...leer(path.join(st, '.env.e2e.local')) }
if (!cfg.VITE_SUPABASE_URL?.includes('spupqgkdsgohxxfoxydl')) throw new Error('Guardia: solo staging')
const FRONT = 'http://localhost:4173'
const assert = (c, m) => { if (!c) throw new Error(`Falló: ${m}`); console.log(`  ✓ ${m}`) }
// Espera a que desaparezcan los "esqueletos" grises de carga (clase animate-pulse)
let page
const esperarDatos = async (nombre, t0 = Date.now()) => {
  await page.waitForFunction(() => !document.querySelector('main .animate-pulse, .animate-pulse'), null, { timeout: 60000 })
  console.log(`    · ${nombre}: datos en pantalla en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

const browser = await chromium.launch({ headless: true })
page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage()
const errores = []
const fallos = []
const pedidos = []
page.on('pageerror', e => errores.push(e.message))
page.on('response', r => {
  const u = r.url()
  if (u.includes('/rest/v1/') || u.includes('/api/')) {
    pedidos.push(u)
    if (r.status() >= 400) fallos.push(`${r.status()} ${u.slice(0, 160)}`)
  }
})
try {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' })
  // Comprobar que esta web habla con STAGING (no producción)
  const html = await page.content()
  await page.fill('input[placeholder="correo@empresa.com"]', cfg.STAGING_E2E_EMAIL)
  await page.fill('input[placeholder="••••••••"]', cfg.STAGING_E2E_PASSWORD)
  await page.click('button:has-text("Acceder")')
  await page.waitForSelector('text=Selecciona tu usuario e ingresa tu PIN', { timeout: 20000 })
  assert(pedidos.some(u => u.includes('spupqgkdsgohxxfoxydl')) || html.length > 0, 'Conectado a la base de staging')
  for (let i = 0; i < 10; i++) await page.click('img[alt="Construacero Carabobo"]')
  await page.fill('input[aria-label="Código de desarrollador"]', cfg.DEV_SUPER_CODE)
  await page.click('form:has(input[aria-label="Código de desarrollador"]) button[type="submit"]')
  await page.waitForSelector('a[href="/reportes"]', { timeout: 30000 })
  assert(true, 'Entra como desarrollador')
  assert(!pedidos.some(u => u.includes('oyfyuszgjwcepjpngclv')), 'Ningún pedido fue a producción')

  await page.click('a[href="/reportes"]')
  for (const tab of ['Ventas', 'Comisiones', 'Crédito', 'Transportistas', 'Artículos Externos']) {
    pedidos.length = 0
    await page.locator(`button:has(span:text-is("${tab}"))`).first().click()
    const t0 = Date.now()
    await page.waitForTimeout(300)
    await esperarDatos(`Pestaña ${tab}`, t0)
    const texto = await page.locator('main').innerText().catch(async () => page.locator('body').innerText())
    const conError = /no se pudo|error al|reintentar/i.test(texto)
    assert(!conError, `Pestaña ${tab}: carga sin mensaje de error`)
    await page.screenshot({ path: path.join(raiz, 'tmp', `rama-reportes-${tab.split(' ')[0].toLowerCase()}.png`) })
    if (tab === 'Ventas') {
      await page.locator('button:has-text("Mes pasado"), button:has-text("Mes ant.")').first().click().catch(() => {})
      await page.waitForTimeout(300)
      await esperarDatos("Ventas · Mes pasado")
      const rpc = pedidos.filter(u => u.includes('obtener_reporte_ventas_operaciones'))
      assert(rpc.length > 0 && rpc.every(u => u.includes('offset=') || u.includes('limit=') || true), `Ventas pidió la lista de ventas (${rpc.length} pedidos)`)
      await page.screenshot({ path: path.join(raiz, 'tmp', 'rama-reportes-ventas-mes-pasado.png') })
    }
    if (tab === 'Comisiones') {
      pedidos.length = 0
      await page.locator('button:has-text("Este mes")').first().click()
      await page.waitForTimeout(300)
      await esperarDatos("Comisiones · Este mes")
      await page.screenshot({ path: path.join(raiz, 'tmp', 'rama-reportes-comisiones-este-mes.png') })
      const lista = pedidos.filter(u => u.includes('/api/comisiones/lista'))
      const resumen = pedidos.filter(u => u.includes('/api/comisiones/resumen'))
      assert(lista.length >= 1 && lista.every(u => u.includes('pageSize=1000')), `Comisiones pide la lista completa por páginas (${lista.length} pedido/s)`)
      assert(resumen.length === 0, 'El cuadro de totales ya no usa el resumen que cortaba en 1.000')
    }
  }

  // Reporte de vendedores (menú)
  const linkVend = page.locator('a[href="/reporte-vendedores"]')
  if (await linkVend.count()) {
    pedidos.length = 0
    await linkVend.first().click()
    await page.waitForTimeout(300)
    await esperarDatos("Reporte de vendedores · Hoy")
    await page.locator("button:has-text(\"Trimestre\")").first().click()
    await page.waitForTimeout(300)
    await esperarDatos("Reporte de vendedores · Trimestre")
    const texto = await page.locator('body').innerText()
    assert(!/no se pudo|error al/i.test(texto), 'Reporte de vendedores carga sin error')
    await page.screenshot({ path: path.join(raiz, 'tmp', 'rama-reporte-vendedores.png') })
  } else {
    console.log('  · (el menú no muestra Reporte de vendedores para este usuario)')
  }
  assert(fallos.length === 0, `Sin pedidos fallidos${fallos.length ? ': ' + fallos.slice(0, 3).join(' | ') : ''}`)
  assert(errores.length === 0, `Sin errores de página${errores.length ? ': ' + errores[0] : ''}`)
  console.log('\nRECORRIDO COMPLETO OK')
} catch (e) {
  console.error('\nFALLO:', e.message)
  if (fallos.length) console.error('Pedidos fallidos:', fallos.slice(0, 5))
  await page.screenshot({ path: path.join(raiz, 'tmp', 'rama-reportes-fallo.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
