// api/handlers/inventario.js
import { json, jsonError, corsHeaders, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

function resolverIdempotencyKey(request, body) {
  const fromBody = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
  const fromHeader = (request.headers.get('Idempotency-Key') || '').trim()
  return fromBody || fromHeader || crypto.randomUUID()
}

// ── PDF temporal handler (para WhatsApp) ──────────────────────────────────
export async function handlePdfTemp(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;

  const blob = await request.arrayBuffer();
  if (!blob || blob.byteLength === 0) return jsonError('PDF vacío', 400, request);
  if (blob.byteLength > 2 * 1024 * 1024) return jsonError('PDF muy grande (max 2MB)', 400, request);

  const id = crypto.randomUUID().slice(0, 8);
  const filename = request.headers.get('X-Filename') || 'cotizacion.pdf';
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${id}_${safeName}`;

  const res = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/pdf-temp/${path}`,
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/pdf',
        'Cache-Control': 'max-age=604800',
      },
      body: blob,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return jsonError(`Error subiendo PDF: ${err}`, 500, request);
  }

  const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/pdf-temp/${path}`;
  return new Response(JSON.stringify({ url: publicUrl }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

// ── Borrar inventario (admin) ────────────────────────────────────────────────
export async function handleClearInventory(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return jsonError('Server misconfigured', 500, request);

  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers: h, ip } = v;
  if (operador.rol !== 'desarrollador') {
    return jsonError('Solo el rol desarrollador puede borrar el inventario', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const idempotencyKey = resolverIdempotencyKey(request, body);
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request);

  const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/limpiar_inventario_atomico`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      p_cuenta_id: operador.cuenta_id,
      p_usuario_id: user.operator_id,
      p_confirmacion: `LIMPIAR_INVENTARIO:${operador.cuenta_id}`,
      p_idempotency_key: idempotencyKey,
    }),
  });
  const text = await rpcRes.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch {
    // Best-effort parse: conservar la respuesta original.
  }
  if (!rpcRes.ok) {
    return jsonError(`Error al borrar inventario: ${result?.message || text || `HTTP ${rpcRes.status}`}`, 500, request);
  }
  if (!result?.ok) return jsonError('La RPC no confirmó la limpieza del inventario', 500, request);

  try {
    await registrarAuditoria(env, h, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'INVENTARIO', accion: 'LIMPIAR_INVENTARIO',
      descripcion: `Limpieza atómica de inventario del tenant ${operador.cuenta_id}`,
      entidadTipo: 'inventario', entidadId: operador.cuenta_id,
      meta: { movimientos_eliminados: result.movimientos_eliminados, productos_eliminados: result.productos_eliminados, idempotency_key: idempotencyKey }, ip,
    });
  } catch {
    // Best-effort operation; preserve the primary response.
  }

  return json({ ok: true, ...result }, 200, request);
}

