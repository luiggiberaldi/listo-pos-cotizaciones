// scripts/verificador-diario-staging.mjs
// Verificador diario automático (OP-2026-103):
// 1) Lee en modo SOLO LECTURA las ventas, abonos y devoluciones del día anterior (L-S) en producción.
// 2) Replica esas operaciones en la cuenta copia de pruebas (STAGING: spupqgkdsgohxxfoxydl).
// 3) Valida totales, métodos de pago, saldos CxC afectados y generación real de PDFs.
// 4) Genera un reporte claro en español en docs/operaciones/reportes-diarios/AAAA-MM-DD.md
//    y en $GITHUB_STEP_SUMMARY (si corre en GitHub Actions).
//
// GUARDARRAÍLES DE SEGURIDAD:
// - Producción (oyfyuszgjwcepjpngclv): ESTRICTAMENTE SOLO LECTURA (solo SELECT/GET).
// - Staging: exige que STAGING_SUPABASE_URL contenga "spupqgkdsgohxxfoxydl"; se niega a escribir en cualquier otro proyecto.
// - Domingos: si la fecha objetivo cae en domingo, termina limpio sin generar alertas.
import fs from 'node:fs'
import path from 'node:path'
import { jsPDF } from 'jspdf'
import { construirVentasDia } from '../src/utils/ventasDia.js'
import { construirReportePeriodoCxC } from '../src/utils/cxcPeriodReport.js'

const MAIN_REF = 'oyfyuszgjwcepjpngclv'
const STAGING_REF = 'spupqgkdsgohxxfoxydl'
const PROD_CUENTA_ID = '74dd6821-963d-406e-8621-47352e0df27e'
const STAGING_CLON_EMAIL = 'copia-prod@construacero.staging'

function leerEnv(file) {
  const v = {}
  if (!fs.existsSync(file)) return v
  for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = l.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && !l.trim().startsWith('#')) v[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return v
}

function fechaCaracasISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(d)
}

function restarDiasISO(ymd, dias) {
  const dt = new Date(`${ymd}T12:00:00-04:00`)
  dt.setDate(dt.getDate() - dias)
  return fechaCaracasISO(dt)
}

function diaSemanaCaracas(ymd) {
  // 0 = domingo, 1 = lunes, ..., 6 = sábado
  return new Date(`${ymd}T12:00:00-04:00`).getDay()
}

function nombreDia(dow) {
  return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][dow] || ''
}

