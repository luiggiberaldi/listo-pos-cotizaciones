#!/usr/bin/env node
// construacero-staging/scripts/verify-op042-cxc-staging.mjs
// OP-2026-042 — Prueba en navegador real (Chromium) contra STAGING de los arreglos de CxC:
//   1. "Pagado de más" visible en la ficha del cliente y en el reporte de CxC.
//   2. Selector "¿Qué despacho paga?" y regla del Cruce en el formulario de abono.
//   3. Aviso en la devolución cuando un abono manual ya cubrió el crédito, y anulación
//      del abono dentro de la misma operación (escenario temporal PRUEBA OP042).
// Requiere: servidores locales (staging-api :8789 y staging-web :5174), el operador
// temporal (scripts/op042-operador-prueba.mjs crear) y el escenario temporal
// (.tmp-op040/escenario042.py crear). Guarda capturas en ../tmp/op042/.
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const STAGING_PROJECT_REF = 'spupqgkdsgohxxfoxydl'
const ORIGIN = 'http://localhost:5174'
const NOMBRE_OPERADOR = 'OP042 Admin Prueba'
const PIN = '604242'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '..', '.tmp-op040')
const shots = path.join(root, '..', 'tmp', 'op042')
await mkdir(shots, { recursive: true })

const { session } = JSON.parse(await readFile(path.join(tmp, 'op042-operador.json'), 'utf8'))
const escenario = JSON.parse(await readFile(path.join(tmp, 'escenario042_ids.json'), 'utf8'))
const ping = await fetch(`${ORIGIN}/api/ping`)
if (ping.headers.get('x-supabase-project-ref') !== STAGING_PROJECT_REF) throw new Error('Guardia: el servidor local no apunta a staging. Abortado.')