// ── Aplicar movimiento de inventario por lotes (admin) ────────────────────────
export async function handleAplicarMovimientoLote(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;
  const ROLES_MOVIMIENTO = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_MOVIMIENTO.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden aplicar movimientos', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { tipo, motivo, motivo_tipo = 'otro', items } = body;
  if (!tipo || !motivo || !items || !Array.isArray(items) || items.length === 0) {
    return jsonError('Faltan campos: tipo, motivo, items', 400, request);
  }
  if (!['ingreso', 'egreso'].includes(tipo)) return jsonError('tipo debe ser ingreso o egreso', 400, request);
  if (!motivo.trim()) return jsonError('El motivo es obligatorio', 400, request);

  const motivosPermitidos = ['compra_proveedor', 'ajuste_inventario', 'merma', 'devolucion', 'transferencia', 'otro', 'venta'];
  if (!motivosPermitidos.includes(motivo_tipo)) return jsonError('motivo_tipo inválido', 400, request);
  for (const item of items) {
    if (!isValidUuid(item?.producto_id)) return jsonError('producto_id inválido', 400, request);
    if (!Number.isFinite(Number(item?.cantidad)) || Number(item.cantidad) <= 0) {
      return jsonError('La cantidad debe ser mayor a 0', 400, request);
    }
  }

  const idempotencyKey = resolverIdempotencyKey(request, body);
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request);

  try {
    const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/aplicar_movimiento_inventario_atomico`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_cuenta_id: operador.cuenta_id,
        p_tipo: tipo,
        p_motivo: motivo.trim(),
        p_motivo_tipo: motivo_tipo,
        p_items: items,
        p_usuario_id: user.operator_id,
        p_usuario_nombre: operador.nombre,
        p_usuario_color: operador.color || null,
        p_idempotency_key: idempotencyKey,
      }),
    });
    const text = await rpcRes.text();
    let result = null;
    try { result = text ? JSON.parse(text) : null; } catch {
      // Best-effort parse: conservar la respuesta original.
    }
    if (!rpcRes.ok) {
      return jsonError(`No se pudo aplicar el movimiento atómico: ${result?.message || text || `HTTP ${rpcRes.status}`}`, 400, request);
    }
    if (!result?.ok) return jsonError('La RPC no confirmó el movimiento atómico', 500, request);

    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'INVENTARIO', accion: tipo === 'ingreso' ? 'INGRESO_INVENTARIO' : 'EGRESO_INVENTARIO',
        descripcion: `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} atómico de ${items.length} producto(s): ${motivo}`,
        entidadTipo: 'inventario', entidadId: result.lote_id, meta: { tipo, motivo, motivo_tipo, items_count: items.length, numero: result.numero, idempotency_key: idempotencyKey, idempotent: result.idempotent === true }, ip,
      });
    } catch {
      // Best-effort operation; preserve the primary response.
    }

    return json({ lote_id: result.lote_id, numero: result.numero, movimientos: result.movimientos }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al aplicar movimiento atómico', 500, request);
  }
}

// ── Parsear texto WhatsApp → productos del inventario ────────────────────────
export async function handleParseMaterialText(request, env) {
  if (!env.AI) return jsonError('Servicio AI no configurado', 503, request)
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { text } = body
  if (!text || typeof text !== 'string' || text.trim().length < 3) {
    return jsonError('Texto vacío o muy corto', 400, request)
  }

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }

  // 1. Obtener catálogo de productos del tenant (nombre, codigo)
  const prodRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/productos?activo=eq.true&cuenta_id=eq.${operador.cuenta_id}&select=id,nombre,codigo,unidad,precio_usd,precio_2,precio_3,stock_actual,stock_minimo,imagen_url&order=nombre.asc`,
    { headers: h }
  )
  if (!prodRes.ok) return jsonError('Error obteniendo productos', 500, request)
  const productos = await prodRes.json()

  // 2. Construir catálogo compacto para el prompt (codigo|nombre)
  const catalogo = productos.map(p => `${p.codigo || p.id}|${p.nombre}`).join('\n')

  // 3. Usar AI para parsear texto Y hacer matching contra catálogo
  const systemPrompt = `Eres un asistente de ferretería/materiales de construcción. Tu trabajo es:
1. Extraer materiales y cantidades de un texto (mensaje de WhatsApp, lista, nota).
2. Hacer matching inteligente contra el catálogo del inventario.

REGLAS DE MATCHING:
- Usa conocimiento de ferretería: "cabilla 1/2" = "CABILLA 1/2 LISA" o "BARRA LISA 1/2"
- Las medidas pueden estar en diferentes formatos: 1/2, 1/2", 1/2 pulgada, etc.
- Sinónimos comunes: cemento=saco de cemento, pega=pegamento, tubo=tubería, codo=codo PVC, etc.
- Si hay varias coincidencias posibles, devuelve hasta 3 ordenadas por relevancia.
- La cantidad por defecto es 1 si no se especifica.
- Ignora texto que claramente no son materiales (saludos, preguntas, emojis).

CATÁLOGO DE PRODUCTOS (codigo|nombre):
${catalogo}

RESPOnde ÚNICAMENTE en JSON válido con este formato (sin markdown, sin explicaciones):
{"items":[{"descripcionOriginal":"texto exacto del item","cantidad":N,"confianza":0.0-1.0,"matchIds":["codigo1","codigo2"]}]}

- confianza: 1.0 = match exacto, 0.8 = muy probable, 0.5 = posible, 0.3 = poco probable
- matchIds: array de CÓDIGOS del catálogo (máx 3), ordenados por relevancia. Vacío si no hay match.
- Si el texto no contiene materiales, devuelve {"items":[]}`

  let rawAiText = ''
  try {
    const aiResponse = await env.AI.run('@cf/moonshotai/kimi-k2.6', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.trim() },
      ],
      max_tokens: 4000,
      temperature: 0.1,
    })
    rawAiText = aiResponse?.response || ''
  } catch (e) {
    console.error('[PARSE] AI error:', e.message)
    return jsonError(`Error AI: ${e.message}`, 500, request)
  }

  // 4. Parsear respuesta AI
  let parsed
  try {
    // Limpiar posible markdown wrapping
    let clean = rawAiText.trim()
    if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const rawParsed = JSON.parse(clean)
    // Normalizar: la AI puede devolver {items:[...]} o directamente [...]
    if (Array.isArray(rawParsed)) {
      parsed = { items: rawParsed }
    } else {
      parsed = rawParsed
    }
  } catch {
    return json({ items: [], rawAiText, error: 'No se pudo parsear respuesta AI' }, 200, request)
  }

  if (!parsed?.items?.length) {
    return json({ items: [], rawAiText }, 200, request)
  }

  // 5. Mapear matchIds a productos completos (puede ser id o codigo)
  const prodMapById = new Map(productos.map(p => [p.id, p]))
  const prodMapByCodigo = new Map(productos.map(p => [p.codigo, p]).filter(([k]) => k))
  const items = parsed.items.map(item => ({
    descripcionOriginal: item.descripcionOriginal || '',
    cantidad: Math.max(1, Number(item.cantidad) || 1),
    confianza: Math.min(1, Math.max(0, Number(item.confianza) || 0.5)),
    matches: (item.matchIds || [])
      .map(id => prodMapById.get(id) || prodMapByCodigo.get(id))
      .filter(Boolean)
      .map(p => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        unidad: p.unidad,
        precio_usd: Number(p.precio_usd),
        precio_2: p.precio_2 ? Number(p.precio_2) : null,
        precio_3: p.precio_3 ? Number(p.precio_3) : null,
        stock_actual: Number(p.stock_actual),
        stock_minimo: Number(p.stock_minimo),
        imagen_url: p.imagen_url,
      })),
  }))

  return json({ items, rawAiText }, 200, request)
}

