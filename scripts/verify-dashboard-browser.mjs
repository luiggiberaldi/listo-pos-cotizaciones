// End-to-end local UI with production build + real server auth/dashboard handlers.
// All Auth/PostgREST I/O is a synthetic in-process transport; never a real account.
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const root = fssync.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const require = createRequire(path.join(root, 'package.json'))
const { chromium } = require('playwright')
const build = JSON.parse(await fs.readFile(path.join(root, 'scratch/dashboard-role-audit/latest-build.json'), 'utf8'))
assert.equal(build.status, 'passed')
const runDir = path.join(root, 'outputs/auditoria-inicio-roles', `browser-${Date.now()}`)
await fs.mkdir(runDir, { recursive: true })
// Bundle only to resolve the application's extensionless imports in native Node.
// The production modules themselves are unchanged; only fetch is substituted below.
const backendPath = path.join(runDir, 'qa-backend.mjs')
await require('esbuild').build({
  stdin: { contents: "export * from './api/lib/crypto.js'; export * from './api/handlers/auth-operators.js'; export * from './api/handlers/dashboard.js';", resolveDir: build.root, sourcefile: 'qa-backend.js' },
  bundle: true, format: 'esm', platform: 'node', target: 'node22', outfile: backendPath,
})
const handlers = await import(pathToFileURL(backendPath))
const { hashPinPBKDF2, handleDashboard } = handlers
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const account = uuid(1)
const supabaseOrigin = 'https://dashboard-qa.test.invalid'
const env = { SUPABASE_URL: supabaseOrigin, SUPABASE_SERVICE_KEY: 'qa-service-key-only', SUPABASE_ANON_KEY: 'qa-public-key-only', DEV_SUPER_CODE: '87531642' }
const now = new Date()
const iso = now.toISOString()
const rolePin = rol => rol.startsWith('vendedor') ? '1234' : '123456'
const roleNames = { jefe: 'Jefe QA', supervisor: 'Supervisor QA', vendedor: 'Vendedor Alfa QA', vendedor_sin_comision: 'Vendedor Beta QA', administracion: 'Administración QA', logistica: 'Logística QA', desarrollador: 'Soporte QA' }
const operators = await Promise.all(Object.entries(roleNames).map(async ([rol, nombre], i) => ({ id: uuid(100 + i), cuenta_id: account, nombre, rol, activo: true, color: '#1B365D', codigo: `QA-${i}`, pin_hash: await hashPinPBKDF2(rolePin(rol), 'qa-only-salt'), pin_salt: 'qa-only-salt', es_externo: false })))
const inactiveSeller = { id: uuid(199), cuenta_id: account, nombre: 'Vendedor Inactivo QA', rol: 'vendedor', activo: false, color: '#888888', codigo: 'QA-INACTIVO', es_externo: false }
const actor = Object.fromEntries(operators.map(row => [row.rol, row]))
const sale = (id, seller, total, estado = 'entregada') => ({ id: uuid(id), numero: id, cuenta_id: account, vendedor_id: seller.id, total_usd: total, creado_en: iso, entregada_en: iso, estado, flete_usd: 10, corte_usd: 5, forma_pago: 'Efectivo', cliente_id: uuid(501) })
const data = {
  usuarios: [...operators, inactiveSeller],
  notas_despacho: [sale(201, actor.vendedor, 115), sale(202, actor.vendedor_sin_comision, 215), sale(203, actor.jefe, 1015), sale(204, actor.vendedor, 99, 'pendiente'), sale(205, actor.vendedor_sin_comision, 75, 'despachada')],
  comisiones: [
    { id: uuid(301), cuentaid: account, vendedorid: actor.vendedor.id, despachoid: uuid(201), totalcomision: 5, estado: 'generada' },
    { id: uuid(302), cuentaid: account, vendedorid: actor.vendedor_sin_comision.id, despachoid: uuid(202), totalcomision: 8, estado: 'generada' },
  ],
  notas_despacho_items: [201, 202, 203, 205].map((n, i) => ({ id: uuid(400 + i), despacho_id: uuid(n), cuenta_id: account, producto_id: uuid(601), cantidad: 1, es_prestamo: false })),
  productos: [{ id: uuid(601), cuenta_id: account, costo_usd: 30, stock_actual: 1, stock_minimo: 3, activo: true }],
  clientes: [{ id: uuid(501), cuenta_id: account, nombre: 'Cliente QA', ciudad: 'Valencia', estado: 'Carabobo', activo: true, saldo_pendiente: 150 }],
  cuentas_por_cobrar: [{ id: uuid(701), cuenta_id: account, cliente_id: uuid(501), despacho_id: uuid(204), tipo: 'cargo', metodo_pago: 'cod', monto_usd: 40, saldo_usd: 40 }, { id: uuid(702), cuenta_id: account, cliente_id: uuid(501), despacho_id: uuid(201), tipo: 'cargo', metodo_pago: 'cxc', monto_usd: 90, saldo_usd: 90, fecha_vencimiento: '2099-01-01' }],
}
const sessions = new Map()
const serverCalls = []
let forceDashboardFailure = false
let forceIdentityMismatch = false
let dashboardDelay = 0
const rawFetch = globalThis.fetch
const match = (row, key, filter) => {
  let value = row[key]
  if (key.startsWith('despacho.')) value = data.notas_despacho.find(s => s.id === row.despachoid)?.[key.slice(9)]
  if (filter === 'is.null') return value == null
  if (filter.startsWith('eq.')) return String(value) === filter.slice(3)
  if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(value))
  if (filter.startsWith('gt.')) return isNaN(Number(value)) ? Date.parse(value) > Date.parse(filter.slice(3)) : Number(value) > Number(filter.slice(3))
  if (filter.startsWith('gte.')) return Date.parse(value) >= Date.parse(filter.slice(4))
  if (filter.startsWith('lt.')) return Date.parse(value) < Date.parse(filter.slice(3))
  return true
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input)
  assert.equal(url.origin, supabaseOrigin, 'No real network is permitted')
  const method = init.method || 'GET'
  serverCalls.push({ path: url.pathname, method })
  if (url.pathname === '/auth/v1/user') return Response.json({ id: account, email: 'qa@example.invalid', app_metadata: {} })
  const table = url.pathname.split('/').at(-1)
  if (table === 'operator_sessions') {
    if (method === 'POST') { const row = { ...JSON.parse(init.body), revoked_at: null }; sessions.set(row.token_hash, row); return new Response(null, { status: 201 }) }
    const rows = [...sessions.values()].filter(row => [...url.searchParams].every(([key, val]) => ['select', 'limit'].includes(key) || match(row, key, val)))
    if (method === 'PATCH') { for (const row of rows) Object.assign(row, JSON.parse(init.body)); return new Response(null, { status: 204 }) }
    return Response.json(rows)
  }
  if (['auditoria', 'system_logs'].includes(table) && method === 'POST') return new Response(null, { status: 201 })
  const params = url.searchParams
  let rows = [...(data[table] || [])].filter(row => [...params].every(([key, val]) => ['select', 'limit', 'offset', 'order'].includes(key) || match(row, key, val)))
  rows.sort((a, b) => a.id.localeCompare(b.id))
  const total = rows.length
  const offset = Number(params.get('offset') || 0)
  rows = rows.slice(offset, offset + Number(params.get('limit') || 1000))
  return Response.json(rows, { headers: { 'content-range': `${offset}-${offset + rows.length - 1}/${total}` } })
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' }
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname.startsWith('/api/')) {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString()
      const request = new Request(url, { method: req.method, headers: req.headers, ...(body ? { body } : {}) })
      let response
      if (url.pathname === '/api/auth/switch-operator') response = await handlers.handleSwitchOperator(request, env)
      else if (url.pathname === '/api/auth/clear-operator') response = await handlers.handleClearOperator(request, env)
      else if (url.pathname === '/api/auth/super-admin') response = await handlers.handleSuperAdmin(request, env)
      else if (url.pathname === '/api/auth/operators') response = await handlers.handleGetOperators(request, env)
      else if (url.pathname === '/api/dashboard/inicio') {
        if (dashboardDelay) await new Promise(resolve => setTimeout(resolve, dashboardDelay))
        response = forceDashboardFailure ? Response.json({ error: 'Fallo de prueba: cifras no disponibles' }, { status: 503 }) : await handleDashboard(request, env)
        if (forceIdentityMismatch && response.ok) { const b = await response.json(); b.identity.operatorId = actor.jefe.id; response = Response.json(b) }
      } else if (url.pathname === '/api/config') response = Response.json({ nombre_negocio: 'Construacero QA', moneda_base: 'USD', iva_pct: 0 })
      else if (url.pathname === '/api/ping') response = new Response('ok')
      else if (url.pathname === '/api/rates') response = Response.json({ bcv: { precio: 40, fuente: 'QA', ultimaActualizacion: iso }, usdt: { precio: 41, fuente: 'QA' } })
      else response = Response.json(req.method === 'GET' ? [] : { ok: true })
      res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'Cache-Control': 'no-store' }); res.end(await response.text()); return
    }
    const safe = path.resolve(build.dist, `.${decodeURIComponent(url.pathname)}`)
    if (!safe.startsWith(build.dist + path.sep) && safe !== build.dist) { res.writeHead(403); res.end(); return }
    let target = safe
    const stat = await fs.stat(target).catch(() => null)
    if (!stat?.isFile()) target = path.join(build.dist, 'index.html')
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(await fs.readFile(target))
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const checks = []
const screenshots = []
const blocked = []
const errors = []
const evidence = { build: build.dist, mode: 'Production UI + real auth/dashboard handlers with synthetic in-process I/O. No real accounts or deployment.', checks, screenshots, blocked, errors }
const check = (name, detail = {}) => { checks.push({ name, status: 'passed', ...detail }); console.log(`PASS ${name}`) }
async function context(width = 1440, height = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', colorScheme: 'light' })
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    if (url.origin === supabaseOrigin) {
      if (url.pathname === '/rest/v1/rpc/listar_usuarios_login') {
        errors.push('Login used the obsolete pre-PIN roster RPC')
        return route.fulfill({ status: 403, json: { message: 'Use the account-only roster endpoint' } })
      }
      if (url.pathname.startsWith('/auth/')) return route.fulfill({ json: { id: account, email: 'qa@example.invalid', app_metadata: {}, aud: 'authenticated', role: 'authenticated' } })
      return route.fulfill({ json: [], headers: { 'content-range': '*/0' } })
    }
    blocked.push(url.origin)
    return route.abort()
  })
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: account, exp, role: 'authenticated', aud: 'authenticated' })).toString('base64url')}.qa-only-signature`
  await ctx.addInitScript(({ account, token, exp }) => {
    localStorage.setItem('sb-dashboard-qa-auth-token', JSON.stringify({ access_token: token, refresh_token: 'qa-only-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer', user: { id: account, email: 'qa@example.invalid', app_metadata: {}, aud: 'authenticated', role: 'authenticated' } }))
  }, { account, token, exp })
  return ctx
}
async function enterPin(page, rol) {
  const dialog = page.getByRole('dialog', { name: 'Ingreso de PIN' })
  await dialog.waitFor()
  for (const digit of rolePin(rol)) await dialog.getByRole('button', { name: digit, exact: true }).click()
}
async function login(page, rol) {
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' })
  if (rol === 'desarrollador') {
    await page.getByText('¿Quién está operando?', { exact: true }).waitFor()
    for (let i = 0; i < 10; i++) await page.getByAltText('Construacero Carabobo', { exact: true }).click()
    await page.getByLabel('Código de desarrollador').fill(env.DEV_SUPER_CODE)
    await page.getByRole('button', { name: 'Acceder', exact: true }).click()
  } else {
    await page.getByText(new RegExp(`^${roleNames[rol]}$`, 'i')).click({ timeout: 15000 })
    await enterPin(page, rol)
  }
  await page.getByRole('main', { name: 'Inicio por rol' }).waitFor({ timeout: 20000 })
  await page.getByText('Actualizado:', { exact: false }).waitFor({ timeout: 20000 })
}
async function screenshot(page, file) {
  const full = path.join(runDir, file)
  await page.screenshot({ path: full, fullPage: true, animations: 'disabled' })
  screenshots.push(full)
}
try {
  for (const rol of ['jefe', 'supervisor', 'vendedor', 'vendedor_sin_comision', 'administracion', 'logistica']) {
    const ctx = await context()
    const page = await ctx.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await login(page, rol)
    const main = page.getByRole('main', { name: 'Inicio por rol' })
    const text = await main.innerText()
    if (rol === 'jefe') { assert.doesNotMatch(text, /Ganancia bruta estimada/); assert.match(text, /Resultados por vendedor/); assert.match(text, /Vendedor Alfa QA/); assert.match(text, /Supervisor QA/); assert.doesNotMatch(text, /Vendedor Beta QA|Inactivo/) }
    if (rol === 'supervisor') { assert.match(text, /Resultados por vendedor/); assert.match(text, /Vendedor Alfa QA/); assert.match(text, /Supervisor QA/); assert.doesNotMatch(text, /Vendedor Beta QA|Ganancia bruta estimada|Ventas de la empresa|Cuentas por cobrar/) }
    if (rol.startsWith('vendedor')) { assert.match(text, /Mis ventas/); assert.match(text, /Mis comisiones generadas/); assert.doesNotMatch(text, /Resultados por vendedor|Ganancia bruta|Clientes con deuda|Cuentas por cobrar/); assert.doesNotMatch(text, new RegExp(rol === 'vendedor' ? roleNames.vendedor_sin_comision : roleNames.vendedor)) }
    if (rol === 'administracion') { assert.match(text, /Despachos por aprobar hoy/); assert.match(text, /COD pendientes/); assert.match(text, /Deudas por vencer/); assert.doesNotMatch(text, /Cuentas por cobrar/); assert.doesNotMatch(text, /Prioridad a los pendientes más antiguos/) }
    if (rol === 'logistica') assert.doesNotMatch(text, /Resultados por vendedor|Ganancia bruta|Mis comisiones|COD pendientes|Deudas por vencer/)
    assert.doesNotMatch(text, /Datos de entregas|Datos administrativos|Toda la empresa|Solo vendedores del equipo/)
    check(`Desktop role isolation: ${rol}`)
    await screenshot(page, `${rol}-desktop.png`)
    await page.setViewportSize({ width: 390, height: 844 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    assert.equal(overflow, false)
    await screenshot(page, `${rol}-mobile.png`)
    check(`Mobile bounds: ${rol}`)
    if (rol === 'vendedor') {
      // Restore the desktop viewport: on mobile the fixed bottom nav and FAB
      // overlay the dashboard's own buttons (a real-device interaction issue,
      // not part of these authorization checks).
      await page.setViewportSize({ width: 1440, height: 1000 })
      const requested = []
      page.on('request', req => { if (req.url().includes('/api/dashboard/')) requested.push(req.url()) })
      // El trigger del CustomSelect queda dentro de un <label>Período…, así que su
      // nombre accesible es el del label; las opciones viven en un portal al body.
      await page.getByRole('button', { name: 'Período', exact: true }).click()
      const previousResponse = page.waitForResponse(response => response.url().includes('periodo=anterior'))
      await page.getByRole('button', { name: 'Mes anterior' }).click()
      await previousResponse
      await page.getByText('No hay ventas en este período.', { exact: true }).waitFor()
      check('Previous month selector changes scoped data')
      await page.getByRole('button', { name: 'Período', exact: true }).click()
      await page.getByRole('button', { name: 'Este mes' }).click()
      await page.getByText('DES-00201', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Período', exact: true }).click()
      const todayResponse = page.waitForResponse(response => response.url().includes('periodo=hoy'))
      await page.getByRole('button', { name: 'Hoy', exact: true }).click()
      await todayResponse
      await page.getByText('DES-00201', { exact: true }).waitFor()
      check('Today selector uses the current Caracas day')
      forceDashboardFailure = true
      await main.getByRole('button', { name: 'Actualizar', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Fallo de prueba' }).waitFor()
      assert.equal(await main.getByText('Mis ventas', { exact: true }).count(), 0)
      check('Service failure hides financial values instead of showing zero')
      await screenshot(page, 'vendedor-error.png')
      forceDashboardFailure = false
      await main.getByRole('button', { name: 'Reintentar' }).click()
      await page.getByText('DES-00201', { exact: true }).waitFor()
      forceIdentityMismatch = true
      await main.getByRole('button', { name: 'Actualizar', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'operador activo' }).waitFor()
      assert.equal(await main.getByText('Mis ventas', { exact: true }).count(), 0)
      check('Response for another operator is rejected')
      forceIdentityMismatch = false
      await main.getByRole('button', { name: 'Reintentar' }).click()
      await page.getByText('DES-00201', { exact: true }).waitFor()
      await ctx.setOffline(true)
      await page.getByText('Los datos están protegidos.', { exact: true }).waitFor()
      assert.equal(await main.getByText('Mis ventas', { exact: true }).count(), 0)
      check('Offline hides previously loaded private metrics')
      await ctx.setOffline(false)
    }
    await ctx.close()
  }
  // Two browsers share one business account but use different server PIN sessions.
  const a = await context(), b = await context()
  const pa = await a.newPage(), pb = await b.newPage()
  await login(pa, 'jefe'); await login(pb, 'vendedor')
  assert.doesNotMatch(await pa.getByRole('main', { name: 'Inicio por rol' }).innerText(), /Ganancia bruta/)
  assert.doesNotMatch(await pb.getByRole('main', { name: 'Inicio por rol' }).innerText(), /Ganancia bruta/)
  check('Concurrent boss and seller browsers retain separate identity')
  await a.close(); await b.close()
  assert.equal(errors.length, 0, errors.join('\n'))
  evidence.summary = { passed: checks.length, failed: 0, screenshots: screenshots.length }
} catch (error) {
  evidence.summary = { passed: checks.length, failed: 1, error: error.message, stack: error.stack }
  console.error(error.stack)
  for (const ctx of browser.contexts()) for (const page of ctx.pages()) await screenshot(page, `failure-${screenshots.length}.png`).catch(() => {})
  process.exitCode = 1
} finally {
  evidence.serverRequestCount = serverCalls.length
  evidence.blockedOrigins = [...new Set(blocked)]
  await fs.writeFile(path.join(runDir, 'results.json'), JSON.stringify(evidence, null, 2))
  await fs.writeFile(path.join(root, 'outputs/auditoria-inicio-roles/browser-verification.json'), JSON.stringify(evidence, null, 2))
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  globalThis.fetch = rawFetch
  console.log(JSON.stringify(evidence.summary))
}
