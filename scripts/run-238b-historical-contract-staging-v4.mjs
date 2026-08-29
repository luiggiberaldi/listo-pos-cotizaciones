import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'

const { Client } = pg
const ROOT = process.cwd()
const REF = 'spupqgkdsgohxxfoxydl'
const HOST = `db.${REF}.supabase.co`
const ACCOUNT = '74dd6821-963d-406e-8621-47352e0df27e'
const OPERATOR_ID = '00000000-0000-0000-0000-000000000000'
const OPERATOR_NAME = 'Desarrollador'
const CONFIRM = 'RUN_238B_HISTORICAL_CONTRACT_STAGING'
const SOURCE_PATH = path.join(ROOT, 'supabase/release/main/238b_historical_apply_review.sql')
const CANDIDATE_PATH = path.join(ROOT, 'tmp/238b-staging/238b-rate2-candidate-batch.json')
const OUTPUT_DIR = path.join(ROOT, 'tmp/238b-staging')

function parseEnv(file) {
  const out = {}
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    const i = line.indexOf('=')
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}
function n(value) { return Number.isFinite(Number(value)) ? Number(value) : 0 }
function money(value) { return Math.round(n(value) * 100) / 100 }
function same(a, b) { return Math.abs(n(a) - n(b)) < 0.000001 }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function simple(row) {
  return {
    numero: Number(row.numero), comision_id: row.comision_id, despacho_id: row.despacho_id,
    estado: row.estado, total: money(row.totalcomision), cabilla: money(row.comisioncabilla),
    otros: money(row.comisionotros), liberada: money(row.comision_liberada),
    retenida: money(row.comision_retenida), montopagado: money(row.montopagado),
    pagadaen: row.pagadaen ? new Date(row.pagadaen).toISOString() : null,
    cxc: row.comision_cxc_excluida == null ? null : money(row.comision_cxc_excluida),
    pago: row.comision_pago_excluida == null ? null : money(row.comision_pago_excluida),
    otras: row.comision_otras_exclusiones == null ? null : money(row.comision_otras_exclusiones),
    fraccion: row.fraccion_no_cxc == null ? null : Number(row.fraccion_no_cxc),
    extras: row.detalle_extras, version: row.calculo_version,
    policy: row.politica_comision, source: row.fuente_calculo, evidence: row.calculo_evidencia,
  }
}

