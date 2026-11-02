import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../audit.js', () => ({ logToSystem: vi.fn(() => Promise.resolve()) }))
vi.mock('../webpush.js', () => ({ sendWebPush: vi.fn(() => Promise.resolve()) }))

import { sendWebPush } from '../webpush.js'
import { avisarDespacho, enviarPush, programar } from '../notificarPush.js'

const ENV = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'k' }
const despId = '11111111-1111-4111-8111-111111111111'
const cotId = '22222222-2222-4222-8222-222222222222'
const cliId = '33333333-3333-4333-8333-333333333333'
const actorId = '44444444-4444-4444-8444-444444444444'
const otroId = '55555555-5555-4555-8555-555555555555'

function stubDb({ formaPago = '[{"metodo":"Efectivo"}]', subs = [{ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a', usuario_id: otroId }] } = {}) {
  const urls = []
  vi.stubGlobal('fetch', vi.fn(async u => {
    const s = String(u); urls.push(s)
    if (s.includes('notas_despacho?')) return new Response(JSON.stringify([{ numero: 7, cotizacion_id: cotId, cliente_id: cliId, forma_pago: formaPago }]), { status: 200 })
    if (s.includes('cotizaciones?')) return new Response(JSON.stringify([{ numero: 123 }]), { status: 200 })
    if (s.includes('clientes?')) return new Response(JSON.stringify([{ nombre: 'Ferretería Sol' }]), { status: 200 })
    if (s.includes('/usuarios?')) return new Response(JSON.stringify([{ id: otroId }]), { status: 200 })
    if (s.includes('push_subscriptions?select')) return new Response(JSON.stringify(subs), { status: 200 })
    return new Response('', { status: 200 })
  }))
  return urls
}

beforeEach(() => { vi.clearAllMocks() })

describe('avisarDespacho (aviso desde el servidor)', () => {
  it('despacho creado: avisa a dirección con datos leídos de la base y excluye a quien actuó', async () => {
    const urls = stubDb()
    await avisarDespacho(ENV, { tipo: 'creado', despachoId: despId, actor: { id: actorId, nombre: 'Ana' } })
    expect(urls.find(u => u.includes('/usuarios?'))).toContain('rol=in.(supervisor,administracion,jefe)')
    expect(urls.find(u => u.includes('push_subscriptions?select'))).toContain(`usuario_id=neq.${actorId}`)
    const payload = JSON.parse(sendWebPush.mock.calls[0][3])
    expect(payload).toMatchObject({ title: '🚚 Orden de Despacho Creada', body: 'Despacho para cotización #00123 — Ferretería Sol', url: '/despachos', tag: 'despacho-00123' })
  })
  it('detecta cobro a destino', async () => {
    stubDb({ formaPago: '[{"metodo":"Cobro a destino"}]' })
    await avisarDespacho(ENV, { tipo: 'venta_rapida', despachoId: despId, actor: { id: actorId, nombre: 'Ana' } })
    expect(JSON.parse(sendWebPush.mock.calls[0][3])).toMatchObject({ title: 'Venta Rápida Creada [COD]', tag: 'venta-rapida-7' })
  })
  it('estados: en ruta a vendedor y logística; anulado a todos los roles', async () => {
    let urls = stubDb()
    await avisarDespacho(ENV, { tipo: 'despachada', despachoId: despId, actor: { id: actorId, nombre: 'Luis' } })
    expect(urls.find(u => u.includes('/usuarios?'))).toContain('rol=in.(vendedor,logistica)')
    expect(JSON.parse(sendWebPush.mock.calls[0][3]).body).toBe('Despacho #00123 — Ferretería Sol despachado por Luis')
    urls = stubDb()
    await avisarDespacho(ENV, { tipo: 'anulada', despachoId: despId, actor: { id: actorId, nombre: 'Luis' } })
    expect(urls.find(u => u.includes('/usuarios?'))).toContain('vendedor_sin_comision')
  })
  it('ignora tipos desconocidos e ids inválidos sin llamar a la base', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    await avisarDespacho(ENV, { tipo: 'otro', despachoId: despId })
    await avisarDespacho(ENV, { tipo: 'creado', despachoId: 'x&y=1' })
    expect(f).not.toHaveBeenCalled()
  })
  it('si el envío falla no lanza error', async () => {
    stubDb()
    sendWebPush.mockRejectedValueOnce(new Error('Push failed: 410'))
    await expect(avisarDespacho(ENV, { tipo: 'creado', despachoId: despId, actor: { id: actorId } })).resolves.toBeUndefined()
  })
})

describe('programar', () => {
  it('con waitUntil no hace esperar; sin él espera la tarea', async () => {
    const espera = []
    const env = { waitUntil: p => espera.push(p) }
    let hecho = false
    await programar(env, async () => { hecho = true })
    expect(espera).toHaveLength(1)
    await espera[0]
    expect(hecho).toBe(true)
    let hecho2 = false
    await programar({}, async () => { hecho2 = true })
    expect(hecho2).toBe(true)
  })
})

describe('enviarPush', () => {
  it('rechaza destino inválido', async () => {
    expect(await enviarPush(ENV, { title: 't', message: 'm', userId: 'no-uuid' })).toMatchObject({ error: 'Destino inválido' })
  })
})
