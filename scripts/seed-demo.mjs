// scripts/seed-demo.mjs
// Seed script — datos realistas de ferretería venezolana para demo
// Ejecutar: node scripts/seed-demo.mjs

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

async function main() {
  console.log('🔧 Seed demo — Ferretería Listo POS\n')

  // ── 0. Limpiar datos anteriores (mantener usuarios) ─────────────────
  console.log('🧹 Limpiando datos anteriores...')
  // Orden: items → cotizaciones → clientes → transportistas → productos
  await fetch(`${SUPABASE_URL}/rest/v1/cotizacion_items`, { method: 'DELETE', headers: { ...headers, Prefer: '' }, }).catch(() => {})
  await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers: { ...headers, Prefer: '' } }).catch(() => {})
  await fetch(`${SUPABASE_URL}/rest/v1/clientes?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers: { ...headers, Prefer: '' } }).catch(() => {})
  await fetch(`${SUPABASE_URL}/rest/v1/transportistas?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers: { ...headers, Prefer: '' } }).catch(() => {})
  await fetch(`${SUPABASE_URL}/rest/v1/productos?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE', headers: { ...headers, Prefer: '' } }).catch(() => {})
  console.log('✓ Datos anteriores limpiados')

  // ── 1. Obtener usuarios existentes ──────────────────────────────────
  const usuarios = await query('usuarios', 'GET', null, '?select=id,nombre,rol&activo=eq.true')
  console.log(`✓ ${usuarios.length} usuarios encontrados`)

  const supervisor = usuarios.find(u => u.rol === 'supervisor')
  const vendedor = usuarios.find(u => u.rol === 'vendedor')

  if (!supervisor) { console.error('✗ No hay supervisor activo'); return }
  console.log(`  Supervisor: ${supervisor.nombre} (${supervisor.id})`)
  if (vendedor) console.log(`  Vendedor: ${vendedor.nombre} (${vendedor.id})`)

  // ── 2. Configuración del negocio ────────────────────────────────────
  console.log('\n📋 Actualizando configuración del negocio...')
  await query('configuracion_negocio', 'PATCH', {
    nombre_negocio: 'Ferretería El Constructor C.A.',
    rif_negocio: 'J-41256789-3',
    telefono_negocio: '0241-8675432',
    direccion_negocio: 'Av. Bolívar Norte, C.C. La Granja, Local 12, Valencia, Carabobo',
    email_negocio: 'ventas@elconstructor.com.ve',
    pie_pagina_pdf: 'Precios en USD. Sujetos a cambio sin previo aviso. Válidos según fecha indicada. Gracias por su preferencia.',
    validez_cotizacion_dias: 7,
  }, '?id=eq.1')
  console.log('✓ Negocio configurado')

  // ── 3. Productos (inventario) ───────────────────────────────────────
  console.log('\n📦 Creando productos...')

  const productos = [
    // CEMENTO
    { codigo: 'CEM-001', nombre: 'Cemento Gris Tipo I 42.5kg',        categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 5.50,  costo_usd: 4.20,  stock_actual: 250,  stock_minimo: 50 },
    { codigo: 'CEM-002', nombre: 'Cemento Blanco 1kg',                 categoria: 'Cemento',      unidad: 'kg',    precio_usd: 2.80,  costo_usd: 2.10,  stock_actual: 80,   stock_minimo: 20 },
    { codigo: 'CEM-003', nombre: 'Mortero Premezclado 40kg',           categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 4.50,  costo_usd: 3.40,  stock_actual: 120,  stock_minimo: 30 },
    { codigo: 'CEM-004', nombre: 'Arena Lavada (saco 40kg)',           categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 2.00,  costo_usd: 1.30,  stock_actual: 180,  stock_minimo: 40 },
    { codigo: 'CEM-005', nombre: 'Piedra Picada Nro. 2 (saco 40kg)',  categoria: 'Cemento',      unidad: 'bolsa', precio_usd: 2.50,  costo_usd: 1.60,  stock_actual: 150,  stock_minimo: 30 },

    // PINTURA
    { codigo: 'PIN-001', nombre: 'Pintura Caucho Int. Blanco Glaciar 4L', categoria: 'Pintura',   unidad: 'und',   precio_usd: 18.00, costo_usd: 13.50, stock_actual: 45,   stock_minimo: 10 },
    { codigo: 'PIN-002', nombre: 'Pintura Caucho Ext. Blanco Hueso 4L',   categoria: 'Pintura',   unidad: 'und',   precio_usd: 22.00, costo_usd: 16.80, stock_actual: 30,   stock_minimo: 8 },
    { codigo: 'PIN-003', nombre: 'Esmalte Brillante Rojo 1L',             categoria: 'Pintura',   unidad: 'und',   precio_usd: 8.50,  costo_usd: 6.20,  stock_actual: 25,   stock_minimo: 5 },
    { codigo: 'PIN-004', nombre: 'Impermeabilizante Acrílico 4L',         categoria: 'Pintura',   unidad: 'und',   precio_usd: 28.00, costo_usd: 21.00, stock_actual: 15,   stock_minimo: 5 },
    { codigo: 'PIN-005', nombre: 'Rodillo de Felpa 9" con Mango',         categoria: 'Pintura',   unidad: 'und',   precio_usd: 4.50,  costo_usd: 2.80,  stock_actual: 60,   stock_minimo: 15 },

    // HERRAMIENTAS
    { codigo: 'HER-001', nombre: 'Martillo de Uña 16oz Mango Fibra',  categoria: 'Herramientas', unidad: 'und',   precio_usd: 12.00, costo_usd: 8.50,  stock_actual: 20,   stock_minimo: 5 },
    { codigo: 'HER-002', nombre: 'Taladro Percutor 1/2" 750W',        categoria: 'Herramientas', unidad: 'und',   precio_usd: 45.00, costo_usd: 32.00, stock_actual: 8,    stock_minimo: 3 },
    { codigo: 'HER-003', nombre: 'Juego Destornilladores 6 piezas',   categoria: 'Herramientas', unidad: 'und',   precio_usd: 9.00,  costo_usd: 5.80,  stock_actual: 15,   stock_minimo: 5 },
    { codigo: 'HER-004', nombre: 'Nivel de Burbuja 24"',              categoria: 'Herramientas', unidad: 'und',   precio_usd: 7.50,  costo_usd: 4.80,  stock_actual: 12,   stock_minimo: 3 },
    { codigo: 'HER-005', nombre: 'Cinta Métrica 5m Stanley',          categoria: 'Herramientas', unidad: 'und',   precio_usd: 5.00,  costo_usd: 3.20,  stock_actual: 35,   stock_minimo: 10 },

    // ELECTRICIDAD
    { codigo: 'ELE-001', nombre: 'Cable THHN 12AWG Rojo (rollo 100m)',  categoria: 'Electricidad', unidad: 'rollo', precio_usd: 35.00, costo_usd: 26.00, stock_actual: 18,  stock_minimo: 5 },
    { codigo: 'ELE-002', nombre: 'Interruptor Sencillo 15A Blanco',     categoria: 'Electricidad', unidad: 'und',   precio_usd: 2.50,  costo_usd: 1.50,  stock_actual: 80,  stock_minimo: 20 },
    { codigo: 'ELE-003', nombre: 'Toma Corriente Doble 15A',            categoria: 'Electricidad', unidad: 'und',   precio_usd: 3.00,  costo_usd: 1.80,  stock_actual: 65,  stock_minimo: 15 },
    { codigo: 'ELE-004', nombre: 'Breaker 1x20A Riel DIN',              categoria: 'Electricidad', unidad: 'und',   precio_usd: 6.50,  costo_usd: 4.20,  stock_actual: 30,  stock_minimo: 8 },
    { codigo: 'ELE-005', nombre: 'Bombillo LED 12W Luz Blanca E27',     categoria: 'Electricidad', unidad: 'und',   precio_usd: 2.00,  costo_usd: 1.10,  stock_actual: 120, stock_minimo: 30 },

    // PLOMERÍA
    { codigo: 'PLO-001', nombre: 'Tubo PVC 1/2" x 3m Presión',       categoria: 'Plomería',     unidad: 'und',   precio_usd: 3.50,  costo_usd: 2.30,  stock_actual: 60,   stock_minimo: 15 },
    { codigo: 'PLO-002', nombre: 'Tubo PVC 4" x 3m Drenaje',         categoria: 'Plomería',     unidad: 'und',   precio_usd: 8.00,  costo_usd: 5.80,  stock_actual: 25,   stock_minimo: 8 },
    { codigo: 'PLO-003', nombre: 'Codo PVC 1/2" x 90°',              categoria: 'Plomería',     unidad: 'und',   precio_usd: 0.40,  costo_usd: 0.20,  stock_actual: 200,  stock_minimo: 50 },
    { codigo: 'PLO-004', nombre: 'Llave de Paso 1/2" Bronce',        categoria: 'Plomería',     unidad: 'und',   precio_usd: 5.50,  costo_usd: 3.80,  stock_actual: 20,   stock_minimo: 5 },
    { codigo: 'PLO-005', nombre: 'Teflón Industrial 3/4" x 10m',     categoria: 'Plomería',     unidad: 'und',   precio_usd: 0.80,  costo_usd: 0.40,  stock_actual: 150,  stock_minimo: 40 },

    // FIJACIÓN
    { codigo: 'FIJ-001', nombre: 'Tornillo Drywall 6x1" (caja 100)', categoria: 'Fijación',     unidad: 'caja',  precio_usd: 3.00,  costo_usd: 1.80,  stock_actual: 40,   stock_minimo: 10 },
    { codigo: 'FIJ-002', nombre: 'Clavo de Acero 2" (kg)',            categoria: 'Fijación',     unidad: 'kg',    precio_usd: 2.50,  costo_usd: 1.60,  stock_actual: 30,   stock_minimo: 10 },
    { codigo: 'FIJ-003', nombre: 'Ancla Expansiva 3/8" x 3"',        categoria: 'Fijación',     unidad: 'und',   precio_usd: 0.60,  costo_usd: 0.30,  stock_actual: 300,  stock_minimo: 50 },
    { codigo: 'FIJ-004', nombre: 'Silicón Transparente 280ml',        categoria: 'Fijación',     unidad: 'und',   precio_usd: 4.00,  costo_usd: 2.80,  stock_actual: 25,   stock_minimo: 8 },
    { codigo: 'FIJ-005', nombre: 'Pega Epóxica Bicomponente 50ml',    categoria: 'Fijación',     unidad: 'und',   precio_usd: 5.50,  costo_usd: 3.60,  stock_actual: 18,   stock_minimo: 5 },
  ]

  const productosCreados = await query('productos', 'POST', productos)
  console.log(`✓ ${productosCreados.length} productos creados`)

  // ── 4. Transportistas ───────────────────────────────────────────────
  console.log('\n🚚 Creando transportistas...')

  const transportistas = [
    { nombre: 'TransVenCarga Express',   rif: 'J-30456789-1', telefono: '0241-4561234', zona_cobertura: 'Valencia / Carabobo',           tarifa_base: 8.00,  notas: 'Entrega mismo día en Valencia', creado_por: supervisor.id },
    { nombre: 'MRW Encomiendas',         rif: 'J-00359741-6', telefono: '0800-679-0000', zona_cobertura: 'Nacional',                     tarifa_base: 12.00, notas: 'Cobertura nacional, 2-3 días',  creado_por: supervisor.id },
    { nombre: 'Zoom Envíos',             rif: 'J-29871456-2', telefono: '0800-966-6000', zona_cobertura: 'Nacional',                     tarifa_base: 10.00, notas: 'Envíos puerta a puerta',        creado_por: supervisor.id },
    { nombre: 'Fletes Rodríguez',        rif: 'V-18456321',   telefono: '0414-4123456', zona_cobertura: 'Carabobo / Aragua / Cojedes',   tarifa_base: 15.00, notas: 'Camión 350 para materiales pesados', creado_por: supervisor.id },
  ]

  const transCreados = await query('transportistas', 'POST', transportistas)
  console.log(`✓ ${transCreados.length} transportistas creados`)

  // ── 5. Clientes ─────────────────────────────────────────────────────
  console.log('\n👥 Creando clientes...')

  const vendedorId = vendedor?.id ?? supervisor.id

  const clientes = [
    // Clientes del supervisor
    { nombre: 'Ferretería Don Pedro',           rif_cedula: 'J-41023456-7', telefono: '0241-8234567',  email: 'donpedro@gmail.com',           direccion: 'Av. Lara, Centro Comercial Roma, Local 5, Valencia',                     tipo_cliente: 'ferreteria',  vendedor_id: supervisor.id, notas: 'Cliente mayorista. Compra regularmente cemento y materiales de construcción.' },
    { nombre: 'Constructora Bolívar 2020 C.A.', rif_cedula: 'J-50234567-8', telefono: '0241-8345678',  email: 'compras@constructorabolivar.com', direccion: 'Zona Industrial Castillito, Galpón 15, San Diego',                    tipo_cliente: 'constructor', vendedor_id: supervisor.id, notas: 'Obras en curso: Residencias Las Palmas y Centro Empresarial Norte.' },
    { nombre: 'Inversiones Martínez & Hijos',   rif_cedula: 'J-40567890-1', telefono: '0414-4234567',  email: 'martinez.inversiones@hotmail.com', direccion: 'Urb. Prebo, Av. 98, Casa 12, Valencia',                              tipo_cliente: 'empresa',     vendedor_id: supervisor.id, notas: 'Pago a 15 días. Excelente historial.' },
    { nombre: 'Carlos Mendoza',                 rif_cedula: 'V-18456789',   telefono: '0424-4567890',  email: null,                              direccion: 'Sector San José, Calle 3, Casa 45, Naguanagua',                     tipo_cliente: 'particular',  vendedor_id: supervisor.id, notas: 'Remodelación de vivienda.' },
    { nombre: 'Ferretería La Esquina',          rif_cedula: 'J-41234567-0', telefono: '0241-8567890',  email: 'laesquina.ferreteria@gmail.com',   direccion: 'Av. Cedeño, Nro. 78, Frente al Mercado Municipal, Valencia',        tipo_cliente: 'ferreteria',  vendedor_id: supervisor.id, notas: 'Competidor pequeño. Compra artículos eléctricos y plomería.' },
    { nombre: 'María González',                 rif_cedula: 'V-20345678',   telefono: '0412-4678901',  email: 'mariag78@gmail.com',               direccion: 'Res. Las Acacias, Torre B, Apto 4-C, Valencia',                     tipo_cliente: 'particular',  vendedor_id: supervisor.id, notas: null },
    { nombre: 'Corporación SAMCA',              rif_cedula: 'J-30987654-3', telefono: '0241-8901234',  email: 'compras@samca.com.ve',             direccion: 'Zona Industrial Municipal Norte, Galpón 8-A, Valencia',             tipo_cliente: 'empresa',     vendedor_id: supervisor.id, notas: 'Mantenimiento industrial. Volumen alto de herramientas y fijación.' },

    // Clientes del vendedor
    { nombre: 'José Ramírez',                   rif_cedula: 'V-19876543',   telefono: '0414-4789012',  email: null,                              direccion: 'Barrio Unión, Calle Principal, Casa S/N, Guacara',                  tipo_cliente: 'particular',  vendedor_id: vendedorId, notas: 'Autoconstrucción. Compra por etapas.' },
    { nombre: 'Construcciones Orinoco C.A.',    rif_cedula: 'J-41567890-2', telefono: '0241-8012345',  email: 'orinoco.const@gmail.com',          direccion: 'Av. Universidad, Edif. Orinoco, PB, Valencia',                      tipo_cliente: 'constructor', vendedor_id: vendedorId, notas: 'Obra actual: Conjunto Residencial Parque del Este. Pedidos grandes de cemento.' },
    { nombre: 'Ferretería El Tornillo Feliz',   rif_cedula: 'J-50456789-5', telefono: '0241-8123456',  email: 'eltornillofeliz@hotmail.com',      direccion: 'C.C. Paseo Las Industrias, Local PB-7, Valencia',                   tipo_cliente: 'ferreteria',  vendedor_id: vendedorId, notas: 'Reventa. Pide tornillería y fijación cada 15 días.' },
    { nombre: 'Ana Lucía Pérez',                rif_cedula: 'V-21456789',   telefono: '0424-4890123',  email: 'analucia.perez@gmail.com',         direccion: 'Urb. Trigal Norte, Av. 137, Quinta Mi Refugio, Valencia',           tipo_cliente: 'particular',  vendedor_id: vendedorId, notas: 'Proyecto de pintura exterior. Pidió colores personalizados.' },
    { nombre: 'Soluciones Eléctricas VLC',      rif_cedula: 'J-41890123-4', telefono: '0412-4901234',  email: 'soluciones.electricas@gmail.com',   direccion: 'Av. Bolívar Sur, C.C. Cosmos, Nivel 2, Local 28, Valencia',        tipo_cliente: 'empresa',     vendedor_id: vendedorId, notas: 'Instalaciones eléctricas. Compra cables e interruptores por volumen.' },
    { nombre: 'Pedro Hernández',                rif_cedula: 'V-15678901',   telefono: '0416-6012345',  email: null,                              direccion: 'Sector La Isabelica, Bloque 5, Apto 3-A, Valencia',                tipo_cliente: 'particular',  vendedor_id: vendedorId, notas: 'Plomero independiente. Compra materiales de plomería.' },
    { nombre: 'Grupo Constructor Carabobo',     rif_cedula: 'J-31234567-9', telefono: '0241-8234568',  email: 'gcc@constructorcarabobo.com',      direccion: 'Av. Principal de Naguanagua, Torre Empresarial, Piso 3, Of. 3-B',  tipo_cliente: 'constructor', vendedor_id: vendedorId, notas: 'Proyectos gubernamentales. Requiere factura fiscal.' },
    { nombre: 'Dulcería y Ferretería Central',  rif_cedula: 'J-41345678-6', telefono: '0241-8345679',  email: 'central.mixta@gmail.com',          direccion: 'Calle Comercio, Nro. 45, Centro de Valencia',                      tipo_cliente: 'ferreteria',  vendedor_id: vendedorId, notas: 'Negocio mixto. Compra artículos variados en cantidades pequeñas.' },
  ]

  const clientesCreados = await query('clientes', 'POST', clientes)
  console.log(`✓ ${clientesCreados.length} clientes creados`)

  // ── 6. Cotizaciones de muestra ──────────────────────────────────────
  console.log('\n📝 Creando cotizaciones...')

  // Helper para calcular totales de items
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

  // Cotización 1: Borrador grande (constructor)
  const cot1Items = calcItems([
    { producto_id: productosCreados[0].id, codigo_snap: 'CEM-001', nombre_snap: 'Cemento Gris Tipo I 42.5kg',     unidad_snap: 'bolsa', cantidad: 100, precio_unit_usd: 5.50,  descuento_pct: 5 },
    { producto_id: productosCreados[3].id, codigo_snap: 'CEM-004', nombre_snap: 'Arena Lavada (saco 40kg)',        unidad_snap: 'bolsa', cantidad: 50,  precio_unit_usd: 2.00,  descuento_pct: 0 },
    { producto_id: productosCreados[4].id, codigo_snap: 'CEM-005', nombre_snap: 'Piedra Picada Nro. 2 (saco 40kg)', unidad_snap: 'bolsa', cantidad: 50,  precio_unit_usd: 2.50, descuento_pct: 0 },
    { producto_id: productosCreados[25].id, codigo_snap: 'FIJ-001', nombre_snap: 'Tornillo Drywall 6x1" (caja 100)', unidad_snap: 'caja', cantidad: 10,  precio_unit_usd: 3.00, descuento_pct: 0 },
  ])
  const t1 = calcCotizacion(cot1Items, 3, 15)

  // Cotización 2: Enviada (ferretería mayorista)
  const cot2Items = calcItems([
    { producto_id: productosCreados[5].id,  codigo_snap: 'PIN-001', nombre_snap: 'Pintura Caucho Int. Blanco Glaciar 4L', unidad_snap: 'und', cantidad: 12, precio_unit_usd: 18.00, descuento_pct: 8 },
    { producto_id: productosCreados[6].id,  codigo_snap: 'PIN-002', nombre_snap: 'Pintura Caucho Ext. Blanco Hueso 4L',   unidad_snap: 'und', cantidad: 8,  precio_unit_usd: 22.00, descuento_pct: 8 },
    { producto_id: productosCreados[9].id,  codigo_snap: 'PIN-005', nombre_snap: 'Rodillo de Felpa 9" con Mango',         unidad_snap: 'und', cantidad: 20, precio_unit_usd: 4.50,  descuento_pct: 0 },
  ])
  const t2 = calcCotizacion(cot2Items, 0, 0)

  // Cotización 3: Enviada (plomero)
  const cot3Items = calcItems([
    { producto_id: productosCreados[20].id, codigo_snap: 'PLO-001', nombre_snap: 'Tubo PVC 1/2" x 3m Presión', unidad_snap: 'und', cantidad: 20, precio_unit_usd: 3.50, descuento_pct: 0 },
    { producto_id: productosCreados[22].id, codigo_snap: 'PLO-003', nombre_snap: 'Codo PVC 1/2" x 90°',        unidad_snap: 'und', cantidad: 40, precio_unit_usd: 0.40, descuento_pct: 0 },
    { producto_id: productosCreados[23].id, codigo_snap: 'PLO-004', nombre_snap: 'Llave de Paso 1/2" Bronce',   unidad_snap: 'und', cantidad: 5,  precio_unit_usd: 5.50, descuento_pct: 0 },
    { producto_id: productosCreados[24].id, codigo_snap: 'PLO-005', nombre_snap: 'Teflón Industrial 3/4" x 10m', unidad_snap: 'und', cantidad: 10, precio_unit_usd: 0.80, descuento_pct: 0 },
  ])
  const t3 = calcCotizacion(cot3Items, 0, 8)

  // Cotización 4: Aceptada (eléctrica)
  const cot4Items = calcItems([
    { producto_id: productosCreados[15].id, codigo_snap: 'ELE-001', nombre_snap: 'Cable THHN 12AWG Rojo (rollo 100m)', unidad_snap: 'rollo', cantidad: 5,  precio_unit_usd: 35.00, descuento_pct: 5 },
    { producto_id: productosCreados[16].id, codigo_snap: 'ELE-002', nombre_snap: 'Interruptor Sencillo 15A Blanco',     unidad_snap: 'und',   cantidad: 30, precio_unit_usd: 2.50,  descuento_pct: 0 },
    { producto_id: productosCreados[17].id, codigo_snap: 'ELE-003', nombre_snap: 'Toma Corriente Doble 15A',            unidad_snap: 'und',   cantidad: 25, precio_unit_usd: 3.00,  descuento_pct: 0 },
    { producto_id: productosCreados[18].id, codigo_snap: 'ELE-004', nombre_snap: 'Breaker 1x20A Riel DIN',              unidad_snap: 'und',   cantidad: 8,  precio_unit_usd: 6.50,  descuento_pct: 0 },
    { producto_id: productosCreados[19].id, codigo_snap: 'ELE-005', nombre_snap: 'Bombillo LED 12W Luz Blanca E27',     unidad_snap: 'und',   cantidad: 50, precio_unit_usd: 2.00,  descuento_pct: 0 },
  ])
  const t4 = calcCotizacion(cot4Items, 2, 0)

  // Cotización 5: Borrador pequeño (particular)
  const cot5Items = calcItems([
    { producto_id: productosCreados[10].id, codigo_snap: 'HER-001', nombre_snap: 'Martillo de Uña 16oz Mango Fibra', unidad_snap: 'und', cantidad: 1, precio_unit_usd: 12.00, descuento_pct: 0 },
    { producto_id: productosCreados[14].id, codigo_snap: 'HER-005', nombre_snap: 'Cinta Métrica 5m Stanley',         unidad_snap: 'und', cantidad: 1, precio_unit_usd: 5.00,  descuento_pct: 0 },
    { producto_id: productosCreados[28].id, codigo_snap: 'FIJ-004', nombre_snap: 'Silicón Transparente 280ml',       unidad_snap: 'und', cantidad: 3, precio_unit_usd: 4.00,  descuento_pct: 0 },
  ])
  const t5 = calcCotizacion(cot5Items, 0, 0)

  // Cotización 6: Enviada con transportista (obra grande)
  const cot6Items = calcItems([
    { producto_id: productosCreados[0].id,  codigo_snap: 'CEM-001', nombre_snap: 'Cemento Gris Tipo I 42.5kg',       unidad_snap: 'bolsa', cantidad: 200, precio_unit_usd: 5.50, descuento_pct: 8 },
    { producto_id: productosCreados[2].id,  codigo_snap: 'CEM-003', nombre_snap: 'Mortero Premezclado 40kg',         unidad_snap: 'bolsa', cantidad: 50,  precio_unit_usd: 4.50, descuento_pct: 5 },
    { producto_id: productosCreados[3].id,  codigo_snap: 'CEM-004', nombre_snap: 'Arena Lavada (saco 40kg)',         unidad_snap: 'bolsa', cantidad: 80,  precio_unit_usd: 2.00, descuento_pct: 0 },
    { producto_id: productosCreados[4].id,  codigo_snap: 'CEM-005', nombre_snap: 'Piedra Picada Nro. 2 (saco 40kg)', unidad_snap: 'bolsa', cantidad: 80, precio_unit_usd: 2.50, descuento_pct: 0 },
    { producto_id: productosCreados[26].id, codigo_snap: 'FIJ-002', nombre_snap: 'Clavo de Acero 2" (kg)',           unidad_snap: 'kg',    cantidad: 20,  precio_unit_usd: 2.50, descuento_pct: 0 },
  ])
  const t6 = calcCotizacion(cot6Items, 5, 15)

  const ahora = new Date()
  const hace3Dias = new Date(ahora - 3 * 86400000).toISOString()
  const hace5Dias = new Date(ahora - 5 * 86400000).toISOString()
  const hace7Dias = new Date(ahora - 7 * 86400000).toISOString()
  const hace10Dias = new Date(ahora - 10 * 86400000).toISOString()
  const en7Dias = new Date(ahora.getTime() + 7 * 86400000).toISOString().split('T')[0]
  const en15Dias = new Date(ahora.getTime() + 15 * 86400000).toISOString().split('T')[0]

  const cotizaciones = [
    {
      cliente_id: clientesCreados[1].id, vendedor_id: supervisor.id, transportista_id: transCreados[3].id,
      estado: 'borrador', subtotal_usd: t1.subtotal, descuento_global_pct: 3, descuento_usd: t1.descuento,
      costo_envio_usd: 15, total_usd: t1.total, valida_hasta: en15Dias,
      tasa_bcv_snapshot: null, total_bs_snapshot: null,
      notas_cliente: 'Precios especiales por volumen. Disponibilidad inmediata.',
      notas_internas: 'Pendiente aprobación del ingeniero residente.',
      creado_en: hace3Dias, enviada_en: null,
    },
    {
      cliente_id: clientesCreados[0].id, vendedor_id: supervisor.id, transportista_id: null,
      estado: 'enviada', subtotal_usd: t2.subtotal, descuento_global_pct: 0, descuento_usd: 0,
      costo_envio_usd: 0, total_usd: t2.total, tasa_bcv_snapshot: 95.50, total_bs_snapshot: Math.round(t2.total * 95.50 * 100) / 100,
      valida_hasta: en7Dias, notas_cliente: 'Retiro en tienda. Descuento por ser cliente frecuente.',
      notas_internas: null,
      enviada_en: hace5Dias, creado_en: hace5Dias,
    },
    {
      cliente_id: clientesCreados[12].id, vendedor_id: vendedorId, transportista_id: transCreados[0].id,
      estado: 'enviada', subtotal_usd: t3.subtotal, descuento_global_pct: 0, descuento_usd: 0,
      costo_envio_usd: 8, total_usd: t3.total, tasa_bcv_snapshot: 94.80, total_bs_snapshot: Math.round(t3.total * 94.80 * 100) / 100,
      valida_hasta: en7Dias,
      notas_cliente: 'Materiales para trabajo de plomería residencial.',
      notas_internas: null,
      enviada_en: hace3Dias, creado_en: hace5Dias,
    },
    {
      cliente_id: clientesCreados[11].id, vendedor_id: vendedorId, transportista_id: null,
      estado: 'aceptada', subtotal_usd: t4.subtotal, descuento_global_pct: 2, descuento_usd: t4.descuento,
      costo_envio_usd: 0, total_usd: t4.total, tasa_bcv_snapshot: 93.20, total_bs_snapshot: Math.round(t4.total * 93.20 * 100) / 100,
      valida_hasta: en15Dias, notas_cliente: 'Material eléctrico para instalación en oficinas.',
      notas_internas: null,
      enviada_en: hace7Dias, creado_en: hace10Dias,
    },
    {
      cliente_id: clientesCreados[3].id, vendedor_id: supervisor.id, transportista_id: null,
      estado: 'borrador', subtotal_usd: t5.subtotal, descuento_global_pct: 0, descuento_usd: 0,
      costo_envio_usd: 0, total_usd: t5.total,
      tasa_bcv_snapshot: null, total_bs_snapshot: null,
      valida_hasta: null,
      notas_cliente: null,
      notas_internas: 'Cliente preguntó si tenemos descuento por pago en efectivo.',
      creado_en: ahora.toISOString(), enviada_en: null,
    },
    {
      cliente_id: clientesCreados[8].id, vendedor_id: vendedorId, transportista_id: transCreados[3].id,
      estado: 'enviada', subtotal_usd: t6.subtotal, descuento_global_pct: 5, descuento_usd: t6.descuento,
      costo_envio_usd: 15, total_usd: t6.total, tasa_bcv_snapshot: 95.10, total_bs_snapshot: Math.round(t6.total * 95.10 * 100) / 100,
      valida_hasta: en7Dias,
      notas_cliente: 'Entrega en obra: Conjunto Residencial Parque del Este, Av. Principal, San Diego. Contactar al Ing. Rodríguez (0414-4567890).',
      notas_internas: 'Descuento autorizado por gerencia. Pedido recurrente mensual.',
      enviada_en: hace3Dias, creado_en: hace5Dias,
    },
  ]

  const cotsCreadas = await query('cotizaciones', 'POST', cotizaciones)
  console.log(`✓ ${cotsCreadas.length} cotizaciones creadas`)

  // ── 7. Items de cotización ──────────────────────────────────────────
  console.log('\n📋 Creando items de cotización...')

  const allItems = [
    ...cot1Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[0].id })),
    ...cot2Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[1].id })),
    ...cot3Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[2].id })),
    ...cot4Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[3].id })),
    ...cot5Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[4].id })),
    ...cot6Items.map(it => ({ ...it, cotizacion_id: cotsCreadas[5].id })),
  ]

  const itemsCreados = await query('cotizacion_items', 'POST', allItems)
  console.log(`✓ ${itemsCreados.length} items de cotización creados`)

  // ── Resumen ─────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════')
  console.log('✅ Seed completado exitosamente!')
  console.log('═══════════════════════════════════════')
  console.log(`  Negocio:       Ferretería El Constructor C.A.`)
  console.log(`  Productos:     ${productosCreados.length}`)
  console.log(`  Transportistas: ${transCreados.length}`)
  console.log(`  Clientes:      ${clientesCreados.length}`)
  console.log(`  Cotizaciones:  ${cotsCreadas.length} (${cotizaciones.filter(c => c.estado === 'borrador').length} borrador, ${cotizaciones.filter(c => c.estado === 'enviada').length} enviadas, ${cotizaciones.filter(c => c.estado === 'aceptada').length} aceptada)`)
  console.log(`  Items:         ${itemsCreados.length}`)
  console.log('')
}

main().catch(console.error)