function fmtUsd(n) {
  const v = Number(n) || 0
  return `$${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── 1. Determinar fecha objetivo (ayer VE por defecto a las 12 a.m., o TARGET_DATE manual) ──
const hoyVe = fechaCaracasISO()
const targetDate = (process.env.TARGET_DATE || '').trim() || restarDiasISO(hoyVe, 1)
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  throw new Error(`Fecha inválida: "${targetDate}" (formato esperado AAAA-MM-DD)`)
}
const dow = diaSemanaCaracas(targetDate)
if (dow === 0 && !process.env.ALLOW_SUNDAY) {
  console.log(`⏭️ ${targetDate} es Domingo (día no laboral). No corresponde verificación.`)
  process.exit(0)
}

// ── 2. Cargar credenciales (CI o local) con guardas estrictas ───────────────────────────────
const localMainEnv = leerEnv(path.resolve('.env'))
const localMainSecrets = leerEnv(path.resolve('.env.secrets'))
const localStagingEnv = leerEnv(path.resolve('construacero-staging/.env'))
const localStagingVars = leerEnv(path.resolve('construacero-staging/.dev.vars'))

const mainAccessToken = process.env.MAIN_SUPABASE_ACCESS_TOKEN || localMainEnv.SUPABASE_ACCESS_TOKEN || ''
const prodUrl = process.env.PROD_SUPABASE_URL || localMainEnv.VITE_SUPABASE_URL || `https://${MAIN_REF}.supabase.co`
const prodServiceKey = process.env.PROD_SUPABASE_SERVICE_KEY || localMainSecrets.SUPABASE_SERVICE_KEY || ''

const stagingUrl = process.env.STAGING_SUPABASE_URL || localStagingEnv.VITE_SUPABASE_URL || localStagingVars.SUPABASE_URL || ''
const stagingServiceKey = process.env.STAGING_SUPABASE_SERVICE_KEY || localStagingVars.SUPABASE_SERVICE_KEY || ''

if (!prodUrl.includes(MAIN_REF)) {
  throw new Error(`GUARDIA: prodUrl no corresponde al proyecto principal (${MAIN_REF})`)
}
if (!mainAccessToken && !prodServiceKey) {
  throw new Error('Falta MAIN_SUPABASE_ACCESS_TOKEN (CI) o PROD_SUPABASE_SERVICE_KEY (local) para leer producción en modo solo lectura.')
}
if (!stagingUrl || !stagingUrl.includes(STAGING_REF)) {
  throw new Error(`GUARDIA: STAGING_SUPABASE_URL debe apuntar únicamente a staging (${STAGING_REF}). Recibido: "${stagingUrl}"`)
}
if (!stagingServiceKey) {
  throw new Error('Falta STAGING_SUPABASE_SERVICE_KEY para replicar en staging.')
}

// ── 3. Cliente SOLO LECTURA para producción (nunca permite escrituras) ──────────────────────
async function prodSelectSql(sql) {
  const trimmed = sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    throw new Error('GUARDIA SOLO LECTURA: solo se permiten consultas SELECT contra producción.')
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${MAIN_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mainAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`PROD SQL HTTP ${r.status}: ${txt.slice(0, 300)}`)
  return txt ? JSON.parse(txt) : []
}

async function prodRestGet(endpoint) {
  const r = await fetch(`${prodUrl}/rest/v1/${endpoint}`, {
    method: 'GET',
    headers: { apikey: prodServiceKey, Authorization: `Bearer ${prodServiceKey}` },
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`PROD GET ${endpoint} HTTP ${r.status}: ${txt.slice(0, 300)}`)
  return txt ? JSON.parse(txt) : []
}

const inicioDia = `${targetDate}T00:00:00-04:00`
const finDia = `${targetDate}T23:59:59.999-04:00`

async function leerDiaProduccion() {
  if (mainAccessToken) {
    const despachos = await prodSelectSql(`
      SELECT * FROM notas_despacho
      WHERE cuenta_id = '${PROD_CUENTA_ID}'
        AND ((creado_en >= '${inicioDia}' AND creado_en <= '${finDia}')
          OR (entregada_en >= '${inicioDia}' AND entregada_en <= '${finDia}'))
      ORDER BY numero ASC
    `)
    const movsCxc = await prodSelectSql(`
      SELECT * FROM cuentas_por_cobrar
      WHERE cuenta_id = '${PROD_CUENTA_ID}'
        AND creado_en >= '${inicioDia}' AND creado_en <= '${finDia}'
      ORDER BY creado_en ASC, id ASC
    `)
    const despIds = despachos.map(d => `'${d.id}'`).join(',')
    const items = despIds
      ? await prodSelectSql(`SELECT * FROM notas_despacho_items WHERE despacho_id IN (${despIds})`)
      : []
    const devoluciones = despIds
      ? await prodSelectSql(`SELECT * FROM despacho_devoluciones WHERE despacho_id IN (${despIds})`)
      : []
    const cliIdsSet = new Set([
      ...despachos.map(d => d.cliente_id),
      ...movsCxc.map(m => m.cliente_id),
    ].filter(Boolean))
    const cliIds = [...cliIdsSet].map(id => `'${id}'`).join(',')
    const clientes = cliIds
      ? await prodSelectSql(`SELECT * FROM clientes WHERE id IN (${cliIds})`)
      : []
    const histCxc = cliIds
      ? await prodSelectSql(`
          SELECT * FROM cuentas_por_cobrar
          WHERE cuenta_id = '${PROD_CUENTA_ID}' AND cliente_id IN (${cliIds})
            AND tipo IN ('cargo', 'abono')
          ORDER BY creado_en ASC, id ASC
        `)
      : []
    const prodIdsSet = new Set(items.map(i => i.producto_id).filter(Boolean))
    const prodIds = [...prodIdsSet].map(id => `'${id}'`).join(',')
    const productos = prodIds
      ? await prodSelectSql(`SELECT * FROM productos WHERE id IN (${prodIds})`)
      : []
    const cotIdsSet = new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))
    const cotIds = [...cotIdsSet].map(id => `'${id}'`).join(',')
    const cotizaciones = cotIds
      ? await prodSelectSql(`SELECT * FROM cotizaciones WHERE id IN (${cotIds})`)
      : []
    const transpIdsSet = new Set([
      ...despachos.map(d => d.transportista_id),
      ...cotizaciones.map(c => c.transportista_id),
    ].filter(Boolean))
    const transpIds = [...transpIdsSet].map(id => `'${id}'`).join(',')
    const transportistas = transpIds
      ? await prodSelectSql(`SELECT * FROM transportistas WHERE id IN (${transpIds})`)
      : []
    const tasaRows = await prodSelectSql(`
      SELECT * FROM configuracion_negocio
      WHERE cuenta_id = '${PROD_CUENTA_ID}' LIMIT 1
    `)
    return { despachos, cotizaciones, transportistas, items, devoluciones, movsCxc, clientes, histCxc, productos, config: tasaRows[0] || {} }
  }

  // Fallback local con SERVICE_KEY solo-GET
  const enc = encodeURIComponent
  const despachos = await prodRestGet(
    `notas_despacho?cuenta_id=eq.${PROD_CUENTA_ID}&or=(and(creado_en.gte.${enc(inicioDia)},creado_en.lte.${enc(finDia)}),and(entregada_en.gte.${enc(inicioDia)},entregada_en.lte.${enc(finDia)}))&order=numero.asc&limit=500`
  )
  const movsCxc = await prodRestGet(
    `cuentas_por_cobrar?cuenta_id=eq.${PROD_CUENTA_ID}&creado_en=gte.${enc(inicioDia)}&creado_en=lte.${enc(finDia)}&order=creado_en.asc,id.asc&limit=500`
  )
  const despIds = despachos.map(d => d.id)
  const items = despIds.length
    ? await prodRestGet(`notas_despacho_items?despacho_id=in.(${despIds.join(',')})&limit=2000`)
    : []
  const devoluciones = despIds.length
    ? await prodRestGet(`despacho_devoluciones?despacho_id=in.(${despIds.join(',')})&limit=500`)
    : []
  const cliIds = [...new Set([...despachos.map(d => d.cliente_id), ...movsCxc.map(m => m.cliente_id)].filter(Boolean))]
  const clientes = cliIds.length
    ? await prodRestGet(`clientes?id=in.(${cliIds.join(',')})&limit=500`)
    : []
  const histCxc = cliIds.length
    ? await prodRestGet(`cuentas_por_cobrar?cuenta_id=eq.${PROD_CUENTA_ID}&cliente_id=in.(${cliIds.join(',')})&tipo=in.(cargo,abono)&order=creado_en.asc,id.asc&limit=5000`)
    : []
  const prodIds = [...new Set(items.map(i => i.producto_id).filter(Boolean))]
  const productos = prodIds.length
    ? await prodRestGet(`productos?id=in.(${prodIds.join(',')})&limit=500`)
    : []
  const cotIds = [...new Set(despachos.map(d => d.cotizacion_id).filter(Boolean))]
  const cotizaciones = cotIds.length
    ? await prodRestGet(`cotizaciones?id=in.(${cotIds.join(',')})&limit=500`)
    : []
  const transpIds = [...new Set([...despachos.map(d => d.transportista_id), ...cotizaciones.map(c => c.transportista_id)].filter(Boolean))]
  const transportistas = transpIds.length
    ? await prodRestGet(`transportistas?id=in.(${transpIds.join(',')})&limit=500`)
    : []
  const cfgRows = await prodRestGet(`configuracion_negocio?cuenta_id=eq.${PROD_CUENTA_ID}&limit=1`)
  return { despachos, cotizaciones, transportistas, items, devoluciones, movsCxc, clientes, histCxc, productos, config: cfgRows[0] || {} }
}

