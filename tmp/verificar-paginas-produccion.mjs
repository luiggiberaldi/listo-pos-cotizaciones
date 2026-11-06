// SOLO LECTURA en producción: comprueba que las consultas nuevas (por páginas) traen todo
// y que en períodos cortos devuelven EXACTAMENTE lo mismo que las viejas.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { leerTodasLasPaginas } from '../src/utils/leerPaginas.js'

const e = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!e.VITE_SUPABASE_URL.includes('oyfyuszgjwcepjpngclv')) throw new Error('no es producción')
const sb = createClient(e.VITE_SUPABASE_URL, e.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) process.exitCode = 1 }

const viejo = async (f, t) => { const { data, error } = await sb.rpc('obtener_reporte_ventas_operaciones', { p_fecha_inicio: f, p_fecha_fin: t, p_vendedor_id: null }); if (error) throw error; return data }
const nuevo = (f, t) => leerTodasLasPaginas((d, h) => sb.rpc('obtener_reporte_ventas_operaciones', { p_fecha_inicio: f, p_fecha_fin: t, p_vendedor_id: null })
  .order('fecha', { ascending: false }).order('despacho_id', { ascending: true }).range(d, h))
const suma = l => Math.round(l.reduce((s, d) => s + Number(d.venta_neta_usd || 0), 0) * 100) / 100

for (const [n, f, t] of [['Corte', '2026-10-23', '2026-10-29'], ['Mes pasado', '2026-10-01', '2026-10-31']]) {
  const [a, b] = await Promise.all([viejo(f, t), nuevo(f, t)])
  ok(a.length === b.length && suma(a) === suma(b) && JSON.stringify(a.map(x => x.despacho_id).sort()) === JSON.stringify(b.map(x => x.despacho_id).sort()),
    `${n}: viejo ${a.length} ventas $${suma(a)} = nuevo ${b.length} ventas $${suma(b)} (mismas ventas)`)
}
const { count: reales } = await sb.from('notas_despacho').select('id', { count: 'exact', head: true }).in('estado', ['despachada', 'entregada'])
  .gte('creado_en', '2026-08-01T00:00:00-04:00').lt('creado_en', '2026-11-01T00:00:00-04:00')
const [v3, n3] = await Promise.all([viejo('2026-08-01', '2026-10-31'), nuevo('2026-08-01', '2026-10-31')])
ok(n3.length === reales && new Set(n3.map(x => x.despacho_id)).size === n3.length,
  `Ago–Oct: viejo ${v3.length} ventas ($${suma(v3)}) → nuevo ${n3.length} ventas ($${suma(n3)}); en la base hay ${reales}; sin repetidas`)

// Cotizaciones (tasa de cierre del reporte de vendedores)
const cotViejo = await sb.from('cotizaciones').select('id, vendedor_id, estado').gte('creado_en', '2026-09-01T00:00:00-04:00').lte('creado_en', '2026-10-31T23:59:59-04:00').limit(5000)
const cotNuevo = await leerTodasLasPaginas((d, h) => sb.from('cotizaciones').select('id, vendedor_id, estado').gte('creado_en', '2026-09-01T00:00:00-04:00').lte('creado_en', '2026-10-31T23:59:59-04:00').order('id').range(d, h))
const { count: cotReales } = await sb.from('cotizaciones').select('id', { count: 'exact', head: true }).gte('creado_en', '2026-09-01T00:00:00-04:00').lte('creado_en', '2026-10-31T23:59:59-04:00')
ok(cotNuevo.length === cotReales, `Cotizaciones Sep–Oct: viejo ${cotViejo.data.length} → nuevo ${cotNuevo.length}; en la base hay ${cotReales}`)

// Comisiones: el servidor ahora informa el total real para pedir las páginas que falten
const r = await fetch(`${e.VITE_SUPABASE_URL}/rest/v1/comisiones?select=id,despacho:notas_despacho!inner(creado_en)&despacho.creado_en=gte.2026-05-01T00:00:00-04:00&despacho.creado_en=lte.2026-10-31T23:59:59-04:00&order=creadoen.desc,id.asc`,
  { headers: { apikey: e.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_KEY}`, Range: '0-999', Prefer: 'count=exact' } })
const filas = await r.json()
ok(r.headers.get('content-range')?.includes('/'), `Comisiones May–Oct: llegan ${filas.length} en la 1ª página y el servidor informa el total real (${r.headers.get('content-range')})`)
