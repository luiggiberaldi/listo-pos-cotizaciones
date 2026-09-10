import fs from 'node:fs'

// ─── Builder migración 274 (staging) ─────────────────────────────────────────
// Parche quirúrgico en las 2 RPCs de entrega, rama 'Saldo a favor':
//   1) tipo 'abono' → 'consumo_credito'
//   2) saldo_usd: en vez de decrementar la deuda (v_saldo), calcula el bolsillo
//      de favor canónico del ledger del cliente menos el monto consumido.
// Nota: el dump de pg_get_functiondef trae header completo Y SU PROPIO cierre
// $function$ — cada statement solo necesita el ; final.
const backups = [
  'construacero-staging/supabase/release/staging/274_backup_cuerpos/confirmar_entrega_finanzas_atomica_staging.live.sql',
  'construacero-staging/supabase/release/staging/274_backup_cuerpos/confirmar_entrega_finanzas_idempotente.live.sql',
]

const OLD_SALDO = "        v_saldo := GREATEST(0, ROUND((v_saldo - v_monto)::NUMERIC, 4));"
const NEW_SALDO = [
  "        v_saldo := GREATEST(0, ROUND((",
  "          COALESCE((SELECT SUM(CASE WHEN c.tipo='credito' THEN c.monto_usd WHEN c.tipo='abono' AND lower(COALESCE(c.forma_pago_abono,''))='saldo a favor' THEN -c.monto_usd WHEN c.tipo='devolucion_credito' THEN -c.monto_usd WHEN c.tipo='consumo_credito' THEN -c.monto_usd ELSE 0 END)",
  "          FROM public.cuentas_por_cobrar c WHERE c.cliente_id = v_cliente_id AND c.cuenta_id = p_cuenta_id),0)",
  "          - v_monto)::NUMERIC, 4));",
].join('\n')

const OUT = 'construacero-staging/supabase/migrations/274_staging_entrega_consumo_tipo_correcto.sql'

function patchBody(body, fnName) {
  const abonoPat = "'abono', v_monto, v_saldo,"
  const abonoCount = body.split(abonoPat).length - 1
  if (abonoCount !== 1) throw new Error(`${fnName}: patrón INSERT abono x${abonoCount} (esperado 1)`)
  let out = body.replace(abonoPat, "'consumo_credito', v_monto, v_saldo,")

  const saldoCount = out.split(OLD_SALDO).length - 1
  if (saldoCount !== 1) throw new Error(`${fnName}: patrón saldo x${saldoCount} (esperado 1)`)
  out = out.replace(OLD_SALDO, NEW_SALDO)
  return out
}

const header = `-- 274_staging_entrega_consumo_tipo_correcto.sql
-- Fix: la entrega registraba el consumo de saldo a favor como 'abono' (pago de
-- deuda) en vez de 'consumo_credito' → neteaba el COD y lo dejaba incobrable
-- (caso #3072 en el principal). Parche quirúrgico de la rama 'Saldo a favor' en
-- las 2 RPCs de entrega: tipo correcto + saldo_usd del bolsillo de favor
-- (replay canónico del ledger), sin tocar el saldo de deuda.
-- Fuente: cuerpos vivos de staging (274_backup_cuerpos). Rollback: 274_rollback.sql.
-- Guard 273 intacto: NOT EXISTS ya cubre ('abono','consumo_credito').
`

const statements = []
const patchedBodies = {}

for (const file of backups) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const fnName = file.split('/').pop().replace('.live.sql', '')
  const patched = patchBody(raw, fnName)
  patchedBodies[fnName] = patched
  statements.push(`-- === ${fnName} ===\n${patched.trimEnd()};`)
}

// Postflight interno: si algún cuerpo vivo no quedó con consumo_credito, fallar
const postflight = `
-- ─── Postflight interno (falla si el parche no quedó vivo) ──────────────────
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('confirmar_entrega_finanzas_atomica_staging','confirmar_entrega_finanzas_idempotente')
    AND position('consumo_credito'', v_monto' in pg_get_functiondef(p.oid)) = 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'POSTFLIGHT 274: % funcion(es) sin el tipo consumo_credito', v_bad;
  END IF;
END $$;
`

fs.writeFileSync(OUT, header + statements.join('\n\n') + '\n' + postflight)

// Rollback byte-idéntico (restaurar cuerpos originales del dump)
const rbStatements = backups.map((file) => {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const fnName = file.split('/').pop().replace('.live.sql', '')
  return `-- === rollback ${fnName} ===\n${raw.trimEnd()};`
})
fs.writeFileSync('construacero-staging/supabase/migrations/274_rollback.sql',
  '-- 274 rollback: restauración byte-idéntica de los cuerpos previos (dump vivo).\n' + rbStatements.join('\n\n') + '\n')

// Guardar cuerpos parcheados para el verificador LCS
fs.mkdirSync('tmp/274/patched', { recursive: true })
for (const [k, v] of Object.entries(patchedBodies)) fs.writeFileSync(`tmp/274/patched/${k}.sql`, v)

console.log('274 generada:', OUT)
console.log('rollback: construacero-staging/supabase/migrations/274_rollback.sql')
