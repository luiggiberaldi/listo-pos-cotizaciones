import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const files = {
  guardrails: 'supabase/release/main/238b_comisiones_guardrails_review.sql',
  dryRun: 'supabase/release/main/238b_historical_dry_run_readonly.sql',
  apply: 'supabase/release/main/238b_historical_apply_review.sql',
  cutover: 'supabase/release/main/238b_cutover_legacy_rpc_review.sql',
  contractAudit: 'supabase/release/main/238c_contract_audit_readonly.sql',
  contractNeutral: 'supabase/release/main/238a_contract_neutral_review.sql',
  contractRollback: 'supabase/release/main/238a_contract_neutral_rollback_review.sql',
};

const errors = [];
const warnings = [];
const sources = {};

for (const [name, relative] of Object.entries(files)) {
  const absolute = path.join(root, relative);
  try {
    sources[name] = await readFile(absolute, 'utf8');
  } catch (error) {
    errors.push(`${relative}: no se pudo leer (${error.message})`);
  }
}

const requireText = (name, text, expected, description) => {
  if (!text.includes(expected)) errors.push(`${name}: falta ${description}`);
};

const forbidText = (name, text, forbidden, description) => {
  if (text.includes(forbidden)) errors.push(`${name}: contiene ${description}`);
};

const count = (text, pattern) => text.match(pattern)?.length ?? 0;

if (sources.contractNeutral) {
  requireText('contractNeutral', sources.contractNeutral, 'REVIEW_ONLY:', 'gate REVIEW_ONLY');
  requireText('contractNeutral', sources.contractNeutral, 'comision_238a_installation_marker', 'marcador de instalacion');
  requireText('contractNeutral', sources.contractNeutral, 'comision_238b_batches', 'tabla de batches');
  requireText('contractNeutral', sources.contractNeutral, 'comision_238b_batch_rows', 'tabla de snapshots');
  requireText('contractNeutral', sources.contractNeutral, 'CREATE UNIQUE INDEX', 'indice unico por despacho');
  requireText('contractNeutral', sources.contractNeutral, 'PRECONDICION_FALTANTE', 'guardas de precondicion');
  requireText('contractNeutral', sources.contractNeutral, 'no agrega pagadapor', 'politica sin pagadopor');
  forbidText('contractNeutral', sources.contractNeutral, 'UPDATE public.comisiones', 'actualizacion historica');
  forbidText('contractNeutral', sources.contractNeutral, 'INSERT INTO public.comisiones', 'insercion historica');
  forbidText('contractNeutral', sources.contractNeutral, 'DELETE FROM public.comisiones', 'borrado historico');
  forbidText('contractNeutral', sources.contractNeutral, 'GRANT ', 'GRANT remoto');
  forbidText('contractNeutral', sources.contractNeutral, 'REVOKE ', 'REVOKE remoto');
  if (count(sources.contractNeutral, /REVIEW_ONLY:/g) !== 1) {
    errors.push('contractNeutral: debe tener exactamente un gate REVIEW_ONLY');
  }
}

if (sources.contractRollback) {
  requireText('contractRollback', sources.contractRollback, 'REVIEW_ONLY:', 'gate REVIEW_ONLY');
  requireText('contractRollback', sources.contractRollback, 'ROLLBACK_238A_SIN_MARCADOR', 'guarda de marcador');
  requireText('contractRollback', sources.contractRollback, 'ROLLBACK_238A_BLOQUEADO_POR_USO', 'guarda de uso posterior');
  requireText('contractRollback', sources.contractRollback, 'ROLLBACK_238A_BLOQUEADO_POR_EVIDENCIA', 'guarda de evidencia');
  requireText('contractRollback', sources.contractRollback, 'created_columns', 'ownership de columnas');
  requireText('contractRollback', sources.contractRollback, 'created_tables', 'ownership de tablas');
  requireText('contractRollback', sources.contractRollback, 'created_indexes', 'ownership de indices');
  if (count(sources.contractRollback, /REVIEW_ONLY:/g) !== 1) {
    errors.push('contractRollback: debe tener exactamente un gate REVIEW_ONLY');
  }
}

