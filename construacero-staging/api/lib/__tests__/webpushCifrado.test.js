// Verifica que el aviso se puede DESCIFRAR como lo haría un navegador (RFC 8291, aes128gcm)
// y que la firma VAPID es válida. El receptor se validó antes contra la librería de referencia "web-push".
import { describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import { sendWebPush } from '../webpush.js'

const b64u = b => Buffer.from(b).toString('base64url')
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len))

function descifrarAes128gcm(body, rx, rxPub, auth) {
  const salt = body.subarray(0, 16)
  const rs = body.readUInt32BE(16)
  const idlen = body[20]
  const serverPub = body.subarray(21, 21 + idlen)
  const ct = body.subarray(21 + idlen)
  const secret = rx.computeSecret(serverPub)
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), rxPub, serverPub]), 32)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(ct.subarray(ct.length - 16))
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  return { texto: pt.subarray(0, pt.lastIndexOf(2)).toString(), rs, idlen }
}

describe('sendWebPush', () => {
  it('el dispositivo puede descifrar el aviso y la firma VAPID es válida', async () => {
    const rx = crypto.createECDH('prime256v1'); rx.generateKeys()
    const rxPub = rx.getPublicKey(); const auth = crypto.randomBytes(16)
    const vk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = vk.publicKey.export({ format: 'jwk' })
    const vapidPub = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]))
    const env = { VAPID_PUBLIC_KEY: vapidPub, VAPID_PRIVATE_KEY: b64u(vk.privateKey.export({ format: 'der', type: 'pkcs8' })), VAPID_SUBJECT: 'mailto:soporte@ejemplo.com' }

    let capturada
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { capturada = { url, init }; return new Response('', { status: 201 }) }))
    const mensaje = JSON.stringify({ title: 'Despacho 🚚', body: 'Ñandú — cliente', url: '/despachos' })
    await sendWebPush('https://fcm.googleapis.com/fcm/send/x', b64u(rxPub), b64u(auth), mensaje, env)

    const h = capturada.init.headers
    expect(h['Content-Encoding']).toBe('aes128gcm')
    expect(h['Crypto-Key']).toBeUndefined()
    const r = descifrarAes128gcm(Buffer.from(capturada.init.body), rx, rxPub, auth)
    expect(r.texto).toBe(mensaje)
    expect(r.idlen).toBe(65)

    const m = /^vapid t=([^,]+),k=(.+)$/.exec(h.Authorization)
    expect(m[2]).toBe(vapidPub)
    const [hd, cl, sg] = m[1].split('.')
    expect(crypto.verify('sha256', Buffer.from(`${hd}.${cl}`), { key: vk.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url'))).toBe(true)
    const claims = JSON.parse(Buffer.from(cl, 'base64url').toString())
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:soporte@ejemplo.com' })
  })

  it('falla con claridad si no hay claves VAPID', async () => {
    const rx = crypto.createECDH('prime256v1'); rx.generateKeys()
    await expect(sendWebPush('https://fcm.googleapis.com/x', b64u(rx.getPublicKey()), b64u(crypto.randomBytes(16)), 'x', {})).rejects.toThrow(/VAPID/)
  })
})
