// scripts/op091-prueba-prestamo-cobro-staging.mjs — OP-2026-091 (SOLO STAGING).
// Prueba, contra la base real de staging, facturar un préstamo con tasa principal, "a crédito" y "paga ahora",
// la comisión del vendedor y el freno de revertir con préstamos facturados (N44-INV).
// Cada prueba corre dentro de una transacción que SIEMPRE se deshace (termina con un error a propósito),
// así que no deja datos.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './test-e2e-staging.mjs'

const STAGING = 'spupqgkdsgohxxfoxydl'
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const leer = f => { try { return parseEnvFile(readFileSync(path.join(raiz, f), 'utf8')) } catch { return {} } }
const env = { ...leer('.env'), ...leer('.dev.vars'), ...leer('.env.e2e.local') }
if (!env.VITE_SUPABASE_URL?.includes(STAGING)) throw new Error('Guardia: esto solo corre contra staging')

async function sql(query, escribir = false) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(escribir ? { query } : { query, read_only: true }),
  })
  const t = await r.text()
  return { status: r.status, texto: t }
}

// Ejecuta un bloque que termina siempre en error; devuelve el JSON que el bloque dejó en el mensaje.
async function enTransaccionDeshecha(cuerpo) {
  const { texto } = await sql(`DO $op$ DECLARE r JSONB; antes JSONB; despues JSONB; BEGIN ${cuerpo} END $op$;`, true)
  const m = texto.match(/OP091\|(\{.*\})/s)
  if (m) {
    const limpio = m[1].replace(/\\n.*$/s, '').replace(/\\"/g, '"')
    try { return { datos: JSON.parse(limpio) } } catch { /* sigue */ }
  }
  return { error: texto.slice(0, 400) }
}

const resultados = []
const anotar = (codigo, ok, detalle) => { resultados.push({ codigo, ok }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${codigo} — ${detalle}`) }

const [pr] = JSON.parse((await sql(`SELECT cp.id, c.cuenta_id, cp.cliente_id, cp.despacho_id, nd.vendedor_id,
    (SELECT u.id FROM public.usuarios u WHERE u.cuenta_id=c.cuenta_id AND u.activo AND u.rol IN ('administracion','jefe') LIMIT 1) adm
  FROM public.cliente_prestamos cp JOIN public.clientes c ON c.id=cp.cliente_id JOIN public.notas_despacho nd ON nd.id=cp.despacho_id
  JOIN public.notas_despacho_items i ON i.id=cp.despacho_item_id
  LEFT JOIN public.usuarios u ON u.id = COALESCE(c.vendedor_id, nd.vendedor_id)
  WHERE cp.cantidad_prestada - COALESCE(cp.cantidad_devuelta,0) - COALESCE(cp.cantidad_facturada,0) >= 1 AND i.precio_unit_usd > 0
    AND u.rol = 'vendedor' AND EXISTS (SELECT 1 FROM public.comisiones co WHERE co.despachoid = nd.id)
  ORDER BY nd.creado_en DESC LIMIT 1`)).texto)
if (!pr) throw new Error('No hay un préstamo pendiente con vendedor comisionable para probar')

const base = (modo, tasa, metodo) => `
  antes := jsonb_build_object('saldo', (SELECT saldo_pendiente FROM public.clientes WHERE id='${pr.cliente_id}'), 'neto', (SELECT COALESCE(SUM(CASE WHEN tipo='cargo' THEN monto_usd WHEN tipo='abono' THEN -monto_usd ELSE 0 END),0) FROM public.cuentas_por_cobrar WHERE cliente_id='${pr.cliente_id}'),
    'com', (SELECT to_jsonb(c) FROM public.comisiones c WHERE c.despachoid='${pr.despacho_id}' LIMIT 1));
  r := public.facturar_prestamo_atomico('${pr.cuenta_id}','${pr.id}',1,'${pr.adm}',${tasa},gen_random_uuid(),'${modo}',${metodo ? `'${metodo}'` : 'NULL'},NULL);
  despues := jsonb_build_object('saldo', (SELECT saldo_pendiente FROM public.clientes WHERE id='${pr.cliente_id}'), 'neto', (SELECT COALESCE(SUM(CASE WHEN tipo='cargo' THEN monto_usd WHEN tipo='abono' THEN -monto_usd ELSE 0 END),0) FROM public.cuentas_por_cobrar WHERE cliente_id='${pr.cliente_id}'),
    'com', (SELECT to_jsonb(c) FROM public.comisiones c WHERE c.despachoid='${pr.despacho_id}' LIMIT 1),
    'cargo', (SELECT descripcion FROM public.cuentas_por_cobrar WHERE id=(r->>'cargo_id')::uuid),
    'abono', (SELECT jsonb_build_object('monto', monto_usd, 'forma', forma_pago_abono) FROM public.cuentas_por_cobrar WHERE id=NULLIF(r->>'abono_id','')::uuid));
  RAISE EXCEPTION 'OP091|%', jsonb_build_object('r', r, 'antes', antes, 'despues', despues)::text;`

// T1 — a crédito con tasa principal USDT
{
  const { datos: d, error } = await enTransaccionDeshecha(base('usdt', 1108, null))
  const comAntes = Number(d?.antes?.com?.comision_retenida || 0)
  const comDesp = Number(d?.despues?.com?.comision_retenida || 0)
  anotar('T1 a crédito: cargo con tasa principal anotada y sin "##"',
    !!d && d.r.ok && d.r.tasa_modo === 'usdt' && /tasa principal \(USDT\) 1108\.00/.test(d.despues.cargo) && !d.despues.cargo.includes('#') && d.r.abono_id === null,
    d ? d.despues.cargo : error)
  // El saldo del cliente es max(0, cargos − abonos): un cliente con pagos de más absorbe el cargo (regla de siempre).
  anotar('T1b a crédito: cargos − abonos sube por el monto facturado y el saldo sigue esa regla',
    !!d && Math.abs((Number(d.despues.neto) - Number(d.antes.neto)) - Number(d.r.monto_usd)) < 0.011
      && Math.abs(Number(d.despues.saldo) - Math.max(0, Number(d.despues.neto))) < 0.011,
    d ? `neto ${d.antes.neto} → ${d.despues.neto}; saldo ${d.antes.saldo} → ${d.despues.saldo} (monto ${d.r.monto_usd})` : error)
  anotar('T1c a crédito: la comisión queda retenida con el mismo porcentaje',
    !!d && d.r.comision?.aplica === true && d.r.comision.liberada === false && d.despues.com.estado === 'cta_cobrar'
      && Math.abs((comDesp - comAntes) - Number(d.r.comision.comision_usd)) < 0.011
      && Math.abs(Number(d.r.comision.comision_usd) - Math.round(Number(d.r.monto_usd) * Number(d.r.comision.pct)) / 100) < 0.011,
    d ? `comisión $${d.r.comision?.comision_usd} (${d.r.comision?.pct}%) sobre $${d.r.monto_usd}; estado ${d.despues.com?.estado}` : error)
}

// T2 — paga ahora
{
  const { datos: d, error } = await enTransaccionDeshecha(base('bcv', 924.35, 'Efectivo $'))
  anotar('T2 paga ahora: se registra el pago y el saldo del cliente no cambia',
    !!d && !!d.r.abono_id && d.despues.abono?.forma === 'Efectivo $' && Math.abs(Number(d.despues.abono.monto) - Number(d.r.monto_usd)) < 0.011
      && Math.abs(Number(d.despues.neto) - Number(d.antes.neto)) < 0.011 && Math.abs(Number(d.despues.saldo) - Number(d.antes.saldo)) < 0.011,
    d ? `saldo ${d.antes.saldo} → ${d.despues.saldo}; pago $${d.despues.abono?.monto} (${d.despues.abono?.forma})` : error)
  anotar('T2b paga ahora: la comisión queda liberada (no retenida)',
    !!d && d.r.comision?.aplica === true && d.r.comision.liberada === true && Number(d.despues.com.comision_retenida || 0) === Number(d.antes.com.comision_retenida || 0)
      && Number(d.despues.com.comision_liberada) > Number(d.antes.com.comision_liberada),
    d ? `comisión $${d.r.comision?.comision_usd}; liberada ${d.antes.com?.comision_liberada} → ${d.despues.com?.comision_liberada}` : error)
}

// T3 — validaciones
{
  const { error } = await enTransaccionDeshecha(base('bcv', 924.35, 'Donación'))
  anotar('T3 un método que no es pago ("Donación") se rechaza', /PAGO_METODO_INVALIDO/.test(error || ''), (error || '').slice(0, 120))
  const r2 = await enTransaccionDeshecha(base('euro', 924.35, null))
  anotar('T3b un tipo de tasa inventado se rechaza', /TASA_MODO_INVALIDO/.test(r2.error || ''), (r2.error || '').slice(0, 120))
}

// T4 — N44-INV: con un préstamo facturado no se revierte la entrega a ningún estado
{
  const [d] = JSON.parse((await sql(`SELECT nd.id FROM public.notas_despacho nd JOIN public.cliente_prestamos cp ON cp.despacho_id=nd.id
    WHERE nd.estado='entregada' AND (cp.cantidad_facturada > 0 OR cp.cantidad_devuelta > 0) ORDER BY nd.creado_en DESC LIMIT 1`)).texto)
  const intentos = []
  for (const estado of ['despachada', 'pendiente']) {
    const rr = await enTransaccionDeshecha(`PERFORM public.revertir_entrega_finanzas_atomica('${d.id}','${estado}',(SELECT id FROM public.usuarios WHERE activo AND rol='desarrollador' LIMIT 1),'PRUEBA',NULL); RAISE EXCEPTION 'OP091|{"sin_bloqueo":true}';`)
    intentos.push(`${estado}: ${/PRESTAMO_YA_TIENE/.test(rr.error || '') ? 'bloqueado' : 'SIN BLOQUEO'}`)
  }
  anotar('T4 revertir la entrega con préstamo facturado queda bloqueado (despachada y pendiente)', intentos.every(i => i.endsWith('bloqueado')), intentos.join('; '))
}

// Nada debe haber quedado
const [{ n }] = JSON.parse((await sql(`SELECT count(*)::int n FROM public.cuentas_por_cobrar WHERE descripcion LIKE '%tasa principal (USDT) 1108%' OR descripcion LIKE 'Pago al facturar préstamo%' AND creado_en > now() - interval '10 minutes'`)).texto)
anotar('T5 las pruebas no dejaron datos', n === 0, `${n} filas sobrantes`)

const fallas = resultados.filter(r => !r.ok)
console.log(`\nResultado: ${resultados.length - fallas.length}/${resultados.length} OK${fallas.length ? ` — FALLAS: ${fallas.map(f => f.codigo).join(' | ')}` : ''}`)
process.exit(fallas.length ? 1 : 0)
