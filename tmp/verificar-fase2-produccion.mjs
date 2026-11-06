// SOLO LECTURA en producción: comprueba que traer la categoría junto con los artículos
// (consulta nueva) da LO MISMO que pedirla aparte (consulta vieja), y que se hace en menos pasos.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { leerTodasLasPaginas } from '../src/utils/leerPaginas.js'

const e = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!e.VITE_SUPABASE_URL.includes('oyfyuszgjwcepjpngclv')) throw new Error('no es producción')
const sb = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) process.exitCode = 1 }
const lotes = (a, n = 50) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

for (const [n, f, t] of [['Mes pasado', '2026-10-01', '2026-10-31'], ['Ago–Oct', '2026-08-01', '2026-10-31']]) {
  const desp = await leerTodasLasPaginas((d, h) => sb.rpc('obtener_reporte_ventas_operaciones', { p_fecha_inicio: f, p_fecha_fin: t, p_vendedor_id: null })
    .order('fecha', { ascending: false }).order('despacho_id').range(d, h))
  const ids = [...new Set(desp.map(d => d.despacho_id))]
  const t0 = Date.now()
  const nuevo = (await Promise.all(lotes(ids).map(b => sb.from('notas_despacho_items')
    .select('despacho_id, producto_id, total_linea_usd, cantidad, producto:productos(categoria)').in('despacho_id', b)))).flatMap(r => { if (r.error) throw r.error; return r.data })
  const tNuevo = Date.now() - t0
  const t1 = Date.now()
  const viejo = (await Promise.all(lotes(ids).map(b => sb.from('notas_despacho_items')
    .select('despacho_id, producto_id, total_linea_usd, cantidad').in('despacho_id', b)))).flatMap(r => r.data)
  const pids = [...new Set(viejo.map(i => i.producto_id).filter(Boolean))]
  const cats = {}
  for (const b of lotes(pids)) (await sb.from('productos').select('id, categoria').in('id', b)).data.forEach(p => { cats[p.id] = p.categoria || '' })
  const tViejo = Date.now() - t1
  const agr = (lista, fc) => { const m = {}; lista.forEach(i => { const c = fc(i) || 'PRODUCTOS EXTERNOS'; m[c] = Math.round(((m[c] || 0) + Number(i.total_linea_usd || 0)) * 100) / 100 }); return JSON.stringify(Object.entries(m).sort()) }
  const igual = agr(nuevo, i => i.producto?.categoria) === agr(viejo, i => cats[i.producto_id])
  ok(nuevo.length === viejo.length && igual, `${n}: ${ids.length} ventas, ${nuevo.length} artículos; categorías y totales IDÉNTICOS (nuevo ${tNuevo} ms en 1 paso · viejo ${tViejo} ms en 2 pasos)`)
  const sinArt = desp.filter(d => !nuevo.some(i => i.despacho_id === d.despacho_id)).length
  console.log(`   · ventas sin artículos propios (las únicas que piden artículos de cotización): ${sinArt}`)
}