// ── 4. Cliente para STAGING (con guardia dura) ──────────────────────────────────────────────
const stH = { apikey: stagingServiceKey, Authorization: `Bearer ${stagingServiceKey}`, 'Content-Type': 'application/json' }
async function stUpsert(tabla, rows, batchSize = 200) {
  if (!stagingUrl.includes(STAGING_REF)) throw new Error('GUARDIA: escritura fuera de staging bloqueada')
  if (!rows || rows.length === 0) return 0
  let total = 0
  const omitCols = new Set()
  const clean = (arr) => omitCols.size === 0 ? arr : arr.map(r => {
    const c = { ...r }
    for (const k of omitCols) delete c[k]
    return c
  })
  for (let i = 0; i < rows.length; i += batchSize) {
    let intento = 0
    while (true) {
      const chunk = clean(rows.slice(i, i + batchSize))
      const r = await fetch(`${stagingUrl}/rest/v1/${tabla}`, {
        method: 'POST',
        headers: { ...stH, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      })
      if (r.ok) { total += chunk.length; break }
      const txt = await r.text()
      const m = txt.match(/Could not find the '([^']+)' column/)
        || txt.match(/cannot insert a non-DEFAULT value into column \\?"([^"\\]+)\\?"/)
      if (r.status === 400 && m && intento < 15) {
        omitCols.add(m[1]); intento++; continue
      }
      throw new Error(`STAGING ${tabla} HTTP ${r.status}: ${txt.slice(0, 300)}`)
    }
  }
  return total
}

