// Crea en STAGING un vendedor de prueba (PIN 0000) con ventas de ejemplo, dentro de la cuenta de pruebas E2E.
// Uso: node scripts/sembrar-vendedor-prueba-staging.mjs          (crea)
//      node scripts/sembrar-vendedor-prueba-staging.mjs --quitar (deja staging como estaba)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPinPBKDF2, generateSalt } from '../construacero-staging/api/lib/crypto.js'
import { getCorteSemanalRange } from '../construacero-staging/src/utils/dateHelpers.js'

const stagingRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'construacero-staging')
const STAGING_REF = 'spupqgkdsgohxxfoxydl'
const PIN = '0000'
const NOMBRE = 'VENDEDOR PRUEBA'
const TAG = 'PRUEBA MV'

function leerEnv(file) {
  const v = {}
  if (!fs.existsSync(file)) return v
  for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = l.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && !l.trim().startsWith('#')) v[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return v
}
const cfg = { ...leerEnv(path.join(stagingRoot, '.env')), ...leerEnv(path.join(stagingRoot, '.dev.vars')) }
const url = cfg.SUPABASE_URL || cfg.VITE_SUPABASE_URL
const key = cfg.SUPABASE_SERVICE_KEY
if (!url || !url.includes(STAGING_REF)) throw new Error('Guardia: esto solo corre contra staging')
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const api = (p, o = {}) => fetch(`${url}${p}`, { ...o, headers: { ...H, ...(o.headers || {}) } })
async function ok(r, label) {
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${(await r.text()).slice(0, 500)}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}
const ins = async (tabla, filas, label) => ok(await api(`/rest/v1/${tabla}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(filas) }), label)
const borrar = p => api(p, { method: 'DELETE' })
const dia = (ymd, d) => { const x = new Date(`${ymd}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }

const e2e = leerEnv(path.join(stagingRoot, '.env.e2e.local'))
const cuentas = await ok(await api(`/rest/v1/usuarios?select=id,cuenta_id&id=eq.${e2e.STAGING_E2E_OPERATOR_ID}`), 'Buscar cuenta de pruebas')
if (!cuentas.length) throw new Error('No se encontró la cuenta de pruebas E2E (corre npm run provision:e2e:staging)')
const cuenta = cuentas[0].cuenta_id

async function quitar() {
  const us = await ok(await api(`/rest/v1/usuarios?select=id&cuenta_id=eq.${cuenta}&nombre=eq.${encodeURIComponent(NOMBRE)}`), 'Buscar vendedor')
  const ids = us.map(u => u.id)
  if (ids.length) {
    const ds = await ok(await api(`/rest/v1/notas_despacho?select=id,cotizacion_id&vendedor_id=in.(${ids.join(',')})`), 'Buscar despachos')
    const dIds = ds.map(d => d.id), cIds = ds.map(d => d.cotizacion_id).filter(Boolean)
    if (dIds.length) {
      await borrar(`/rest/v1/comisiones?despachoid=in.(${dIds.join(',')})`)
      await borrar(`/rest/v1/notas_despacho_items?despacho_id=in.(${dIds.join(',')})`)
      await borrar(`/rest/v1/notas_despacho?id=in.(${dIds.join(',')})`)
    }
    if (cIds.length) {
      await borrar(`/rest/v1/cotizacion_items?cotizacion_id=in.(${cIds.join(',')})`)
      await borrar(`/rest/v1/cotizaciones?id=in.(${cIds.join(',')})`)
    }
  }
  await borrar(`/rest/v1/clientes?cuenta_id=eq.${cuenta}&nombre=like.${encodeURIComponent(TAG + '*')}`)
  if (ids.length) await borrar(`/rest/v1/usuarios?id=in.(${ids.join(',')})`)
  console.log('Vendedor de prueba y sus ventas eliminados')
}

if (process.argv.includes('--quitar')) { await quitar(); process.exit(0) }
await quitar() // idempotente

const corte = getCorteSemanalRange(0)
const salt = generateSalt(), hash = await hashPinPBKDF2(PIN, salt)
const [yo] = await ins('usuarios?select=id', { nombre: NOMBRE, rol: 'vendedor', activo: true, cuenta_id: cuenta, pin_hash: hash, pin_salt: salt }, 'Crear vendedor')
const clientes = await ins('clientes?select=id,nombre', [
  { nombre: `${TAG} FERRETERIA SOL`, rif_cedula: 'J-31111111', telefono: '04140000001' },
  { nombre: `${TAG} CONSTRUCTORA LUNA`, rif_cedula: 'J-32222222', telefono: '04140000002' },
  { nombre: `${TAG} INVERSIONES ESTRELLA`, rif_cedula: 'J-33333333', telefono: '04140000003' },
].map(c => ({ ...c, saldo_pendiente: 0, activo: true, vendedor_id: yo.id, cuenta_id: cuenta })), 'Crear clientes')
const [sol, luna, est] = clientes

const P = { cab: ['CAB-12', 'Cabilla 1/2 x 12m', 'und', 8.5], ala: ['ALA-DUL', 'Alambre dulce', 'kg', 2.2], cla: ['CLA-2', 'Clavos 2 pulgadas', 'kg', 3.1], cem: ['CEM-42', 'Cemento gris 42.5kg', 'saco', 9.8], tub: ['TUB-34', 'Tubo PVC 3/4', 'und', 4.4] }
// [día dentro del corte (0 = viernes), cliente, estado, pago, [[producto, cantidad], ...]]
const ventas = [
  [0, sol, 'entregada', 'Zelle', [['cab', 20], ['ala', 10]]],
  [1, luna, 'entregada', 'Efectivo $', [['cem', 30], ['cla', 5]]],
  [2, est, 'despachada', 'Pago móvil', [['tub', 40], ['cab', 5]]],
  [3, sol, 'entregada', 'Zelle', [['cem', 12]]],
  [5, luna, 'despachada', 'Efectivo $', [['cab', 15], ['ala', 6], ['cla', 8]]],
  [-6, sol, 'entregada', 'Zelle', [['cab', 10]]], // corte anterior
  [-4, est, 'entregada', 'Zelle', [['cem', 20]]], // corte anterior
]
for (const [i, [d, cli, estado, pago, lineas]] of ventas.entries()) {
  const fecha = dia(corte.from, d)
  const items = lineas.map(([k, cant], o) => { const [cod, nom, und, precio] = P[k]; return { cod, nom, und, cant, precio, total: +(cant * precio).toFixed(2), o: o + 1 } })
  const total = +items.reduce((s, x) => s + x.total, 0).toFixed(2)
  const [cot] = await ins('cotizaciones?select=id,numero', { cuenta_id: cuenta, cliente_id: cli.id, vendedor_id: yo.id, estado: 'aceptada', subtotal_usd: total, total_usd: total, creado_en: `${fecha}T09:00:00-04:00` }, `Cotización ${i + 1}`)
  const [des] = await ins('notas_despacho?select=id,numero', { cotizacion_id: cot.id, cuenta_id: cuenta, vendedor_id: yo.id, cliente_id: cli.id, estado, creado_en: `${fecha}T10:00:00-04:00`, total_usd: total, flete_usd: 0, descuento_total_usd: 0, forma_pago: JSON.stringify([{ metodo: pago, monto: total }]), creado_por: yo.id }, `Despacho ${i + 1}`)
  await ins('notas_despacho_items', items.map(x => ({ despacho_id: des.id, cuenta_id: cuenta, codigo_snap: x.cod, nombre_snap: x.nom, unidad_snap: x.und, cantidad: x.cant, cantidad_original: x.cant, precio_unit_usd: x.precio, precio_original: x.precio, descuento_pct: 0, total_linea_usd: x.total, orden: x.o })), `Ítems ${i + 1}`)
  await ins('comisiones', { despachoid: des.id, cotizacionid: cot.id, vendedorid: yo.id, cuentaid: cuenta, totalcomision: +(total * 0.02).toFixed(2), estado: 'generada', calculo_version: '238b' }, `Comisión ${i + 1}`)
  console.log(`  DES-${des.numero} · ${fecha} · ${cli.nombre} · $${total}`)
}
console.log(`Listo. Corte ${corte.from} → ${corte.to}. Usuario "${NOMBRE}" con PIN ${PIN}`)
