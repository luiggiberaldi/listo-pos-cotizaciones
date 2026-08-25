import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const EXPECTED_PROJECT_REF = 'oyfyuszgjwcepjpngclv'
const CONFIRMATION = 'ROLLBACK_PRODUCTION_DEEP_EDIT_239'
const targetSignatures = [
  'editar_despacho_profundidad(uuid,jsonb)',
  'editar_despacho_profundidad(uuid,jsonb,uuid,text,text)',
  'editar_despacho_profundidad(uuid,jsonb,uuid,text,text,text)',
]
const helperSignature = 'validar_items_despacho_sin_duplicados(jsonb)'

function loadEnv(filePath) {
  const values = {}
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    const separator = line.indexOf('=')
    if (!line || line.startsWith('#') || separator < 1) continue
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[line.slice(0, separator).trim()] = value
  }
  return values
}

function projectRefFromUrl(value) {
  try { return new URL(value).hostname.split('.')[0] } catch { return null }
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

const backupPath = process.argv[2]
if (!backupPath) throw new Error('Uso: node scripts/rollback-deep-edit-main.mjs tmp/backups/deep-edit-main-239-...json')
if (process.env.PRODUCTION_DEEP_EDIT_CONFIRM !== CONFIRMATION) {
  throw new Error(`Falta PRODUCTION_DEEP_EDIT_CONFIRM=${CONFIRMATION}`)
}

const backup = JSON.parse(fs.readFileSync(path.resolve(backupPath), 'utf8'))
const env = loadEnv('.env')
const projectRef = projectRefFromUrl(env.VITE_SUPABASE_URL)
if (projectRef !== EXPECTED_PROJECT_REF || env.host !== `db.${EXPECTED_PROJECT_REF}.supabase.co`) {
  throw new Error(`Destino inesperado: ref=${projectRef} host=${env.host}`)
}
if (backup.project_ref !== EXPECTED_PROJECT_REF) throw new Error('El backup no pertenece al proyecto principal esperado')
if (!env.DB_PASSWORD) throw new Error('Falta DB_PASSWORD')

const client = new pg.Client({
  host: env.host,
  port: Number(env.port || 5432),
  database: env.database || 'postgres',
  user: env.user || 'postgres',
  password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  statement_timeout: 120000,
})

let inTransaction = false
try {
  await client.connect()
  const identity = await client.query(`select current_database() as database, current_user as user_name`)
  if (identity.rows[0]?.database !== 'postgres' || identity.rows[0]?.user_name !== 'postgres') {
    throw new Error('Identidad PostgreSQL inesperada')
  }

  await client.query('BEGIN')
  inTransaction = true

  for (const signature of targetSignatures) {
    const backupFunction = backup.functions.find(row => row.signature === signature)
    if (!backupFunction) throw new Error(`Falta definición respaldada: ${signature}`)
    await client.query(backupFunction.definition)
  }

  if (backup.helper) {
    await client.query(backup.helper.definition)
  } else {
    await client.query(`DROP FUNCTION IF EXISTS public.${helperSignature}`)
  }

  for (const signature of [...targetSignatures, helperSignature]) {
    await client.query(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role`)
  }

  const aclRows = backup.acl.filter(row => row.privilege_type === 'EXECUTE')
  for (const row of aclRows) {
    const grantee = row.grantee === 'PUBLIC' ? 'PUBLIC' : quoteIdent(row.grantee)
    await client.query(`GRANT EXECUTE ON FUNCTION public.${row.signature} TO ${grantee}`)
  }
  await client.query("NOTIFY pgrst, 'reload schema'")
  await client.query('COMMIT')
  inTransaction = false

  const installed = await client.query(`
    select p.oid::regprocedure::text as signature,
           pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname = 'editar_despacho_profundidad'
        or p.proname = 'validar_items_despacho_sin_duplicados')
    order by 1
  `)
  console.log(JSON.stringify({ ok: true, restoredFrom: path.resolve(backupPath), functions: installed.rows.map(row => ({ signature: row.signature, hasDelete: /delete\s+from\s+public\.notas_despacho_items/i.test(row.definition), hasGuard: /ITEMS_DUPLICADOS|validar_items_despacho_sin_duplicados/i.test(row.definition) })) }, null, 2))
} catch (error) {
  if (inTransaction) await client.query('ROLLBACK').catch(() => {})
  console.error(JSON.stringify({ ok: false, error: String(error?.stack || error) }, null, 2))
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
