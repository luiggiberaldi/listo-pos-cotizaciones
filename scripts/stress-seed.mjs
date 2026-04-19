// scripts/stress-seed.mjs
// Stress test de datos — genera volumen masivo para probar rendimiento
// Ejecutar: node scripts/stress-seed.mjs [--level small|medium|large|extreme]
//
// Niveles:
//   small    →  100 productos,   50 clientes,   200 cotizaciones (~800 items)
//   medium   →  300 productos,  150 clientes,   600 cotizaciones (~2400 items)
//   large    →  500 productos,  300 clientes,  1500 cotizaciones (~6000 items)
//   extreme  → 1000 productos,  500 clientes,  3000 cotizaciones (~12000 items)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://oyfyuszgjwcepjpngclv.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_SERVICE_KEY) {
  console.error('✗ Falta SUPABASE_SERVICE_KEY')
  process.exit(1)
}

// ── Configuración por nivel ─────────────────────────────────────────────────
const LEVELS = {
  small:   { productos: 100,  clientes: 50,   cotizaciones: 200,  itemsPorCot: [2, 6] },
  medium:  { productos: 300,  clientes: 150,  cotizaciones: 600,  itemsPorCot: [2, 8] },
  large:   { productos: 500,  clientes: 300,  cotizaciones: 1500, itemsPorCot: [2, 8] },
  extreme: { productos: 1000, clientes: 500,  cotizaciones: 3000, itemsPorCot: [3, 10] },
}

const levelArg = process.argv.find(a => a.startsWith('--level='))?.split('=')[1]
  || process.argv[process.argv.indexOf('--level') + 1]
  || 'medium'
const LEVEL = LEVELS[levelArg]
if (!LEVEL) {
  console.error(`✗ Nivel inválido: ${levelArg}. Usar: small, medium, large, extreme`)
  process.exit(1)
}

const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

// ── Utilidades ──────────────────────────────────────────────────────────────
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function randFloat(min, max, dec = 2) { return +(Math.random() * (max - min) + min).toFixed(dec) }
function pick(arr) { return arr[rand(0, arr.length - 1)] }
function uuid() { return crypto.randomUUID() }

const CATEGORIAS = ['Cemento', 'Pintura', 'Herramientas', 'Electricidad', 'Plomería', 'Fijación', 'Ferretería General', 'Seguridad Industrial', 'Iluminación', 'Jardinería']
const UNIDADES = ['und', 'bolsa', 'kg', 'rollo', 'caja', 'metro', 'galón', 'litro', 'par', 'juego']
const ESTADOS = ['borrador', 'enviada', 'aceptada', 'rechazada', 'anulada']
const ESTADOS_PESO = { borrador: 30, enviada: 35, aceptada: 20, rechazada: 10, anulada: 5 }
const TIPOS_CLIENTE = ['particular', 'ferreteria', 'constructor', 'empresa']

const NOMBRES_PRODUCTO = [
  'Cemento Gris', 'Cemento Blanco', 'Mortero', 'Arena', 'Piedra Picada', 'Grava',
  'Pintura Caucho', 'Pintura Esmalte', 'Impermeabilizante', 'Sellador', 'Rodillo', 'Brocha',
  'Martillo', 'Taladro', 'Destornillador', 'Nivel', 'Cinta Métrica', 'Sierra',
  'Cable THHN', 'Interruptor', 'Toma Corriente', 'Breaker', 'Bombillo LED', 'Canaleta',
  'Tubo PVC', 'Codo PVC', 'Tee PVC', 'Llave de Paso', 'Teflón', 'Manguera',
  'Tornillo Drywall', 'Clavo', 'Ancla Expansiva', 'Silicón', 'Pega Epóxica', 'Arandela',
  'Candado', 'Cerradura', 'Bisagra', 'Manija', 'Chapa', 'Pasador',
  'Casco de Seguridad', 'Guantes', 'Lentes', 'Botas', 'Chaleco Reflectivo', 'Mascarilla',
  'Reflector LED', 'Lámpara Solar', 'Panel LED', 'Foco Empotrable', 'Sensor Movimiento',
  'Manguera Jardín', 'Aspersor', 'Pala', 'Pico', 'Carretilla', 'Rastrillo',
]

const NOMBRES_CLIENTES = [
  'Ferretería', 'Construcciones', 'Inversiones', 'Servicios', 'Soluciones', 'Distribuidora',
  'Corporación', 'Grupo', 'Materiales', 'Suministros', 'Comercial', 'Industrial',
]
const APELLIDOS = [
  'Rodríguez', 'Martínez', 'López', 'González', 'Hernández', 'Pérez', 'García',
  'Ramírez', 'Díaz', 'Torres', 'Flores', 'Rivera', 'Morales', 'Castillo', 'Vargas',
  'Mendoza', 'Rojas', 'Contreras', 'Delgado', 'Rivas', 'Briceño', 'Navarro',
]

