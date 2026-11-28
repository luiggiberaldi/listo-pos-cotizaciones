// api/handlers/__tests__/auditFase0Op109.test.js
// Pruebas de Fase 0 de Auditoría 2.0 (OP-2026-109):
//  1. Permiso de lectura para el rol 'administracion' en /api/admin/audit y /stats.
//  2. Ningún handler en api/handlers/ deja llamadas sueltas a registrarAuditoria() sin await ni waitUntil.
//  3. worker.js conecta conWaitUntil(env, ctx) a todo /api/ de forma global.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(),
  getOperatorRole: vi.fn(),
}))

import { verifyAuth, getOperatorRole } from '../../lib/auth.js'
import { handleGetAudit, handleGetAuditStats } from '../audit.js'

const ENV = {
  SUPABASE_URL: 'http://supabase.test.invalid',
  SUPABASE_SERVICE_KEY: 'test-service-key',
}

describe('OP-2026-109 — Auditoría 2.0 Fase 0', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('administracion puede consultar GET /api/admin/audit y GET /api/admin/audit/stats', async () => {
    verifyAuth.mockResolvedValue({ operator_id: '11111111-1111-4111-8111-111111111111' })
    getOperatorRole.mockResolvedValue('administracion')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-range': '0-0/1' }),
      json: async () => [{ id: 'a1', categoria: 'FINANZAS', accion: 'REGISTRAR_ABONO', usuario_nombre: 'Ana', usuario_rol: 'administracion' }],
    })))

    const req = new Request('https://app.test/api/admin/audit?page=1&limit=20')
    const res = await handleGetAudit(req, ENV, new URL(req.url))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.registros).toHaveLength(1)

    const statsRes = await handleGetAuditStats(new Request('https://app.test/api/admin/audit/stats'), ENV)
    expect(statsRes.status).toBe(200)
    const stats = await statsRes.json()
    expect(stats.total).toBe(1)
  })

  it('vendedor sigue bloqueado (403) en GET /api/admin/audit', async () => {
    verifyAuth.mockResolvedValue({ operator_id: '11111111-1111-4111-8111-111111111111' })
    getOperatorRole.mockResolvedValue('vendedor')
    const req = new Request('https://app.test/api/admin/audit')
    const res = await handleGetAudit(req, ENV, new URL(req.url))
    expect(res.status).toBe(403)
  })

  it('guardia estática: ningún handler llama registrarAuditoria() suelta (sin await ni asignación para waitUntil)', () => {
    const handlersDir = path.resolve(process.cwd(), 'api/handlers')
    const archivos = fs.readdirSync(handlersDir).filter((f) => f.endsWith('.js'))
    const sueltas = []
    for (const archivo of archivos) {
      const lineas = fs.readFileSync(path.join(handlersDir, archivo), 'utf8').split(/\r?\n/)
      lineas.forEach((linea, idx) => {
        if (/^\s*(void\s+)?registrarAuditoria\s*\(/.test(linea)) {
          sueltas.push(`${archivo}:${idx + 1}: ${linea.trim()}`)
        }
      })
    }
    expect(sueltas).toEqual([])
  })

  it('worker.js conecta conWaitUntil(env, ctx) al inicio de todas las rutas /api/', () => {
    const workerSrc = fs.readFileSync(path.resolve(process.cwd(), 'worker.js'), 'utf8')
    expect(workerSrc).toMatch(/if\s*\(url\.pathname\.startsWith\('\/api\/'\)\)\s*\{[\s\S]{0,300}env\s*=\s*conWaitUntil\(env,\s*ctx\)/)
  })
})
