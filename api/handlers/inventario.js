// api/handlers/inventario.js
import { json, jsonError, corsHeaders } from '../lib/utils.js'
import { verifyAuth, verifySupervisor, validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'

// ── PDF temporal handler (para WhatsApp) ──────────────────────────────────
export async function handlePdfTemp(request, env) {
  const v = await validateOperator(request, env);
  if (v.error) return v.error;
  const { user } = v;

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
  const { operador, headers: h } = v;
  const ROLES_CLEAR = ['administracion', 'jefe', 'desarrollador'];
  if (!ROLES_CLEAR.includes(operador.rol)) {
    return jsonError('Solo administración, jefe o desarrollador pueden borrar el inventario', 403, request);
  }

  // Borrar kardex (movimientos) antes de productos
  await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: h,
  });

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: h,
  });

  if (!res.ok) {
    const text = await res.text();
    return jsonError(`Error al borrar: ${text}`, 500, request);
  }

  return json({ ok: true }, 200, request);
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

  try {
    const loteId = crypto.randomUUID();
    const movimientos = [];

    for (const item of items) {
      const cantidad = Number(item.cantidad);
      if (cantidad <= 0) return jsonError('La cantidad debe ser mayor a 0', 400, request);

      // Obtener producto
      const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}&activo=eq.true&select=id,nombre,stock_actual`, { headers });
      const [prod] = await pRes.json();
      if (!prod) return jsonError('Producto no encontrado o inactivo', 400, request);

      let nuevoStock;
      if (tipo === 'egreso') {
        nuevoStock = Number(prod.stock_actual) - cantidad;
        if (nuevoStock < 0) {
          return jsonError(`Stock insuficiente para "${prod.nombre}": tiene ${prod.stock_actual} y se intenta retirar ${cantidad}`, 400, request);
        }
      } else {
        nuevoStock = Number(prod.stock_actual) + cantidad;
      }

      // Actualizar stock
      await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${item.producto_id}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ stock_actual: nuevoStock, actualizado_en: new Date().toISOString() }),
      });

      movimientos.push({
        lote_id: loteId,
        tipo,
        motivo: motivo.trim(),
        motivo_tipo,
        producto_id: item.producto_id,
        producto_nombre: prod.nombre,
        cantidad,
        stock_anterior: Number(prod.stock_actual),
        stock_nuevo: nuevoStock,
        usuario_id: user.operator_id,
        usuario_nombre: operador.nombre,
      });
    }

    // Insertar todos los movimientos
    const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos?select=numero`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(movimientos),
    });
    const movResults = await insRes.json();
    const numero = movResults?.[0]?.numero || null;

    // Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'INVENTARIO', accion: tipo === 'ingreso' ? 'INGRESO_INVENTARIO' : 'EGRESO_INVENTARIO',
        descripcion: `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} de ${items.length} producto(s): ${motivo}`,
        entidadTipo: 'inventario', entidadId: loteId, meta: { tipo, motivo, motivo_tipo, items_count: items.length, numero }, ip,
      });
    } catch {}

    return json({ lote_id: loteId, numero }, 200, request);
  } catch (e) {
    return jsonError(e.message || 'Error al aplicar movimiento', 500, request);
  }
}

