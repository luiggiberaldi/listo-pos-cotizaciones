#!/usr/bin/env node
// scripts/verify-op030-usuarios-staging.mjs
// OP-2026-030 — Prueba de punta a punta de la creación de usuarios, SOLO en staging.
// Requiere staging levantado (vite 5174 + worker 8789). Crea usuarios "OP030 …",
// intenta duplicarlos y renombrar a un nombre ocupado, y al final los BORRA.
// Uso: node scripts/verify-op030-usuarios-staging.mjs
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const STAGING_PROJECT_REF = 'spupqgkdsgohxxfoxydl'
const ORIGIN = 'http://localhost:5174'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseEnv(text = '') {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const readEnv = async f => { try { return parseEnv(await readFile(path.join(root, f), 'utf8')) } catch { return {} } }

const cfg = { ...(await readEnv('.env')), ...(await readEnv('.dev.vars')), ...(await readEnv('.env.e2e.local')) }
const supabaseUrl = cfg.STAGING_E2E_SUPABASE_URL || cfg.VITE_SUPABASE_URL
const ref = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : ''
if (ref !== STAGING_PROJECT_REF) throw new Error(`Guardia: la base no es staging (${ref || 'desconocida'}). Abortado.`)
const superCode = cfg.STAGING_E2E_SUPER_CODE || cfg.DEV_SUPER_CODE
if (!cfg.STAGING_E2E_EMAIL || !cfg.STAGING_E2E_PASSWORD || !superCode) throw new Error('Faltan credenciales E2E de staging')

const supabase = createClient(supabaseUrl, cfg.STAGING_E2E_ANON_KEY || cfg.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { error: loginError } = await supabase.auth.signInWithPassword({ email: cfg.STAGING_E2E_EMAIL.trim().toLowerCase(), password: cfg.STAGING_E2E_PASSWORD })
if (loginError) throw new Error(`Login staging: ${loginError.message}`)

let operatorToken = null
async function api(pathname, method = 'GET', body = null) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json' }
  if (operatorToken) headers['X-Operator-Session'] = operatorToken
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${ORIGIN}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: res.status, data }
}

const sa = await api('/api/auth/super-admin', 'POST', { code: superCode })
operatorToken = sa.data?.operatorSession?.token
if (!operatorToken) throw new Error(`No se abrió la sesión de desarrollador (HTTP ${sa.status})`)

const sufijo = Date.now().toString(36).slice(-5).toUpperCase()
const NOMBRE = `OP030 Prueba ${sufijo}`
const NOMBRE_B = `OP030 Otra ${sufijo}`
const creados = []
const resultados = []
function check(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok })
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
}
// Lista oficial de operadores activos de la cuenta (la misma de "¿Quién eres?").
// La lectura directa de la tabla no sirve aquí: las reglas de privacidad la ocultan.
async function idsPorPrefijo() {
  const r = await api('/api/auth/operators', 'GET')
  if (r.status !== 200 || !Array.isArray(r.data?.operators)) throw new Error(`No se pudo leer la lista de operadores (HTTP ${r.status})`)
  return r.data.operators.filter(o => o.nombre.startsWith('OP030 ') && o.nombre.endsWith(` ${sufijo}`))
}

try {
  // 1. Crear un usuario nuevo
  const r1 = await api('/api/admin/users', 'POST', { nombre: NOMBRE, rol: 'vendedor', pin: '2468' })
  if (r1.data?.id) creados.push(r1.data.id)
  check('Crear usuario nuevo', r1.status === 201, `HTTP ${r1.status}`)

  // 2. Mismo nombre, con mayúsculas/espacios distintos → rechazado
  const r2 = await api('/api/admin/users', 'POST', { nombre: `  ${NOMBRE.toLowerCase()}  `, rol: 'vendedor', pin: '2468' })
  if (r2.data?.id) creados.push(r2.data.id)
  check('Nombre repetido (otra escritura) rechazado', r2.status === 409, `HTTP ${r2.status}: ${r2.data?.error ?? ''}`)

  // 3. Dos "Guardar" seguidos (reintento) con el mismo nombre → solo queda 1
  const [a, b] = [
    await api('/api/admin/users', 'POST', { nombre: NOMBRE_B, rol: 'jefe', pin: '135790' }),
    await api('/api/admin/users', 'POST', { nombre: NOMBRE_B, rol: 'jefe', pin: '135790' }),
  ]
  for (const r of [a, b]) if (r.data?.id) creados.push(r.data.id)
  check('Reintento no duplica', a.status === 201 && b.status === 409, `HTTP ${a.status} y ${b.status}`)

  // 4. Renombrar el segundo al nombre del primero → rechazado
  const idB = a.data?.id
  const r4 = idB ? await api(`/api/admin/users/${idB}`, 'PUT', { nombre: NOMBRE, rol: 'jefe' }) : { status: 0 }
  check('Renombrar a un nombre ocupado rechazado', r4.status === 409, `HTTP ${r4.status}`)

  // 5. Guardar sin cambiar el propio nombre → permitido
  const r5 = idB ? await api(`/api/admin/users/${idB}`, 'PUT', { nombre: NOMBRE_B, rol: 'jefe' }) : { status: 0 }
  check('Editar sin cambiar el nombre funciona', r5.status === 200, `HTTP ${r5.status}`)

  // 6. PIN de largo incorrecto → rechazado
  const r6 = await api('/api/admin/users', 'POST', { nombre: `OP030 Pin ${sufijo}`, rol: 'vendedor', pin: '123456' })
  if (r6.data?.id) creados.push(r6.data.id)
  check('PIN de largo incorrecto rechazado', r6.status === 400, `HTTP ${r6.status}`)

  // 7. En la base quedan exactamente 2 usuarios de esta prueba
  const enBD = await idsPorPrefijo()
  check('En la base quedaron exactamente 2 (sin duplicados)', enBD.length === 2, `${enBD.length} encontrados`)
  for (const u of enBD) if (!creados.includes(u.id)) creados.push(u.id)

  // 8. El usuario nuevo puede entrar con su PIN
  if (r1.data?.id) {
    const login = await api('/api/auth/switch-operator', 'POST', { operator_id: r1.data.id, pin: '2468' })
    check('El usuario nuevo puede entrar con su PIN', login.status === 200 && !!login.data?.operatorSession?.token, `HTTP ${login.status}`)
    // volver a la sesión de desarrollador para limpiar
    const back = await api('/api/auth/super-admin', 'POST', { code: superCode })
    operatorToken = back.data?.operatorSession?.token || operatorToken
  }
} finally {
  // Limpieza: borrar todo lo creado por esta prueba
  for (const id of [...new Set(creados)]) {
    const d = await api(`/api/admin/users/${id}`, 'DELETE')
    if (d.status !== 200) console.log(`⚠️  No se pudo borrar ${id} (HTTP ${d.status})`)
  }
  const resto = await idsPorPrefijo()
  check('Limpieza: no quedan usuarios de prueba', resto.length === 0, `${resto.length} restantes`)
}

const fallos = resultados.filter(r => !r.ok).length
console.log(`\nResultado: ${resultados.length - fallos}/${resultados.length} correctos`)
process.exit(fallos ? 1 : 0)
