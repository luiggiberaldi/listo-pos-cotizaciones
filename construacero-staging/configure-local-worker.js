import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(root, '.env')
const devVarsPath = path.join(root, '.dev.vars')

function parseEnvFile(text) {
  const values = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

function getProjectRef(url) {
  return new URL(url).hostname.split('.')[0]
}

if (!fs.existsSync(envPath)) {
  throw new Error('Falta construacero-staging/.env')
}

const rawEnv = fs.readFileSync(envPath, 'utf8')
const appEnv = parseEnvFile(rawEnv)
const accessToken = appEnv.SUPABASE_ACCESS_TOKEN || rawEnv
  .split(/\r?\n/)
  .map(line => line.trim())
  .find(line => /^sbp_[A-Za-z0-9]+$/.test(line))

if (!accessToken) {
  throw new Error('No se encontró una línea sbp_... en construacero-staging/.env')
}

const supabaseUrl = appEnv.SUPABASE_URL || appEnv.VITE_SUPABASE_URL
if (!supabaseUrl) throw new Error('Falta SUPABASE_URL o VITE_SUPABASE_URL')

const projectRef = getProjectRef(supabaseUrl)
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})

const keys = await response.json().catch(() => null)
if (!response.ok || !Array.isArray(keys)) {
  throw new Error(`Supabase Management API rechazó la consulta (HTTP ${response.status})`)
}

const serviceKey = keys.find(key => key.name === 'service_role')?.api_key
if (!serviceKey) throw new Error('El proyecto staging no devolvió una service_role key')

try {
  const payload = JSON.parse(Buffer.from(serviceKey.split('.')[1], 'base64url').toString())
  if (payload.ref && payload.ref !== projectRef) {
    throw new Error('La service_role key devuelta no corresponde al proyecto staging')
  }
} catch (error) {
  if (error.message.includes('no corresponde')) throw error
  throw new Error('La service_role key devuelta no tiene formato JWT válido')
}

const output = [
  '# Generado localmente — ignorado por git; no compartir este archivo.',
  `SUPABASE_SERVICE_KEY=${serviceKey}`,
  'DEV_MASTER_PIN_4=0000',
  'DEV_MASTER_PIN_6=000000',
  'DEV_SUPER_CODE=24457713',
  '',
].join('\n')

fs.writeFileSync(devVarsPath, output, { encoding: 'utf8', mode: 0o600 })
console.log(`Worker staging configurado para ${projectRef}; service_role key no se imprimió.`)
