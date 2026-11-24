// OP-2026-061 — Prueba en STAGING: ¿la base avisa a las pantallas cuando cambia un abono o un cliente?
// Escucha los avisos como lo hace la app y "toca" un movimiento y un cliente sin cambiar nada
// (vuelve a guardar el mismo texto). No modifica datos. Nunca se usa contra producción.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const RAIZ = 'C:/Users/luigg/Desktop/construacero/construacero-staging/'
const leer = (f) => Object.fromEntries(readFileSync(RAIZ + f, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]))
const env = { ...leer('.env'), ...leer('.dev.vars') }
const url = env.VITE_SUPABASE_URL
if (!url.includes('spupqgkdsgohxxfoxydl')) throw new Error('No es staging: me detengo')
const sb = createClient(url, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const recibidos = []
const ch = sb.channel('prueba-op061')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'cuentas_por_cobrar' }, p => recibidos.push('cuentas_por_cobrar:' + p.eventType))
  .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, p => recibidos.push('clientes:' + p.eventType))
await new Promise((ok, mal) => { ch.subscribe(s => { if (s === 'SUBSCRIBED') ok(); if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') mal(new Error(s)) }); setTimeout(() => mal(new Error('sin conexión')), 15000) })
await new Promise(r => setTimeout(r, 1500))

const { data: mov } = await sb.from('cuentas_por_cobrar').select('id, descripcion, cliente_id').order('creado_en', { ascending: false }).limit(1).single()
await sb.from('cuentas_por_cobrar').update({ descripcion: mov.descripcion }).eq('id', mov.id)
const { data: cli } = await sb.from('clientes').select('id, nombre').eq('id', mov.cliente_id).single()
await sb.from('clientes').update({ nombre: cli.nombre }).eq('id', cli.id)

await new Promise(r => setTimeout(r, 6000))
await sb.removeChannel(ch)
console.log('Avisos recibidos:', recibidos)
console.log(recibidos.some(r => r.startsWith('cuentas_por_cobrar')) && recibidos.some(r => r.startsWith('clientes')) ? 'RESULTADO: OK' : 'RESULTADO: FALLA')
process.exit(0)
