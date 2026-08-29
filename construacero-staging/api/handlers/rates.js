import { jsonError, corsHeaders } from '../lib/utils.js'

const CACHE_MS = 10 * 60 * 1000
const BCV_URL = 'https://www.bcv.org.ve/'
// CDN público que replica la publicación diaria del BCV. Se usa solo si el
// servidor del BCV rechaza la conexión del Worker (por TLS o protección anti-bot).
const BCV_CDN_URL = 'https://rates.dolarvzla.com/bcv/current.json'
const DOLAR_API_URLS = {
  usd: ['https://ve.dolarapi.com/v1/dolares/oficial', 'https://ve.dolarapi.com/v1/dolares'],
  eur: ['https://ve.dolarapi.com/v1/euros/oficial', 'https://ve.dolarapi.com/v1/euros'],
}
const BCV_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

let cache = null
let cacheTime = 0

function parseLocalizedNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0

  const clean = value.replace(/[^\d.,]/g, '')
  if (!clean) return 0

  const lastDot = clean.lastIndexOf('.')
  const lastComma = clean.lastIndexOf(',')
  const lastSeparator = Math.max(lastDot, lastComma)
  if (lastSeparator === -1) return Number(clean) || 0

  const integer = clean.slice(0, lastSeparator).replace(/[.,]/g, '')
  const decimals = clean.slice(lastSeparator + 1)
  return Number(`${integer}.${decimals}`) || 0
}

function extractBcvRate(html, id) {
  const patterns = [
    new RegExp(
      `id=["']${id}["'][\\s\\S]{0,5000}?<strong\\b[^>]*class=["'][^"']*strong-tb[^"']*["'][^>]*>\\s*([\\d.,]+)`,
      'i'
    ),
    new RegExp(
      `id=["']${id}["'][\\s\\S]{0,5000}?<strong\\b[^>]*>\\s*([\\d.,]+)`,
      'i'
    ),
  ]

  for (const pattern of patterns) {
    const value = parseLocalizedNumber(html.match(pattern)?.[1])
    if (value > 0) return value
  }
  return 0
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    if (!response.ok) return null
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBcvDirect() {
  // El BCV puede servir una copia intermedia si se solicita siempre la misma
  // URL. El querystring evita ese cache y el User-Agent reproduce la consulta
  // que funciona en el proyecto de referencia.
  const response = await fetchWithTimeout(`${BCV_URL}?_=${Date.now()}`, {
    headers: {
      'User-Agent': BCV_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })
  if (!response) throw new Error('BCV no respondió correctamente')

  const html = await response.text()
  const usd = extractBcvRate(html, 'dolar')
  const eur = extractBcvRate(html, 'euro')
  if (usd <= 0 || eur <= 0) throw new Error('No se encontraron USD/EUR en la página del BCV')

  return { usd, eur, source: 'BCV Directo' }
}

async function fetchBcvCdn() {
  const response = await fetchWithTimeout(`${BCV_CDN_URL}?_=${Date.now()}`, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  }, 8000)
  if (!response) throw new Error('CDN BCV no respondió correctamente')

  const payload = await response.json()
  const current = payload?.current
  const usd = parseLocalizedNumber(current?.usd)
  const eur = parseLocalizedNumber(current?.eur)
  if (usd <= 0 || eur <= 0 || typeof current?.date !== 'string') {
    throw new Error('CDN BCV no publicó USD/EUR vigentes')
  }

  return {
    usd,
    eur,
    source: 'BCV CDN (DolarVZLA)',
    officialDate: current.date,
  }
}

function getGoogleBcvUrl(env) {
  return (
    env?.BCV_GOOGLE_SCRIPT_URL
    || env?.GOOGLE_SCRIPT_URL
    || env?.VITE_BCV_GOOGLE_SCRIPT_URL
    || env?.VITE_GOOGLE_SCRIPT_RATES_URL
    || env?.VITE_GOOGLE_SCRIPT_URL
    || ''
  ).trim()
}

async function fetchGoogleBcv(env) {
  const url = getGoogleBcvUrl(env)
  if (!url) return null

  const response = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  }, 10000)
  if (!response) throw new Error('Google Script BCV no respondió correctamente')

  const payload = await response.json()
  const usd = parseLocalizedNumber(payload?.bcv?.price ?? payload?.bcv ?? payload?.usd?.price ?? payload?.usd)
  const eur = parseLocalizedNumber(payload?.euro?.price ?? payload?.euro ?? payload?.eur?.price ?? payload?.eur)
  if (usd <= 0 || eur <= 0) throw new Error('Google Script BCV no publicó USD/EUR válidos')

  return { usd, eur, source: 'BCV Oficial (Google Script)' }
}