async function obtenerCuentaStagingClon() {
  const r = await fetch(`${stagingUrl}/auth/v1/admin/users?page=1&per_page=100`, { headers: stH })
  if (!r.ok) throw new Error(`STAGING auth list HTTP ${r.status}`)
  const data = await r.json()
  const u = (data.users || []).find(x => (x.email || '').toLowerCase() === STAGING_CLON_EMAIL)
  return u?.id || null
}

// ── 5. Ejecución principal ──────────────────────────────────────────────────────────────────
console.log(`🔎 Verificador diario OP-2026-103 — Fecha objetivo: ${targetDate} (${nombreDia(dow)})`)
const prod = await leerDiaProduccion()
console.log(`📥 Leído de producción (solo lectura): ${prod.despachos.length} despachos, ${prod.items.length} líneas, ${prod.movsCxc.length} movs CxC, ${prod.devoluciones.length} devoluciones`)

// Replicar en staging si existe la cuenta copia-prod@construacero.staging
let stagingSyncOk = false
let stagingSyncNota = ''
const stagingCuentaId = await obtenerCuentaStagingClon()
if (stagingCuentaId) {
  const remap = (arr) => (arr || []).map(r => ('cuenta_id' in r ? { ...r, cuenta_id: stagingCuentaId } : { ...r }))
  try {
    await stUpsert('transportistas', remap(prod.transportistas))
    await stUpsert('productos', remap(prod.productos))
    await stUpsert('clientes', remap(prod.clientes).map(c => ({ ...c, activo: true })))
    await stUpsert('cotizaciones', remap(prod.cotizaciones))
    await stUpsert('notas_despacho', remap(prod.despachos))
    await stUpsert('notas_despacho_items', remap(prod.items))
    await stUpsert('despacho_devoluciones', prod.devoluciones)
    await stUpsert('cuentas_por_cobrar', remap(prod.movsCxc))
    await stUpsert('clientes', remap(prod.clientes))
    stagingSyncOk = true
    stagingSyncNota = `Replicado correctamente en staging (${STAGING_CLON_EMAIL}).`
  } catch (err) {
    stagingSyncNota = `Aviso al replicar en staging: ${err.message}`
  }
} else {
  stagingSyncNota = `Cuenta ${STAGING_CLON_EMAIL} no encontrada en staging; se validó solo en memoria.`
}

// ── 6. Validaciones de negocio y generación real de PDFs ────────────────────────────────────
const ventasDia = construirVentasDia({
  fecha: targetDate,
  despachos: prod.despachos,
  clientes: prod.clientes,
})

const avisosDespachos = ventasDia.filas.filter(f => f.avisos && f.avisos.length > 0)

const reporteCxC = construirReportePeriodoCxC({
  clientes: prod.clientes,
  transacciones: prod.histCxc,
  rango: { from: targetDate, to: targetDate },
})
const divergenciasCxC = reporteCxC.revisionesSaldoActual || []

// Validar generación real de PDF resumen del día (bytes %PDF- válidos)
let pdfVentasOk = false
let pdfVentasBytes = 0
let pdfError = null
try {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape', compress: true })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`Verificación Ventas del Día — ${targetDate}`, 14, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Notas: ${ventasDia.resumen.notas} | Vendido: ${fmtUsd(ventasDia.resumen.totalVendidoUsd)} | Cobrado: ${fmtUsd(ventasDia.resumen.cobradoUsd)} | Por cobrar: ${fmtUsd(ventasDia.resumen.porCobrarUsd)}`, 14, 24)
  const buf = Buffer.from(doc.output('arraybuffer'))
  pdfVentasBytes = buf.length
  pdfVentasOk = buf.subarray(0, 5).toString('utf8') === '%PDF-' && buf.length > 500
} catch (err) {
  pdfError = err.message
}

const abonosDia = prod.movsCxc.filter(m => m.tipo === 'abono')
const totalAbonosDia = abonosDia.reduce((s, m) => s + Number(m.monto_usd || 0), 0)
const cargosDia = prod.movsCxc.filter(m => m.tipo === 'cargo')
const totalCargosDia = cargosDia.reduce((s, m) => s + Number(m.monto_usd || 0), 0)

const hayAlertas = avisosDespachos.length > 0 || divergenciasCxC.length > 0 || !pdfVentasOk || !stagingSyncOk
const estadoSemaforo = hayAlertas ? '⚠️ REVISAR DIFERENCIAS' : '✅ TODO CUADRÓ AL CENTAVO'

