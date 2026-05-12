// api/lib/groq.js

export const groqCounters = { A: 0, B: 0, C: 0 }

export async function groqFetch(env, grupo, messages, { maxTokens = 2048, temperature = 0.3 } = {}) {
  const envKey = `GROQ_KEYS_${grupo}`
  const raw = env[envKey]
  if (!raw) throw new Error(`No hay keys configuradas para grupo ${grupo}`)
  const keys = raw.split(',').map(k => k.trim()).filter(Boolean)
  if (!keys.length) throw new Error(`Keys vacías para grupo ${grupo}`)

  const startIdx = groqCounters[grupo] % keys.length
  groqCounters[grupo]++

  // Intentar round-robin: si una falla (429), probar la siguiente
  for (let i = 0; i < keys.length; i++) {
    const idx = (startIdx + i) % keys.length
    const key = keys[idx]
    try {
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 20_000)
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          'User-Agent': 'groq-python/0.13.0',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          max_completion_tokens: maxTokens,
          temperature,
        }),
        signal: ctrl.signal,
      })
      clearTimeout(timeout)

      if (res.status === 429) continue  // rate limited → next key
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Groq API error ${res.status}: ${errText.slice(0, 200)}`)
      }
      const data = await res.json()
      return data.choices?.[0]?.message?.content || ''
    } catch (e) {
      if (e.name === 'AbortError') continue // timeout → next key
      if (i === keys.length - 1) throw e    // last key → propagate
    }
  }
  throw new Error(`Todas las keys del grupo ${grupo} fallaron (rate limit)`)
}
