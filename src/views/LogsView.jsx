// src/views/LogsView.jsx
// Panel de logs del sistema + análisis AI + Tests/Health (desarrollador)
import { useState, useEffect } from 'react'
import {
  AlertCircle, AlertTriangle, Info, Download, Trash2, Bot, RefreshCw,
  Filter, ChevronLeft, ChevronRight, Shield, Zap, Bug, Clock,
  Monitor, Server, Database, CheckCircle2, XCircle, Activity, FlaskConical,
} from 'lucide-react'
import { useLogs, useLogStats, useLogAnalysis, useLogPurge } from '../hooks/useLogs'
import { adminAPI, devAPI } from '../services/supabase/adminClient'
import useAuthStore from '../store/useAuthStore'
import PageHeader from '../components/ui/PageHeader'
import ConfirmModal from '../components/ui/ConfirmModal'
import { showToast } from '../components/ui/Toast'

// ── Config ──────────────────────────────────────────────────────────────
const TABS_BASE = [
  { id: 'logs', label: 'Logs', icon: AlertCircle },
  { id: 'ai',   label: 'Análisis AI', icon: Bot },
]

const TABS_DEV = [
  { id: 'tests',  label: 'Tests', icon: FlaskConical },
  { id: 'health', label: 'Health', icon: Activity },
]

const NIVELES = [
  { value: '', label: 'Todos' },
  { value: 'error', label: 'Error', color: '#ef4444' },
  { value: 'warn', label: 'Warning', color: '#f59e0b' },
  { value: 'info', label: 'Info', color: '#3b82f6' },
]

const ORIGENES = [
  { value: '', label: 'Todos' },
  { value: 'frontend', label: 'Frontend', icon: Monitor },
  { value: 'worker', label: 'Worker', icon: Server },
  { value: 'supabase', label: 'Supabase', icon: Database },
]