function generarNombreCliente(i) {
  if (Math.random() < 0.4) {
    // Persona natural
    const nombres = ['José', 'María', 'Carlos', 'Ana', 'Luis', 'Carmen', 'Pedro', 'Rosa', 'Juan', 'Elena', 'Miguel', 'Luisa', 'Rafael', 'Andrea', 'Roberto', 'Patricia']
    return `${pick(nombres)} ${pick(APELLIDOS)} ${pick(APELLIDOS)}`
  }
  // Empresa
  const sufijos = ['C.A.', 'S.A.', 'S.R.L.', '& Hijos', 'del Centro', 'de Venezuela', 'Carabobo']
  return `${pick(NOMBRES_CLIENTES)} ${pick(APELLIDOS)} ${pick(sufijos)}`
}

function generarRIF(tipo) {
  if (tipo === 'particular') return `V-${rand(10000000, 29999999)}`
  return `J-${rand(30000000, 50999999)}-${rand(0, 9)}`
}

function estadoPonderado() {
  const total = Object.values(ESTADOS_PESO).reduce((a, b) => a + b, 0)
  let r = rand(1, total)
  for (const [estado, peso] of Object.entries(ESTADOS_PESO)) {
    r -= peso
    if (r <= 0) return estado
  }
  return 'borrador'
}

// ── Batch insert con chunks ─────────────────────────────────────────────────
async function batchInsert(table, rows, chunkSize = 500) {
  const all = []
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(`POST ${table} chunk ${i}: ${JSON.stringify(err)}`)
    }
    const data = await res.json()
    all.push(...data)
  }
  return all
}

async function deleteAll(table) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: '' },
  }).catch(() => {})
}