// ── Escanear fotografía de lista de materiales (OCR con Llama 3.2 Vision + Kimi) ──
export async function handleScanMaterialList(request, env) {
  if (!env.AI) return jsonError('Servicio AI no configurado', 503, request)
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { image } = body
  if (!image || typeof image !== 'string') {
    return jsonError('Imagen vacía o inválida', 400, request)
  }

  // 1. Convertir Base64 a buffer binario
  let binaryImg
  try {
    binaryImg = Uint8Array.from(atob(image), c => c.charCodeAt(0))
  } catch {
    return jsonError('Error al decodificar la imagen Base64', 400, request)
  }

  // 2. Ejecutar Llama 3.2 Vision para extraer el texto de la imagen (OCR inteligente)
  let extractedText = ''
  try {
    const aiResponse = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      image: [...binaryImg],
      prompt: 'Analiza esta imagen y extrae todos los materiales, productos, artículos y sus cantidades. Escribe únicamente la lista de materiales y cantidades en español, un elemento por línea, sin explicaciones ni markdown. Ejemplo: 10 cabillas de 1/2, 5 pegas azules, etc.',
      max_tokens: 1000,
      temperature: 0.1
    })
    extractedText = aiResponse?.response || ''
  } catch (e) {
    console.error('[SCAN OCR] Vision AI error:', e.message)
    return jsonError(`Error en Vision AI: ${e.message}`, 500, request)
  }

  if (!extractedText.trim()) {
    return json({ items: [], rawAiText: 'No se detectó texto en la imagen' }, 200, request)
  }

  // 3. Obtener catálogo de productos de Supabase
  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }

  const prodRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/productos?activo=eq.true&cuenta_id=eq.${operador.cuenta_id}&select=id,nombre,codigo,unidad,precio_usd,precio_2,precio_3,stock_actual,stock_minimo,imagen_url&order=nombre.asc`,
    { headers: h }
  )
  if (!prodRes.ok) return jsonError('Error obteniendo productos', 500, request)
  const productos = await prodRes.json()

  // 4. Construir catálogo compacto
  const catalogo = productos.map(p => `${p.codigo || p.id}|${p.nombre}`).join('\n')

  // 5. Usar AI Kimi para parsear texto Y hacer matching contra catálogo
  const systemPrompt = `Eres un asistente de ferretería/materiales de construcción. Tu trabajo es:
1. Extraer materiales y cantidades de un texto (mensaje de WhatsApp, lista, nota).
2. Hacer matching inteligente contra el catálogo del inventario.

REGLAS DE MATCHING:
- Usa conocimiento de ferretería: "cabilla 1/2" = "CABILLA 1/2 LISA" o "BARRA LISA 1/2"
- Las medidas pueden estar en diferentes formatos: 1/2, 1/2", 1/2 pulgada, etc.
- Sinónimos comunes: cemento=saco de cemento, pega=pegamento, tubo=tubería, codo=codo PVC, etc.
- Si hay varias coincidencias posibles, devuelve hasta 3 ordenadas por relevancia.
- La cantidad por defecto es 1 si no se especifica.
- Ignora texto que claramente no son materiales (saludos, preguntas, emojis).

CATÁLOGO DE PRODUCTOS (codigo|nombre):
${catalogo}

RESPOnde ÚNICAMENTE en JSON válido con este formato (sin markdown, sin explicaciones):
{"items":[{"descripcionOriginal":"texto exacto del item","cantidad":N,"confianza":0.0-1.0,"matchIds":["codigo1","codigo2"]}]}

