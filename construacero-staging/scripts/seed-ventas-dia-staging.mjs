// Crea en STAGING (solo) un operador de Logística con PIN 000000 y ventas de HOY para ver "Ventas del día".
// Cuenta: staging-e2e@listo.sys. Todo lo creado lleva "PRUEBA VD" y se anota en tmp/ventas-dia/seed-ids.json.
// Uso: node scripts/seed-ventas-dia-staging.mjs        Borrar: node scripts/seed-ventas-dia-staging.mjs --borrar
import fs from 'node:fs'
import { hashPinPBKDF2, generateSalt } from '../api/lib/crypto.js'
const rd = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
const v = rd('.dev.vars'), e = rd('.env'), e2e = rd('.env.e2e.local')
if (!e.SUPABASE_URL.includes('spupqgkdsgohxxfoxydl')) throw new Error('No es staging')
const H = { apikey: v.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${v.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' }
const api = (p, o = {}) => fetch(e.SUPABASE_URL + p, { ...o, headers: { ...H, ...(o.headers || {}) } })
const ok = async (r, l) => { if (!r.ok) throw new Error(`${l}: ${r.status} ${(await r.text()).slice(0, 300)}`); const t = await r.text(); return t ? JSON.parse(t) : null }
const ins = (t, f, l) => api(`/rest/v1/${t}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(f) }).then(r => ok(r, l))
const IDS = 'tmp/ventas-dia/seed-ids.json'
fs.mkdirSync('tmp/ventas-dia', { recursive: true })

if (process.argv.includes('--borrar')) {
  const s = JSON.parse(fs.readFileSync(IDS, 'utf8'))
  const d = p => api(p, { method: 'DELETE' })
  await d(`/rest/v1/notas_despacho_items?despacho_id=in.(${s.despachos.join(',')})`)
  await d(`/rest/v1/notas_despacho?id=in.(${s.despachos.join(',')})`)
  await d(`/rest/v1/cotizacion_items?cotizacion_id=in.(${s.cotizaciones.join(',')})`)
  await d(`/rest/v1/cotizaciones?id=in.(${s.cotizaciones.join(',')})`)
  await d(`/rest/v1/clientes?id=in.(${s.clientes.join(',')})`)
  await d(`/rest/v1/usuarios?id=in.(${s.usuarios.join(',')})`)
  console.log('Borrado.'); process.exit(0)
}

const au = await ok(await api('/auth/v1/admin/users?per_page=50'), 'Cuentas')
const cuenta = au.users.find(u => u.email === e2e.STAGING_E2E_EMAIL)?.id
if (!cuenta) throw new Error('No existe la cuenta de prueba')
const salt = generateSalt(), hash = await hashPinPBKDF2('000000', salt)
const [logi] = await ins('usuarios?select=id', { nombre: 'Logística PRUEBA VD', rol: 'logistica', activo: true, cuenta_id: cuenta, pin_hash: hash, pin_salt: salt }, 'Operador logística')
const [vend] = await ins('usuarios?select=id', { nombre: 'Vendedor PRUEBA VD', rol: 'vendedor', activo: true, cuenta_id: cuenta, pin_hash: await hashPinPBKDF2('0000', salt), pin_salt: salt }, 'Operador vendedor')
const nombres = ['ALEJANDRO CORTEZ', 'ANTONIO CARRILLO', 'ANDREIDI FAGUNDES', 'JOSE HERNANDEZ', 'DOUGLAS ASCANIO', 'ANA RIVERO']
const clientes = await ins('clientes?select=id,nombre', nombres.map((n, i) => ({ nombre: `${n} (PRUEBA VD)`, rif_cedula: `V-9000000${i}`, telefono: `0414000010${i}`, saldo_pendiente: 0, activo: true, vendedor_id: vend.id, cuenta_id: cuenta })), 'Clientes')
const c = i => clientes[i].id
const PM = 'Transf. / Pago Móvil'
const ventas = [
  [0, 'entregada', 20.9, [{ metodo: PM, monto: 20.9, monto_bs: 21150.8, referencia: '204518' }]],
  [1, 'despachada', 499.8, [{ metodo: 'Efectivo $', monto: 499.8 }]],
  [2, 'entregada', 116.96, [{ metodo: 'Efectivo $', monto: 116.96 }]],
  [2, 'despachada', 106.83, [{ metodo: PM, monto: 106.83, monto_bs: 108111.96, referencia: '771023' }]],
  [3, 'despachada', 61.5, [{ metodo: 'Efectivo $', monto: 41.5 }, { metodo: PM, monto: 20, monto_bs: 20240, referencia: '338120' }]],
  [4, 'entregada', 100.59, [{ metodo: 'Efectivo $', monto: 80 }, { metodo: 'Cta por cobrar', monto: 20.59, diasVencimiento: 15 }]],
  [5, 'despachada', 35, [{ metodo: 'Efectivo $', monto: 0 }]],
  [0, 'pendiente', 48, [{ metodo: 'Zelle', monto: 48 }]],
  [1, 'anulada', 30, [{ metodo: 'Zelle', monto: 30 }]],
]
const out = { usuarios: [logi.id, vend.id], clientes: clientes.map(x => x.id), cotizaciones: [], despachos: [] }
const ahora = Date.now()
for (const [k, [ci, estado, total, pagos]] of ventas.entries()) {
  const t = new Date(ahora - (ventas.length - k) * 600000).toISOString()
  const [cot] = await ins('cotizaciones?select=id', { cuenta_id: cuenta, cliente_id: c(ci), vendedor_id: vend.id, estado: 'aceptada', subtotal_usd: total, total_usd: total, creado_en: t }, 'Cotización')
  out.cotizaciones.push(cot.id)
  const [d] = await ins('notas_despacho?select=id,numero', { cotizacion_id: cot.id, cuenta_id: cuenta, vendedor_id: vend.id, cliente_id: c(ci), estado, creado_en: t, total_usd: total, flete_usd: 0, descuento_total_usd: 0, forma_pago: JSON.stringify(pagos), creado_por: vend.id }, 'Despacho')
  out.despachos.push(d.id)
}
fs.writeFileSync(IDS, JSON.stringify(out))
console.log(`Listo: operador "Logística PRUEBA VD" y ${ventas.length} despachos de hoy en la cuenta ${e2e.STAGING_E2E_EMAIL}`)
