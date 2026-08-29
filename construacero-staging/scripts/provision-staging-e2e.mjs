import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const STAGING_PROJECT_REF = 'spupqgkdsgohxxfoxydl'
const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const e2eEnvPath = path.join(root, '.env.e2e.local')

function parseEnv(text = '') {
  return Object.fromEntries(String(text).split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) return []
    return [[match[1], match[2].trim().replace(/^['"]|['"]$/g, '')]]
  }))
}

async function readEnv(file) {
  try { return parseEnv(await readFile(file, 'utf8')) } catch { return {} }
}

const [localEnv, devVars, e2eEnv] = await Promise.all([
  readEnv(path.join(root, '.env')),
  readEnv(path.join(root, '.dev.vars')),
  readEnv(e2eEnvPath),
])
const env = { ...localEnv, ...devVars, ...e2eEnv, ...process.env }
const serviceKey = env.SUPABASE_SERVICE_KEY
const baseUrl = env.SUPABASE_URL || STAGING_URL
const email = env.STAGING_E2E_EMAIL || 'staging-e2e@listo.sys'
const password = env.STAGING_E2E_PASSWORD || e2eEnv.STAGING_E2E_PASSWORD || randomBytes(24).toString('base64url')

if (baseUrl !== STAGING_URL) throw new Error(`Abortado: SUPABASE_URL debe ser ${STAGING_URL}`)
if (!serviceKey) throw new Error('Falta SUPABASE_SERVICE_KEY en construacero-staging/.dev.vars')
if (!email.includes('@')) throw new Error('STAGING_E2E_EMAIL inválido')
if (password.length < 12) throw new Error('La contraseña E2E debe tener al menos 12 caracteres')

const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

async function requestJson(endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: { ...adminHeaders, ...(options.headers || {}) },
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  if (!response.ok) {
    const detail = data?.msg || data?.message || text.slice(0, 500)
    throw new Error(`${options.method || 'GET'} ${endpoint} → HTTP ${response.status}: ${detail}`)
  }
  return data
}

async function findAuthUser() {
  for (let page = 1; page <= 10; page += 1) {
    const data = await requestJson(`/auth/v1/admin/users?per_page=1000&page=${page}`)
    const users = Array.isArray(data?.users) ? data.users : []
    const found = users.find(user => user.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (users.length < 1000) break
  }
  return null
}

const existingAuth = await findAuthUser()
const authUser = existingAuth
  ? await requestJson(`/auth/v1/admin/users/${existingAuth.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password, email_confirm: true, user_metadata: { environment: 'staging', purpose: 'e2e' } }),
    })
  : await requestJson('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { environment: 'staging', purpose: 'e2e' } }),
    })
const accountId = authUser?.user?.id || authUser?.id
if (!accountId) throw new Error('Supabase no devolvió el ID de la cuenta E2E')

const primarySellerName = 'Vendedor E2E Staging'
const alternateSellerName = 'Vendedor E2E Alterno'
let existingSellers = await requestJson(`/rest/v1/usuarios?cuenta_id=eq.${accountId}&rol=eq.vendedor&activo=eq.true&select=id,nombre&limit=20`)
let sellerId = existingSellers?.find(seller => seller.nombre === primarySellerName)?.id || existingSellers?.[0]?.id
if (!sellerId) {
  sellerId = randomUUID()
  await requestJson('/rest/v1/usuarios', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: sellerId,
      cuenta_id: accountId,
      nombre: primarySellerName,
      rol: 'vendedor',
      activo: true,
      color: '#2563EB',
    }),
  })
}

existingSellers = await requestJson(`/rest/v1/usuarios?cuenta_id=eq.${accountId}&rol=eq.vendedor&activo=eq.true&select=id,nombre&limit=20`)
let alternateSellerId = existingSellers?.find(seller => seller.id !== sellerId)?.id
if (!alternateSellerId) {
  alternateSellerId = randomUUID()
  await requestJson('/rest/v1/usuarios', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: alternateSellerId,
      cuenta_id: accountId,
      nombre: alternateSellerName,
      rol: 'vendedor',
      activo: true,
      color: '#7C3AED',
    }),
  })
}

// Las RPC atómicas de inventario y devoluciones deben guardar un usuario FK
// real. El código maestro activa un desarrollador virtual (0000...), que no
// existe en public.usuarios; provisionar un operador privilegiado dedicado
// permite que el fallback de auditoría funcione sin relajar las RPCs ni usar
// un operador de otro tenant.
const privilegedName = 'Desarrollador E2E Staging'
let privilegedRows = await requestJson(`/rest/v1/usuarios?cuenta_id=eq.${accountId}&rol=eq.desarrollador&activo=eq.true&select=id,nombre&limit=20`)
let privilegedId = privilegedRows?.find(operator => operator.nombre === privilegedName)?.id || privilegedRows?.[0]?.id
if (!privilegedId) {
  privilegedId = randomUUID()
  await requestJson('/rest/v1/usuarios', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: privilegedId,
      cuenta_id: accountId,
      nombre: privilegedName,
      rol: 'desarrollador',
      activo: true,
      color: '#8B5CF6',
    }),
  })
}

const configRows = await requestJson(`/rest/v1/configuracion_negocio?cuenta_id=eq.${accountId}&select=cuenta_id,comision_pct_cabilla,comision_pct_otros,comision_categoria_cabilla&limit=1`)
if (!configRows?.length) {
  // The restored staging schema keeps `id` as a global primary key with a
  // default of 1. Omitting it makes provisioning fail after the main tenant's
  // singleton row already exists, so reserve the next explicit id.
  const latestConfig = await requestJson('/rest/v1/configuracion_negocio?select=id&order=id.desc&limit=1')
  const nextConfigId = Number(latestConfig?.[0]?.id || 0) + 1
  await requestJson('/rest/v1/configuracion_negocio', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: nextConfigId,
      cuenta_id: accountId,
      nombre_negocio: 'Staging E2E',
      moneda_principal: 'USD',
      validez_cotizacion_dias: 7,
      comision_pct_cabilla: 2,
      comision_pct_otros: 3,
      comision_categoria_cabilla: 'Cabilla',
    }),
  })
}

await writeFile(e2eEnvPath, [
  '# Generado localmente por npm run provision:e2e:staging; no subir.',
  `STAGING_E2E_EMAIL=${email}`,
  `STAGING_E2E_PASSWORD=${password}`,
  `STAGING_E2E_OPERATOR_ID=${sellerId}`,
  '',
].join('\n'), { encoding: 'utf8', mode: 0o600 })

console.log(JSON.stringify({
  ok: true,
  environment: 'staging',
  projectRef: STAGING_PROJECT_REF,
  email,
  accountId,
  sellerId,
  alternateSellerId,
  privilegedId,
  authAction: existingAuth ? 'password-reset-existing-dedicated-account' : 'created-dedicated-account',
  credentialsFile: '.env.e2e.local',
}, null, 2))