- confianza: 1.0 = match exacto, 0.8 = muy probable, 0.5 = posible, 0.3 = poco probable
- matchIds: array de CÓDIGOS del catálogo (máx 3), ordenados por relevancia. Vacío si no hay match.
- Si el texto no contiene materiales, devuelve {"items":[]}`

  let rawAiText = ''
  try {
    const aiResponseKimi = await env.AI.run('@cf/moonshotai/kimi-k2.6', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: extractedText.trim() },
      ],
      max_tokens: 4000,
      temperature: 0.1,
    })
    rawAiText = aiResponseKimi?.response || ''
  } catch (e) {
    console.error('[SCAN PARSE] Kimi AI error:', e.message)
    return jsonError(`Error Kimi AI: ${e.message}`, 500, request)
  }

  // 6. Parsear respuesta AI
  let parsed
  try {
    let clean = rawAiText.trim()
    if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const rawParsed = JSON.parse(clean)
    if (Array.isArray(rawParsed)) {
      parsed = { items: rawParsed }
    } else {
      parsed = rawParsed
    }
  } catch {
    return json({ items: [], rawAiText, error: 'No se pudo parsear respuesta AI' }, 200, request)
  }

  if (!parsed?.items?.length) {
    return json({ items: [], rawAiText }, 200, request)
  }

  // 7. Mapear matchIds a productos completos
  const prodMapById = new Map(productos.map(p => [p.id, p]))
  const prodMapByCodigo = new Map(productos.map(p => [p.codigo, p]).filter(([k]) => k))
  const items = parsed.items.map(item => ({
    descripcionOriginal: item.descripcionOriginal || '',
    cantidad: Math.max(1, Number(item.cantidad) || 1),
    confianza: Math.min(1, Math.max(0, Number(item.confianza) || 0.5)),
    matches: (item.matchIds || [])
      .map(id => prodMapById.get(id) || prodMapByCodigo.get(id))
      .filter(Boolean)
      .map(p => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        unidad: p.unidad,
        precio_usd: Number(p.precio_usd),
        precio_2: p.precio_2 ? Number(p.precio_2) : null,
        precio_3: p.precio_3 ? Number(p.precio_3) : null,
        stock_actual: Number(p.stock_actual),
        stock_minimo: Number(p.stock_minimo),
        imagen_url: p.imagen_url,
      })),
  }))

  return json({ items, rawAiText }, 200, request)
}

// ── Búsqueda Híbrida de Productos (Semántica + Lexical) ──────────────────────
export async function handleBuscarProductosHibrido(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user, operador } = v
  const isSup = ['supervisor', 'administracion', 'jefe', 'desarrollador'].includes(operador.rol)

  let body
  try { body = await request.json() } catch { body = {} }

  const busqueda = (body.busqueda || '').trim()
  const categoria = (body.categoria || '').trim()
  const page = Math.max(0, parseInt(body.page || '0'))
  const limit = Math.min(100, Math.max(1, parseInt(body.limit || '100')))
  const isGroup = body.categoria_grupo === true
  const incluirInactivos = body.incluir_inactivos === true
  const puedeVerInactivos = isSup && incluirInactivos

  let embedding = null

  if (busqueda !== '') {
    try {
      const aiResponse = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [busqueda] })
      if (aiResponse && aiResponse.data && aiResponse.data[0]) {
        embedding = `[${aiResponse.data[0].join(',')}]`
      }
    } catch (e) {
      console.error('[HYBRID_SEARCH] AI Error:', e.message)
    }
  }

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  }

  const rpcBody = {
    p_busqueda: busqueda,
    p_embedding: embedding,
    p_categoria: categoria,
    p_categoria_grupo: isGroup,
    p_limit: limit,
    p_offset: page * limit,
    p_cuenta_id: user.id
  }

  let res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/buscar_productos_hibrido`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      ...rpcBody,
      p_incluir_inactivos: puedeVerInactivos
    })
  })

  if (!res.ok) {
    const errorText = await res.text()
    let parsedError = {}
    try { parsedError = JSON.parse(errorText) } catch {
      // Conservar el texto original si la respuesta no es JSON.
    }

    // Fallback: Si falla por PGRST202 (firma de función no coincide), reintentamos sin p_incluir_inactivos ni p_cuenta_id
    if (parsedError.code === 'PGRST202') {
      console.log('[HYBRID_SEARCH] RPC signature mismatch, retrying with legacy parameters...')
      res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/buscar_productos_hibrido`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          p_busqueda: busqueda,
          p_embedding: embedding,
          p_categoria: categoria,
          p_categoria_grupo: isGroup,
          p_limit: limit,
          p_offset: page * limit
        })
      })
    } else {
      console.error('[HYBRID_SEARCH] RPC Error:', errorText)
      return jsonError('Error en búsqueda híbrida', 500, request)
    }
  }

  if (!res.ok) {
    const text = await res.text()
    console.error('[HYBRID_SEARCH] RPC Fallback Error:', text)
    return jsonError('Error en búsqueda híbrida', 500, request)
  }

  const productos = await res.json()
  const totalCount = productos.length > 0 ? Number(productos[0].total_count) : 0
  const productosLimpio = productos.map(({ total_count: _total_count, vector_distance: _vector_distance, costo_usd, ...rest }) => {
    return isSup ? { ...rest, costo_usd } : rest
  })
  
  return json({ productos: productosLimpio, totalCount }, 200, request)
}

// ── Sincronizar Embeddings de Productos (Admin) ──────────────────────────────
export async function handleSyncEmbeddings(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user, operador } = v
  if (!['administracion', 'jefe', 'desarrollador'].includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden sincronizar embeddings', 403, request)
  }

  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?vector_embedding=is.null&activo=eq.true&cuenta_id=eq.${user.id}&limit=50&select=id,nombre,categoria,descripcion`, { headers: h })
  if (!res.ok) return jsonError('Error obteniendo productos', 500, request)
  
  const productos = await res.json()
  if (productos.length === 0) return json({ ok: true, message: 'Todos los productos tienen embedding', procesados: 0 }, 200, request)

  let procesados = 0
  for (const p of productos) {
    const text = `${p.nombre} ${p.categoria || ''} ${p.descripcion || ''}`.trim()
    try {
      const aiResponse = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [text] })
      if (aiResponse && aiResponse.data && aiResponse.data[0]) {
        const embedding = `[${aiResponse.data[0].join(',')}]`
        await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${p.id}`, {
          method: 'PATCH',
          headers: h,
          body: JSON.stringify({ vector_embedding: embedding })
        })
        procesados++
      }
    } catch (e) {
      console.error('[SYNC_EMBEDDINGS] Error para producto', p.id, e.message)
    }
  }

  return json({ ok: true, procesados, faltantes_estimados: productos.length === 50 ? 'mas de 50' : 0 }, 200, request)
}

// ── Actualización Masiva de Precios (Admin) ──────────────────────────────────
export async function handleBatchPriceUpdate(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_BATCH = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_BATCH.includes(operador.rol)) {
    return jsonError('Permisos insuficientes para actualización masiva de precios', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { 
    modo, porcentaje, valor_fijo,
    categoria, precio_objetivo, preview_only 
  } = body;

  if (!['porcentaje', 'valor_fijo'].includes(modo)) return jsonError('Modo inválido', 400, request);
  if (!['precio_usd', 'precio_2', 'precio_3', 'todos'].includes(precio_objetivo)) return jsonError('Precio objetivo inválido', 400, request);

  // Tenant-safety: el tenant siempre es el del operador autenticado, nunca
  // el enviado por el cliente (evita actualizar precios de otro tenant).
  const cuentaId = operador.cuenta_id;

  // 1. Obtener productos activos del tenant
  let query = `${env.SUPABASE_URL}/rest/v1/productos?activo=eq.true&cuenta_id=eq.${cuentaId}&select=id,nombre,precio_usd,precio_2,precio_3,categoria`;
  if (categoria) {
    query += `&categoria=eq.${encodeURIComponent(categoria)}`;
  }

  const prodRes = await fetch(query, { headers });
  if (!prodRes.ok) return jsonError('Error al obtener productos', 500, request);
  const productos = await prodRes.json();

  if (productos.length === 0) return json({ count: 0, updated: 0, message: 'No se encontraron productos' }, 200, request);

  const calculateNewPrice = (current) => {
    let newVal = 0;
    const actual = Number(current || 0);
    if (modo === 'porcentaje') {
      newVal = actual * (1 + (Number(porcentaje) || 0) / 100);
    } else {
      newVal = Number(valor_fijo) || 0;
    }
    return Math.round(newVal * 100) / 100;
  };

  const fieldMap = {
    'precio_usd': ['precio_usd'],
    'precio_2': ['precio_2'],
    'precio_3': ['precio_3'],
    'todos': ['precio_usd', 'precio_2', 'precio_3']
  };

  const targetFields = fieldMap[precio_objetivo];
  const timestamp = new Date().toISOString();

  if (preview_only) {
    const ejemplos = productos.slice(0, 3).map(p => {
      const result = { nombre: p.nombre };
      targetFields.forEach(f => {
        result[f] = { actual: p[f], nuevo: calculateNewPrice(p[f]) };
      });
      return result;
    });
    return json({ count: productos.length, ejemplos }, 200, request);
  }

  // Actualización masiva (vía RPC o múltiples patches, preferimos upsert si js-sdk permitiera bulk patch por id)
  // Como fetch directo a PostgREST no soporta "bulk patch different values", usamos upsert con IDs
  const updates = productos.map(p => {
    const updateObj = { id: p.id, actualizado_en: timestamp };
    targetFields.forEach(f => {
      updateObj[f] = calculateNewPrice(p[f]);
    });
    return updateObj;
  });

  // Dividir en batches de 100 para evitar límites de payload
  const batchSize = 100;
  let totalUpdated = 0;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(batch)
    });
    if (!upRes.ok) {
      const errText = await upRes.text();
      return jsonError(`Error al actualizar batch: ${errText}`, 500, request);
    }
    totalUpdated += batch.length;
  }

  // Auditoría
  try {
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'INVENTARIO', accion: 'BATCH_PRICE_UPDATE',
      descripcion: `Actualización masiva de precios (${modo}): ${totalUpdated} productos.`,
      entidadTipo: 'productos', entidadId: null, 
      meta: { modo, porcentaje, valor_fijo, categoria, precio_objetivo, count: totalUpdated }, ip
    });
  } catch {
    // La auditoría es best-effort y no debe invalidar la actualización.
  }

  return json({ updated: totalUpdated }, 200, request);
}

// ── Producto + Kardex: helpers para RPCs tenant-safe ───────────────────────
function productTextOrNull(value, field) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${field} inválido`)
  return value.trim() || null
}