if (sources.guardrails) {
  requireText('guardrails', sources.guardrails, 'REVIEW_ONLY:', 'gate REVIEW_ONLY');
  requireText('guardrails', sources.guardrails, 'BEGIN;', 'BEGIN');
  requireText('guardrails', sources.guardrails, 'COMMIT;', 'COMMIT');
  requireText('guardrails', sources.guardrails, 'comision_238b_pago_split', 'normalizador de pagos');
  requireText('guardrails', sources.guardrails, 'calcularcomisiondespacho_238b', 'funcion futura');
  requireText('guardrails', sources.guardrails, 'comision_238b_batches', 'tabla de batches');
  requireText('guardrails', sources.guardrails, 'comision_238b_batch_rows', 'tabla de snapshots');
  requireText('guardrails', sources.guardrails, 'revertir_reconciliacion_comisiones_238b', 'rollback');
  requireText('guardrails', sources.guardrails, "GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho_238b(UUID) TO service_role", 'grant service_role futuro');
  requireText('guardrails', sources.guardrails, 'cutover_legacy_rpc_review.sql', 'referencia al cutover separado');
  forbidText('guardrails', sources.guardrails, "REVOKE ALL ON FUNCTION public.marcar_comision_pagada(UUID)", 'revocacion del ciclo legacy dentro del tramo futuro');
  forbidText('guardrails', sources.guardrails, 'DROP TABLE public.comisiones', 'DROP TABLE sobre comisiones');
  if (count(sources.guardrails, /REVIEW_ONLY:/g) !== 1) {
    errors.push('guardrails: debe tener exactamente un gate REVIEW_ONLY');
  }
  if (count(sources.guardrails, /UPDATE public\.comisiones/g) < 1) {
    errors.push('guardrails: falta el UPDATE de rollback esperado');
  }
}

