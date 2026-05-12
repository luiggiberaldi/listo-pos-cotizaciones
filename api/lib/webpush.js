// api/lib/webpush.js

export async function sendWebPush(endpoint, p256dhBase64, authBase64, payload, env) {
  const crypto = globalThis.crypto;

  // Decodificar claves del cliente
  const clientPublicKey = base64urlDecode(p256dhBase64);
  const clientAuth = base64urlDecode(authBase64);

  // Importar clave pública del cliente
  const clientKey = await crypto.subtle.importKey(
    'raw', clientPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // Generar par de claves efímeras del servidor
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
  );

  // Exportar clave pública del servidor (para el header)
  const serverPublicKeyRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);

  // Derivar secreto compartido
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey }, serverKeyPair.privateKey, 256
  );

  // Salt aleatorio (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF para derivar claves de cifrado
  const prk = await hkdf(clientAuth, sharedSecret, concatBuffers(
    lengthPrefix(clientPublicKey),
    lengthPrefix(serverPublicKeyRaw),
  ), 32);

  const cek = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: aesgcm\0'), 16);
  const nonce = await hkdf(salt, prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Cifrar payload con AES-GCM
  const payloadBytes = new TextEncoder().encode(payload);
  const padded = new Uint8Array(2 + payloadBytes.length);
  new DataView(padded.buffer).setUint16(0, 0); // sin padding
  padded.set(payloadBytes, 2);

  const encryptionKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encryptionKey, padded);

  // JWT VAPID
  const vapidJwt = await createVapidJwt(endpoint, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);

  // Hacer la petición al push service
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Authorization': `vapid t=${vapidJwt},k=${env.VAPID_PUBLIC_KEY}`,
      'Crypto-Key': `dh=${base64urlEncode(serverPublicKeyRaw)}`,
      'Encryption': `salt=${base64urlEncode(salt)}`,
      'TTL': '86400',
    },
    body: encrypted,
  });

  if (!response.ok && response.status !== 201) {
    throw new Error(`Push failed: ${response.status}`);
  }
}

export async function createVapidJwt(endpoint, privateKeyBase64, publicKeyBase64) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp,
    sub: 'mailto:admin@listpos.com',
  })));

  const signingInput = `${header}.${claims}`;

  // Importar clave privada VAPID
  const keyData = base64urlDecode(privateKeyBase64);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64urlEncode(signature)}`;
}

export async function hkdf(salt, ikm, info, length) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = await crypto.subtle.sign('HMAC', saltKey, ikm);
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = concatBuffers(info, new Uint8Array([1]));
  const okm = await crypto.subtle.sign('HMAC', prkKey, infoWithCounter);
  return new Uint8Array(okm).slice(0, length);
}

export function concatBuffers(...buffers) {
  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer || buf), offset);
    offset += buf.byteLength;
  }
  return result;
}

export function lengthPrefix(buffer) {
  const arr = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer || buffer);
  const result = new Uint8Array(2 + arr.length);
  new DataView(result.buffer).setUint16(0, arr.length);
  result.set(arr, 2);
  return result;
}

export function base64urlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + (4 - str.length % 4) % 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export function base64urlEncode(buffer) {
  const arr = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer);
  let binary = '';
  arr.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
