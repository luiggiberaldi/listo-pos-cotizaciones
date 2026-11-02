import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn() }))
vi.mock('../../lib/audit.js', () => ({ logToSystem: vi.fn(() => Promise.resolve()) }))
vi.mock('../../lib/webpush.js', () => ({ sendWebPush: vi.fn(() => Promise.resolve()) }))

import { validateOperator } from '../../lib/auth.js'
import { sendWebPush } from '../../lib/webpush.js'
import { handlePush, esEndpointPushValido, normalizarRoles, urlInterna } from '../push.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key', VAPID_PUBLIC_KEY: 'k' }
const opId = '33333333-3333-4333-8333-333333333333'
const otroId = '44444444-4444-4444-8444-444444444444'
const EP = 'https://fcm.googleapis.com/fcm/send/abc123'
const KEYS = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }

const auth = (rol = 'vendedor') => ({ user: { id: 'cuenta' }, operador: { id: opId, nombre: 'Op', rol }, headers: {}, ip: '1.1.1.1' })
const llamar = (ruta, method, body) =>
  handlePush(new Request(`https://app.test/api/push/${ruta}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }), ENV, new URL(`https://app.test/api/push/${ruta}`))

beforeEach(() => {
  vi.clearAllMocks()
  validateOperator.mockResolvedValue(auth())
})

describe('ayudantes de validación', () => {
  it('solo acepta servicios push reales', () => {
    expect(esEndpointPushValido(EP)).toBe(true)
    expect(esEndpointPushValido('https://web.push.apple.com/xyz')).toBe(true)
    expect(esEndpointPushValido('https://wns2-par02p.notify.windows.com/w/?token=1')).toBe(true)
    expect(esEndpointPushValido('https://evil.com/fcm.googleapis.com')).toBe(false)
    expect(esEndpointPushValido('https://fcm.googleapis.com.evil.com/x')).toBe(false)
    expect(esEndpointPushValido('http://fcm.googleapis.com/x')).toBe(false)
    expect(esEndpointPushValido('https://169.254.169.254/latest')).toBe(false)
    expect(esEndpointPushValido('https://user:pw@fcm.googleapis.com/x')).toBe(false)
  })
  it('valida roles y enlaces internos', () => {
    expect(normalizarRoles('supervisor, jefe')).toEqual(['supervisor', 'jefe'])
    expect(normalizarRoles('supervisor&usuario_id=neq.0')).toBeNull()
    expect(normalizarRoles('admin')).toBeNull()
    expect(urlInterna('/despachos?id=1')).toBe('/despachos?id=1')
    expect(urlInterna('https://evil.com')).toBeNull()
    expect(urlInterna('//evil.com')).toBeNull()
    expect(urlInterna('javascript:alert(1)')).toBeNull()
  })
})

describe('subscribe / unsubscribe', () => {
  it('exige sesión de operador', async () => {
    validateOperator.mockResolvedValue({ error: new Response('{}', { status: 403 }) })
    expect((await llamar('subscribe', 'POST', { endpoint: EP, keys: KEYS })).status).toBe(403)
  })
  it('rechaza destinos que no son un servicio push y claves mal formadas', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    expect((await llamar('subscribe', 'POST', { endpoint: 'https://evil.com/x', keys: KEYS })).status).toBe(400)
    expect((await llamar('subscribe', 'POST', { endpoint: EP, keys: { p256dh: 'x', auth: 'y' } })).status).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })
  it('guarda la suscripción a nombre del operador y reasigna si el dispositivo cambia de operador', async () => {
    const llamadas = []
    vi.stubGlobal('fetch', vi.fn(async (u, init) => { llamadas.push({ u: String(u), init }); return new Response('', { status: 201 }) }))
    expect((await llamar('subscribe', 'POST', { endpoint: EP, keys: KEYS })).status).toBe(200)
    expect(llamadas[0].u).toContain('on_conflict=endpoint')
    expect(JSON.parse(llamadas[0].init.body)).toMatchObject({ usuario_id: opId, endpoint: EP })
  })
  it('desuscribir borra solo la del operador', async () => {
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async u => { urls.push(String(u)); return new Response(null, { status: 204 }) }))
    expect((await llamar('unsubscribe', 'DELETE', { endpoint: EP })).status).toBe(200)
    expect(urls[0]).toContain(`usuario_id=eq.${opId}`)
  })
})

describe('send', () => {
  const subs = [{ endpoint: EP, p256dh: 'p', auth: 'a', usuario_id: otroId }]
  function stubDb() {
    const urls = []
    vi.stubGlobal('fetch', vi.fn(async u => {
      const s = String(u); urls.push(s)
      if (s.includes('/usuarios?')) return new Response(JSON.stringify([{ id: otroId }]), { status: 200 })
      return new Response(JSON.stringify(subs), { status: 200 })
    }))
    return urls
  }

  it('exige sesión de operador', async () => {
    validateOperator.mockResolvedValue({ error: new Response('{}', { status: 403 }) })
    expect((await llamar('send', 'POST', { title: 't', message: 'm', targetRole: 'supervisor' })).status).toBe(403)
  })
  it('rechaza enlaces externos, roles inventados y destinos manipulados', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    expect((await llamar('send', 'POST', { title: 't', message: 'm', url: 'https://evil.com', targetRole: 'supervisor' })).status).toBe(400)
    expect((await llamar('send', 'POST', { title: 't', message: 'm', targetRole: 'x&select=*' })).status).toBe(400)
    expect((await llamar('send', 'POST', { title: 't', message: 'm', targetUserId: 'no-uuid&x=1' })).status).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })
  it('un vendedor no puede avisar a todos; un supervisor sí', async () => {
    stubDb()
    expect((await llamar('send', 'POST', { title: 't', message: 'm' })).status).toBe(403)
    validateOperator.mockResolvedValue(auth('supervisor'))
    expect((await llamar('send', 'POST', { title: 't', message: 'm' })).status).toBe(200)
  })
  it('avisa al rol pedido, excluye a quien hizo la acción y envía el aviso', async () => {
    const urls = stubDb()
    const r = await llamar('send', 'POST', { title: 'Despacho', message: 'Nuevo', url: '/despachos', tag: 'x', targetRole: 'supervisor,jefe' })
    expect((await r.json())).toMatchObject({ ok: true, sent: 1 })
    expect(urls.find(u => u.includes('/usuarios?'))).toContain('rol=in.(supervisor,jefe)')
    expect(urls.find(u => u.includes('/push_subscriptions?select'))).toContain(`usuario_id=neq.${opId}`)
    expect(sendWebPush).toHaveBeenCalledTimes(1)
  })
  it('retira la suscripción muerta (410) y no falla', async () => {
    const urls = stubDb()
    sendWebPush.mockRejectedValueOnce(new Error('Push failed: 410'))
    const r = await llamar('send', 'POST', { title: 't', message: 'm', targetRole: 'supervisor' })
    expect(await r.json()).toMatchObject({ sent: 0, failed: 1 })
    expect(urls.some(u => u.includes('push_subscriptions?endpoint=eq.'))).toBe(true)
  })
})