const paso = process.argv[2] || 'todo'
let passed = 0
let failed = 0
const check = (n, ok, d = '') => { ok ? passed++ : failed++; console[ok ? 'log' : 'error'](`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
await context.addInitScript(({ k, v }) => { window.localStorage.setItem(k, v) }, { k: `sb-${STAGING_PROJECT_REF}-auth-token`, v: JSON.stringify(session) })
const page = await context.newPage()
const erroresJs = []
page.on('pageerror', e => erroresJs.push(e.message))
const foto = async n => page.screenshot({ path: path.join(shots, `${n}.png`), fullPage: false })

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle' })
  const tarjeta = page.getByText(new RegExp(NOMBRE_OPERADOR, 'i')).first()
  await tarjeta.waitFor({ timeout: 20000 })
  await tarjeta.click()
  await page.waitForTimeout(600)
  await page.keyboard.type(PIN, { delay: 60 })
  await page.waitForTimeout(2500)
  await foto('00-inicio')
  check('Inicio de sesión con el operador temporal', !(await page.getByText(/¿Quién está operando/i).isVisible().catch(() => false)))
  if (paso === 'login') throw new Error('FIN_PASO')

  // Navegar sin recargar (recargar pide de nuevo el operador)
  async function ir(ruta) {
    await page.evaluate(r => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')) }, ruta)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1200)
  }

  // ── Ficha del cliente ────────────────────────────────────────────────────
  async function cerrarFicha() {
    const fondo = page.locator('div.fixed.inset-0.z-50 > div.absolute.inset-0').first()
    if (await fondo.isVisible().catch(() => false)) { await page.mouse.click(15, 450); await page.waitForTimeout(500) }
  }
  async function abrirFicha(nombre) {
    await cerrarFicha()
    await ir('/clientes')
    const buscador = page.getByPlaceholder(/Buscar por nombre, código o RIF/i)
    await buscador.fill(nombre)
    await page.waitForTimeout(1500)
    await page.getByText('Ver cuenta', { exact: true }).first().click()
    await page.getByText(/Historial de cuenta/i).waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
  }

  if (paso === 'todo' || paso === 'fichas') {
    await abrirFicha('Decoraciones Encendo')
    const badgeEnc = await page.getByTestId('ficha-pagado-de-mas').textContent().catch(() => '')
    check('Encendo: la ficha muestra "Pagado de más" de $1.949', /1[.,]?949/.test(badgeEnc || ''), badgeEnc)
    check('Encendo: aviso explicativo visible', await page.getByTestId('ficha-aviso-pagado-de-mas').isVisible())
    await foto('01-ficha-encendo-pagado-de-mas')

    await abrirFicha('Ferrechuros')
    const badgeFer = await page.getByTestId('ficha-pagado-de-mas').textContent().catch(() => '')
    check('Ferrechuros: la ficha muestra "Pagado de más" de $810', /810/.test(badgeFer || ''), badgeFer)
    await foto('02-ficha-ferrechuros')

    await abrirFicha('REYKAR')
    check('REYKAR: sin aviso de pago de más', !(await page.getByTestId('ficha-pagado-de-mas').isVisible().catch(() => false)))
    const selector = page.getByTestId('abono-despacho')
    await selector.waitFor({ timeout: 10000 })
    const opciones = await selector.locator('option').allTextContents()
    check('REYKAR: selector "¿Qué despacho paga?" con despachos pendientes', opciones.length >= 2, opciones.slice(0, 3).join(' | '))
    await selector.selectOption({ index: 1 })
    await page.getByPlaceholder('0.00').first().fill('1')
    await page.getByRole('button', { name: 'Cruce', exact: true }).first().click()
    const etiquetaCruce = await page.getByText(/Contra qué se cruzó \(obligatorio\)/i).isVisible()
    const botonDeshabilitado = await page.getByRole('button', { name: /Confirmar abono/i }).isDisabled()
    check('Regla del Cruce: pide "contra qué se cruzó" y no deja confirmar sin ese dato', etiquetaCruce && botonDeshabilitado)
    await page.locator('#abono-descripcion').fill('Cruce contra factura de flete de prueba')
    check('Regla del Cruce: con el motivo escrito ya deja confirmar (no se confirma en la prueba)', !(await page.getByRole('button', { name: /Confirmar abono/i }).isDisabled()))
    await page.locator('#abono-despacho').scrollIntoViewIfNeeded()
    await foto('03-ficha-reykar-selector-y-cruce')
    await cerrarFicha()
  }

  // ── Reporte de CxC ───────────────────────────────────────────────────────
  if (paso === 'todo' || paso === 'reporte') {
    await ir('/reportes')
    await page.getByRole('button', { name: /Crédito|Créd\./ }).first().click()
    const panel = page.getByTestId('cxc-pagado-de-mas')
    await panel.waitFor({ timeout: 20000 })
    await panel.locator('summary').click()
    await page.waitForTimeout(500)
    const textoPanel = await panel.textContent()
    check('Reporte: sección "Pagos de más sin deuda" con 16 clientes y $4.969,71', /16/.test(textoPanel) && /4[.,]?969[.,]71/.test(textoPanel), textoPanel.slice(0, 90))
    await panel.scrollIntoViewIfNeeded()
    await foto('04-reporte-pagos-de-mas')
  }

  // ── Devolución con aviso y anulación del Cruce (escenario temporal) ─────
  if (paso === 'todo' || paso === 'devolucion') {
    await ir('/despachos')
    await page.getByRole('button', { name: 'Todos', exact: true }).first().click()
    await page.waitForTimeout(800)
    await page.getByPlaceholder(/Buscar por cliente, cédula\/RIF/i).fill('PRUEBA OP042')
    await page.waitForTimeout(2000)
    await page.getByTitle('Más opciones').first().click()
    await page.getByText('Devolución Parcial', { exact: true }).first().click()
    const aviso = page.getByTestId('devolucion-aviso-cubierto')
    // marcar el primer artículo (40 cabillas × $8,50 = $340)
    const filaCabilla = page.locator('div', { hasText: /^Cabilla 1\/2/ }).filter({ has: page.locator('input[type="checkbox"]') }).last()
    await page.getByText(/Cabilla 1\/2/).first().waitFor({ timeout: 15000 })
    await page.locator('input[type="checkbox"]').nth(0).waitFor()
    // la casilla del artículo está en la misma fila que su nombre
    await page.getByText(/Cabilla 1\/2/).first().locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]').locator('input[type="checkbox"]').first().check()
    await aviso.waitFor({ timeout: 15000 })
    check('Devolución: aviso "ya fue cubierto por este abono" visible', await aviso.isVisible())
    const resultadoSin = await page.getByText(/Resultado esperado/i).locator('..').textContent()
    check('Devolución sin confirmar: todo va a saldo a favor ($340)', /Saldo a favor:\s*\$?340\.00/.test(resultadoSin), resultadoSin.replace(/\s+/g, ' ').slice(0, 120))
    await aviso.scrollIntoViewIfNeeded()
    await foto('05-devolucion-aviso')

    await aviso.locator('input[type="radio"]').first().check()
    await page.waitForTimeout(300)
    const resultadoCon = await page.getByText(/Resultado esperado/i).locator('..').textContent()
    check('Devolución confirmando el Cruce: la deuda del despacho baja $634 → $294 y saldo a favor $0', /634\.00.*294\.00/.test(resultadoCon.replace(/\s+/g, ' ')) && /Saldo a favor:\s*\$?0\.00/.test(resultadoCon), resultadoCon.replace(/\s+/g, ' ').slice(0, 120))
    await aviso.scrollIntoViewIfNeeded()
    await foto('06-devolucion-cruce-elegido')

    // motivo + confirmación de inventario y registrar de verdad (escenario temporal)
    await page.getByText('Seleccione un motivo...').click()
    await page.getByText('Cantidad incorrecta', { exact: true }).last().click()
    await page.getByText(/Confirmar ingreso de mercancía devuelta a stock/i).click()
    const registrar = page.getByRole('button', { name: /Registrar Devolución/i })
    check('Devolución: el botón "Registrar Devolución" queda habilitado', !(await registrar.isDisabled()))
    await registrar.click()
    await page.waitForTimeout(4000)
    await foto('07-devolucion-registrada')

    await abrirFicha('PRUEBA OP042')
    const textoFicha = (await page.locator('body').textContent()).replace(/\s+/g, ' ')
    check('Después: el cliente de prueba debe $294 (deuda real visible)', /Deuda:\s*\$?294/.test(textoFicha))
    check('Después: sin "Pagado de más"', !(await page.getByTestId('ficha-pagado-de-mas').isVisible().catch(() => false)))
    await foto('08-ficha-prueba-despues')
  }
} catch (e) {
  if (e.message !== 'FIN_PASO') { failed++; console.error('❌ Error:', e.message); await foto('error').catch(() => {}) }
} finally {
  check('Sin errores JavaScript en la página', erroresJs.length === 0, erroresJs.slice(0, 3).join(' | '))
  await browser.close()
  console.log(`\nResultado: ${passed} OK, ${failed} con problema. Capturas en tmp/op042/`)
  process.exitCode = failed ? 1 : 0
}