// ── Parsear texto WhatsApp → productos del inventario ────────────────────────
export async function handleParseMaterialText(request, env) {
  if (!env.AI) return jsonError('Servicio AI no configurado', 503, request)
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)

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
    `${env.SUPABASE_URL}/rest/v1/productos?activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,codigo,unidad,precio_usd,precio_2,precio_3,stock_actual,stock_minimo,imagen_url&order=nombre.asc`,
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

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/buscar_productos_hibrido`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(rpcBody)
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[HYBRID_SEARCH] RPC Error:', text)
    return jsonError('Error en búsqueda híbrida', 500, request)
  }

  const productos = await res.json()
  const totalCount = productos.length > 0 ? Number(productos[0].total_count) : 0
  const productosLimpio = productos.map(({ total_count, vector_distance, costo_usd, ...rest }) => {
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
    cuenta_id, modo, porcentaje, valor_fijo, 
    categoria, precio_objetivo, preview_only 
  } = body;

  if (!cuenta_id) return jsonError('cuenta_id es obligatorio', 400, request);
  if (!['porcentaje', 'valor_fijo'].includes(modo)) return jsonError('Modo inválido', 400, request);
  if (!['precio_usd', 'precio_2', 'precio_3', 'todos'].includes(precio_objetivo)) return jsonError('Precio objetivo inválido', 400, request);

  // 1. Obtener productos activos del tenant
  let query = `${env.SUPABASE_URL}/rest/v1/productos?activo=eq.true&cuenta_id=eq.${cuenta_id}&select=id,nombre,precio_usd,precio_2,precio_3,categoria`;
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
  } catch {}

  return json({ updated: totalUpdated }, 200, request);
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

  if (!origen?.producto_id || !origen?.cantidad || !destino?.producto_id || !destino?.cantidad || !motivo) {
    return jsonError('Faltan campos: origen, destino, motivo', 400, request);
  }

  if (origen.producto_id === destino.producto_id) {
    return jsonError('Origen y destino no pueden ser el mismo producto', 400, request);
  }

  const loteId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  try {
    // 1. Fetch producto origen
    const oriRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${origen.producto_id}&cuenta_id=eq.${user.id}&activo=eq.true&select=id,nombre,stock_actual`, { headers });
    const oriData = await oriRes.json();
    if (!Array.isArray(oriData) || oriData.length === 0) return jsonError('Producto origen no encontrado', 400, request);
    const prodOri = oriData[0];

    if (Number(prodOri.stock_actual) < Number(origen.cantidad)) {
      return jsonError(`Stock insuficiente en origen. Disponible: ${prodOri.stock_actual}`, 400, request);
    }

    // 2. Fetch producto destino
    const desRes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${destino.producto_id}&cuenta_id=eq.${user.id}&activo=eq.true&select=id,nombre,stock_actual`, { headers });
    const desData = await desRes.json();
    if (!Array.isArray(desData) || desData.length === 0) return jsonError('Producto destino no encontrado', 400, request);
    const prodDes = desData[0];

    const stockNuevoOri = Math.round((Number(prodOri.stock_actual) - Number(origen.cantidad)) * 100) / 100;
    const stockNuevoDes = Math.round((Number(prodDes.stock_actual) + Number(destino.cantidad)) * 100) / 100;

    // 3. PATCH producto origen
    const patchOri = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${origen.producto_id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ stock_actual: stockNuevoOri, actualizado_en: timestamp }),
    });
    if (!patchOri.ok) throw new Error('Error al descontar stock de origen');

    // 4. PATCH producto destino
    const patchDes = await fetch(`${env.SUPABASE_URL}/rest/v1/productos?id=eq.${destino.producto_id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ stock_actual: stockNuevoDes, actualizado_en: timestamp }),
    });
    if (!patchDes.ok) throw new Error('Error al sumar stock de destino');

    // 5. INSERT movimientos
    const movimientos = [
      {
        lote_id: loteId,
        tipo: "egreso",
        motivo: motivo.trim(),
        motivo_tipo: "otro",
        producto_id: prodOri.id,
        producto_nombre: prodOri.nombre,
        cantidad: Number(origen.cantidad),
        stock_anterior: Number(prodOri.stock_actual),
        stock_nuevo: stockNuevoOri,
        usuario_id: user.operator_id,
        usuario_nombre: operador.nombre
      },
      {
        lote_id: loteId,
        tipo: "ingreso",
        motivo: motivo.trim(),
        motivo_tipo: "otro",
        producto_id: prodDes.id,
        producto_nombre: prodDes.nombre,
        cantidad: Number(destino.cantidad),
        stock_anterior: Number(prodDes.stock_actual),
        stock_nuevo: stockNuevoDes,
        usuario_id: user.operator_id,
        usuario_nombre: operador.nombre
      }
    ];

    const movRes = await fetch(`${env.SUPABASE_URL}/rest/v1/inventario_movimientos`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(movimientos),
    });
    if (!movRes.ok) {
      const errText = await movRes.text();
      throw new Error(`Error al registrar movimientos: ${errText}`);
    }

    // 6. Auditoría
    try {
      await registrarAuditoria(env, headers, {
        usuarioId: user.operator_id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
        categoria: 'INVENTARIO', accion: 'TRANSFORMACION_INVENTARIO',
        descripcion: `Transformación: ${prodOri.nombre} (${origen.cantidad}) → ${prodDes.nombre} (${destino.cantidad})`,
        entidadTipo: 'inventario', entidadId: loteId, 
        meta: { motivo, origen, destino, lote_id: loteId }, ip,
      });
    } catch {}

    return json({ 
      ok: true, 
      lote_id: loteId, 
      origen: { nombre: prodOri.nombre, stock_nuevo: stockNuevoOri },
      destino: { nombre: prodDes.nombre, stock_nuevo: stockNuevoDes } 
    }, 200, request);

  } catch (e) {
    return jsonError(e.message || 'Error en proceso de transformación', 500, request);
  }
}