function adapt(source) {
  const gate = /DO\s+\$\$\s*\r?\nBEGIN\s*\r?\n\s*RAISE EXCEPTION 'REVIEW_ONLY:[^']*';\s*\r?\nEND\s*\$\$;\s*/m
  if (!gate.test(source)) throw Error('Falta REVIEW_ONLY')
  let sql = source.replace(gate, '').replace(/^--.*pagadapor.*\r?\n/gmi, '')
  sql = sql.replace(/ALTER TABLE public\.comision_238b_batch_rows\s*\r?\n  ADD COLUMN IF NOT EXISTS old_pagadapor UUID,\s*\r?\n  ADD COLUMN IF NOT EXISTS proposed_pagadapor UUID;\s*\r?\n/m, '')
  sql = sql.replace(/^\s*pagadapor_anterior UUID,\s*\r?\n/gm, '')
  sql = sql.replace(/^\s*old_pagadaen, old_pagadapor, old_comision_cxc_excluida,\s*\r?\n/gm, '      old_pagadaen, old_comision_cxc_excluida,\n')
  sql = sql.replace(/^\s*proposed_pagadaen, proposed_pagadapor,\s*\r?\n/gm, '      proposed_pagadaen,\n')
  sql = sql.replace(/^\s*v_commission\.pagadapor,\s*\r?\n/gm, '')
  sql = sql.replace(/v_commission\.pagadaen, v_commission\.pagadapor,\s*/g, 'v_commission.pagadaen, ')
  sql = sql.replace(/^\s*OR v_commission\.pagadapor IS DISTINCT FROM v_row\.pagadapor_anterior\s*\r?\n/gm, '')
  sql = sql.replace(/^\s*OR v_current\.pagadapor IS DISTINCT FROM v_row\.old_pagadapor\s*\r?\n/gm, '')
  sql = sql.replace(/^\s*OR v_current\.pagadapor IS DISTINCT FROM v_row\.proposed_pagadapor\s*\r?\n/gm, '')
  sql = sql.replace(/^\s*pagadapor = v_row\.old_pagadapor,\s*\r?\n/gm, '')
  sql = sql.replace(/^\s*pagadapor = v_row\.proposed_pagadapor,\s*\r?\n/gm, '')
  sql = sql.replace(/0, NULL, NULL,\s*\r?\n      round\(COALESCE\(v_row\.comision_cxc_excluida_propuesta, 0\), 2\),/g, '0, NULL,\n      round(COALESCE(v_row.comision_cxc_excluida_propuesta, 0), 2),')
  if (/pagadapor/i.test(sql) || /REVIEW_ONLY:/i.test(sql)) throw Error('Adaptación dejó pagadapor o REVIEW_ONLY')
  if ((sql.match(/^BEGIN;$/gm) || []).length !== 1 || (sql.match(/^COMMIT;$/gm) || []).length !== 1) throw Error('Transacción adaptada no única')
  for (const name of ['registrar_propuestas_comisiones_238b', 'aprobar_reconciliacion_comisiones_238b', 'aplicar_reconciliacion_comisiones_238b', 'revertir_reconciliacion_comisiones_238b']) {
    if ((sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\b`, 'g')) || []).length !== 1) throw Error(`Falta ${name}`)
  }
  return sql
}

const env = parseEnv(path.join(ROOT, 'construacero-staging/.env'))
if (process.env.STAGING_238B_CONTRACT_CONFIRM !== CONFIRM) throw Error(`Falta STAGING_238B_CONTRACT_CONFIRM=${CONFIRM}`)
if (new URL(env.VITE_SUPABASE_URL).hostname !== `${REF}.supabase.co`) throw Error('Destino no es staging autorizado')
if (!env.PGPASSWORD) throw Error('Falta PGPASSWORD')
if (!fs.existsSync(CANDIDATE_PATH)) throw Error('Falta candidato')
const candidate = JSON.parse(fs.readFileSync(CANDIDATE_PATH, 'utf8'))
const batchKey = candidate.batch_key
const applyKey = candidate.planned_apply_key
const rollbackKey = candidate.rollback_key
if (candidate.project_ref !== REF || candidate.account_id !== ACCOUNT || candidate.proposals?.length !== 4) throw Error('Candidato inválido')
if (!candidate.gates?.all_high_confidence || !candidate.gates?.all_100_percent_non_cxc) throw Error('Candidato sin gates')
if (!candidate.proposals.every((row) => row.confidence === 'high_confidence' && Number(row.fraccion_no_cxc_propuesta) === 1 && Number(row.comision_cxc_excluida_propuesta) === 0)) throw Error('Candidato no elegible')
const backupNames = fs.readdirSync(path.join(ROOT, 'tmp/backups')).filter((name) => /^238b-staging-preapply-.*\.json$/.test(name)).sort()
if (!backupNames.length) throw Error('Falta backup staging')
const backupPath = path.join(ROOT, 'tmp/backups', backupNames.at(-1))
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
if (backup.project_ref !== REF || backup.account_id !== ACCOUNT || backup.transaction_read_only !== true || backup.rollback_executed !== true || backup.remote_mutation_attempted !== false) throw Error('Backup inválido')

const client = new Client({ host: HOST, port: 5432, database: 'postgres', user: 'postgres', password: env.PGPASSWORD, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000, statement_timeout: 180000 })
const evidence = { run_version: '238b-historical-contract-staging-v4', generated_at: new Date().toISOString(), project_ref: REF, environment: 'staging', account_id: ACCOUNT, operator_id: OPERATOR_ID, operator_name: OPERATOR_NAME, batch_key: batchKey, apply_key: applyKey, rollback_key: rollbackKey, source_sql: path.relative(ROOT, SOURCE_PATH).replaceAll(path.sep, '/'), candidate_sha256: hash(CANDIDATE_PATH), backup_path: path.relative(ROOT, backupPath).replaceAll(path.sep, '/'), backup_sha256: hash(backupPath), main_touched: false, stages: [] }
const record = (name, data) => evidence.stages.push({ name, at: new Date().toISOString(), ...data })

async function business() {
  const totals = (await client.query('SELECT count(*)::int rows, coalesce(sum(totalcomision),0)::numeric total, coalesce(sum(comisioncabilla),0)::numeric cabilla, coalesce(sum(comisionotros),0)::numeric otros FROM public.comisiones WHERE cuentaid=$1::uuid', [ACCOUNT])).rows[0]
  const states = (await client.query("SELECT coalesce(jsonb_object_agg(estado,count ORDER BY estado),'{}'::jsonb) values FROM (SELECT estado,count(*)::int count FROM public.comisiones WHERE cuentaid=$1::uuid GROUP BY estado)x", [ACCOUNT])).rows[0].values
  const batches = (await client.query('SELECT count(*)::int count FROM public.comision_238b_batches WHERE cuenta_id=$1::uuid', [ACCOUNT])).rows[0]
  const rows = (await client.query('SELECT count(*)::int count FROM public.comision_238b_batch_rows r JOIN public.comision_238b_batches b USING(batch_key) WHERE b.cuenta_id=$1::uuid', [ACCOUNT])).rows[0]
  return { totals: { rows:Number(totals.rows), total:money(totals.total), cabilla:money(totals.cabilla), otros:money(totals.otros) }, states, batches:Number(batches.count), batch_rows:Number(rows.count) }
}
async function selectedRows() {
  const sql = `SELECT nd.numero,c.id::text AS comision_id,c.despachoid::text AS despacho_id,
    c.estado,c.totalcomision,c.comisioncabilla,c.comisionotros,c.comision_liberada,
    c.comision_retenida,c.montopagado,c.pagadaen,c.comision_cxc_excluida,
    c.comision_pago_excluida,c.comision_otras_exclusiones,c.fraccion_no_cxc,
    c.detalle_extras,c.calculo_version,c.politica_comision,c.fuente_calculo,c.calculo_evidencia
    FROM public.comisiones c JOIN public.notas_despacho nd ON nd.id=c.despachoid
    WHERE c.cuentaid=$1::uuid AND nd.numero=ANY($2::int[]) ORDER BY nd.numero`
  return (await client.query(sql, [ACCOUNT, candidate.proposals.map((row) => Number(row.despacho_numero))])).rows
}

let before
let beforeRows
let applied = false
let rolledBack = false
await client.connect()
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const target = (await client.query("SELECT current_database() database_name,current_setting('transaction_read_only') read_only")).rows[0]
  before = await business()
  beforeRows = await selectedRows()
  if (target.database_name !== 'postgres' || target.read_only !== 'on' || before.totals.rows !== 703 || beforeRows.length !== 4) throw Error(`Baseline staging inválido: ${JSON.stringify({target,before,selected_rows:beforeRows.length})}`)
  if (before.totals.total !== money(backup.baseline.commission_total)) throw Error('Backup no coincide con baseline')
  await client.query('ROLLBACK')
  evidence.preflight = { target, before, rows_before: beforeRows.map(simple), rollback: true }
  record('preflight_read_only', { ok:true, before })

  const adapted = adapt(fs.readFileSync(SOURCE_PATH, 'utf8'))
  fs.mkdirSync(OUTPUT_DIR, { recursive:true })
  const adaptedPath = path.join(OUTPUT_DIR, '238b-historical-contract-staging-adapted-v4.sql')
  fs.writeFileSync(adaptedPath, `${adapted}\n`, 'utf8')
  evidence.adapted_sql = path.relative(ROOT, adaptedPath).replaceAll(path.sep, '/')
  evidence.adapted_sql_sha256 = crypto.createHash('sha256').update(adapted).digest('hex')
  await client.query(adapted)
  const afterInstall = await business()
  if (JSON.stringify(afterInstall.totals)!==JSON.stringify(before.totals)||JSON.stringify(afterInstall.states)!==JSON.stringify(before.states)) throw Error('Instalación alteró negocio')
  record('install_contract', { ok:true, after_install:afterInstall })

  const registered=(await client.query('SELECT public.registrar_propuestas_comisiones_238b($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::jsonb) result',[ACCOUNT,batchKey,OPERATOR_ID,OPERATOR_NAME,JSON.stringify({candidate_sha256:evidence.candidate_sha256,backup_sha256:evidence.backup_sha256}),JSON.stringify(candidate.proposals)])).rows[0].result
  if(registered.ok!==true||Number(registered.snapshot_rows)!==4||Number(registered.manual_review_rows)!==0) throw Error(`Registro inválido: ${JSON.stringify(registered)}`)
  record('register_snapshot',{ok:true,result:registered})

  const approved=(await client.query('SELECT public.aprobar_reconciliacion_comisiones_238b($1::uuid,$2::uuid,$3::text) result',[batchKey,OPERATOR_ID,OPERATOR_NAME])).rows[0].result
  if(approved.ok!==true||Number(approved.approved_rows)!==4) throw Error(`Aprobación inválida: ${JSON.stringify(approved)}`)
  record('approve_batch',{ok:true,result:approved})

  const appliedResult=(await client.query('SELECT public.aplicar_reconciliacion_comisiones_238b($1::uuid,$2::uuid,$3::uuid,$4::text) result',[batchKey,applyKey,OPERATOR_ID,OPERATOR_NAME])).rows[0].result
  if(appliedResult.ok!==true||Number(appliedResult.applied_count)!==4) throw Error(`Apply inválido: ${JSON.stringify(appliedResult)}`)
  applied=true
  const afterApply=await business();const afterRows=await selectedRows();const byNumber=new Map(candidate.proposals.map((row)=>[Number(row.despacho_numero),row]))
  const expectedTotal=money(before.totals.total-candidate.totals.delta)
  const checks=afterRows.map((row)=>{const p=byNumber.get(Number(row.numero));return {numero:Number(row.numero),generated:row.estado==='generada',total:same(row.totalcomision,p.total_propuesto),cxc_zero:same(row.comision_cxc_excluida,0),fraction_one:same(row.fraccion_no_cxc,1),version:row.calculo_version==='238b',policy:row.politica_comision==='fecha_despacho_no_cxc'}})
  if(afterApply.totals.total!==expectedTotal||!checks.every((row)=>Object.values(row).every(Boolean))) throw Error(`Postflight apply inválido: ${JSON.stringify({afterApply,expectedTotal,checks})}`)
  record('apply_postflight',{ok:true,result:appliedResult,after_apply:afterApply,checks})

  const applyIdempotent=(await client.query('SELECT public.aplicar_reconciliacion_comisiones_238b($1::uuid,$2::uuid,$3::uuid,$4::text) result',[batchKey,applyKey,OPERATOR_ID,OPERATOR_NAME])).rows[0].result
  if(applyIdempotent.ok!==true||applyIdempotent.idempotent!==true) throw Error(`Apply idempotente inválido: ${JSON.stringify(applyIdempotent)}`)
  record('apply_idempotency',{ok:true,result:applyIdempotent})

  const rollbackResult=(await client.query('SELECT public.revertir_reconciliacion_comisiones_238b($1::uuid,$2::uuid,$3::uuid,$4::text) result',[batchKey,rollbackKey,OPERATOR_ID,OPERATOR_NAME])).rows[0].result
  if(rollbackResult.ok!==true||Number(rollbackResult.restored)!==4) throw Error(`Rollback inválido: ${JSON.stringify(rollbackResult)}`)
  rolledBack=true
  const afterRollback=await business();const rowsAfterRollback=await selectedRows();const beforeByNumber=new Map(beforeRows.map((row)=>[Number(row.numero),simple(row)]))
  const rollbackChecks=rowsAfterRollback.map((row)=>{const actual=simple(row);const expected=beforeByNumber.get(actual.numero);return {numero:actual.numero,restored:Boolean(expected)&&Object.keys(expected).filter((key)=>key!=='numero').every((key)=>JSON.stringify(actual[key])===JSON.stringify(expected[key]))}})
  if(JSON.stringify(afterRollback.totals)!==JSON.stringify(before.totals)||JSON.stringify(afterRollback.states)!==JSON.stringify(before.states)||!rollbackChecks.every((row)=>row.restored)) throw Error(`Postflight rollback inválido: ${JSON.stringify({afterRollback,rollbackChecks})}`)
  const rollbackIdempotent=(await client.query('SELECT public.revertir_reconciliacion_comisiones_238b($1::uuid,$2::uuid,$3::uuid,$4::text) result',[batchKey,rollbackKey,OPERATOR_ID,OPERATOR_NAME])).rows[0].result
  if(rollbackIdempotent.ok!==true||rollbackIdempotent.idempotent!==true) throw Error(`Rollback idempotente inválido: ${JSON.stringify(rollbackIdempotent)}`)
  record('rollback_postflight',{ok:true,after_rollback:afterRollback,checks:rollbackChecks,result:rollbackIdempotent})
  evidence.result={ok:true,staging_only:true,contract_installed:true,snapshot_registered:true,batch_approved:true,applied_rows:4,rollback_rows:4,apply_idempotent:true,rollback_idempotent:true,business_restored:true,main_touched:false}
} catch(error) {
  evidence.result={ok:false,staging_only:true,error:error instanceof Error?error.message:String(error),applied,rolled_back:rolledBack,main_touched:false}
  try { await client.query('ROLLBACK') } catch {}
  if(applied&&!rolledBack){try{evidence.emergency_rollback=(await client.query('SELECT public.revertir_reconciliacion_comisiones_238b($1::uuid,$2::uuid,$3::uuid,$4::text) result',[batchKey,rollbackKey,OPERATOR_ID,OPERATOR_NAME])).rows[0].result;rolledBack=evidence.emergency_rollback?.ok===true}catch(error2){evidence.emergency_rollback_error=error2 instanceof Error?error2.message:String(error2)}}
  throw error
} finally {
  evidence.generated_at=new Date().toISOString();fs.mkdirSync(OUTPUT_DIR,{recursive:true});const output=path.join(OUTPUT_DIR,`238b-historical-contract-staging-v4-${evidence.generated_at.replace(/[:.]/g,'-')}.json`);evidence.evidence_path=path.relative(ROOT,output).replaceAll(path.sep,'/');fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');await client.end().catch(()=>{})
}
if(evidence.result?.ok) console.log(JSON.stringify({ok:true,project_ref:REF,batch_key:batchKey,applied_rows:4,rollback_rows:4,business_restored:true,evidence_path:evidence.evidence_path},null,2))
else process.exitCode=1
