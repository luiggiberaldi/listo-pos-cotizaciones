// Crea en STAGING despachos de prueba (crédito, mixto, contado, por vencer, vencido) para revisar
// la fecha de vencimiento en la ficha, el detalle y el PDF de la orden de despacho.
// Uso: node scripts/sembrar-despachos-credito-staging.mjs          (crea)
//      node scripts/sembrar-despachos-credito-staging.mjs --quitar (deja staging como estaba)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const stagingRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'construacero-staging')
const STAGING_REF = 'spupqgkdsgohxxfoxydl'
const TAG = 'PRUEBA VENC'

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

const e2e = leerEnv(path.join(stagingRoot, '.env.e2e.local'))
const [base] = await ok(await api(`/rest/v1/usuarios?select=id,cuenta_id&id=eq.${e2e.STAGING_E2E_OPERATOR_ID}`), 'Buscar cuenta de pruebas')
if (!base) throw new Error('No se encontró la cuenta de pruebas E2E (corre npm run provision:e2e:staging)')
const cuenta = base.cuenta_id
// Las ventas quedan a nombre de VENDEDOR PRUEBA (PIN 0000, el de node scripts/sembrar-vendedor-prueba-staging.mjs);
// si no existe, a nombre del operador E2E.
const [vp] = await ok(await api(`/rest/v1/usuarios?select=id,cuenta_id&cuenta_id=eq.${cuenta}&nombre=eq.${encodeURIComponent('VENDEDOR PRUEBA')}`), 'Buscar vendedor de prueba')
const operador = vp || base

async function quitar() {
  const cs = await ok(await api(`/rest/v1/clientes?select=id&cuenta_id=eq.${cuenta}&nombre=like.${encodeURIComponent(TAG + '*')}`), 'Buscar clientes')
  const cIds = cs.map(c => c.id)
  if (cIds.length) {
    const ds = await ok(await api(`/rest/v1/notas_despacho?select=id,cotizacion_id&cliente_id=in.(${cIds.join(',')})`), 'Buscar despachos')
    const dIds = ds.map(d => d.id), qIds = ds.map(d => d.cotizacion_id).filter(Boolean)
    if (dIds.length) {
      await borrar(`/rest/v1/comisiones?despachoid=in.(${dIds.join(',')})`)
      await borrar(`/rest/v1/notas_despacho_items?despacho_id=in.(${dIds.join(',')})`)
      await borrar(`/rest/v1/notas_despacho?id=in.(${dIds.join(',')})`)
    }
    if (qIds.length) {
      await borrar(`/rest/v1/cotizacion_items?cotizacion_id=in.(${qIds.join(',')})`)
      await borrar(`/rest/v1/cotizaciones?id=in.(${qIds.join(',')})`)
    }
    await borrar(`/rest/v1/clientes?id=in.(${cIds.join(',')})`)
  }
  console.log('Despachos de prueba de vencimiento eliminados')
}
if (process.argv.includes('--quitar')) { await quitar(); process.exit(0) }
await quitar() // idempotente

// Fecha/hora en Venezuela: hoy menos N días, a cierta hora
const hoyCaracas = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const dia = (d) => { const x = new Date(`${hoyCaracas}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10) }

const clientes = await ins('clientes?select=id,nombre', [
  `${TAG} FERRETERIA EL SOL`, `${TAG} CONSTRUCTORA LUNA`, `${TAG} INVERSIONES ESTRELLA`, `${TAG} MATERIALES NORTE`, `${TAG} DISTRIBUIDORA SUR`, `${TAG} CORRALON CENTRAL`,
].map((nombre, i) => ({ nombre, rif_cedula: `J-4000000${i}`, telefono: `0414000010${i}`, direccion: 'Av. Bolívar, Valencia', saldo_pendiente: 0, activo: true, vendedor_id: operador.id, cuenta_id: cuenta })), 'Crear clientes')

const items = [['CAB-12', 'Cabilla 1/2 x 12m', 'und', 8.5, 40], ['CEM-42', 'Cemento gris 42.5kg', 'saco', 9.8, 30]]
// [cliente, hace N días, hora Caracas, estado, formas de pago, descripción]
const casos = [
  [clientes[0], 0, '10:00', 'despachada', (t) => [{ metodo: 'Cta por cobrar', monto: t, diasVencimiento: 15 }], 'Crédito 15 días, de hoy → normal'],
  [clientes[1], 6, '10:00', 'despachada', (t) => [{ metodo: 'Cta por cobrar', monto: t, diasVencimiento: 8 }], 'Crédito 8 días, de hace 6 → por vencer (2 restantes)'],
  [clientes[2], 20, '10:00', 'entregada', (t) => [{ metodo: 'Cta por cobrar', monto: t, diasVencimiento: 15 }], 'Crédito 15 días, de hace 20 → vencido'],
  [clientes[3], 0, '11:00', 'despachada', (t) => [{ metodo: 'Zelle', monto: 300 }, { metodo: 'Cta por cobrar', monto: +(t - 300).toFixed(2), diasVencimiento: 15 }], 'Pago mixto: Zelle + crédito 15 días'],
  [clientes[4], 0, '12:00', 'entregada', (t) => [{ metodo: 'Zelle', monto: t }], 'Contado (no debe mostrar vencimiento)'],
  [clientes[5], 2, '21:30', 'despachada', (t) => [{ metodo: 'Cta por cobrar', monto: t, diasVencimiento: 30 }], 'Crédito 30 días, venta nocturna (21:30) → no se corre de día'],
]
for (const [i, [cli, hace, hora, estado, formas, desc]] of casos.entries()) {
  const fecha = dia(hace)
  const lineas = items.map(([cod, nom, und, precio, cant], o) => ({ cod, nom, und, cant, precio, total: +(cant * precio).toFixed(2), o: o + 1 }))
  const total = +lineas.reduce((s, x) => s + x.total, 0).toFixed(2)
  const [cot] = await ins('cotizaciones?select=id,numero', { cuenta_id: cuenta, cliente_id: cli.id, vendedor_id: operador.id, estado: 'aceptada', subtotal_usd: total, total_usd: total, creado_en: `${fecha}T${hora}:00-04:00` }, `Cotización ${i + 1}`)
  const [des] = await ins('notas_despacho?select=id,numero', { cotizacion_id: cot.id, cuenta_id: cuenta, vendedor_id: operador.id, cliente_id: cli.id, estado, creado_en: `${fecha}T${hora}:00-04:00`, total_usd: total, flete_usd: 0, descuento_total_usd: 0, forma_pago: JSON.stringify(formas(total)), creado_por: operador.id }, `Despacho ${i + 1}`)
  await ins('notas_despacho_items', lineas.map(x => ({ despacho_id: des.id, cuenta_id: cuenta, codigo_snap: x.cod, nombre_snap: x.nom, unidad_snap: x.und, cantidad: x.cant, cantidad_original: x.cant, precio_unit_usd: x.precio, precio_original: x.precio, descuento_pct: 0, total_linea_usd: x.total, orden: x.o })), `Ítems ${i + 1}`)
  console.log(`  DES-${des.numero} · ${fecha} ${hora} · ${cli.nombre} · $${total} · ${desc}`)
}
console.log('Listo. Para quitarlos: node scripts/sembrar-despachos-credito-staging.mjs --quitar')