function productNumber(value, field, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${field} inválido`)
  return number
}

async function readProductBody(request) {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Body inválido')
    return body
  } catch (error) {
    throw new Error(error.message || 'Body inválido')
  }
}

async function callProductKardexRpc(request, env, rpcName, payload, context) {
  const { user, operador, headers, ip, action, description, requestedProductId, meta = {} } = context
  let rpcRes
  try {
    rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch (error) {
    return jsonError(`Error conectando con la RPC de producto: ${error.message}`, 502, request)
  }

  const text = await rpcRes.text()
  let result = null
  try { result = text ? JSON.parse(text) : null } catch {
    // Conservar el texto original para diagnosticar respuestas no JSON.
  }

  if (!rpcRes.ok) {
    return jsonError(result?.message || result?.details || text || `HTTP ${rpcRes.status}`, 400, request)
  }
  if (!result?.ok) return jsonError('La RPC de producto no confirmó la operación', 500, request)

  if (!result.idempotent) {
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id,
        usuarioNombre: operador.nombre,
        usuarioRol: operador.rol,
        categoria: 'INVENTARIO',
        accion: action,
        descripcion: description,
        entidadTipo: 'productos',
        entidadId: result.id || result.producto_id || requestedProductId || null,
        meta: { ...meta, idempotency_key: payload.p_idempotency_key },
        ip,
      })
    } catch {
      // La auditoría es best-effort; la RPC ya confirmó la transacción atómica.
    }
  }

  return json({ ok: true, ...result }, 200, request)
}

// ── Crear producto con Kardex (Worker/service_role) ─────────────────────────
export async function handleCrearProductoConKardex(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user, operador, headers, ip } = v
  const roles = ['supervisor', 'administracion', 'jefe', 'desarrollador']
  if (!roles.includes(operador.rol)) return jsonError('Permisos insuficientes para crear productos', 403, request)

  let body
  try { body = await readProductBody(request) } catch (error) { return jsonError(error.message, 400, request) }
  const idempotencyKey = resolverIdempotencyKey(request, body)
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request)

  let nombre
  try { nombre = productTextOrNull(body.nombre, 'nombre') } catch (error) { return jsonError(error.message, 400, request) }
  if (!nombre) return jsonError('nombre requerido', 400, request)

  let payload
  try {
    const stock = productNumber(body.stock_actual, 'stock_actual', 0)
    if (stock < 0) return jsonError('stock_actual no puede ser negativo', 400, request)
    payload = {
      p_cuenta_id: operador.cuenta_id,
      p_usuario_id: user.operator_id,
      p_usuario_nombre: operador.nombre || null,
      p_usuario_color: operador.color || null,
      p_codigo: productTextOrNull(body.codigo, 'codigo'),
      p_nombre: nombre,
      p_descripcion: productTextOrNull(body.descripcion, 'descripcion'),
      p_categoria: productTextOrNull(body.categoria, 'categoria'),
      p_unidad: productTextOrNull(body.unidad, 'unidad') || 'und',
      p_precio_usd: productNumber(body.precio_usd, 'precio_usd', 0),
      p_costo_usd: productNumber(body.costo_usd, 'costo_usd'),
      p_stock_actual: stock,
      p_stock_minimo: productNumber(body.stock_minimo, 'stock_minimo', 0),
      p_imagen_url: productTextOrNull(body.imagen_url, 'imagen_url'),
      p_precio_2: productNumber(body.precio_2, 'precio_2'),
      p_precio_3: productNumber(body.precio_3, 'precio_3'),
      p_precio1_porcentaje: productNumber(body.precio1_porcentaje, 'precio1_porcentaje'),
      p_precio2_porcentaje: productNumber(body.precio2_porcentaje, 'precio2_porcentaje'),
      p_precio3_porcentaje: productNumber(body.precio3_porcentaje, 'precio3_porcentaje'),
      p_idempotency_key: idempotencyKey,
    }
  } catch (error) {
    return jsonError(error.message, 400, request)
  }

  return callProductKardexRpc(request, env, 'crear_producto_con_kardex_tenant_safe', payload, {
    user, operador, headers, ip,
    action: 'CREAR_PRODUCTO',
    description: `Creación atómica de producto ${nombre}`,
    meta: { codigo: payload.p_codigo, stock_inicial: payload.p_stock_actual },
  })
}

// ── Actualizar producto con Kardex (Worker/service_role) ────────────────────
export async function handleActualizarProductoConKardex(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user, operador, headers, ip } = v
  const roles = ['supervisor', 'administracion', 'jefe', 'desarrollador']
  if (!roles.includes(operador.rol)) return jsonError('Permisos insuficientes para actualizar productos', 403, request)

  let body
  try { body = await readProductBody(request) } catch (error) { return jsonError(error.message, 400, request) }
  if (!isValidUuid(body.id)) return jsonError('id de producto inválido', 400, request)
  const idempotencyKey = resolverIdempotencyKey(request, body)
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request)

  let payload
  try {
    payload = {
      p_cuenta_id: operador.cuenta_id,
      p_usuario_id: user.operator_id,
      p_producto_id: body.id,
      p_usuario_nombre: operador.nombre || null,
      p_usuario_color: operador.color || null,
      p_codigo: productTextOrNull(body.codigo, 'codigo'),
      p_nombre: productTextOrNull(body.nombre, 'nombre'),
      p_descripcion: productTextOrNull(body.descripcion, 'descripcion'),
      p_categoria: productTextOrNull(body.categoria, 'categoria'),
      p_unidad: productTextOrNull(body.unidad, 'unidad'),
      p_precio_usd: productNumber(body.precio_usd, 'precio_usd'),
      p_costo_usd: productNumber(body.costo_usd, 'costo_usd'),
      p_stock_actual: productNumber(body.stock_actual, 'stock_actual'),
      p_stock_minimo: productNumber(body.stock_minimo, 'stock_minimo'),
      p_imagen_url: productTextOrNull(body.imagen_url, 'imagen_url'),
      p_precio_2: productNumber(body.precio_2, 'precio_2'),
      p_precio_3: productNumber(body.precio_3, 'precio_3'),
      p_precio1_porcentaje: productNumber(body.precio1_porcentaje, 'precio1_porcentaje'),
      p_precio2_porcentaje: productNumber(body.precio2_porcentaje, 'precio2_porcentaje'),
      p_precio3_porcentaje: productNumber(body.precio3_porcentaje, 'precio3_porcentaje'),
      p_idempotency_key: idempotencyKey,
    }
  } catch (error) {
    return jsonError(error.message, 400, request)
  }

  return callProductKardexRpc(request, env, 'actualizar_producto_con_kardex_tenant_safe', payload, {
    user, operador, headers, ip,
    action: 'ACTUALIZAR_PRODUCTO',
    description: `Actualización atómica de producto ${body.id}`,
    requestedProductId: body.id,
    meta: { stock_nuevo: payload.p_stock_actual, codigo: payload.p_codigo },
  })
}

// ── Borrar producto con Kardex (Worker/service_role) ────────────────────────
export async function handleBorrarProductoConKardex(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { user, operador, headers, ip } = v
  const roles = ['administracion', 'jefe', 'desarrollador']
  if (!roles.includes(operador.rol)) return jsonError('Solo administración, jefe o desarrollador pueden borrar productos', 403, request)

  let body
  try { body = await readProductBody(request) } catch (error) { return jsonError(error.message, 400, request) }
  const productId = body.id || body.producto_id
  if (!isValidUuid(productId)) return jsonError('id de producto inválido', 400, request)
  const idempotencyKey = resolverIdempotencyKey(request, body)
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request)

  const payload = {
    p_cuenta_id: operador.cuenta_id,
    p_producto_id: productId,
    p_usuario_id: user.operator_id,
    p_usuario_nombre: operador.nombre || null,
    p_usuario_color: operador.color || null,
    p_confirmacion: 'BORRAR_PRODUCTO',
    p_idempotency_key: idempotencyKey,
  }

  return callProductKardexRpc(request, env, 'borrar_producto_con_kardex_tenant_safe', payload, {
    user, operador, headers, ip,
    action: 'BORRAR_PRODUCTO',
    description: `Borrado atómico de producto ${productId}`,
    requestedProductId: productId,
  })
}

// ── Actualización de metadatos de producto (imagen_url / activo) ──────────
// Migrado desde writes directos del frontend (ProductoForm.jsx y useDesactivarProducto)
// para que 06 pueda revocar UPDATE de productos a authenticated. Este handler
// escribe por service_role (headers de validateOperator) y valida tenant.
export async function handleActualizarProductoMetadatos(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES = ['administracion', 'jefe', 'desarrollador', 'supervisor'];
  if (!ROLES.includes(operador.rol)) {
    return jsonError('Permisos insuficientes para actualizar producto', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }
  const { id } = body;
  if (!id || typeof id !== 'string') return jsonError('id requerido', 400, request);

  const hasImagen = Object.prototype.hasOwnProperty.call(body, 'imagen_url');
  const hasActivo = Object.prototype.hasOwnProperty.call(body, 'activo');
  if (!hasImagen && !hasActivo) return jsonError('Sin campos a actualizar (imagen_url o activo)', 400, request);
  if (hasActivo && typeof body.activo !== 'boolean') return jsonError('activo debe ser booleano', 400, request);

  // Tenant-safety: el producto debe pertenecer a la cuenta del operador.
  const cuentaId = operador.cuenta_id;
  const idQ = encodeURIComponent(id);
  const cuentaQ = encodeURIComponent(cuentaId);
  const checkRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${idQ}&cuenta_id=eq.${cuentaQ}&select=id`, { headers });
  if (!checkRes.ok) return jsonError('Error verificando producto', 500, request);
  const checkData = await checkRes.json();
  if (!Array.isArray(checkData) || checkData.length === 0) {
    return jsonError('Producto no encontrado o no pertenece a tu cuenta', 404, request);
  }

  const patch = { actualizado_en: new Date().toISOString() };
  if (hasImagen) patch.imagen_url = body.imagen_url; // puede ser null (quitar imagen)
  if (hasActivo) patch.activo = body.activo;

  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${idQ}&cuenta_id=eq.${cuentaQ}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!upRes.ok) {
    const errText = await upRes.text().catch(() => '');
    return jsonError(`Error actualizando producto: ${errText}`, 500, request);
  }
  const updated = await upRes.json();

  // Auditoría best-effort (no invalida la actualización).
  try {
    await registrarAuditoria(env, headers, {
      usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
      categoria: 'INVENTARIO', accion: 'ACTUALIZAR_PRODUCTO_METADATOS',
      descripcion: 'Actualización de metadatos del producto (imagen_url/activo)',
      entidadTipo: 'productos', entidadId: id,
      meta: { imagen_url: hasImagen ? body.imagen_url : undefined, activo: hasActivo ? body.activo : undefined },
      ip,
    });
  } catch {
    // best-effort
  }

  return json({ ok: true, producto: updated?.[0] || { id } }, 200, request);
}

