// api/[...path].js
// Proxy serverless para Vercel → Cloudflare Worker
// La URL del worker se lee de la variable de entorno WORKER_URL
// Si cambia el worker, solo actualiza WORKER_URL en Vercel Dashboard — sin push.

export const config = { runtime: 'edge' }

export default async function handler(req) {
  const workerUrl = process.env.WORKER_URL
  if (!workerUrl) {
    return new Response(JSON.stringify({ error: 'WORKER_URL no configurada' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const incoming = new URL(req.url)
  const target = new URL(incoming.pathname + incoming.search, workerUrl)

  // Copiar headers relevantes (no reenviar host ni encoding problemáticos)
  const headers = new Headers()
  for (const [key, value] of req.headers.entries()) {
    const k = key.toLowerCase()
    if (['host', 'connection', 'transfer-encoding', 'content-encoding'].includes(k)) continue
    headers.set(key, value)
  }

  const hasBody = !['GET', 'HEAD'].includes(req.method)
  const upstream = await fetch(target.toString(), {
    method:  req.method,
    headers,
    body: hasBody ? req.body : undefined,
    duplex: hasBody ? 'half' : undefined,
  })

  // Filtrar headers de respuesta que Vercel Edge no permite reenviar
  const resHeaders = new Headers()
  for (const [key, value] of upstream.headers.entries()) {
    const k = key.toLowerCase()
    if (['content-encoding', 'transfer-encoding', 'connection'].includes(k)) continue
    resHeaders.set(key, value)
  }

  return new Response(upstream.body, {
    status:  upstream.status,
    headers: resHeaders,
  })
}
