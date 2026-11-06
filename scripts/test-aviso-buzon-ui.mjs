// Recorrido real en STAGING del aviso del Buzón para el desarrollador.
// Uso (con el servidor de staging en :8789 y la web en :5174): node scripts/test-aviso-buzon-ui.mjs
// Entra como desarrollador (código de staging), crea mensajes de prueba y al final los borra.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stagingRoot = path.join(raiz, 'construacero-staging')
const FRONTEND = process.env.AB_FRONTEND || 'http://localhost:5174'
const leer = f => Object.fromEntries((fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split(/\r?\n/).filter(l => /^[A-Za-z0-9_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const cfg = { ...leer(path.join(stagingRoot, '.env')), ...leer(path.join(stagingRoot, '.dev.vars')), ...leer(path.join(stagingRoot, '.env.e2e.local')) }
const URL_ = cfg.VITE_SUPABASE_URL
if (!URL_?.includes('spupqgkdsgohxxfoxydl')) throw new Error('Guardia: solo staging')
const svc = cfg.SUPABASE_SERVICE_KEY
const H = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' }
const api = (p, o = {}) => fetch(`${URL_}${p}`, { ...o, headers: { ...H, ...(o.headers || {}) } })
const ok = async (r, l) => { if (!r.ok) throw new Error(`${l}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`); const t = await r.text(); return t ? JSON.parse(t) : null }
const assert = (c, m) => { if (!c) throw new Error(`Falló: ${m}`); console.log(`  ✓ ${m}`) }

const estado = { devId: null, msgIds: [] }

async function preparar() {
  const [op] = await ok(await api(`/rest/v1/usuarios?select=id,cuenta_id&id=eq.${cfg.STAGING_E2E_OPERATOR_ID}`), 'Cuenta de pruebas')
  const cuenta = op.cuenta_id
  const [vend] = await ok(await api(`/rest/v1/usuarios?select=id,nombre&cuenta_id=eq.${cuenta}&nombre=eq.VENDEDOR%20PRUEBA`), 'Vendedor de prueba')
  if (!vend) throw new Error('Falta VENDEDOR PRUEBA (node scripts/sembrar-vendedor-prueba-staging.mjs)')
  estado.cuenta = cuenta
  estado.vend = vend.id
}
async function nuevoMensaje(tipo, texto) {
  const [m] = await ok(await api('/rest/v1/buzon_sugerencias?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ usuario_id: estado.vend, cuenta_id: estado.cuenta, tipo, mensaje: texto }) }), 'Mensaje de prueba')
  estado.msgIds.push(m.id)
}
async function limpiar() {
  const del = p => api(p, { method: 'DELETE' }).catch(() => {})
  if (estado.msgIds.length) await del(`/rest/v1/buzon_sugerencias?id=in.(${estado.msgIds.join(',')})`)
  const r1 = await (await api(`/rest/v1/buzon_sugerencias?select=id&mensaje=like.${encodeURIComponent('PRUEBA AVISO*')}`)).json()
  console.log(`· Limpieza: mensajes de prueba restantes=${r1.length}`)
}

async function ui() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', e => errores.push(e.message))
  try {
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('input[placeholder="correo@empresa.com"]', cfg.STAGING_E2E_EMAIL)
    await page.fill('input[placeholder="••••••••"]', cfg.STAGING_E2E_PASSWORD)
    await page.click('button:has-text("Acceder")')
    await page.waitForSelector('text=Selecciona tu usuario e ingresa tu PIN', { timeout: 20000 })
    // Acceso de desarrollador: 10 toques al logo y el código de 8 dígitos (el de staging, de su .dev.vars)
    for (let i = 0; i < 10; i++) await page.click('img[alt="Construacero Carabobo"]')
    await page.fill('input[aria-label="Código de desarrollador"]', cfg.DEV_SUPER_CODE)
    await page.click('form:has(input[aria-label="Código de desarrollador"]) button[type="submit"]')
    await page.waitForSelector('a[href="/logs"]', { timeout: 30000 })
    assert(true, 'El desarrollador entra y ve "Buzón" en el menú')

    // 1) mensaje pendiente que ya estaba antes de entrar: debe avisar una sola vez y mostrar el número
    await page.waitForFunction(() => /1/.test(document.querySelector('a[href="/logs"]')?.innerText || ''), null, { timeout: 30000 })
    assert(true, 'El menú "Buzón" muestra 1 pendiente')
    await page.locator('button:has(svg.lucide-bell)').first().click()
    await page.waitForSelector('text=Nuevo mensaje en el Buzón', { timeout: 10000 })
    const texto1 = await page.locator('body').innerText()
    const i1 = texto1.indexOf('Nuevo mensaje en el Buzón')
    assert(texto1.includes('Queja de VENDEDOR PRUEBA') && texto1.includes('PRUEBA AVISO uno'), `La campanita dice quién escribió, de qué tipo y el texto (vi: ${JSON.stringify(texto1.slice(i1, i1 + 160))})`)
    await page.screenshot({ path: path.join(raiz, 'tmp', 'aviso-buzon-1.png') })

    // 2) llega otro mensaje con la sesión abierta: aparece solo (revisión cada minuto)
    await nuevoMensaje('sugerencia', 'PRUEBA AVISO dos')
    await page.waitForFunction(() => /2/.test(document.querySelector('a[href="/logs"]')?.innerText || ''), null, { timeout: 90000 })
    assert(true, 'Sin recargar, el menú pasa a 2 pendientes')
    await page.waitForFunction(() => document.body.innerText.includes('PRUEBA AVISO dos'), null, { timeout: 10000 }).catch(() => {})
    if (!(await page.locator('text=PRUEBA AVISO dos').count())) await page.locator('button:has(svg.lucide-bell)').first().click()
    await page.waitForSelector('text=PRUEBA AVISO dos', { timeout: 10000 })
    assert(true, 'La campanita avisa del segundo mensaje')
    const textoBell = await page.locator('body').innerText()
    assert(textoBell.split('PRUEBA AVISO uno').length - 1 === 1, 'El primer mensaje no se avisa dos veces tras varias revisiones')
    await page.screenshot({ path: path.join(raiz, 'tmp', 'aviso-buzon-2.png') })

    // 3) al tocar el aviso lleva al Buzón
    await page.locator('text=PRUEBA AVISO dos').first().click()
    await page.waitForURL('**/logs', { timeout: 10000 })
    assert(true, 'Tocar el aviso abre la pantalla del Buzón')
    assert(errores.length === 0, `Sin errores de página${errores.length ? ': ' + errores[0] : ''}`)
  } finally {
    await browser.close()
  }
}

try {
  await preparar()
  await nuevoMensaje('queja', 'PRUEBA AVISO uno')
  await ui()
  console.log('\nRECORRIDO COMPLETO OK')
} catch (e) {
  console.error('\nFALLO:', e.message)
  process.exitCode = 1
} finally {
  await limpiar()
}
