import fs from 'node:fs'

// Verificador LCS 274: entre el dump vivo y el parcheado debe haber
// esperado por función: del=2 (saldo viejo + tipo abono), ins=5 (4 bolsillo favor + tipo consumo_credito).
const fns = [
  'confirmar_entrega_finanzas_atomica_staging',
  'confirmar_entrega_finanzas_idempotente',
]

function readNorm(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n')
    .map(l => l.trimEnd()).filter(l => l.trim() !== '')
}

let allOk = true
for (const fn of fns) {
  const A = readNorm(`construacero-staging/supabase/release/staging/274_backup_cuerpos/${fn}.live.sql`)
  const B = readNorm(`tmp/274/patched/${fn}.sql`)
  const n = A.length, m = B.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const del = [], ins = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { del.push(A[i]); i++ }
    else { ins.push(B[j]); j++ }
  }
  while (i < n) { del.push(A[i]); i++ }
  while (j < m) { ins.push(B[j]); j++ }

  const hasTipo = ins.some(l => l.includes("'consumo_credito', v_monto"))
  const delTipo = del.some(l => l.includes("'abono', v_monto"))
  const insSaldo = ins.filter(l => l.includes('cuentas_por_cobrar c WHERE c.cliente_id') || l.includes("- v_monto)::NUMERIC, 4));") || l.includes("WHEN c.tipo='consumo_credito' THEN -c.monto_usd")).length
  const delSaldo = del.filter(l => l.includes('v_saldo - v_monto')).length

  const ok = hasTipo && delTipo && delSaldo === 1 && insSaldo >= 2 && del.length === 2 && ins.length === 5
  console.log(`${fn}: del=${del.length} ins=${ins.length} | tipo ${delTipo ? 'abono→' : ''}${hasTipo ? 'consumo_credito ✓' : '✗'} | saldo viejo ${delSaldo}/1 | líneas favor ${insSaldo} | ${ok ? 'OK' : 'FALLA'}`)
  if (!ok) {
    console.log('  DEL:', JSON.stringify(del, null, 1))
    console.log('  INS:', JSON.stringify(ins, null, 1))
    allOk = false
  }
}
process.exit(allOk ? 0 : 1)
