// src/components/tester/TesterPanel.jsx
// Panel integrado de testing — determinista + stress + rendimiento
// Con logs detallados y copiables en todos los paneles
import { useState, useRef, useCallback } from 'react'
import {
  Database, Zap, Play, Trash2, CheckCircle, AlertCircle, Clock,
  Activity, BarChart3, Search, Layers, Gauge, RefreshCw, Copy, Check,
  ChevronDown, ChevronUp, Terminal,
} from 'lucide-react'
import supabase from '../../services/supabase/client'
import { apiUrl } from '../../services/apiBase'

// ── Helpers ─────────────────────────────────────────────────────────────────
async function getAuthToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

/**
 * Fetch al worker. Devuelve siempre { data, log } donde log puede venir del backend.
 * En caso de error, lanza un TesterError con .log adjunto.
 */
class TesterError extends Error {
  constructor(message, log = []) {
    super(message)
    this.log = log
  }
}

async function testerFetch(path, method = 'POST', body = null) {
  const token = await getAuthToken()
  if (!token) throw new TesterError('No autenticado')
  const res = await fetch(apiUrl(`/api/admin/tester/${path}`), {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json()
  if (!res.ok) throw new TesterError(data.error || `Error ${res.status}`, data.log || [])
  return data
}

function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function StatusBadge({ status }) {
  if (status === 'running') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700"><RefreshCw size={11} className="animate-spin" />Ejecutando</span>
  if (status === 'ok') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700"><CheckCircle size={11} />Completado</span>
  if (status === 'error') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"><AlertCircle size={11} />Error</span>
  return null
}

function MetricCard({ label, value, unit, icon: Icon, color = 'slate' }) {
  const colors = {
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  }
  return (
    <div className={`rounded-xl border p-3 ${colors[color]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon size={12} />}
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</span>
      </div>
      <div className="text-lg font-black">
        {value}{unit && <span className="text-xs font-semibold ml-0.5 opacity-60">{unit}</span>}
      </div>
    </div>
  )
}

// ── LogConsole: Componente reutilizable de logs copiables ─────────────────
function LogConsole({ logs = [], title = 'Log de ejecución' }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!logs || logs.length === 0) return null

  const logText = logs.map(l => {
    if (typeof l === 'string') return l
    const ts = l.ts != null ? `[${fmtMs(l.ts)}]` : ''
    return `${ts} ${l.msg}`
  }).join('\n')

  function handleCopy() {
    // Fallback para iframes donde navigator.clipboard no funciona
    try {
      const ta = document.createElement('textarea')
      ta.value = logText
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Intentar API moderna como fallback
      navigator.clipboard?.writeText(logText).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  const displayLogs = expanded ? logs : logs.slice(0, 8)
  const hasMore = logs.length > 8

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-900 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-slate-400" />
          <span className="text-[11px] font-semibold text-slate-300">{title}</span>
          <span className="text-[10px] text-slate-500">{logs.length} entradas</span>
        </div>
        <button onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all hover:bg-slate-700 text-slate-400 hover:text-slate-200">
          {copied ? <><Check size={10} className="text-emerald-400" /> Copiado</> : <><Copy size={10} /> Copiar</>}
        </button>
      </div>
      <div className="px-3 py-2 max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-0.5">
        {displayLogs.map((l, i) => {
          const isError = typeof l === 'string' ? l.toLowerCase().includes('error') || l.startsWith('✗') : (l.msg || '').toLowerCase().includes('error') || (l.msg || '').startsWith('✗')
          const isSuccess = typeof l === 'string' ? l.startsWith('✓') : (l.msg || '').startsWith('✓')
          const color = isError ? 'text-red-400' : isSuccess ? 'text-emerald-400' : 'text-slate-300'

          if (typeof l === 'string') {
            return <div key={i} className={color}>{l}</div>
          }
          return (
            <div key={i} className="flex gap-2">
              {l.ts != null && <span className="text-slate-500 flex-shrink-0">[{fmtMs(l.ts)}]</span>}
              <span className={color}>{l.msg}</span>
            </div>
          )
        })}
        {hasMore && !expanded && (
          <button onClick={() => setExpanded(true)}
            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-[10px] font-semibold mt-1">
            <ChevronDown size={10} /> Ver {logs.length - 8} más
          </button>
        )}
        {hasMore && expanded && (
          <button onClick={() => setExpanded(false)}
            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-[10px] font-semibold mt-1">
            <ChevronUp size={10} /> Colapsar
          </button>
        )}
      </div>
    </div>
  )
}

// ── Sub-panel: Tester Determinista ──────────────────────────────────────────
function TesterDeterminista() {
  const [status, setStatus] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])

  async function runSeed() {
    setStatus('running'); setResult(null); setError(null); setLogs([])
    try {
      const data = await testerFetch('seed-demo', 'POST')
      setResult(data)
      setLogs(data.log || [])
      setStatus('ok')
    } catch (e) {
      setError(e.message)
      setLogs(e.log || [{ msg: e.message }])
      setStatus('error')
    }
  }

  async function clearAll() {
    setStatus('running'); setResult(null); setError(null); setLogs([])
    try {
      const data = await testerFetch('clear-all', 'DELETE')
      setResult({ ok: true, resumen: { mensaje: 'Todos los datos borrados' } })
      setLogs(data.log || [{ msg: '✓ Todos los datos borrados' }])
      setStatus('ok')
    } catch (e) {
      setError(e.message)
      setLogs(e.log || [{ msg: e.message }])
      setStatus('error')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50 border border-blue-200">
          <Database size={15} className="text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Tester Determinista</h3>
          <p className="text-xs text-slate-500">Carga datos demo de ferretería (30 productos, 13 clientes, 6 cotizaciones)</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={runSeed} disabled={status === 'running'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #1B365D, #2563eb)' }}>
          {status === 'running' ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
          Ejecutar Seed Demo
        </button>
        <button onClick={clearAll} disabled={status === 'running'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-all disabled:opacity-50">
          <Trash2 size={14} />
          Limpiar Todo
        </button>
        {status && <StatusBadge status={status} />}
      </div>

      {result?.resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Object.entries(result.resumen).filter(([k]) => k !== 'mensaje').map(([k, v]) => (
            <MetricCard key={k} label={k} value={v} color="blue" />
          ))}
          {result.elapsed_ms && <MetricCard label="Tiempo" value={fmtMs(result.elapsed_ms)} icon={Clock} color="slate" />}
        </div>
      )}
      {result?.resumen?.mensaje && (
        <p className="text-sm text-emerald-600 font-medium">{result.resumen.mensaje}</p>
      )}
      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      <LogConsole logs={logs} title="Log — Seed Demo" />
    </div>
  )
}

// ── Sub-panel: Stress Test ──────────────────────────────────────────────────
function TesterStress() {
  const [level, setLevel] = useState('medium')
  const [status, setStatus] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [logs, setLogs] = useState([])

  async function runStress() {
    setStatus('running'); setResult(null); setError(null); setLogs([])
    try {
      const data = await testerFetch('stress-seed', 'POST', { level })
      setResult(data)
      setLogs(data.log || [])
      setStatus('ok')
    } catch (e) {
      setError(e.message)
      setLogs(e.log || [{ msg: e.message }])
      setStatus('error')
    }
  }

  const LEVEL_INFO = {
    small:  '100 prod, 50 cli, 200 cot',
    medium: '300 prod, 150 cli, 500 cot',
    large:  '500 prod, 300 cli, 1000 cot',
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50 border border-amber-200">
          <Zap size={15} className="text-amber-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Stress Test de Datos</h3>
          <p className="text-xs text-slate-500">Genera datos masivos para probar rendimiento con volumen</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-slate-100 p-0.5 rounded-xl">
          {Object.keys(LEVEL_INFO).map(l => (
            <button key={l} onClick={() => setLevel(l)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${level === l ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {l.charAt(0).toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">{LEVEL_INFO[level]}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={runStress} disabled={status === 'running'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #B8860B, #d97706)' }}>
          {status === 'running' ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
          Ejecutar Stress Test
        </button>
        {status && <StatusBadge status={status} />}
      </div>

      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {Object.entries(result.resumen).map(([k, v]) => (
              <MetricCard key={k} label={k} value={v.toLocaleString()} color="amber" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Tiempo total" value={fmtMs(result.elapsed_ms)} icon={Clock} color="slate" />
            <MetricCard label="Throughput" value={result.throughput?.toLocaleString()} unit="reg/s" icon={Gauge} color={result.throughput > 100 ? 'emerald' : result.throughput > 50 ? 'amber' : 'red'} />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      <LogConsole logs={logs} title="Log — Stress Test" />
    </div>
  )
}

// ── Sub-panel: Performance en navegador ─────────────────────────────────────
function TesterRendimiento() {
  const [status, setStatus] = useState(null)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState('')
  const [logs, setLogs] = useState([])

  function addLog(msg) {
    setLogs(prev => [...prev, { ts: Math.round(performance.now()), msg }])
  }

  async function timeQuery(label, fn) {
    const start = performance.now()
    const res = await fn()
    const ms = performance.now() - start
    const rows = res?.data?.length ?? 0
    const count = res?.count ?? null
    const err = res?.error
    if (err) {
      addLog(`  ✗ ${label}: ERROR ${err.code || ''} ${err.message} (${Math.round(ms)}ms)`)
    } else {
      addLog(`  ✓ ${label}: ${Math.round(ms)}ms | ${count != null ? `count=${count}` : `${rows} filas`} | status=${res.status ?? 200}`)
    }
    return { label, ms, result: res }
  }

  async function runPerf() {
    setStatus('running'); setResults(null); setError(null); setLogs([])
    const startTime = performance.now()
    const metrics = []

    try {
      addLog('=== TEST DE RENDIMIENTO — Inicio ===')
      addLog(`Fecha/hora: ${new Date().toISOString()}`)
      addLog(`User Agent: ${navigator.userAgent}`)
      addLog(`URL: ${window.location.href}`)
      addLog(`Viewport: ${window.innerWidth}x${window.innerHeight}`)
      addLog(`devicePixelRatio: ${window.devicePixelRatio}`)
      addLog(`Conexión: ${navigator.connection?.effectiveType || 'desconocida'} (downlink: ${navigator.connection?.downlink ?? '?'}Mbps, rtt: ${navigator.connection?.rtt ?? '?'}ms)`)

      // 1. Métricas DOM
      addLog('--- Fase 1: Análisis DOM ---')
      setProgress('Analizando DOM...')
      const domNodes = document.querySelectorAll('*').length
      let maxDepth = 0
      const walk = (el, d) => { maxDepth = Math.max(maxDepth, d); for (const c of el.children) walk(c, d + 1) }
      walk(document.documentElement, 0)
      const bodyChildren = document.body.children.length
      const forms = document.querySelectorAll('form').length
      const inputs = document.querySelectorAll('input,select,textarea').length
      const images = document.querySelectorAll('img').length
      const svgs = document.querySelectorAll('svg').length
      metrics.push({ category: 'DOM', label: 'Nodos DOM', value: domNodes, unit: '', threshold: 1500 })
      metrics.push({ category: 'DOM', label: 'Profundidad DOM', value: maxDepth, unit: 'niveles', threshold: 32 })
      addLog(`  Nodos totales: ${domNodes}`)
      addLog(`  Profundidad máxima: ${maxDepth}`)
      addLog(`  Body hijos directos: ${bodyChildren} | Forms: ${forms} | Inputs: ${inputs} | Imgs: ${images} | SVGs: ${svgs}`)

      // 2. Memory
      addLog('--- Fase 2: Memoria ---')
      if (performance.memory) {
        const usedMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)
        const totalMB = (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2)
        const limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0)
        const pct = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1)
        metrics.push({ category: 'Memoria', label: 'JS Heap usado', value: Math.round(+usedMB), unit: 'MB', threshold: 50 })
        metrics.push({ category: 'Memoria', label: 'JS Heap total', value: Math.round(+totalMB), unit: 'MB' })
        addLog(`  JS Heap usado: ${usedMB}MB / total asignado: ${totalMB}MB / límite: ${limitMB}MB (${pct}% del límite)`)
      } else {
        addLog('  ⚠ performance.memory no disponible (solo Chrome con flag)')
      }

      // 3. Paint timing
      addLog('--- Fase 3: Web Vitals (Paint & Navigation) ---')
      const paints = performance.getEntriesByType('paint')
      if (paints.length === 0) addLog('  ⚠ No hay entradas de paint (¿página cargada hace mucho?)')
      for (const p of paints) {
        addLog(`  ${p.name}: ${Math.round(p.startTime)}ms`)
        if (p.name === 'first-contentful-paint') {
          metrics.push({ category: 'Renderizado', label: 'FCP', value: Math.round(p.startTime), unit: 'ms', threshold: 1800 })
        }
      }

      // 4. Navigation timing
      const navEntries = performance.getEntriesByType('navigation')
      if (navEntries.length) {
        const nav = navEntries[0]
        metrics.push({ category: 'Renderizado', label: 'TTFB', value: Math.round(nav.responseStart), unit: 'ms', threshold: 800 })
        metrics.push({ category: 'Renderizado', label: 'DOM Interactive', value: Math.round(nav.domInteractive), unit: 'ms', threshold: 3000 })
        metrics.push({ category: 'Renderizado', label: 'DOM Complete', value: Math.round(nav.domComplete), unit: 'ms', threshold: 5000 })
        addLog(`  DNS: ${Math.round(nav.domainLookupEnd - nav.domainLookupStart)}ms | TCP: ${Math.round(nav.connectEnd - nav.connectStart)}ms | SSL: ${Math.round((nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0))}ms`)
        addLog(`  TTFB: ${Math.round(nav.responseStart)}ms | Response: ${Math.round(nav.responseEnd - nav.responseStart)}ms`)
        addLog(`  DOM Interactive: ${Math.round(nav.domInteractive)}ms | DOM Content Loaded: ${Math.round(nav.domContentLoadedEventEnd)}ms | DOM Complete: ${Math.round(nav.domComplete)}ms`)
        addLog(`  Load Event: ${Math.round(nav.loadEventEnd)}ms | Redirect Count: ${nav.redirectCount} | Transfer Size: ${Math.round((nav.transferSize || 0) / 1024)}KB`)
        addLog(`  Protocol: ${nav.nextHopProtocol || 'N/A'} | Type: ${nav.type}`)
      } else {
        addLog('  ⚠ No hay navigation entries')
      }

      // 5. Resource timing (bundle sizes)
      addLog('--- Fase 4: Recursos & Bundle ---')
      const resources = performance.getEntriesByType('resource')
      addLog(`  Total recursos cargados: ${resources.length}`)
      const jsResources = resources.filter(r => r.initiatorType === 'script')
      const cssResources = resources.filter(r => r.initiatorType === 'link' || r.name.endsWith('.css'))
      const imgResources = resources.filter(r => r.initiatorType === 'img')
      const fetchResources = resources.filter(r => r.initiatorType === 'fetch' || r.initiatorType === 'xmlhttprequest')
      const totalJsKB = Math.round(jsResources.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024)
      const totalCssKB = Math.round(cssResources.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024)
      const totalImgKB = Math.round(imgResources.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024)
      metrics.push({ category: 'Bundle', label: 'JS transferido', value: totalJsKB, unit: 'KB', threshold: 500 })
      metrics.push({ category: 'Bundle', label: 'CSS transferido', value: totalCssKB, unit: 'KB', threshold: 100 })
      metrics.push({ category: 'Bundle', label: 'Archivos JS', value: jsResources.length, unit: '' })
      addLog(`  JS: ${jsResources.length} archivos, ${totalJsKB}KB transferidos`)
      addLog(`  CSS: ${cssResources.length} archivos, ${totalCssKB}KB transferidos`)
      addLog(`  Imágenes: ${imgResources.length} archivos, ${totalImgKB}KB transferidos`)
      addLog(`  Fetch/XHR: ${fetchResources.length} peticiones`)
      // Top 5 JS más grandes
      const topJs = [...jsResources].sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0)).slice(0, 5)
      if (topJs.length) {
        addLog('  Top 5 JS más grandes:')
        for (const r of topJs) {
          const name = r.name.split('/').pop().split('?')[0]
          addLog(`    ${name}: ${Math.round((r.transferSize || 0) / 1024)}KB (${Math.round(r.duration)}ms)`)
        }
      }

      // 6. Query performance — Supabase
      addLog('--- Fase 5: Queries Supabase ---')
      setProgress('Probando queries Supabase...')

      const q1 = await timeQuery('SELECT productos (limit 100)', () => supabase.from('productos').select('id,nombre,codigo,precio_usd').limit(100))
      metrics.push({ category: 'Queries', label: 'Listar productos (100)', value: Math.round(q1.ms), unit: 'ms', threshold: 1000 })

      const q2 = await timeQuery('SELECT clientes (limit 100)', () => supabase.from('clientes').select('id,nombre,rif_cedula').limit(100))
      metrics.push({ category: 'Queries', label: 'Listar clientes (100)', value: Math.round(q2.ms), unit: 'ms', threshold: 1000 })

      const q3 = await timeQuery('SELECT cotizaciones + JOIN clientes (limit 100)', () => supabase.from('cotizaciones').select('id,numero,estado,total_usd,cliente:clientes(nombre)').limit(100))
      metrics.push({ category: 'Queries', label: 'Listar cotizaciones (100)', value: Math.round(q3.ms), unit: 'ms', threshold: 1500 })

      const q4 = await timeQuery('COUNT productos (exact)', () => supabase.from('productos').select('id', { count: 'exact', head: true }))
      metrics.push({ category: 'Queries', label: 'Count productos', value: Math.round(q4.ms), unit: 'ms', threshold: 500, extra: q4.result?.count })

      const q5 = await timeQuery('COUNT cotizaciones (exact)', () => supabase.from('cotizaciones').select('id', { count: 'exact', head: true }))
      metrics.push({ category: 'Queries', label: 'Count cotizaciones', value: Math.round(q5.ms), unit: 'ms', threshold: 500, extra: q5.result?.count })

      addLog(`  Volumen actual: ~${q4.result?.count ?? '?'} productos, ~${q5.result?.count ?? '?'} cotizaciones`)

      // 7. Search performance
      addLog('--- Fase 6: Búsqueda (RPC obtener_productos_vendedor) ---')
      setProgress('Probando búsqueda...')

      const q6 = await timeQuery('RPC buscar "cemento"', () => supabase.rpc('obtener_productos_vendedor', { p_busqueda: 'cemento' }))
      metrics.push({ category: 'Búsqueda', label: 'Buscar "cemento"', value: Math.round(q6.ms), unit: 'ms', threshold: 500 })

      const q7 = await timeQuery('RPC buscar "tornillo drywall"', () => supabase.rpc('obtener_productos_vendedor', { p_busqueda: 'tornillo drywall' }))
      metrics.push({ category: 'Búsqueda', label: 'Buscar "tornillo drywall"', value: Math.round(q7.ms), unit: 'ms', threshold: 500 })

      const q8 = await timeQuery('RPC buscar "xyznonexistent999"', () => supabase.rpc('obtener_productos_vendedor', { p_busqueda: 'xyznonexistent999' }))
      metrics.push({ category: 'Búsqueda', label: 'Buscar inexistente', value: Math.round(q8.ms), unit: 'ms', threshold: 500 })

      // 8. Aggregate query
      addLog('--- Fase 7: Query pesada (JOIN) ---')
      setProgress('Probando queries pesadas...')

      const q9 = await timeQuery('SELECT cotizacion_items + JOIN productos (limit 500)', () =>
        supabase.from('cotizacion_items').select('id,cantidad,total_linea_usd,producto:productos(nombre,categoria)').limit(500))
      metrics.push({ category: 'Queries', label: 'Items + join (500)', value: Math.round(q9.ms), unit: 'ms', threshold: 2000 })

      // Score
      addLog('--- Fase 8: Cálculo de Score ---')
      let score = 100
      const alerts = []
      for (const m of metrics) {
        if (m.threshold && m.value > m.threshold) {
          const severity = m.value > m.threshold * 2 ? 10 : 5
          score -= severity
          alerts.push({ label: m.label, value: m.value, unit: m.unit, threshold: m.threshold, severity: m.value > m.threshold * 2 ? 'critical' : 'warning' })
          addLog(`  ⚠ ${m.label}: ${m.value}${m.unit} excede umbral ${m.threshold}${m.unit} (${m.value > m.threshold * 2 ? '-10 CRITICAL' : '-5 WARNING'})`)
        }
      }
      score = Math.max(0, score)

      const totalMs = Math.round(performance.now() - startTime)
      addLog('--- Resumen final ---')
      addLog(`  Métricas recolectadas: ${metrics.length}`)
      addLog(`  Alertas: ${alerts.length} (${alerts.filter(a => a.severity === 'critical').length} críticas, ${alerts.filter(a => a.severity === 'warning').length} warnings)`)
      addLog(`  Score: ${score}/100`)
      addLog(`  Duración total del test: ${totalMs}ms`)
      addLog(`✓ TEST DE RENDIMIENTO completado`)

      setResults({ metrics, score, alerts, timestamp: new Date().toISOString() })
      setStatus('ok')
      setProgress('')
    } catch (e) {
      addLog(`✗ Error: ${e.message}`)
      setError(e.message); setStatus('error'); setProgress('')
    }
  }

  const grouped = results ? Object.groupBy(results.metrics, m => m.category) : {}

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-50 border border-emerald-200">
          <Activity size={15} className="text-emerald-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Test de Rendimiento</h3>
          <p className="text-xs text-slate-500">Mide Web Vitals, queries Supabase, DOM, memoria y búsqueda desde el navegador</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={runPerf} disabled={status === 'running'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
          {status === 'running' ? <RefreshCw size={14} className="animate-spin" /> : <BarChart3 size={14} />}
          Ejecutar Test de Rendimiento
        </button>
        {status && <StatusBadge status={status} />}
        {progress && <span className="text-xs text-slate-500">{progress}</span>}
      </div>

      {results && (
        <div className="space-y-4">
          {/* Score */}
          <div className={`flex items-center gap-3 p-3 rounded-xl border ${
            results.score >= 80 ? 'bg-emerald-50 border-emerald-200' :
            results.score >= 50 ? 'bg-amber-50 border-amber-200' :
            'bg-red-50 border-red-200'
          }`}>
            <Gauge size={20} className={results.score >= 80 ? 'text-emerald-600' : results.score >= 50 ? 'text-amber-600' : 'text-red-600'} />
            <div>
              <span className="text-2xl font-black">{results.score}</span>
              <span className="text-sm font-semibold text-slate-500">/100</span>
              <p className="text-xs text-slate-500">
                {results.score >= 80 ? 'Rendimiento excelente' : results.score >= 50 ? 'Rendimiento aceptable — hay oportunidades de mejora' : 'Rendimiento bajo — requiere optimización'}
              </p>
            </div>
          </div>

          {/* Métricas por categoría */}
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{cat}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {items.map((m, i) => {
                  const overThreshold = m.threshold && m.value > m.threshold
                  const critical = m.threshold && m.value > m.threshold * 2
                  return (
                    <MetricCard
                      key={i}
                      label={m.label}
                      value={m.value?.toLocaleString()}
                      unit={m.unit}
                      color={critical ? 'red' : overThreshold ? 'amber' : 'emerald'}
                    />
                  )
                })}
              </div>
            </div>
          ))}

          {/* Alertas */}
          {results.alerts.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Alertas</h4>
              {results.alerts.map((a, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs font-medium ${a.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>
                  <AlertCircle size={12} />
                  <span>{a.label}: {a.value}{a.unit} (umbral: {a.threshold}{a.unit})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      <LogConsole logs={logs} title="Log — Rendimiento" />
    </div>
  )
}

// ── Panel Principal ─────────────────────────────────────────────────────────
export default function TesterPanel() {
  return (
    <div className="space-y-5">
      <TesterDeterminista />
      <TesterStress />
      <TesterRendimiento />
    </div>
  )
}
