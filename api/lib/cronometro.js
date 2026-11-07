// api/lib/cronometro.js
// Cronómetro por petición: anota cuánto tarda el servidor y la verificación de sesión, y lo devuelve
// en la cabecera estándar Server-Timing. El frontend lo incluye en el resumen RENDIMIENTO para separar
// "tiempo del servidor" de "tiempo de viaje por internet". No toca datos ni permisos.

const tiempos = new WeakMap()

/** Suma ms a una medida de la petición (p. ej. 'auth'). */
export function anotarTiempo(request, nombre, ms) {
  if (!request || typeof request !== 'object' || !Number.isFinite(ms)) return
  const t = tiempos.get(request) || {}
  t[nombre] = (t[nombre] || 0) + ms
  tiempos.set(request, t)
}

export function cabeceraServerTiming(totalMs, medidas = {}) {
  const partes = Object.entries(medidas)
    .filter(([n, v]) => /^[a-z]+$/.test(n) && Number.isFinite(v))
    .map(([n, v]) => `${n};dur=${Math.round(v)}`)
  partes.push(`app;dur=${Math.round(totalMs)}`)
  return partes.join(', ')
}

/** Envuelve el fetch del Worker: solo rutas /api/, nunca rompe la respuesta. */
export function conCronometro(fetchFn) {
  return async function (request, env, ctx) {
    let ruta = ''
    try { ruta = new URL(request.url).pathname } catch { /* url inválida */ }
    if (!ruta.startsWith('/api/')) return fetchFn.call(this, request, env, ctx)
    const inicio = Date.now()
    const response = await fetchFn.call(this, request, env, ctx)
    try {
      if (!response || response.status === 101 || response.webSocket) return response
      const conTiempo = new Response(response.body, response)
      conTiempo.headers.append('Server-Timing', cabeceraServerTiming(Date.now() - inicio, tiempos.get(request)))
      return conTiempo
    } catch {
      return response
    }
  }
}
