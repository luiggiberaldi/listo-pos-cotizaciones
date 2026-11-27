// scripts/op084-restauracion-real-staging.mjs — Prueba R3/R7 del plan OP-2026-084 (SOLO STAGING).
// Descarga el respaldo completo de la empresa de prueba por el servidor local, lo vuelve a restaurar
// (mismos datos) y comprueba que nada cambió: conteos, stock contra Kardex, préstamos y saldos.
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

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, read_only: true }) })
  return r.json()
}
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { data } = await sb.auth.signInWithPassword({ email: env.STAGING_E2E_EMAIL.trim().toLowerCase(), password: env.STAGING_E2E_PASSWORD })
const jwt = data.session.access_token
const cuenta = data.user.id
let r = await fetch('http://localhost:5174/api/auth/super-admin', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: env.DEV_SUPER_CODE }) })
const tok = (await r.json()).operatorSession.token
const H = { Authorization: `Bearer ${jwt}`, 'X-Operator-Session': tok }

const foto = async () => (await sql(`SELECT
  (SELECT count(*) FROM productos WHERE cuenta_id='${cuenta}')::int prod,
  (SELECT count(*) FROM inventario_movimientos WHERE cuenta_id='${cuenta}')::int movs,
  (SELECT max(numero) FROM inventario_movimientos)::int max_mov,
  (SELECT count(*) FROM notas_despacho WHERE cuenta_id='${cuenta}')::int desp,
  (SELECT count(*) FROM cliente_prestamos cp JOIN clientes c ON c.id=cp.cliente_id WHERE c.cuenta_id='${cuenta}')::int prest,
  (SELECT coalesce(sum(cantidad_devuelta + cantidad_facturada),0) FROM cliente_prestamos cp JOIN clientes c ON c.id=cp.cliente_id WHERE c.cuenta_id='${cuenta}')::numeric prest_mov,
  (SELECT coalesce(sum(stock_actual),0) FROM productos WHERE cuenta_id='${cuenta}')::numeric stock_total,
  (SELECT coalesce(sum(saldo_pendiente),0) FROM clientes WHERE cuenta_id='${cuenta}')::numeric saldos,
  (SELECT count(*) FROM cuentas_por_cobrar WHERE cuenta_id='${cuenta}')::int cxc,
  (SELECT count(*) FROM comisiones WHERE cuentaid='${cuenta}')::int comis,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname IN ('notas_despacho_items','notas_despacho','cuentas_por_cobrar') AND NOT t.tgisinternal AND t.tgenabled='D')::int disparadores_apagados`))[0]

const antes = await foto()
const t0 = Date.now()
r = await fetch('http://localhost:5174/api/admin/backup', { headers: H })
const backup = await r.json()
const bytes = JSON.stringify(backup).length
console.log(`Respaldo: completo=${backup.completo} versión=${backup.version} tamaño=${(bytes / 1048576).toFixed(2)} MB en ${Date.now() - t0} ms`)
const t1 = Date.now()
r = await fetch('http://localhost:5174/api/admin/restore', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(backup) })
const res = await r.json()
console.log(`Restauración: HTTP ${r.status} en ${Date.now() - t1} ms`, JSON.stringify(res.resumen || res.error))
const despues = await foto()
const difs = Object.keys(antes).filter(k => String(antes[k]) !== String(despues[k]))
console.log('Antes  ', JSON.stringify(antes))
console.log('Después', JSON.stringify(despues))
console.log(difs.length === 0 && r.status === 200 ? 'RESULTADO: OK — nada cambió y los disparadores quedaron encendidos' : `RESULTADO: FALLA — cambió: ${difs.join(', ')}`)
process.exit(difs.length === 0 && r.status === 200 ? 0 : 1)
