#!/usr/bin/env node
/** Browser-level COD test with local-only API and rate fixtures. */
import net from 'node:net'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const root = process.cwd()
const viteConfig = 'src/test-fixtures/cod-modal/vite.config.js'

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForServer(url, process, getLogs) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (process.exitCode !== null) throw new Error(`Vite terminó antes de iniciar. ${getLogs()}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* El listener local aún no inició. */ }
    await delay(250)
  }
  throw new Error(`Vite no respondió en 20 segundos. ${getLogs()}`)
}

const port = await reservePort()
const url = `http://127.0.0.1:${port}/src/test-fixtures/cod-modal/`
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', viteConfig], {
  cwd: root,
  env: { ...process.env, COD_MODAL_PORT: String(port) },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLogs = ''
server.stdout.on('data', chunk => { serverLogs += chunk.toString() })
server.stderr.on('data', chunk => { serverLogs += chunk.toString() })
let browser
let successful = false

try {
  await waitForServer(url, server, () => serverLogs)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(url)
  const dialog = page.getByRole('dialog', { name: /Conciliar COD/ })
  await dialog.waitFor()
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
    console.log(`  ✓ ${message}`)
  }
  const dialogText = () => dialog.innerText()

  assert((await dialogText()).includes('$200.01'), 'muestra el saldo COD inicial del ledger')
  await dialog.getByRole('button', { name: 'Zelle' }).click()
  await dialog.getByRole('spinbutton', { name: 'Monto Zelle' }).fill('0.001')
  assert(await dialog.getByRole('button', { name: 'Registrar abono COD' }).isDisabled(),
    'bloquea montos con más de dos decimales en la interfaz')
  await dialog.getByRole('button', { name: 'Quitar Zelle' }).click()

  await dialog.getByRole('button', { name: 'Efectivo Bs' }).click()
  const bsInput = dialog.getByRole('spinbutton', { name: 'Monto Efectivo Bs' })
  await bsInput.fill('100.00')
  assert((await dialogText()).includes('Tasa seleccionada: 2 Bs/$ (USDT fixture) · Equivalente: $50.00'),
    'convierte Bs a USD con la tasa inicial y muestra el equivalente')
  await dialog.getByRole('textbox', { name: 'Nota (opcional)' }).fill('Recibo parcial tasa 2')
  await dialog.getByRole('button', { name: 'Registrar abono COD' }).click()
  await page.getByRole('button', { name: 'Abrir conciliación COD' }).waitFor()

  await page.getByRole('button', { name: 'Cambiar tasa de prueba a 4 Bs/$' }).click()
  await page.getByRole('button', { name: 'Abrir conciliación COD' }).click()
  await page.getByRole('dialog', { name: /Conciliar COD/ }).waitFor()
  assert((await dialogText()).includes('$150.01'), 'mantiene el saldo USD registrado por el abono anterior al cambiar la tasa')

  await dialog.getByRole('button', { name: 'Efectivo Bs' }).click()
  const secondInput = dialog.getByRole('spinbutton', { name: 'Monto Efectivo Bs' })
  await secondInput.fill('400.04')
  assert((await dialogText()).includes('Tasa seleccionada: 4 Bs/$ (USDT fixture) · Equivalente: $100.01'),
    'el nuevo abono utiliza la tasa actualizada sin revaluar el previo')
  // La nota es opcional: este segundo abono se registra sin nota.
  await dialog.getByRole('button', { name: 'Registrar abono COD' }).click()

  const payments = await page.evaluate(() => window.__codRequests.flatMap(request => request.pagos))
  assert(payments.length === 2, 'envía exactamente dos abonos independientes')
  assert(payments[0].monto_bs === 100 && payments[0].tasa_snapshot === 2 && payments[0].monto === 50,
    'conserva los Bs, tasa 2 y equivalente USD del primer snapshot')
  assert(payments[1].monto_bs === 400.04 && payments[1].tasa_snapshot === 4 && payments[1].monto === 100.01,
    'guarda para el segundo abono los Bs, tasa 4 y equivalente USD nuevos')
  const notas = await page.evaluate(() => window.__codRequests.map(request => request.evidencia))
  assert(notas[0] === 'Recibo parcial tasa 2' && notas[1] === '',
    'la nota es opcional: se envía vacía cuando no se escribe')

  await page.getByRole('button', { name: 'Abrir conciliación COD' }).click()
  await page.getByRole('dialog', { name: /Conciliar COD/ }).waitFor()
  await dialog.getByRole('button', { name: 'Zelle' }).click()
  const finalInput = dialog.getByRole('spinbutton', { name: 'Monto Zelle' })
  await finalInput.fill('49.99')
  assert((await dialogText()).includes('Pago parcial'),
    'no considera liquidada la deuda cuando queda un centavo pendiente')
  await finalInput.fill('50.01')
  await dialog.getByRole('textbox', { name: 'Referencia Zelle' }).fill('TX-OVER-CENT')
  await dialog.getByRole('textbox', { name: 'Nota (opcional)' }).fill('Recibo final con un centavo extra')
  assert((await dialogText()).includes('Liquida COD · excede $0.01'),
    'identifica el excedente permitido de un centavo al liquidar COD')
  await dialog.getByRole('button', { name: 'Registrar abono COD' }).click()
  const finalPayments = await page.evaluate(() => window.__codRequests.flatMap(request => request.pagos))
  assert(finalPayments.length === 3 && finalPayments[2].monto === 50.01,
    'permite completar el saldo con hasta un centavo de exceso')
  assert(pageErrors.length === 0, `sin excepciones de interfaz (${pageErrors.length})`)
  successful = true
  console.log(`PASS: prueba local de interfaz COD en Chromium (${url}); no usa Supabase.`)
} finally {
  if (browser) await browser.close()
  server.kill()
  if (server.exitCode === null) {
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      delay(3000),
    ])
  }
  if (!successful && serverLogs) console.error(serverLogs)
}
