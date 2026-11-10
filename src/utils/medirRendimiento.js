// src/utils/medirRendimiento.js
// Mide cuánto tardan las llamadas al servidor (solo ruta, método, tiempo y estado: sin datos de
// clientes ni parámetros) y manda un resumen cada 5 minutos a los logs del sistema (info/RENDIMIENTO).
import { logClientError } from './errorLogger'

const INTERVALO_MS = 5 * 60 * 1000
const MAX_MUESTRAS = 500
const MAX_RUTAS = 50

let muestras = []
let iniciado = false

// /api/despachos/123e4567-...?x=1  ->  /api/despachos/:id
export function normalizarRuta(path) {
  return String(path || '')
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
}

// Consultas directas a la base desde el navegador: /rest/v1/clientes -> db:clientes,
// /rest/v1/rpc/buscar_productos -> db:rpc/buscar_productos. Solo el nombre: sin filtros ni ids.
export function rutaBaseDatos(pathname) {
  return `db:${normalizarRuta(pathname).replace(/^\/rest\/v1\//, '')}`
}

// Lee la cabecera Server-Timing del Worker: app = tiempo total en el servidor, auth = verificación
// de cuenta + PIN, cuenta = consulta al servidor de autenticación. Ignora las de otros proxies.
export function leerServerTiming(valor) {
  const out = {}
  for (const parte of String(valor || '').split(',')) {
    const m = /^\s*(app|auth|cuenta)\s*;(?:.*;)?\s*dur=([\d.]+)/i.exec(parte)
    if (m && out[m[1]] === undefined) out[m[1]] = Math.round(Number(m[2]))
  }
  return out
}

export function registrarLlamada(path, metodo, ms, estado, serverTiming) {
  if (!Number.isFinite(ms)) return
  if (muestras.length >= MAX_MUESTRAS) muestras.shift()
  const st = leerServerTiming(serverTiming)
  muestras.push({ ruta: normalizarRuta(path), metodo: String(metodo || 'GET').toUpperCase(), ms: Math.round(ms), estado, srv: st.app, auth: st.auth, cuenta: st.cuenta })
  iniciar()
}

const p50De = (lista, campo) => {
  const v = lista.map(x => x[campo]).filter(Number.isFinite).sort((a, b) => a - b)
  return v.length ? percentil(v, 0.5) : undefined
}

const percentil = (ordenados, p) => ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))]

export function resumir(lista) {
  const grupos = new Map()
  for (const m of lista) {
    const k = `${m.metodo} ${m.ruta}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k).push(m)
  }
  return [...grupos.entries()]
    .map(([ruta, ms]) => {
      const t = ms.map(x => x.ms).sort((a, b) => a - b)
      const r = { ruta, n: t.length, p50: percentil(t, 0.5), p95: percentil(t, 0.95), max: t[t.length - 1], errores: ms.filter(x => !(x.estado >= 200 && x.estado < 400)).length }
      // Desglose (solo si el servidor lo envió): servidor, verificación de sesión y consulta de cuenta
      const srv = p50De(ms, 'srv'), auth = p50De(ms, 'auth'), cuenta = p50De(ms, 'cuenta')
      if (srv !== undefined) r.srv_p50 = srv
      if (auth !== undefined) r.auth_p50 = auth
      if (cuenta !== undefined) r.cuenta_p50 = cuenta
      return r
    })
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, MAX_RUTAS)
}

export function enviarResumen() {
  if (!muestras.length) return
  const lista = muestras
  muestras = []
  logClientError({ nivel: 'info', categoria: 'RENDIMIENTO', mensaje: `Tiempos de ${lista.length} llamadas`, meta: { resumen: resumir(lista) } })
}

function iniciar() {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true
  setInterval(enviarResumen, INTERVALO_MS)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') enviarResumen() })
}
