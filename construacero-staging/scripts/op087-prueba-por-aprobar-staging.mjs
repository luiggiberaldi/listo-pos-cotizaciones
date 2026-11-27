// scripts/op087-prueba-por-aprobar-staging.mjs — OP-2026-087 (SOLO STAGING, solo lectura).
// Comprueba que "por aprobar" coincide con la base (4 decimales) y que no se filtra a otras empresas ni a anónimos.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './test-e2e-staging.mjs'

const STAGING = 'spupqgkdsgohxxfoxydl'
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const leer = f => { try { return parseEnvFile(readFileSync(path.join(raiz, f), 'utf8')) } catch { return {} } }
const env = { ...leer('.env'), ...leer('.dev.vars'), ...leer('.env.e2e.local') }
if (!env.VITE_SUPABASE_URL?.includes(STAGING)) throw new Error('Guardia: solo staging')

const sql = async query => (await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, read_only: true }) })).json()
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

let fallas = 0
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) fallas++ }

const { data: login, error: e0 } = await sb.auth.signInWithPassword({ email: env.STAGING_E2E_EMAIL.trim().toLowerCase(), password: env.STAGING_E2E_PASSWORD })
if (e0) throw e0
const cuenta = login.user.id

const esperado = await sql(`SELECT ndi.producto_id, ROUND(SUM(ndi.cantidad)::numeric, 4)::numeric(12,4) total FROM notas_despacho_items ndi JOIN notas_despacho nd ON nd.id=ndi.despacho_id WHERE nd.estado='pendiente' AND nd.cuenta_id='${cuenta}' AND ndi.producto_id IS NOT NULL GROUP BY 1`)
const { data: tot, error: e1 } = await sb.rpc('obtener_stock_por_aprobar')
ok(!e1, 'la función de totales responde con sesión')
const mapa = Object.fromEntries((tot ?? []).map(r => [r.producto_id, Number(r.total_por_aprobar)]))
ok(esperado.length === Object.keys(mapa).length && esperado.every(r => Math.abs(mapa[r.producto_id] - Number(r.total)) < 0.0001), `totales coinciden con la base (${esperado.length} productos con unidades por aprobar)`)

const pid = esperado[0]?.producto_id
if (pid) {
  const { data: det } = await sb.rpc('obtener_stock_por_aprobar_detalle', { p_producto_id: pid })
  const suma = (det ?? []).reduce((a, r) => a + Number(r.cantidad), 0)
  ok(Math.abs(suma - Number(esperado[0].total)) < 0.0001, `el detalle del producto suma lo mismo que el total (${suma})`)
}
const { data: todo } = await sb.rpc('obtener_stock_por_aprobar_detalle', { p_producto_id: null })
const ajenos = await sql(`SELECT count(*)::int n FROM notas_despacho_items ndi JOIN notas_despacho nd ON nd.id=ndi.despacho_id WHERE nd.estado='pendiente' AND nd.cuenta_id IS DISTINCT FROM '${cuenta}'`)
console.log(`      (hay ${ajenos[0].n} líneas pendientes de otras empresas; la función devolvió ${todo?.length ?? 0} propias)`)
const propias = await sql(`SELECT count(*)::int n FROM notas_despacho_items ndi JOIN notas_despacho nd ON nd.id=ndi.despacho_id WHERE nd.estado='pendiente' AND nd.cuenta_id='${cuenta}' AND ndi.producto_id IS NOT NULL`)
ok((todo?.length ?? 0) === propias[0].n, 'el detalle sin producto devuelve solo las líneas de la empresa')

const { error: e2 } = await anon.rpc('obtener_stock_por_aprobar')
ok(!!e2, `sin sesión se rechaza (${e2?.code || e2?.message})`)
const { error: e3 } = await anon.rpc('obtener_stock_por_aprobar_detalle', { p_producto_id: null })
ok(!!e3, 'detalle sin sesión se rechaza')

console.log(fallas === 0 ? 'RESULTADO: OK' : `RESULTADO: ${fallas} FALLA(S)`)
process.exit(fallas ? 1 : 0)
