// Regresión — Transportistas y autenticación
//
// Bug: editar un transportista (logística u otro rol) fallaba con "No autenticado"
// porque crear/actualizar usaban fetch crudo + getAuthHeaders(), que corre
// supabase.auth.getSession() contra un timeout de 1.5s y sin refresh de token.
// Cualquier latencia > 1.5s invalidaba una sesión perfectamente válida.
//
// Contrato nuevo:
// 1. Todas las mutaciones/consultas de transportistas pasan por authFetch
//    (mismo estándar que clientes/despachos: sin carrera de 1.5s y con
//    refresh + reintento ante 401).
// 2. El error mostrado es el mensaje real del servidor (err.error), no un genérico.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  perfil: { rol: 'logistica' },
}))

vi.mock('../../services/authFetch', () => ({ authFetch: mocks.authFetch }))
vi.mock('../../components/ui/Toast', () => ({
  showToast: { success: mocks.toastSuccess, error: mocks.toastError },
}))
vi.mock('../../store/useAuthStore', () => ({
  default: (sel) => sel({ perfil: mocks.perfil }),
}))
vi.mock('../../services/supabase/client', () => ({ default: {} }))
vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts) => opts,
  useQuery: (opts) => opts,
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}))

const { useActualizarTransportista, useCrearTransportista } = await import('../../hooks/useTransportistas')

const resOk = (body) => ({ ok: true, status: 200, json: async () => body })
const resError = (status, error) => ({ ok: false, status, json: async () => ({ error }) })

describe('transportistas — canal de autenticación', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('actualizar usa authFetch con POST /api/transportistas/actualizar y el body correcto', async () => {
    mocks.authFetch.mockResolvedValueOnce(resOk({ ok: true, transportista: { id: 't-1', nombre: 'Adalberto Rojas' } }))
    const { mutationFn } = useActualizarTransportista()

    const out = await mutationFn({ id: 't-1', campos: { nombre: 'Adalberto Rojas', vehiculo: 'ford triton' } })

    expect(mocks.authFetch).toHaveBeenCalledTimes(1)
    const [path, opts] = mocks.authFetch.mock.calls[0]
    expect(path).toBe('/api/transportistas/actualizar')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ id: 't-1', nombre: 'Adalberto Rojas', vehiculo: 'ford triton' })
    expect(out.transportista.nombre).toBe('Adalberto Rojas')
  })

  it('crear usa authFetch con POST /api/transportistas/crear', async () => {
    mocks.authFetch.mockResolvedValueOnce(resOk({ ok: true, transportista: { id: 't-2' } }))
    const { mutationFn } = useCrearTransportista()

    await mutationFn({ nombre: 'Frailin Lozano' })

    const [path, opts] = mocks.authFetch.mock.calls[0]
    expect(path).toBe('/api/transportistas/crear')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ nombre: 'Frailin Lozano' })
  })

  it('propaga el mensaje real del servidor (no "No autenticado" genérico)', async () => {
    mocks.authFetch.mockResolvedValueOnce(resError(401, 'Tu sesión expiró. Inicia sesión nuevamente.'))
    const { mutationFn } = useActualizarTransportista()

    await expect(mutationFn({ id: 't-1', campos: { nombre: 'x' } })).rejects.toThrow(
      'Tu sesión expiró. Inicia sesión nuevamente.',
    )
  })

  it('si authFetch falla sin body JSON, muestra el código HTTP', async () => {
    mocks.authFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new Error('bad json') } })
    const { mutationFn } = useActualizarTransportista()

    await expect(mutationFn({ id: 't-1', campos: {} })).rejects.toThrow('Error 503')
  })

  it('tripwire: el hook ya no importa getAuthHeaders ni usa fetch crudo', () => {
    const src = readFileSync(fileURLToPath(new URL('../../hooks/useTransportistas.js', import.meta.url)), 'utf8')
    expect(src).not.toContain('getAuthHeaders')
    expect(src).not.toMatch(/\bfetch\(apiUrl\(/)
  })
})
