// scripts/seed-demo-safe.mjs
// Seed de datos ficticios SIN tocar el inventario existente
// Solo inserta: transportistas, clientes, cotizaciones con items

const SUPABASE_URL = 'https://oyfyuszgjwcepjpngclv.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95Znl1c3pnandjZXBqcG5nY2x2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQyOTQ0MywiZXhwIjoyMDkxMDA1NDQzfQ.YoMbefzmBd7gbhRQeVNCagSXte_87OQIeYkwCasD8wk'

const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function query(table, method = 'GET', body = null, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`
  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json()
  if (!res.ok) {
    console.error(`Error ${method} ${table}:`, data)
    throw new Error(`${method} ${table} failed: ${res.status}`)
  }
  return data
}

async function deleteAll(table, filter = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${filter || '?id=neq.00000000-0000-0000-0000-000000000000'}`
  await fetch(url, { method: 'DELETE', headers: { ...headers, Prefer: '' } }).catch(() => {})
}

async function main() {
  console.log('🔧 Seed demo SEGURO — NO toca inventario\n')

  // ── 0. Limpiar datos anteriores (items → cotizaciones → clientes → transportistas) ──
  console.log('🧹 Limpiando cotizaciones, clientes y transportistas anteriores...')
  await deleteAll('cotizacion_items')
  await deleteAll('cotizaciones')
  await deleteAll('clientes')
  await deleteAll('transportistas')
  console.log('✓ Datos anteriores limpiados (inventario intacto)')

  // ── 1. Obtener usuarios existentes ──
  const usuarios = await query('usuarios', 'GET', null, '?select=id,nombre,rol&activo=eq.true')
  console.log(`\n👤 ${usuarios.length} usuarios encontrados`)

  const supervisor = usuarios.find(u => u.rol === 'supervisor')
  const vendedor = usuarios.find(u => u.rol === 'vendedor')

  if (!supervisor) { console.error('✗ No hay supervisor activo'); return }
  console.log(`  Supervisor: ${supervisor.nombre} (${supervisor.id})`)
  if (vendedor) console.log(`  Vendedor: ${vendedor.nombre} (${vendedor.id})`)

  const vendedorId = vendedor?.id ?? supervisor.id

  // ── 2. Obtener productos existentes ──
  const productos = await query('productos', 'GET', null, '?select=id,codigo,nombre,unidad,precio_usd&activo=eq.true&order=codigo.asc')
  console.log(`\n📦 ${productos.length} productos existentes en inventario`)

  if (productos.length < 5) {
    console.error('✗ Se necesitan al menos 5 productos para crear cotizaciones de demo')
    return
  }

  // ── 3. Transportistas ──
  console.log('\n🚚 Creando transportistas...')
  const transportistas = [
    { nombre: 'TransVenCarga Express',   rif: 'J-30456789-1', telefono: '0241-4561234', zona_cobertura: 'Valencia / Carabobo',         tarifa_base: 8.00,  notas: 'Entrega mismo día en Valencia', creado_por: supervisor.id },
    { nombre: 'MRW Encomiendas',         rif: 'J-00359741-6', telefono: '0800-679-0000', zona_cobertura: 'Nacional',                   tarifa_base: 12.00, notas: 'Cobertura nacional, 2-3 días',  creado_por: supervisor.id },
    { nombre: 'Zoom Envíos',             rif: 'J-29871456-2', telefono: '0800-966-6000', zona_cobertura: 'Nacional',                   tarifa_base: 10.00, notas: 'Envíos puerta a puerta',        creado_por: supervisor.id },
    { nombre: 'Fletes Rodríguez',        rif: 'V-18456321',   telefono: '0414-4123456', zona_cobertura: 'Carabobo / Aragua / Cojedes', tarifa_base: 15.00, notas: 'Camión 350 para materiales pesados', creado_por: supervisor.id },
  ]
  const transCreados = await query('transportistas', 'POST', transportistas)
  console.log(`✓ ${transCreados.length} transportistas creados`)

  // ── 4. Clientes ──
  console.log('\n👥 Creando clientes...')
  const clientes = [
    { nombre: 'Ferretería Don Pedro',           rif_cedula: 'J-41023456-7', telefono: '0241-8234567',  email: 'donpedro@gmail.com',              direccion: 'Av. Lara, C.C. Roma, Local 5, Valencia',                         tipo_cliente: 'ferreteria',  vendedor_id: supervisor.id, notas: 'Cliente mayorista. Compra regularmente cemento y materiales.' },
    { nombre: 'Constructora Bolívar 2020 C.A.', rif_cedula: 'J-50234567-8', telefono: '0241-8345678',  email: 'compras@constructorabolivar.com', direccion: 'Zona Industrial Castillito, Galpón 15, San Diego',               tipo_cliente: 'constructor', vendedor_id: supervisor.id, notas: 'Obras en curso: Residencias Las Palmas.' },
    { nombre: 'Inversiones Martínez & Hijos',   rif_cedula: 'J-40567890-1', telefono: '0414-4234567',  email: 'martinez.inversiones@hotmail.com', direccion: 'Urb. Prebo, Av. 98, Casa 12, Valencia',                         tipo_cliente: 'empresa',     vendedor_id: supervisor.id, notas: 'Pago a 15 días. Excelente historial.' },
    { nombre: 'Carlos Mendoza',                 rif_cedula: 'V-18456789',   telefono: '0424-4567890',  email: null,                              direccion: 'Sector San José, Calle 3, Casa 45, Naguanagua',                 tipo_cliente: 'particular',  vendedor_id: supervisor.id, notas: 'Remodelación de vivienda.' },
    { nombre: 'Ferretería La Esquina',          rif_cedula: 'J-41234567-0', telefono: '0241-8567890',  email: 'laesquina.ferreteria@gmail.com',  direccion: 'Av. Cedeño, Nro. 78, Frente al Mercado, Valencia',              tipo_cliente: 'ferreteria',  vendedor_id: supervisor.id, notas: 'Compra artículos eléctricos y plomería.' },
    { nombre: 'María González',                 rif_cedula: 'V-20345678',   telefono: '0412-4678901',  email: 'mariag78@gmail.com',              direccion: 'Res. Las Acacias, Torre B, Apto 4-C, Valencia',                 tipo_cliente: 'particular',  vendedor_id: supervisor.id, notas: null },
    { nombre: 'Corporación SAMCA',              rif_cedula: 'J-30987654-3', telefono: '0241-8901234',  email: 'compras@samca.com.ve',            direccion: 'Zona Industrial Norte, Galpón 8-A, Valencia',                   tipo_cliente: 'empresa',     vendedor_id: supervisor.id, notas: 'Mantenimiento industrial. Volumen alto.' },
    // Clientes del vendedor
    { nombre: 'José Ramírez',                   rif_cedula: 'V-19876543',   telefono: '0414-4789012',  email: null,                              direccion: 'Barrio Unión, Calle Principal, Casa S/N, Guacara',              tipo_cliente: 'particular',  vendedor_id: vendedorId, notas: 'Autoconstrucción. Compra por etapas.' },
    { nombre: 'Construcciones Orinoco C.A.',    rif_cedula: 'J-41567890-2', telefono: '0241-8012345',  email: 'orinoco.const@gmail.com',         direccion: 'Av. Universidad, Edif. Orinoco, PB, Valencia',                  tipo_cliente: 'constructor', vendedor_id: vendedorId, notas: 'Obra: Conjunto Residencial Parque del Este. Pedidos grandes.' },
    { nombre: 'Ferretería El Tornillo Feliz',   rif_cedula: 'J-50456789-5', telefono: '0241-8123456',  email: 'eltornillofeliz@hotmail.com',     direccion: 'C.C. Paseo Las Industrias, Local PB-7, Valencia',               tipo_cliente: 'ferreteria',  vendedor_id: vendedorId, notas: 'Reventa. Pide cada 15 días.' },
    { nombre: 'Ana Lucía Pérez',                rif_cedula: 'V-21456789',   telefono: '0424-4890123',  email: 'analucia.perez@gmail.com',        direccion: 'Urb. Trigal Norte, Av. 137, Quinta Mi Refugio, Valencia',       tipo_cliente: 'particular',  vendedor_id: vendedorId, notas: 'Proyecto de pintura exterior.' },
    { nombre: 'Soluciones Eléctricas VLC',      rif_cedula: 'J-41890123-4', telefono: '0412-4901234',  email: 'soluciones.electricas@gmail.com',  direccion: 'Av. Bolívar Sur, C.C. Cosmos, Nivel 2, Local 28, Valencia',    tipo_cliente: 'empresa',     vendedor_id: vendedorId, notas: 'Instalaciones eléctricas. Compra por volumen.' },
    { nombre: 'Pedro Hernández',                rif_cedula: 'V-15678901',   telefono: '0416-6012345',  email: null,                              direccion: 'Sector La Isabelica, Bloque 5, Apto 3-A, Valencia',            tipo_cliente: 'particular',  vendedor_id: vendedorId, notas: 'Plomero independiente.' },
    { nombre: 'Grupo Constructor Carabobo',     rif_cedula: 'J-31234567-9', telefono: '0241-8234568',  email: 'gcc@constructorcarabobo.com',     direccion: 'Av. Naguanagua, Torre Empresarial, Piso 3, Of. 3-B',           tipo_cliente: 'constructor', vendedor_id: vendedorId, notas: 'Proyectos gubernamentales. Requiere factura fiscal.' },
    { nombre: 'Dulcería y Ferretería Central',  rif_cedula: 'J-41345678-6', telefono: '0241-8345679',  email: 'central.mixta@gmail.com',         direccion: 'Calle Comercio, Nro. 45, Centro de Valencia',                  tipo_cliente: 'ferreteria',  vendedor_id: vendedorId, notas: 'Negocio mixto. Cantidades pequeñas.' },
  ]
  const clientesCreados = await query('clientes', 'POST', clientes)
  console.log(`✓ ${clientesCreados.length} clientes creados`)

  // ── 5. Cotizaciones ──
  console.log('\n📝 Creando cotizaciones...')

  // Seleccionar productos del inventario real para usar en cotizaciones
  // Tomar al menos 10 productos variados
  const prodsParaCot = productos.slice(0, Math.min(productos.length, 15))

  function calcItems(itemsDef) {
    return itemsDef.map((it, i) => ({
      ...it,
      total_linea_usd: Math.round(it.cantidad * it.precio_unit_usd * (1 - (it.descuento_pct || 0) / 100) * 100) / 100,
      orden: i,
    }))
  }

  function calcCotizacion(items, descPct = 0, envio = 0) {
    const subtotal = items.reduce((s, it) => s + it.total_linea_usd, 0)
    const descuento = Math.round(subtotal * descPct / 100 * 100) / 100
    const total = Math.round((subtotal - descuento + envio) * 100) / 100
    return { subtotal: Math.round(subtotal * 100) / 100, descuento, total }
  }

  // Construir items con los productos reales del inventario
  const p = prodsParaCot

  // Cotización 1: Borrador grande (constructor) — primeros 4 productos
  const cot1Items = calcItems([
    { producto_id: p[0].id, codigo_snap: p[0].codigo, nombre_snap: p[0].nombre, unidad_snap: p[0].unidad, cantidad: 50, precio_unit_usd: p[0].precio_usd, descuento_pct: 5 },
    { producto_id: p[1].id, codigo_snap: p[1].codigo, nombre_snap: p[1].nombre, unidad_snap: p[1].unidad, cantidad: 30, precio_unit_usd: p[1].precio_usd, descuento_pct: 0 },
    { producto_id: p[2].id, codigo_snap: p[2].codigo, nombre_snap: p[2].nombre, unidad_snap: p[2].unidad, cantidad: 20, precio_unit_usd: p[2].precio_usd, descuento_pct: 0 },
    { producto_id: p[3].id, codigo_snap: p[3].codigo, nombre_snap: p[3].nombre, unidad_snap: p[3].unidad, cantidad: 15, precio_unit_usd: p[3].precio_usd, descuento_pct: 0 },
  ])
  const t1 = calcCotizacion(cot1Items, 3, 15)

  // Cotización 2: Enviada (ferretería mayorista) — productos 4-6
  const cot2Items = calcItems([
    { producto_id: p[4]?.id || p[0].id, codigo_snap: (p[4] || p[0]).codigo, nombre_snap: (p[4] || p[0]).nombre, unidad_snap: (p[4] || p[0]).unidad, cantidad: 12, precio_unit_usd: (p[4] || p[0]).precio_usd, descuento_pct: 8 },
    { producto_id: p[5]?.id || p[1].id, codigo_snap: (p[5] || p[1]).codigo, nombre_snap: (p[5] || p[1]).nombre, unidad_snap: (p[5] || p[1]).unidad, cantidad: 8,  precio_unit_usd: (p[5] || p[1]).precio_usd, descuento_pct: 8 },
    { producto_id: p[6]?.id || p[2].id, codigo_snap: (p[6] || p[2]).codigo, nombre_snap: (p[6] || p[2]).nombre, unidad_snap: (p[6] || p[2]).unidad, cantidad: 20, precio_unit_usd: (p[6] || p[2]).precio_usd, descuento_pct: 0 },
  ])
  const t2 = calcCotizacion(cot2Items, 0, 0)

  // Cotización 3: Enviada (plomero) — productos 7-9
  const cot3Items = calcItems([
    { producto_id: p[7]?.id || p[0].id, codigo_snap: (p[7] || p[0]).codigo, nombre_snap: (p[7] || p[0]).nombre, unidad_snap: (p[7] || p[0]).unidad, cantidad: 20, precio_unit_usd: (p[7] || p[0]).precio_usd, descuento_pct: 0 },
    { producto_id: p[8]?.id || p[1].id, codigo_snap: (p[8] || p[1]).codigo, nombre_snap: (p[8] || p[1]).nombre, unidad_snap: (p[8] || p[1]).unidad, cantidad: 40, precio_unit_usd: (p[8] || p[1]).precio_usd, descuento_pct: 0 },
    { producto_id: p[9]?.id || p[2].id, codigo_snap: (p[9] || p[2]).codigo, nombre_snap: (p[9] || p[2]).nombre, unidad_snap: (p[9] || p[2]).unidad, cantidad: 5,  precio_unit_usd: (p[9] || p[2]).precio_usd, descuento_pct: 0 },
  ])
  const t3 = calcCotizacion(cot3Items, 0, 8)

  // Cotización 4: Aceptada (eléctrica) — productos 10-13
  const cot4Items = calcItems([
    { producto_id: p[10]?.id || p[0].id, codigo_snap: (p[10] || p[0]).codigo, nombre_snap: (p[10] || p[0]).nombre, unidad_snap: (p[10] || p[0]).unidad, cantidad: 5,  precio_unit_usd: (p[10] || p[0]).precio_usd, descuento_pct: 5 },
    { producto_id: p[11]?.id || p[1].id, codigo_snap: (p[11] || p[1]).codigo, nombre_snap: (p[11] || p[1]).nombre, unidad_snap: (p[11] || p[1]).unidad, cantidad: 30, precio_unit_usd: (p[11] || p[1]).precio_usd, descuento_pct: 0 },
    { producto_id: p[12]?.id || p[2].id, codigo_snap: (p[12] || p[2]).codigo, nombre_snap: (p[12] || p[2]).nombre, unidad_snap: (p[12] || p[2]).unidad, cantidad: 25, precio_unit_usd: (p[12] || p[2]).precio_usd, descuento_pct: 0 },
    { producto_id: p[13]?.id || p[3].id, codigo_snap: (p[13] || p[3]).codigo, nombre_snap: (p[13] || p[3]).nombre, unidad_snap: (p[13] || p[3]).unidad, cantidad: 10, precio_unit_usd: (p[13] || p[3]).precio_usd, descuento_pct: 0 },
  ])
  const t4 = calcCotizacion(cot4Items, 2, 0)

  // Cotización 5: Borrador pequeño (particular) — 2 productos
  const cot5Items = calcItems([
    { producto_id: p[0].id, codigo_snap: p[0].codigo, nombre_snap: p[0].nombre, unidad_snap: p[0].unidad, cantidad: 2, precio_unit_usd: p[0].precio_usd, descuento_pct: 0 },
    { producto_id: p[3].id, codigo_snap: p[3].codigo, nombre_snap: p[3].nombre, unidad_snap: p[3].unidad, cantidad: 5, precio_unit_usd: p[3].precio_usd, descuento_pct: 0 },
  ])
  const t5 = calcCotizacion(cot5Items, 0, 0)

  // Cotización 6: Enviada con transportista (obra grande) — varios productos
  const cot6Items = calcItems([
    { producto_id: p[0].id, codigo_snap: p[0].codigo, nombre_snap: p[0].nombre, unidad_snap: p[0].unidad, cantidad: 100, precio_unit_usd: p[0].precio_usd, descuento_pct: 8 },
    { producto_id: p[1].id, codigo_snap: p[1].codigo, nombre_snap: p[1].nombre, unidad_snap: p[1].unidad, cantidad: 50,  precio_unit_usd: p[1].precio_usd, descuento_pct: 5 },
    { producto_id: p[2].id, codigo_snap: p[2].codigo, nombre_snap: p[2].nombre, unidad_snap: p[2].unidad, cantidad: 40,  precio_unit_usd: p[2].precio_usd, descuento_pct: 0 },
    { producto_id: p[4]?.id || p[3].id, codigo_snap: (p[4] || p[3]).codigo, nombre_snap: (p[4] || p[3]).nombre, unidad_snap: (p[4] || p[3]).unidad, cantidad: 30, precio_unit_usd: (p[4] || p[3]).precio_usd, descuento_pct: 0 },
  ])
  const t6 = calcCotizacion(cot6Items, 5, 15)

  // Cotización 7: Rechazada (precio muy alto)
  const cot7Items = calcItems([
    { producto_id: p[0].id, codigo_snap: p[0].codigo, nombre_snap: p[0].nombre, unidad_snap: p[0].unidad, cantidad: 200, precio_unit_usd: p[0].precio_usd, descuento_pct: 0 },
    { producto_id: p[2].id, codigo_snap: p[2].codigo, nombre_snap: p[2].nombre, unidad_snap: p[2].unidad, cantidad: 100, precio_unit_usd: p[2].precio_usd, descuento_pct: 0 },
  ])
  const t7 = calcCotizacion(cot7Items, 0, 20)

  // Cotización 8: Borrador reciente (vendedor)
  const cot8Items = calcItems([
    { producto_id: p[5]?.id || p[0].id, codigo_snap: (p[5] || p[0]).codigo, nombre_snap: (p[5] || p[0]).nombre, unidad_snap: (p[5] || p[0]).unidad, cantidad: 6, precio_unit_usd: (p[5] || p[0]).precio_usd, descuento_pct: 10 },
    { producto_id: p[6]?.id || p[1].id, codigo_snap: (p[6] || p[1]).codigo, nombre_snap: (p[6] || p[1]).nombre, unidad_snap: (p[6] || p[1]).unidad, cantidad: 3, precio_unit_usd: (p[6] || p[1]).precio_usd, descuento_pct: 0 },
  ])
  const t8 = calcCotizacion(cot8Items, 0, 0)

  const ahora = new Date()
  const hace2Dias = new Date(ahora - 2 * 86400000).toISOString()
  const hace3Dias = new Date(ahora - 3 * 86400000).toISOString()
  const hace5Dias = new Date(ahora - 5 * 86400000).toISOString()
  const hace7Dias = new Date(ahora - 7 * 86400000).toISOString()
  const hace10Dias = new Date(ahora - 10 * 86400000).toISOString()
  const hace15Dias = new Date(ahora - 15 * 86400000).toISOString()
  const en4Dias = new Date(ahora.getTime() + 4 * 86400000).toISOString().split('T')[0]
  const en7Dias = new Date(ahora.getTime() + 7 * 86400000).toISOString().split('T')[0]
  const en15Dias = new Date(ahora.getTime() + 15 * 86400000).toISOString().split('T')[0]

  const cotizaciones = [
    // 1. Borrador grande — constructor
    {
      cliente_id: clientesCreados[1].id, vendedor_id: supervisor.id, transportista_id: transCreados[3].id,
      estado: 'borrador', subtotal_usd: t1.subtotal, descuento_global_pct: 3, descuento_usd: t1.descuento,
      costo_envio_usd: 15, total_usd: t1.total, valida_hasta: en15Dias,
      tasa_bcv_snapshot: null, total_bs_snapshot: null,
      notas_cliente: 'Precios especiales por volumen. Disponibilidad inmediata.',
      notas_internas: 'Pendiente aprobación del ingeniero residente.',
      creado_en: hace3Dias, enviada_en: null,
    },
    // 2. Enviada — ferretería mayorista
    {
      cliente_id: clientesCreados[0].id, vendedor_id: supervisor.id, transportista_id: null,
      estado: 'enviada', subtotal_usd: t2.subtotal, descuento_global_pct: 0, descuento_usd: 0,
      costo_envio_usd: 0, total_usd: t2.total, tasa_bcv_snapshot: 95.50, total_bs_snapshot: Math.round(t2.total * 95.50 * 100) / 100,
      valida_hasta: en7Dias, notas_cliente: 'Retiro en tienda. Descuento por cliente frecuente.',
      notas_internas: null,
      enviada_en: hace5Dias, creado_en: hace5Dias,
    },
    // 3. Enviada — plomero
    {
      cliente_id: clientesCreados[12].id, vendedor_id: vendedorId, transportista_id: transCreados[0].id,
      estado: 'enviada', subtotal_usd: t3.subtotal, descuento_global_pct: 0, descuento_usd: 0,
      costo_envio_usd: 8, total_usd: t3.total, tasa_bcv_snapshot: 94.80, total_bs_snapshot: Math.round(t3.total * 94.80 * 100) / 100,
      valida_hasta: en7Dias, notas_cliente: 'Materiales para trabajo de plomería residencial.',
      notas_internas: null,
      enviada_en: hace3Dias, creado_en: hace5Dias,
    },
    // 4. Aceptada — empresa eléctrica
    {
      cliente_id: clientesCreados[11].id, vendedor_id: vendedorId, transportista_id: null,
      estado: 'aceptada', subtotal_usd: t4.subtotal, descuento_global_pct: 2, descuento_usd: t4.descuento,
      costo_envio_usd: 0, total_usd: t4.total, tasa_bcv_snapshot: 93.20, total_bs_snapshot: Math.round(t4.total * 93.20 * 100) / 100,
      valida_hasta: en15Dias, notas_cliente: 'Material para instalación en oficinas.',
      notas_internas: null,
      enviada_en: hace7Dias, creado_en: hace10Dias,
    },
    // 5. Borrador pequeño — particular
    {
      cliente_id: clientesCreados[3].id, vendedor_id: supervisor.id, transportista_id: null,
      estado: 'borrador', subtotal_usd: t5.subtotal, descuento_global_pct: 0, descuento_usd: 0,
      costo_envio_usd: 0, total_usd: t5.total,
      tasa_bcv_snapshot: null, total_bs_snapshot: null,
      valida_hasta: null, notas_cliente: null,
      notas_internas: 'Cliente preguntó descuento por pago en efectivo.',
      creado_en: ahora.toISOString(), enviada_en: null,
    },
    // 6. Enviada con transportista — obra grande
    {
      cliente_id: clientesCreados[8].id, vendedor_id: vendedorId, transportista_id: transCreados[3].id,
      estado: 'enviada', subtotal_usd: t6.subtotal, descuento_global_pct: 5, descuento_usd: t6.descuento,
      costo_envio_usd: 15, total_usd: t6.total, tasa_bcv_snapshot: 95.10, total_bs_snapshot: Math.round(t6.total * 95.10 * 100) / 100,
      valida_hasta: en7Dias,
      notas_cliente: 'Entrega en obra: Conjunto Res. Parque del Este, San Diego. Contactar Ing. Rodríguez (0414-4567890).',
      notas_internas: 'Descuento autorizado por gerencia. Pedido recurrente mensual.',
      enviada_en: hace3Dias, creado_en: hace5Dias,
    },
    // 7. Rechazada
    {
      cliente_id: clientesCreados[6].id, vendedor_id: supervisor.id, transportista_id: transCreados[1].id,
      estado: 'rechazada', subtotal_usd: t7.subtotal, descuento_global_pct: 0, descuento_usd: 0,
      costo_envio_usd: 20, total_usd: t7.total, tasa_bcv_snapshot: 92.80, total_bs_snapshot: Math.round(t7.total * 92.80 * 100) / 100,
      valida_hasta: en4Dias,
      notas_cliente: 'Cotización de materiales para mantenimiento anual.',
      notas_internas: 'Rechazada — cliente consiguió mejor precio con la competencia.',
      enviada_en: hace15Dias, creado_en: hace15Dias,
    },
    // 8. Borrador reciente del vendedor
    {
      cliente_id: clientesCreados[10].id, vendedor_id: vendedorId, transportista_id: null,
      estado: 'borrador', subtotal_usd: t8.subtotal, descuento_global_pct: 0, descuento_usd: 0,
      costo_envio_usd: 0, total_usd: t8.total,
      tasa_bcv_snapshot: null, total_bs_snapshot: null,
      valida_hasta: null, notas_cliente: 'Pintura para fachada exterior.',
      notas_internas: null,
      creado_en: hace2Dias, enviada_en: null,
    },
  ]

  const cotsCreadas = await query('cotizaciones', 'POST', cotizaciones)
  console.log(`✓ ${cotsCreadas.length} cotizaciones creadas`)

  // ── 6. Items de cotización ──
  console.log('\n📋 Creando items de cotización...')
  const allItems = [
    ...cot1Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[0].id })),
    ...cot2Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[1].id })),
    ...cot3Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[2].id })),
    ...cot4Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[3].id })),
    ...cot5Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[4].id })),
    ...cot6Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[5].id })),
    ...cot7Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[6].id })),
    ...cot8Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[7].id })),
  ]

  const itemsCreados = await query('cotizacion_items', 'POST', allItems)
  console.log(`✓ ${itemsCreados.length} items de cotización creados`)

  // ── Resumen ──
  console.log('\n═══════════════════════════════════════')
  console.log('✅ Seed completado exitosamente!')
  console.log('═══════════════════════════════════════')
  console.log(`  Productos:      ${productos.length} (NO TOCADOS ✓)`)
  console.log(`  Transportistas: ${transCreados.length}`)
  console.log(`  Clientes:       ${clientesCreados.length}`)
  console.log(`  Cotizaciones:   ${cotsCreadas.length}`)
  const estados = { borrador: 0, enviada: 0, aceptada: 0, rechazada: 0 }
  cotizaciones.forEach(c => estados[c.estado]++)
  console.log(`    - ${estados.borrador} borrador, ${estados.enviada} enviadas, ${estados.aceptada} aceptada, ${estados.rechazada} rechazada`)
  console.log(`  Items:          ${itemsCreados.length}`)
  console.log('')
}

main().catch(console.error)