const NIVEL_CONFIG = {
  error: { icon: AlertCircle, bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', badge: 'bg-red-100 text-red-700' },
  warn:  { icon: AlertTriangle, bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
  info:  { icon: Info, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
}

const AI_AGENTS = [
  {
    tipo: 'errores',
    label: 'Análisis de Errores',
    desc: 'Agrupa errores por causa raíz, identifica patrones y sugiere soluciones',
    icon: Bug,
    gradient: 'from-red-500 to-rose-600',
  },
  {
    tipo: 'mejoras',
    label: 'Recomendaciones de Mejora',
    desc: 'Identifica cuellos de botella y sugiere optimizaciones de UX/rendimiento',
    icon: Zap,
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    tipo: 'seguridad',
    label: 'Auditoría de Seguridad',
    desc: 'Detecta accesos sospechosos y evalúa vulnerabilidades',
    icon: Shield,
    gradient: 'from-blue-500 to-indigo-600',
  },
]

// ── Componentes ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
          <Icon size={18} style={{ color }} />
        </div>
        <div>
          <p className="text-2xl font-black text-slate-800">{value ?? '—'}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  )
}

function LogRow({ log }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = NIVEL_CONFIG[log.nivel] || NIVEL_CONFIG.info
  const Icon = cfg.icon
  const ts = new Date(log.ts)
  const fecha = ts.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })
  const hora = ts.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className={`${cfg.bg} border ${cfg.border} rounded-lg p-3 cursor-pointer transition-all hover:shadow-sm`} onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start gap-2">
        <Icon size={16} className={`${cfg.text} mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>{log.nivel.toUpperCase()}</span>
            {log.categoria && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{log.categoria}</span>}
            <span className="text-xs text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{log.origen}</span>
          </div>
          <p className={`text-sm font-medium ${cfg.text} mt-1 break-words`}>{log.mensaje}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
            <span>{fecha} {hora}</span>
            {log.usuario_nombre && <span>• {log.usuario_nombre}</span>}
            {log.endpoint && <span className="truncate max-w-[200px]">• {log.endpoint}</span>}
          </div>
        </div>
      </div>
      {expanded && log.stack && (
        <pre className="mt-2 text-xs text-slate-600 bg-white/60 border border-slate-200 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">{log.stack}</pre>
      )}
      {expanded && log.meta && Object.keys(log.meta).length > 0 && (
        <pre className="mt-1 text-xs text-slate-500 bg-white/40 border border-slate-100 p-2 rounded overflow-auto max-h-32">{JSON.stringify(log.meta, null, 2)}</pre>
      )}
    </div>
  )
}

function AIAnalysisCard({ agent, onRun, result, isLoading }) {
  const Icon = agent.icon
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className={`bg-gradient-to-r ${agent.gradient} p-4`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
            <Icon size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">{agent.label}</h3>
            <p className="text-white/80 text-xs">{agent.desc}</p>
          </div>
        </div>
      </div>
      <div className="p-4">
        {!result && !isLoading && (
          <button
            onClick={() => onRun(agent.tipo)}
            className="w-full py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
          >
            <Bot size={14} className="inline mr-1.5 -mt-0.5" />
            Ejecutar Análisis
          </button>
        )}
        {isLoading && (
          <div className="flex items-center gap-2 justify-center py-4 text-slate-500">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">Analizando con Groq AI...</span>
          </div>
        )}
        {result && !isLoading && (
          <div className="prose prose-sm max-w-none text-slate-700">
            <div className="text-xs text-slate-400 mb-2 flex items-center gap-2">
              <Clock size={12} />
              {result.logs_count} logs analizados • {result.modelo}
            </div>
            <div
              className="text-sm leading-relaxed whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: formatMarkdown(result.resultado) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function TestSuiteRow({ name, passed, failed, total, tests }) {
  const [expanded, setExpanded] = useState(false)
  const allPassed = failed === 0
  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${allPassed ? 'border-green-100' : 'border-red-200'}`}>
      <div className="p-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(!expanded)}>
        {allPassed ? <CheckCircle2 size={16} className="text-green-500 shrink-0" /> : <XCircle size={16} className="text-red-500 shrink-0" />}
        <span className="text-sm font-medium text-slate-700 flex-1 truncate">{name}</span>
        <span className="text-xs text-slate-400">{passed}/{total}</span>
      </div>
      {expanded && (
        <div className="border-t border-slate-100 px-3 py-2 space-y-1 max-h-60 overflow-auto">
          {tests.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {t.status === 'passed'
                ? <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                : <XCircle size={12} className="text-red-400 shrink-0" />}
              <span className={`${t.status === 'passed' ? 'text-slate-600' : 'text-red-700 font-medium'}`}>{t.title}</span>
              {t.duration != null && <span className="text-slate-400 ml-auto shrink-0">{t.duration.toFixed(1)}ms</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Conversión básica de markdown a HTML
function formatMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4 class="font-bold text-slate-800 mt-3 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-bold text-slate-800 text-base mt-4 mb-1">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="font-black text-slate-900 text-lg mt-4 mb-2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-700 px-1 rounded text-xs">$1</code>')
    .replace(/\n/g, '<br/>')
}

const PURGE_OPTIONS = [
  { dias: 90, label: 'Más de 90 días' },
  { dias: 30, label: 'Más de 30 días' },
  { dias: 7,  label: 'Más de 7 días' },
  { dias: 1,  label: 'Más de 1 día' },
  { dias: 0,  label: 'Todos los logs', danger: true },
]

function PurgeModal({ onConfirm, onClose }) {
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    if (selected === null) return
    setLoading(true)
    try {
      await onConfirm(selected)
    } catch (e) {
      showToast(e.message || 'Error purgando', 'error')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="relative h-20 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #fca5a5, #ef4444)' }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.25)', border: '1.5px solid rgba(255,255,255,0.5)' }}>
            <Trash2 size={22} color="white" />
          </div>
        </div>
        <div className="px-5 pt-4 pb-5">
          <h3 className="text-lg font-black text-slate-800 text-center mb-1">Purgar logs</h3>
          <p className="text-xs text-slate-500 text-center mb-4">Selecciona qué logs eliminar</p>
          <div className="space-y-2 mb-4">
            {PURGE_OPTIONS.map(opt => (
              <button
                key={opt.dias}
                onClick={() => setSelected(opt.dias)}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                  selected === opt.dias
                    ? opt.danger
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {opt.label}
                {opt.danger && selected === opt.dias && (
                  <span className="block text-[10px] text-red-500 mt-0.5">Se borrarán TODOS los registros</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={loading}
              className="flex-1 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl border border-slate-100">
              Cancelar
            </button>
            <button onClick={handleConfirm} disabled={selected === null || loading}
              className="flex-1 py-2.5 text-sm font-bold text-white rounded-xl disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
              {loading && <RefreshCw size={12} className="animate-spin" />}
              Purgar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Vista Principal ──────────────────────────────────────────────────────

export default function LogsView() {
  const { perfil } = useAuthStore()
  const esDesarrollador = perfil?.rol === 'desarrollador'
  const TABS = esDesarrollador ? [...TABS_BASE, ...TABS_DEV] : TABS_BASE

  const [tab, setTab] = useState('logs')
  const [page, setPage] = useState(1)
  const [nivel, setNivel] = useState('')
  const [origen, setOrigen] = useState('')
  const [categoria, setCategoria] = useState('')
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [aiResults, setAiResults] = useState({})
  const [aiLoading, setAiLoading] = useState({})

  // Dev state
  const [testResults, setTestResults] = useState(null)
  const [testsLoading, setTestsLoading] = useState(false)
  const [healthData, setHealthData] = useState(null)
  const [healthLoading, setHealthLoading] = useState(false)

  const { data: logsData, isLoading: logsLoading, refetch, isFetching } = useLogs({ page, limit: 50, nivel: nivel || undefined, origen: origen || undefined, categoria: categoria || undefined })
  const { data: stats, refetch: refetchStats } = useLogStats()
  const purge = useLogPurge()

  const logs = logsData?.logs || []
  const totalPages = logsData?.pages || 1

  async function handleRefresh() {
    await Promise.all([refetch(), refetchStats()])
    showToast('Logs actualizados', 'success')
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      await adminAPI.downloadLogs()
      showToast('Descarga iniciada', 'success')
    } catch (e) { showToast(e.message || 'Error descargando', 'error') }
    setDownloading(false)
  }

  async function handleRunAI(tipo) {
    setAiLoading(prev => ({ ...prev, [tipo]: true }))
    try {
      const result = await adminAPI.analyzeLogs(tipo)
      setAiResults(prev => ({ ...prev, [tipo]: result }))
    } catch (e) {
      setAiResults(prev => ({ ...prev, [tipo]: { resultado: `Error: ${e.message}`, logs_count: 0, modelo: '—' } }))
    }
    setAiLoading(prev => ({ ...prev, [tipo]: false }))
  }

  async function loadTests() {
    setTestsLoading(true)
    try {
      const data = await devAPI.getTestResults()
      setTestResults(data)
    } catch { setTestResults(null) }
    setTestsLoading(false)
  }

  async function runHealthCheck() {
    setHealthLoading(true)
    try {
      const data = await devAPI.healthCheck()
      setHealthData(data)
    } catch (e) {
      setHealthData({ error: e.message })
    }
    setHealthLoading(false)
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        icon={AlertCircle}
        title="System Logs"
        subtitle="Monitoreo de errores y análisis AI del sistema"
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard label="Total logs" value={stats.total} icon={Database} color="#64748b" />
          <StatCard label="Errores hoy" value={stats.erroresHoy} icon={AlertCircle} color="#ef4444" />
          <StatCard label="Warnings hoy" value={stats.warningsHoy} icon={AlertTriangle} color="#f59e0b" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 rounded-xl p-1">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all ${active ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab: Logs */}
      {tab === 'logs' && (
        <div>
          {/* Filters + Actions */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Filter size={14} className="text-slate-400" />
            <select value={nivel} onChange={e => { setNivel(e.target.value); setPage(1) }} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
              {NIVELES.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
            </select>
            <select value={origen} onChange={e => { setOrigen(e.target.value); setPage(1) }} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
              {ORIGENES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="text"
              value={categoria}
              onChange={e => { setCategoria(e.target.value.toUpperCase()); setPage(1) }}
              placeholder="Categoría..."
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-28 bg-white"
            />

            <div className="ml-auto flex gap-2">
              <button onClick={handleRefresh} disabled={isFetching} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1.5 border border-slate-200 rounded-lg bg-white disabled:opacity-50">
                <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Actualizar
              </button>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="text-xs text-white flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold"
                style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
              >
                <Download size={12} /> {downloading ? 'Descargando...' : 'Descargar'}
              </button>
              <button
                onClick={() => setConfirmPurge(true)}
                className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1 px-2 py-1.5 border border-red-200 rounded-lg bg-red-50"
              >
                <Trash2 size={12} /> Purgar
              </button>
            </div>
          </div>

          {/* Log list */}
          {logsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-20 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle size={40} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No hay logs registrados</p>
              <p className="text-xs mt-1">Los errores del sistema aparecerán aquí automáticamente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map(log => <LogRow key={log.id} log={log} />)}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-slate-600 font-medium">
                Página {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab: AI Analysis */}
      {tab === 'ai' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500 mb-2">
            Usa los agentes AI para analizar los logs del sistema. Cada agente se especializa en un área distinta y usa Groq (Llama 3.3 70B) con round-robin de API keys para proteger la cuota.
          </p>
          {AI_AGENTS.map(agent => (
            <AIAnalysisCard
              key={agent.tipo}
              agent={agent}
              onRun={handleRunAI}
              result={aiResults[agent.tipo]}
              isLoading={aiLoading[agent.tipo]}
            />
          ))}

          {/* Top categorías */}
          {stats?.topCategorias?.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-3">Top errores por categoría (7 días)</h3>
              <div className="space-y-2">
                {stats.topCategorias.map(({ categoria: cat, count }) => (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600 w-32 truncate">{cat}</span>
                    <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (count / (stats.topCategorias[0]?.count || 1)) * 100)}%`,
                          background: 'linear-gradient(90deg, #ef4444, #f97316)',
                        }}
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-700 w-8 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Tests (solo desarrollador) */}
      {tab === 'tests' && esDesarrollador && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Resultados de tests automatizados generados en el último build.</p>
            <button
              onClick={loadTests}
              disabled={testsLoading}
              className="text-xs text-white flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold"
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
            >
              {testsLoading ? <RefreshCw size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              {testsLoading ? 'Cargando...' : 'Cargar Tests'}
            </button>
          </div>

          {testResults && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
                  <p className="text-2xl font-black text-slate-800">{testResults.numTotalTests}</p>
                  <p className="text-xs text-slate-500">Total</p>
                </div>
                <div className="bg-white rounded-xl border border-green-100 p-4 shadow-sm text-center">
                  <p className="text-2xl font-black text-green-600">{testResults.numPassedTests}</p>
                  <p className="text-xs text-green-600">Pasaron</p>
                </div>
                <div className="bg-white rounded-xl border border-red-100 p-4 shadow-sm text-center">
                  <p className="text-2xl font-black text-red-600">{testResults.numFailedTests}</p>
                  <p className="text-xs text-red-600">Fallaron</p>
                </div>
                <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
                  <p className="text-2xl font-black text-slate-800">{testResults.numTotalTestSuites}</p>
                  <p className="text-xs text-slate-500">Suites</p>
                </div>
              </div>

              {/* Success banner */}
              {testResults.success && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                  <CheckCircle2 size={18} className="text-green-600" />
                  <span className="text-sm font-bold text-green-700">Todos los tests pasaron</span>
                  <span className="text-xs text-green-600 ml-auto">
                    {new Date(testResults.startTime).toLocaleString('es-VE')}
                  </span>
                </div>
              )}

              {/* Test suites */}
              <div className="space-y-2">
                {testResults.testResults?.map((suite, i) => {
                  const name = suite.name?.split('/').pop() || `Suite ${i + 1}`
                  const passed = suite.assertionResults?.filter(t => t.status === 'passed').length || 0
                  const failed = suite.assertionResults?.filter(t => t.status === 'failed').length || 0
                  const total = suite.assertionResults?.length || 0
                  return (
                    <TestSuiteRow key={i} name={name} passed={passed} failed={failed} total={total} tests={suite.assertionResults || []} />
                  )
                })}
              </div>
            </>
          )}

          {!testResults && !testsLoading && (
            <div className="text-center py-12 text-slate-400">
              <FlaskConical size={40} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">Presiona "Cargar Tests" para ver los resultados</p>
              <p className="text-xs mt-1">Los tests se ejecutan automáticamente en cada build</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Health Check (solo desarrollador) */}
      {tab === 'health' && esDesarrollador && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Verifica la conexión y estado de todos los servicios en tiempo real.</p>
            <button
              onClick={runHealthCheck}
              disabled={healthLoading}
              className="text-xs text-white flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold"
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}
            >
              {healthLoading ? <RefreshCw size={12} className="animate-spin" /> : <Activity size={12} />}
              {healthLoading ? 'Verificando...' : 'Ejecutar Health Check'}
            </button>
          </div>

          {healthData && !healthData.error && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-slate-500">Tiempo total: {healthData.total_ms}ms</span>
              </div>
              <div className="space-y-3">
                {Object.entries(healthData.checks || {}).map(([key, check]) => (
                  <div key={key} className={`rounded-xl border p-4 shadow-sm ${check.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center gap-3">
                      {check.ok ? <CheckCircle2 size={20} className="text-green-600" /> : <XCircle size={20} className="text-red-600" />}
                      <div className="flex-1">
                        <h4 className="text-sm font-bold capitalize">{key.replace(/_/g, ' ')}</h4>
                        <div className="flex flex-wrap gap-3 mt-1">
                          {check.status && <span className="text-xs text-slate-500">Status: {check.status}</span>}
                          <span className="text-xs text-slate-500">{check.ms}ms</span>
                          {check.keys_count && <span className="text-xs text-slate-500">{check.keys_count} keys</span>}
                          {check.total_logs && <span className="text-xs text-slate-500">{check.total_logs} logs</span>}
                          {check.error && <span className="text-xs text-red-600">{check.error}</span>}
                        </div>
                        {check.counts && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {Object.entries(check.counts).map(([table, count]) => (
                              <span key={table} className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5">
                                {table}: <strong>{count}</strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {healthData?.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <XCircle size={24} className="mx-auto mb-2 text-red-500" />
              <p className="text-sm text-red-700 font-medium">{healthData.error}</p>
            </div>
          )}

          {!healthData && !healthLoading && (
            <div className="text-center py-12 text-slate-400">
              <Activity size={40} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">Presiona "Ejecutar Health Check"</p>
              <p className="text-xs mt-1">Verifica Supabase, Groq API, tablas y sistema de logs</p>
            </div>
          )}
        </div>
      )}

      {/* Purge modal con selección de rango */}
      {confirmPurge && (
        <PurgeModal
          onConfirm={async (dias) => {
            const result = await purge.mutateAsync(dias)
            const label = dias === 0 ? 'todos' : `mayores a ${dias} días`
            showToast(`Purga completada: ${result?.eliminados ?? 0} logs eliminados (${label})`, 'success')
            setConfirmPurge(false)
          }}
          onClose={() => setConfirmPurge(false)}
        />
      )}
    </div>
  )
}