function officialRate(payload) {
  const rows = Array.isArray(payload) ? payload : [payload]
  const row = rows.find(item => item?.fuente === 'oficial' || item?.nombre === 'Oficial')
  return {
    price: parseLocalizedNumber(row?.promedio || row?.precio),
    officialDate: row?.fechaActualizacion || null,
  }
}

async function fetchDolarApiRate(urls) {
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, {}, 8000)
      if (!response) continue
      const payload = await response.json()
      const rate = officialRate(payload)
      if (rate.price > 0) return rate
    } catch {
      // Intenta la siguiente variante.
    }
  }
  return { price: 0, officialDate: null }
}

async function fetchDolarApiOfficial() {
  const [usd, eur] = await Promise.all([
    fetchDolarApiRate(DOLAR_API_URLS.usd),
    fetchDolarApiRate(DOLAR_API_URLS.eur),
  ])
  if (usd.price <= 0 || eur.price <= 0) throw new Error('DolarAPI no devolvió USD/EUR oficiales')
  return {
    usd: usd.price,
    eur: eur.price,
    source: 'DolarAPI Oficial (último recurso)',
    officialDate: usd.officialDate || eur.officialDate || null,
  }
}

function buildPayload(rates, stale = false) {
  return {
    source: rates.source,
    bcv: { price: rates.usd, source: `${rates.source} (USD)`, change: 0 },
    euro: { price: rates.eur, source: `${rates.source} (EUR)`, change: 0 },
    lastUpdate: rates.lastUpdate || new Date().toISOString(),
    ...(rates.officialDate ? { officialDate: rates.officialDate } : {}),
    ...(stale ? { stale: true } : {}),
  }
}

function rateHeaders(rates, cacheStatus) {
  return {
    'Content-Type': 'application/json',
    // Las tasas no deben quedar en el cache del navegador/CDN. El Worker
    // conserva únicamente su cache interno de 10 minutos.
    'Cache-Control': 'no-store',
    'X-Rate-Source': rates.source,
    'X-Rate-Cache': cacheStatus,
    ...(rates.officialDate ? { 'X-Rate-Official-Date': rates.officialDate } : {}),
  }
}

export async function handleGetRates(request, env) {
  if (request.method !== 'GET') return jsonError('Method not allowed', 405, request)

  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1'
  if (cache && !forceRefresh && Date.now() - cacheTime < CACHE_MS) {
    return new Response(JSON.stringify(buildPayload(cache)), {
      status: 200,
      headers: { ...rateHeaders(cache, 'HIT'), ...corsHeaders(request) },
    })
  }

  try {
    const sources = [
      { name: 'BCV directo', fetch: fetchBcvDirect },
      { name: 'BCV CDN', fetch: fetchBcvCdn },
      { name: 'Google Script', fetch: () => fetchGoogleBcv(env) },
      { name: 'DolarAPI', fetch: fetchDolarApiOfficial },
    ]
    let rates = null
    let lastError = null

    for (const source of sources) {
      try {
        const candidate = await source.fetch()
        if (candidate) {
          rates = candidate
          break
        }
      } catch (sourceError) {
        lastError = sourceError
        console.warn(`[RATES] ${source.name} falló: ${sourceError.message}`)
      }
    }

    if (!rates) throw lastError || new Error('No hay una fuente BCV disponible')

    cache = { ...rates, lastUpdate: new Date().toISOString() }
    cacheTime = Date.now()

    return new Response(JSON.stringify(buildPayload(cache)), {
      status: 200,
      headers: { ...rateHeaders(cache, 'MISS'), ...corsHeaders(request) },
    })
  } catch (error) {
    if (cache) {
      return new Response(JSON.stringify(buildPayload(cache, true)), {
        status: 200,
        headers: { ...rateHeaders(cache, 'STALE'), ...corsHeaders(request) },
      })
    }
    return jsonError(`No se pudo obtener la tasa BCV: ${error.message}`, 503, request)
  }
}