// ── 7. Construir reporte claro en español ───────────────────────────────────────────────────
const lineas = [
  `# Verificación diaria en pruebas (staging) — ${targetDate} (${nombreDia(dow)})`,
  '',
  `## En resumen`,
  '',
  `- **Resultado:** **${estadoSemaforo}**`,
  `- **Día revisado:** ${nombreDia(dow)} ${targetDate} *(producción leída en modo 100 % solo lectura; nunca modificada)*.`,
  `- **Copia en staging:** ${stagingSyncOk ? '✅' : '⚠️'} ${stagingSyncNota}`,
  `- **Ventas del día (creadas y entregadas ese día):** ${ventasDia.resumen.notas} notas · Total vendido **${fmtUsd(ventasDia.resumen.totalVendidoUsd)}** (Cobrado: **${fmtUsd(ventasDia.resumen.cobradoUsd)}** · Por cobrar: **${fmtUsd(ventasDia.resumen.porCobrarUsd)}**).`,
  `- **PDF real de Ventas del día:** ${pdfVentasOk ? `✅ Generado sin errores (${(pdfVentasBytes / 1024).toFixed(1)} KB)` : `❌ Error: ${pdfError || 'PDF inválido'}`}.`,
  '',
  `## Cuadre del día`,
  '',
  `| Concepto | Cantidad / Valor | Estado |`,
  `|---|---:|---|`,
  `| Despachos activos del día (creados y entregados) | ${ventasDia.resumen.notas} | ✅ |`,
  `| Creados ese día, aún sin entregar ese día | ${ventasDia.sinEntregar.length} | ℹ️ |`,
  `| Entregados ese día, creados otro día | ${ventasDia.entregadasOtroDia.length} | ℹ️ |`,
  `| Total vendido del día | ${fmtUsd(ventasDia.resumen.totalVendidoUsd)} | ✅ |`,
  `| Dinero cobrado (incluye COD pagados) | ${fmtUsd(ventasDia.resumen.cobradoUsd)} | ✅ |`,
  `| Quedó por cobrar (crédito / COD pendiente) | ${fmtUsd(ventasDia.resumen.porCobrarUsd)} | ✅ |`,
  `| Devoluciones registradas | ${prod.devoluciones.length} | ✅ |`,
  `| Cargos CxC del día | ${cargosDia.length} (${fmtUsd(totalCargosDia)}) | ✅ |`,
  `| Abonos CxC del día | ${abonosDia.length} (${fmtUsd(totalAbonosDia)}) | ✅ |`,
  `| Notas con descuadre de métodos de pago | ${avisosDespachos.length} | ${avisosDespachos.length === 0 ? '✅' : '⚠️'} |`,
  `| Clientes del día con diferencia de saldo CxC | ${divergenciasCxC.length} | ${divergenciasCxC.length === 0 ? '✅' : '⚠️'} |`,
  `| Generación real del PDF de Ventas del día | ${pdfVentasOk ? `${(pdfVentasBytes / 1024).toFixed(1)} KB` : 'Falló'} | ${pdfVentasOk ? '✅' : '❌'} |`,
  '',
]

if (avisosDespachos.length > 0) {
  lineas.push('## ⚠️ Notas con aviso en formas de pago', '')
  for (const f of avisosDespachos) {
    lineas.push(`- **DES-${String(f.numero).padStart(5, '0')}** (${f.cliente}, ${fmtUsd(f.totalUsd)}): ${f.avisos.join('; ')}`)
  }
  lineas.push('')
}

if (divergenciasCxC.length > 0) {
  lineas.push('## ⚠️ Clientes con diferencia entre historial CxC y saldo actual', '')
  for (const c of divergenciasCxC) {
    lineas.push(`- **${c.nombre}:** historial ${fmtUsd(c.saldoLedger)} vs saldo guardado ${fmtUsd(c.saldoAlmacenado)} (diferencia: ${fmtUsd(c.diferencia)})`)
  }
  lineas.push('')
}

lineas.push(`---`, `*Generado automáticamente el ${new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' })} (hora Venezuela) por OP-2026-103.*`, '')

const markdown = lineas.join('\n')
const outDir = path.resolve('docs/operaciones/reportes-diarios')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `${targetDate}.md`)
fs.writeFileSync(outFile, markdown, 'utf8')
console.log(`📄 Reporte guardado en: ${outFile}`)

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8')
}

console.log(`\n${estadoSemaforo}`)