// ── Timers ──────────────────────────────────────────────────────────────────
const timers = {}
function startTimer(label) { timers[label] = performance.now() }
function endTimer(label) {
  const ms = performance.now() - timers[label]
  return ms
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏋️ STRESS TEST DE DATOS — Nivel: ${levelArg.toUpperCase()}`)
  console.log(`   Productos: ${LEVEL.productos} | Clientes: ${LEVEL.clientes} | Cotizaciones: ${LEVEL.cotizaciones}`)
  console.log('═'.repeat(60))

  const results = { level: levelArg, timestamps: {} }
  const totalStart = performance.now()

  // ── Limpiar ──
  console.log('\n🧹 Limpiando datos anteriores...')
  startTimer('cleanup')
  await deleteAll('cotizacion_items')
  await deleteAll('cotizaciones')
  await deleteAll('clientes')
  await deleteAll('transportistas')
  await deleteAll('productos')
  results.timestamps.cleanup = endTimer('cleanup')
  console.log(`  ✓ Limpieza: ${(results.timestamps.cleanup / 1000).toFixed(1)}s`)

  // ── Usuarios ──
  const res = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?select=id,nombre,rol&activo=eq.true`, { headers })
  const usuarios = await res.json()
  const supervisor = usuarios.find(u => u.rol === 'supervisor')
  const vendedor = usuarios.find(u => u.rol === 'vendedor')
  if (!supervisor) { console.error('✗ No hay supervisor'); return }
  const vendedorId = vendedor?.id ?? supervisor.id

  // ── Productos ──
  console.log(`\n📦 Generando ${LEVEL.productos} productos...`)
  startTimer('productos')
  const productos = []
  for (let i = 0; i < LEVEL.productos; i++) {
    const cat = pick(CATEGORIAS)
    const nombre = pick(NOMBRES_PRODUCTO)
    const unidad = pick(UNIDADES)
    const costo = randFloat(0.20, 50)
    const margen = randFloat(1.2, 1.8)
    productos.push({
      codigo: `${cat.substring(0, 3).toUpperCase()}-${String(i + 1).padStart(4, '0')}`,
      nombre: `${nombre} ${cat} #${i + 1}`,
      categoria: cat,
      unidad,
      precio_usd: +(costo * margen).toFixed(2),
      costo_usd: costo,
      stock_actual: rand(0, 500),
      stock_minimo: rand(5, 50),
    })
  }
  const prodsCreados = await batchInsert('productos', productos)
  results.timestamps.productos = endTimer('productos')
  console.log(`  ✓ ${prodsCreados.length} productos: ${(results.timestamps.productos / 1000).toFixed(1)}s`)

  // ── Transportistas ──
  console.log('\n🚚 Creando 4 transportistas...')
  startTimer('transportistas')
  const transportistas = [
    { nombre: 'TransVenCarga Express', rif: 'J-30456789-1', telefono: '0241-4561234', zona_cobertura: 'Valencia / Carabobo', tarifa_base: 8.00, notas: 'Entrega mismo día', creado_por: supervisor.id },
    { nombre: 'MRW Encomiendas', rif: 'J-00359741-6', telefono: '0800-679-0000', zona_cobertura: 'Nacional', tarifa_base: 12.00, notas: 'Nacional 2-3 días', creado_por: supervisor.id },
    { nombre: 'Zoom Envíos', rif: 'J-29871456-2', telefono: '0800-966-6000', zona_cobertura: 'Nacional', tarifa_base: 10.00, notas: 'Puerta a puerta', creado_por: supervisor.id },
    { nombre: 'Fletes Rodríguez', rif: 'V-18456321', telefono: '0414-4123456', zona_cobertura: 'Carabobo / Aragua', tarifa_base: 15.00, notas: 'Materiales pesados', creado_por: supervisor.id },
  ]
  const transCreados = await batchInsert('transportistas', transportistas)
  results.timestamps.transportistas = endTimer('transportistas')
  console.log(`  ✓ ${transCreados.length} transportistas: ${(results.timestamps.transportistas / 1000).toFixed(1)}s`)

  // ── Clientes ──
  console.log(`\n👥 Generando ${LEVEL.clientes} clientes...`)
  startTimer('clientes')
  const clientes = []
  for (let i = 0; i < LEVEL.clientes; i++) {
    const tipo = pick(TIPOS_CLIENTE)
    const esVendedor = Math.random() < 0.5
    clientes.push({
      nombre: generarNombreCliente(i),
      rif_cedula: generarRIF(tipo),
      telefono: `04${rand(12, 26)}-${rand(1000000, 9999999)}`,
      email: Math.random() < 0.7 ? `cliente${i + 1}@${pick(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com'])}` : null,
      direccion: `Calle ${rand(1, 100)}, Sector ${pick(['Norte', 'Sur', 'Centro', 'Este', 'Oeste'])}, ${pick(['Valencia', 'San Diego', 'Naguanagua', 'Guacara', 'Los Guayos'])}`,
      tipo_cliente: tipo,
      vendedor_id: esVendedor ? vendedorId : supervisor.id,
      notas: Math.random() < 0.6 ? `Cliente stress test #${i + 1}` : null,
    })
  }
  const clientesCreados = await batchInsert('clientes', clientes)
  results.timestamps.clientes = endTimer('clientes')
  console.log(`  ✓ ${clientesCreados.length} clientes: ${(results.timestamps.clientes / 1000).toFixed(1)}s`)

  // ── Cotizaciones + Items ──
  console.log(`\n📝 Generando ${LEVEL.cotizaciones} cotizaciones con items...`)
  startTimer('cotizaciones')

  const cotBatches = []
  const itemBatches = []
  const ahora = Date.now()
  const cotIds = []

  // Generar cotizaciones en bloques
  for (let i = 0; i < LEVEL.cotizaciones; i++) {
    const estado = estadoPonderado()
    const cliente = pick(clientesCreados)
    const vendId = cliente.vendedor_id
    const hasTrans = Math.random() < 0.3
    const descGlobal = Math.random() < 0.4 ? rand(1, 10) : 0
    const envio = hasTrans ? pick(transCreados).tarifa_base : 0
    const numItems = rand(LEVEL.itemsPorCot[0], LEVEL.itemsPorCot[1])
    const diasAtras = rand(0, 30)
    const creado = new Date(ahora - diasAtras * 86400000).toISOString()
    const enviada = estado !== 'borrador' ? new Date(ahora - (diasAtras - rand(0, 2)) * 86400000).toISOString() : null
    const valida = estado !== 'borrador' ? new Date(ahora + rand(1, 30) * 86400000).toISOString().split('T')[0] : null
    const tasaBcv = estado !== 'borrador' ? randFloat(90, 100) : null

    // Generar items para esta cotización
    const items = []
    let subtotal = 0
    const usedProds = new Set()
    for (let j = 0; j < numItems; j++) {
      let prod
      let attempts = 0
      do {
        prod = pick(prodsCreados)
        attempts++
      } while (usedProds.has(prod.id) && attempts < 20)
      usedProds.add(prod.id)

      const cant = rand(1, 100)
      const descLinea = Math.random() < 0.2 ? rand(1, 15) : 0
      const totalLinea = +(cant * prod.precio_usd * (1 - descLinea / 100)).toFixed(2)
      subtotal += totalLinea

      items.push({
        // cotizacion_id se asigna después
        producto_id: prod.id,
        codigo_snap: prod.codigo,
        nombre_snap: prod.nombre,
        unidad_snap: prod.unidad,
        cantidad: cant,
        precio_unit_usd: prod.precio_usd,
        descuento_pct: descLinea,
        total_linea_usd: totalLinea,
        orden: j,
      })
    }

    const descuento = +(subtotal * descGlobal / 100).toFixed(2)
    const total = +(subtotal - descuento + envio).toFixed(2)

    // Placeholder ID temporal para vincular items
    const cotId = `__cot_${i}__`
    cotIds.push({ index: i, items })

    cotBatches.push({
      cliente_id: cliente.id,
      vendedor_id: vendId,
      transportista_id: hasTrans ? pick(transCreados).id : null,
      estado,
      subtotal_usd: +subtotal.toFixed(2),
      descuento_global_pct: descGlobal,
      descuento_usd: descuento,
      costo_envio_usd: envio,
      total_usd: total,
      tasa_bcv_snapshot: tasaBcv,
      total_bs_snapshot: tasaBcv ? +(total * tasaBcv).toFixed(2) : null,
      valida_hasta: valida,
      notas_cliente: Math.random() < 0.5 ? `Cotización de prueba de estrés #${i + 1}` : null,
      notas_internas: Math.random() < 0.3 ? `Nota interna stress #${i + 1}` : null,
      creado_en: creado,
      enviada_en: enviada,
    })
  }

  // Insertar cotizaciones en chunks
  const cotsCreadas = await batchInsert('cotizaciones', cotBatches)
  results.timestamps.cotizaciones_insert = endTimer('cotizaciones')
  console.log(`  ✓ ${cotsCreadas.length} cotizaciones: ${(results.timestamps.cotizaciones_insert / 1000).toFixed(1)}s`)

  // Vincular items con IDs reales y hacer insert masivo
  console.log('  📋 Insertando items...')
  startTimer('items')
  const allItems = []
  for (let i = 0; i < cotIds.length; i++) {
    const cotId = cotsCreadas[i].id
    for (const item of cotIds[i].items) {
      allItems.push({ ...item, cotizacion_id: cotId })
    }
  }

  const itemsCreados = await batchInsert('cotizacion_items', allItems, 1000)
  results.timestamps.items = endTimer('items')
  console.log(`  ✓ ${itemsCreados.length} items: ${(results.timestamps.items / 1000).toFixed(1)}s`)

  // ── Resumen ──
  const totalMs = performance.now() - totalStart
  results.timestamps.total = totalMs
  results.counts = {
    productos: prodsCreados.length,
    transportistas: transCreados.length,
    clientes: clientesCreados.length,
    cotizaciones: cotsCreadas.length,
    items: itemsCreados.length,
  }

  console.log('\n' + '═'.repeat(60))
  console.log('📊 RESULTADOS DEL STRESS TEST')
  console.log('═'.repeat(60))
  console.log(`  Nivel:          ${levelArg.toUpperCase()}`)
  console.log(`  Productos:      ${results.counts.productos}`)
  console.log(`  Transportistas: ${results.counts.transportistas}`)
  console.log(`  Clientes:       ${results.counts.clientes}`)
  console.log(`  Cotizaciones:   ${results.counts.cotizaciones}`)
  console.log(`  Items:          ${results.counts.items}`)
  console.log('─'.repeat(60))
  console.log(`  Limpieza:       ${(results.timestamps.cleanup / 1000).toFixed(2)}s`)
  console.log(`  Productos:      ${(results.timestamps.productos / 1000).toFixed(2)}s`)
  console.log(`  Clientes:       ${(results.timestamps.clientes / 1000).toFixed(2)}s`)
  console.log(`  Cotizaciones:   ${(results.timestamps.cotizaciones_insert / 1000).toFixed(2)}s`)
  console.log(`  Items:          ${(results.timestamps.items / 1000).toFixed(2)}s`)
  console.log(`  TOTAL:          ${(totalMs / 1000).toFixed(2)}s`)
  console.log('═'.repeat(60))

  // Guardar resultados en JSON para el runner
  const outPath = new URL('../perf-results/stress-results.json', import.meta.url).pathname
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(new URL('../perf-results', import.meta.url).pathname, { recursive: true })
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\n💾 Resultados guardados en: perf-results/stress-results.json`)
}

main().catch(err => {
  console.error('✗ Error fatal:', err.message)
  process.exit(1)
})