// ── Transformación de Inventario (Procesamiento de un producto en otro) ──────
export async function handleTransformacionInventario(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_TRANSFORM = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_TRANSFORM.includes(operador.rol)) {
    return jsonError('Permisos insuficientes para realizar transformaciones', 403, request);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Body inválido', 400, request); }

  const { origen, destino, motivo } = body;
  const origenCantidad = Number(origen?.cantidad);
  const destinoCantidad = Number(destino?.cantidad);

  if (!isValidUuid(origen?.producto_id) || !isValidUuid(destino?.producto_id)
      || !Number.isFinite(origenCantidad) || origenCantidad <= 0
      || !Number.isFinite(destinoCantidad) || destinoCantidad <= 0
      || !motivo?.trim()) {
    return jsonError('Faltan o son inválidos origen, destino, cantidades o motivo', 400, request);
  }

  if (origen.producto_id === destino.producto_id) {
    return jsonError('Origen y destino no pueden ser el mismo producto', 400, request);
  }

  const idempotencyKey = resolverIdempotencyKey(request, body);
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request);

  try {
    const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/transformar_inventario_atomico`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_cuenta_id: operador.cuenta_id,
        p_origen_producto_id: origen.producto_id,
        p_origen_cantidad: origenCantidad,
        p_destino_producto_id: destino.producto_id,
        p_destino_cantidad: destinoCantidad,
        p_motivo: motivo.trim(),
        p_usuario_id: user.operator_id,
        p_usuario_nombre: operador.nombre,
        p_usuario_color: operador.color || null,
        p_idempotency_key: idempotencyKey,
      }),
    });
    const text = await rpcRes.text();
    let result = null;
    try { result = text ? JSON.parse(text) : null; } catch {
      // Best-effort parse: conservar la respuesta original.
    }
    if (!rpcRes.ok) {
      return jsonError(`No se pudo aplicar la transformación atómica: ${result?.message || text || `HTTP ${rpcRes.status}`}`, 400, request);
    }
    if (!result?.ok) return jsonError('La RPC no confirmó la transformación atómica', 500, request);

    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'INVENTARIO', accion: 'TRANSFORMACION_INVENTARIO',
        descripcion: `Transformación atómica (${origenCantidad}) → (${destinoCantidad}): ${motivo.trim()}`,
        entidadTipo: 'inventario', entidadId: result.lote_id,
        meta: { motivo: motivo.trim(), origen, destino, lote_id: result.lote_id, numero: result.numero }, ip,
      });
    } catch {
      // Best-effort operation; preserve the primary response.
    }

    return json({ ok: true, lote_id: result.lote_id, numero: result.numero, origen: result.origen, destino: result.destino }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error en transformación atómica', 500, request);
  }
}

// ── Ingreso masivo por lote (admin / supervisor) ─────────────────────────────
export async function handleBatchIngest(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user, operador, headers, ip } = v;

  const ROLES_BATCH = ['supervisor', 'administracion', 'jefe', 'desarrollador'];
  if (!ROLES_BATCH.includes(operador.rol)) {
    return jsonError('Permisos insuficientes para ingreso masivo de productos', 403, request);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Body inválido', 400, request);
  }

  const { motivo, productos } = body;
  if (!motivo?.trim() || !Array.isArray(productos) || productos.length === 0) {
    return jsonError('Faltan campos: motivo o lista de productos vacía', 400, request);
  }

  const productosRpc = [];
  for (const p of productos) {
    const isNuevo = p?.isNuevo === true;
    if (!isNuevo && !isValidUuid(p?.id)) {
      return jsonError('Producto existente sin id válido', 400, request);
    }
    if (isNuevo && !p?.nombre?.trim()) {
      return jsonError('Producto nuevo sin nombre', 400, request);
    }
    const cantidad = Number(p?.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return jsonError('La cantidad debe ser mayor a 0', 400, request);
    }
    if (!isNuevo && p?.modoExistente && !['sumar', 'sobrescribir'].includes(p.modoExistente)) {
      return jsonError('modoExistente debe ser "sumar" o "sobrescribir"', 400, request);
    }

    productosRpc.push({
      producto_id: isNuevo ? null : p.id,
      is_nuevo: isNuevo,
      codigo: p.codigo ? String(p.codigo).toUpperCase().trim() : null,
      nombre: p.nombre ? String(p.nombre).toUpperCase().trim() : null,
      categoria: p.categoria ?? null,
      unidad: p.unidad || 'und',
      cantidad,
      costo_usd: Number(p.costo) || 0,
      precio_usd: Number(p.precio) || 0,
      modo_existente: isNuevo ? null : (p.modoExistente || 'sumar'),
      actualizar_costo: p.actualizarCosto === true,
    });
  }

  const idempotencyKey = resolverIdempotencyKey(request, body);
  if (!isValidUuid(idempotencyKey)) return jsonError('Idempotency-Key inválida', 400, request);

  try {
    const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ingresar_lote_inventario_atomico`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_cuenta_id: operador.cuenta_id,
        p_motivo: motivo.trim(),
        p_productos: productosRpc,
        p_usuario_id: user.operator_id,
        p_usuario_nombre: operador.nombre,
        p_usuario_color: operador.color || null,
        p_idempotency_key: idempotencyKey,
      }),
    });
    const text = await rpcRes.text();
    let result = null;
    try { result = text ? JSON.parse(text) : null; } catch {
      // Best-effort parse: conservar la respuesta original.
    }
    if (!rpcRes.ok) {
      return jsonError(`No se pudo aplicar el ingreso masivo atómico: ${result?.message || text || `HTTP ${rpcRes.status}`}`, 400, request);
    }
    if (!result?.ok) return jsonError('La RPC no confirmó el ingreso masivo atómico', 500, request);

    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id,
        usuarioNombre: operador.nombre,
        usuarioRol: operador.rol,
        categoria: 'INVENTARIO',
        accion: 'BATCH_INGEST_PRODUCTOS',
        descripcion: `Ingreso masivo por lote: ${result.procesados} productos procesados (${result.nuevos ?? 0} nuevos). Motivo: ${motivo.trim()}`,
        entidadTipo: 'inventario',
        entidadId: result.lote_id,
        meta: { motivo: motivo.trim(), lote_id: result.lote_id, count_nuevos: result.nuevos ?? 0, count_existentes: (result.procesados ?? 0) - (result.nuevos ?? 0), movimientos: result.movimientos, idempotency_key: idempotencyKey, idempotent: result.idempotent === true },
        ip,
      });
    } catch (e) {
      console.error('[BATCH_INGEST] Audit error:', e.message);
    }

    return json({ ok: true, procesados: result.procesados, lote_id: result.lote_id, nuevos: result.nuevos, movimientos: result.movimientos }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error en proceso de ingreso masivo', 500, request);
  }
}