if (sources.dryRun) {
  requireText('dryRun', sources.dryRun, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;', 'transaccion READ ONLY');
  requireText('dryRun', sources.dryRun, 'ROLLBACK;', 'rollback de lectura');
  requireText('dryRun', sources.dryRun, 'app.comision_238b_cuenta_id', 'parametro de cuenta');
  requireText('dryRun', sources.dryRun, 'app.comision_238b_batch_key', 'parametro batch_key');
  requireText('dryRun', sources.dryRun, "'cotizacion_fallback'::TEXT", 'marca de fallback');
  requireText('dryRun', sources.dryRun, "'manual_review'", 'clasificacion manual');
  requireText('dryRun', sources.dryRun, 'item_evidence', 'evidencia por item');
  requireText('dryRun', sources.dryRun, 'detalle_extras_anterior', 'metadata de extras anterior');
  requireText('dryRun', sources.dryRun, 'calculo_version_anterior', 'version anterior');
  forbidText('dryRun', sources.dryRun, 'UPDATE public.comisiones', 'UPDATE de negocio');
  forbidText('dryRun', sources.dryRun, 'INSERT INTO public.comisiones', 'INSERT de negocio');
  forbidText('dryRun', sources.dryRun, 'DELETE FROM public.comisiones', 'DELETE de negocio');
  if (count(sources.dryRun, /\bCOMMIT\s*;/gi) > 0) errors.push('dryRun: no debe hacer COMMIT');
  if (count(sources.dryRun, /\bROLLBACK\s*;/gi) !== 1) errors.push('dryRun: debe terminar con un ROLLBACK');
}

if (sources.apply) {
  requireText('apply', sources.apply, 'REVIEW_ONLY:', 'gate REVIEW_ONLY');
  requireText('apply', sources.apply, 'registrar_propuestas_comisiones_238b', 'registro de snapshot');
  requireText('apply', sources.apply, 'aprobar_reconciliacion_comisiones_238b', 'aprobacion');
  requireText('apply', sources.apply, 'aplicar_reconciliacion_comisiones_238b', 'apply atomico');
  requireText('apply', sources.apply, 'COMISION_PROPUESTA_OBSOLETA', 'stale snapshot guard');
  requireText('apply', sources.apply, 'COMISION_APPLY_BLOQUEADO_POR_CAMBIO_POSTERIOR', 'stale apply guard');
  requireText('apply', sources.apply, 'APPLY_KEY_REUTILIZADA_CON_OTRO_VALOR', 'idempotency apply_key');
  requireText('apply', sources.apply, 'manual_review', 'bloqueo de revision manual');
  requireText('apply', sources.apply, 'snapshot_captured_at', 'timestamp de snapshot');
  if (count(sources.apply, /REVIEW_ONLY:/g) !== 1) errors.push('apply: debe tener exactamente un gate REVIEW_ONLY');
  if (!sources.apply.includes('detalle_extras_anterior JSONB')) warnings.push('apply: revisar metadata detalle_extras en el contrato de entrada');
}

if (sources.cutover) {
  requireText('cutover', sources.cutover, 'REVIEW_ONLY:', 'gate REVIEW_ONLY');
  requireText('cutover', sources.cutover, 'calcularcomisiondespacho_238b', 'dependencia futura');
  requireText('cutover', sources.cutover, 'CREATE OR REPLACE FUNCTION public.calcularcomisiondespacho', 'wrapper legacy');
  requireText('cutover', sources.cutover, 'GRANT EXECUTE ON FUNCTION public.calcularcomisiondespacho(UUID) TO service_role', 'grant legacy wrapper');
  if (count(sources.cutover, /REVIEW_ONLY:/g) !== 1) errors.push('cutover: debe tener exactamente un gate REVIEW_ONLY');
}

if (sources.contractAudit) {
  requireText('contractAudit', sources.contractAudit, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;', 'transaccion READ ONLY');
  requireText('contractAudit', sources.contractAudit, 'ROLLBACK;', 'rollback de auditoria');
  requireText('contractAudit', sources.contractAudit, '238b_preconditions', 'dictamen de precondiciones');
  requireText('contractAudit', sources.contractAudit, 'ready_for_mutating_sql', 'gate de no autorizacion');
  requireText('contractAudit', sources.contractAudit, 'pg_indexes', 'auditoria de indices');
  requireText('contractAudit', sources.contractAudit, 'has_table_privilege', 'auditoria de grants');
  forbidText('contractAudit', sources.contractAudit, 'ALTER TABLE', 'DDL ALTER TABLE');
  forbidText('contractAudit', sources.contractAudit, 'CREATE TABLE', 'DDL CREATE TABLE');
  forbidText('contractAudit', sources.contractAudit, 'CREATE OR REPLACE FUNCTION', 'DDL de funciones');
  forbidText('contractAudit', sources.contractAudit, 'INSERT INTO', 'DML INSERT');
  forbidText('contractAudit', sources.contractAudit, 'UPDATE public', 'DML UPDATE');
  forbidText('contractAudit', sources.contractAudit, 'DELETE FROM', 'DML DELETE');
  forbidText('contractAudit', sources.contractAudit, 'GRANT EXECUTE', 'GRANT ejecutable');
  forbidText('contractAudit', sources.contractAudit, 'REVOKE ALL', 'REVOKE mutante');
}

const allSql = Object.values(sources).join('\n');
if (/\bDROP\s+TABLE\s+public\.comisiones\b/i.test(allSql)) {
  errors.push('paquete: contiene DROP TABLE public.comisiones');
}
if (/\bDROP\s+DATABASE\b/i.test(allSql)) errors.push('paquete: contiene DROP DATABASE');

const summary = {
  ok: errors.length === 0,
  remote_execution: false,
  files_checked: Object.keys(sources).length,
  errors,
  warnings,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) process.exitCode = 1;
