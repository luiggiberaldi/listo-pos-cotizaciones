// OP-2026-032 — Ensayo ANTES de publicar, con datos reales de producción (solo lectura).
// Pasa el código nuevo por todas las ventas reales y compara contra lo guardado en la base.
//
// Uso: npx vite-node scripts/ensayo-op032-produccion.mjs <archivo.json>
//   El archivo es la respuesta de una consulta de solo lectura con:
//   despachos (despacho_id, asesor_id, numero, fecha, cliente_dueno), comisiones (despachoid,
//   vendedorid, totalcomision, tipo) y usuarios (id, nombre, rol, activo, es_externo).
import fs from 'node:fs'
import { construirComisionesGuardadas } from '../src/utils/reporteVendedoresComisiones.js'
import { shouldIncludeReporteVendedor } from '../src/utils/reporteVendedoresAccess.js'
import { destinoComision } from '../src/utils/destinoComision.js'

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))[0].json_build_object
const info = Object.fromEntries(d.usuarios.map(u => [u.id, u]))
const r2 = n => Math.round(n * 100) / 100

// ── A) Totales por período: reporte nuevo vs lo guardado en la base ──
const periodos = [['Hoy 18-nov', '2026-11-18', '2026-11-18'], ['Semana 16-18 nov', '2026-11-16', '2026-11-18'], ['Sab 14-nov', '2026-11-14', '2026-11-14']]
for (const m of ['05', '06', '07', '08', '09', '10', '11']) periodos.push([`Mes 2026-${m}`, `2026-${m}-01`, `2026-${m}-31`])
periodos.push(['TODO', '2000-01-01', '2100-01-01'])
let fallasA = 0
console.log('A) TOTAL DE COMISIONES: Reporte de Vendedores nuevo vs guardado en la base')
for (const [nom, desde, hasta] of periodos) {
  const lista = d.despachos.filter(x => x.fecha >= desde && x.fecha <= hasta)
  const ids = new Set(lista.map(x => x.despacho_id))
  const base = r2(d.comisiones.filter(c => ids.has(c.despachoid)).reduce((s, c) => s + Number(c.totalcomision), 0))
  const filas = construirComisionesGuardadas(lista, d.comisiones, info)
  const map = {}
  const get = id => (map[id] ??= { ...(info[id] || { activo: true, rol: 'vendedor', nombre: id }), totalUsd: 0, numDespachos: 0, comisionTotal: 0 })
  for (const x of lista) { const v = get(x.asesor_id); v.numDespachos++; v.totalUsd += 1 }
  for (const f of filas) get(f.vendedorid).comisionTotal += f.totalcomision
  const tot = rol => r2(Object.values(map).filter(v => shouldIncludeReporteVendedor(rol, v)).reduce((s, v) => s + v.comisionTotal, 0))
  const jefe = tot('jefe')
  const sup = tot('supervisor')
  const ocultas = Object.values(map)
    .filter(v => v.comisionTotal > 0.004 && !shouldIncludeReporteVendedor('jefe', v))
    .map(v => `${v.nombre}${v.activo ? '' : ' (inactivo)'} $${r2(v.comisionTotal)}`)
  const ok = jefe === base
  if (!ok) fallasA++
  console.log(`  ${ok ? 'OK ' : 'XX '} ${nom.padEnd(18)} base $${base.toFixed(2).padStart(9)} | jefe $${jefe.toFixed(2).padStart(9)} | supervisor $${sup.toFixed(2).padStart(9)}${ocultas.length ? ' | no visibles: ' + ocultas.join(', ') : ''}`)
}

// ── B) Aviso de comisión (venta rápida / cotización / detalle) vs regla de la base, venta por venta ──
const comPorDesp = {}
for (const c of d.comisiones) (comPorDesp[c.despachoid] ??= []).push(c)
let ok = 0
let sinFila = 0
const fallas = []
for (const x of d.despachos) {
  const dueno = info[x.cliente_dueno]
  const vendedor = info[x.asesor_id]
  if (!dueno || !vendedor) continue
  const destino = destinoComision({ vendedor_id: dueno.id, vendedor: dueno }, vendedor).tipo
  const filas = comPorDesp[x.despacho_id] || []
  if (filas.length === 0) {
    if (destino === 'sin_comision') ok++
    else sinFila++ // sin fila por cobro a destino pendiente, donación, venta antigua, etc.
    continue
  }
  const receptores = new Set(filas.map(c => c.vendedorid))
  let bien
  if (destino === 'sin_comision') bien = false
  else if (destino === 'propio') bien = receptores.has(vendedor.id)
  else bien = receptores.has(dueno.id)
  if (bien) ok++
  else fallas.push(`#${x.numero} vendio ${vendedor.nombre}, dueno ${dueno.nombre} (${dueno.rol}), aviso=${destino}, comision a ${[...receptores].map(i => info[i]?.nombre).join('+')}`)
}
console.log(`\nB) AVISO DE COMISION vs REGLA DE LA BASE (${d.despachos.length} ventas reales)`)
console.log(`  OK  coinciden: ${ok}`)
console.log(`  ..  sin comision guardada por otro motivo (cobro a destino pendiente, donacion, antiguas): ${sinFila}`)
console.log(`  XX  no coinciden: ${fallas.length}`)
fallas.slice(0, 25).forEach(f => console.log('      ' + f))
console.log(`\nRESULTADO: ${fallasA === 0 && fallas.length === 0 ? 'SIN DIFERENCIAS' : 'HAY DIFERENCIAS (revisar arriba)'}`)
