// Regresión — adminClient / useConfigNegocio y el canal de autenticación
//
// Bug: editar un usuario desde Personal (jefe/administración) y guardar la
// configuración del negocio (incluida la tasa manual del widget BCV) fallaban
// con "No autenticado" porque adminClient.js y useConfigNegocio.js usaban
// fetch crudo + getAuthHeaders(), que corre supabase.auth.getSession() contra
// un timeout de 1.5s y sin refresh de token. Con el JWT vencido (tablet
// suspendida, red lenta) el helper mataba la petición ANTES de enviarla:
// por eso no aparecía nada en consola de red ni en el Worker.
//
// Misma causa raíz que el fix de transportistas (commit 02a08f4).
//
// Contrato nuevo:
// 1. adminClient.js y useConfigNegocio.js pasan por authFetch estándar
//    (refresh single-flight, reintento ante 401, timeout 15s).
// 2. Tripwire: ninguno de los dos archivos vuelve a importar getAuthHeaders
//    ni usa fetch crudo contra la API del Worker.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
}))

vi.mock('../../services/authFetch', () => ({ authFetch: mocks.authFetch }))
vi.mock('../../services/supabase/client', () => ({ default: {} }))
vi.mock('../../services/supabase/realtimeBus', () => ({ broadcastEntidad: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts) => ({ ...opts, mutate: opts.mutationFn, mutateAsync: opts.mutationFn }),
  useQuery: (opts) => opts,
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    setQueriesData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}))

const { adminAPI } = await import('../../services/supabase/adminClient')
const { useActualizarConfig } = await import('../../hooks/useConfigNegocio')

const resOk = (body) => ({
  ok: true, status: 200,
  text: async () => JSON.stringify(body),
  json: async () => body,
  headers: new Headers(),
  blob: async () => new Blob(),
})
const resError = (status, error) => ({
  ok: false, status,
  text: async () => JSON.stringify({ error }),
  json: async () => ({ error }),
  headers: new Headers(),
  blob: async () => new Blob(),
})

describe('adminAPI — canal de autenticación', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updateUser usa authFetch con PUT /api/admin/users/:id y el body correcto', async () => {
    mocks.authFetch.mockResolvedValueOnce(resOk({ ok: true }))
    await adminAPI.updateUser('u-1', { nombre: 'Administrador', pin: '202626' })

    expect(mocks.authFetch).toHaveBeenCalledTimes(1)
    const [path, opts] = mocks.authFetch.mock.calls[0]
    expect(path).toBe('/api/admin/users/u-1')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ nombre: 'Administrador', pin: '202626' })
  })

  it('createUser y deleteUser pasan por authFetch', async () => {
    mocks.authFetch
      .mockResolvedValueOnce(resOk({ id: 'nuevo', ok: true, codigo: 'V-TEST' }))
      .mockResolvedValueOnce(resOk({ ok: true }))
    await adminAPI.createUser({ nombre: 'Nuevo', rol: 'vendedor', pin: '1234' })
    await adminAPI.deleteUser('u-2')

    expect(mocks.authFetch.mock.calls[0]).toEqual([
      '/api/admin/users',
      { method: 'POST', body: JSON.stringify({ nombre: 'Nuevo', rol: 'vendedor', pin: '1234' }) },
    ])
    expect(mocks.authFetch.mock.calls[1]).toEqual(['/api/admin/users/u-2', { method: 'DELETE' }])
  })

  it('propaga el mensaje real del servidor (no "No autenticado" genérico)', async () => {
    mocks.authFetch.mockResolvedValueOnce(resError(401, 'Tu sesión expiró. Inicia sesión nuevamente.'))
    await expect(adminAPI.updateUser('u-1', {})).rejects.toThrow(
      'Tu sesión expiró. Inicia sesión nuevamente.',
    )
  })

  it('si authFetch falla sin body JSON, muestra el código HTTP', async () => {
    mocks.authFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'boom', headers: new Headers() })
    await expect(adminAPI.updateUser('u-1', {})).rejects.toThrow('Error 503')
  })

  it('getLogs/getAudit serializan parámetros en la ruta', async () => {
    mocks.authFetch
      .mockResolvedValueOnce(resOk({ logs: [] }))
      .mockResolvedValueOnce(resOk({ audit: [] }))
    await adminAPI.getLogs({ page: 2, nivel: 'error' })
    await adminAPI.getAudit({ usuario_id: 'u-9' })

    expect(mocks.authFetch.mock.calls[0][0]).toContain('/api/admin/logs?')
    expect(mocks.authFetch.mock.calls[0][0]).toContain('page=2')
    expect(mocks.authFetch.mock.calls[0][0]).toContain('nivel=error')
    expect(mocks.authFetch.mock.calls[1][0]).toContain('/api/admin/audit?')
    expect(mocks.authFetch.mock.calls[1][0]).toContain('usuario_id=u-9')
  })
})

describe('useConfigNegocio — canal de autenticación', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('useActualizarConfig usa authFetch con PUT /api/admin/config', async () => {
    mocks.authFetch.mockResolvedValueOnce(resOk({ ok: true }))
    const { mutationFn } = useActualizarConfig()
    await mutationFn({ tasa_bcv_manual: 970 })

    expect(mocks.authFetch).toHaveBeenCalledTimes(1)
    const [path, opts] = mocks.authFetch.mock.calls[0]
    expect(path).toBe('/api/admin/config')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ tasa_bcv_manual: 970 })
  })

  it('propaga el error real del Worker al guardar config', async () => {
    mocks.authFetch.mockResolvedValueOnce(resError(403, 'Acceso denegado: solo supervisores'))
    const { mutationFn } = useActualizarConfig()
    await expect(mutationFn({ iva_pct: 16 })).rejects.toThrow('Acceso denegado: solo supervisores')
  })
})

describe('tripwire — el canal legado no puede reintroducirse', () => {
  const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('adminClient.js ya no usa getAuthHeaders ni fetch crudo contra /api', () => {
    const src = read('../../services/supabase/adminClient.js')
    expect(src).not.toContain('getAuthHeaders')
    expect(src).not.toMatch(/fetch\(apiUrl\(`?\/api\//)
  })

  it('useConfigNegocio.js ya no usa getAuthHeaders ni fetch crudo contra /api', () => {
    const src = read('../../hooks/useConfigNegocio.js')
    expect(src).not.toContain('getAuthHeaders')
    expect(src).not.toMatch(/fetch\(apiUrl\(/)
  })
})
