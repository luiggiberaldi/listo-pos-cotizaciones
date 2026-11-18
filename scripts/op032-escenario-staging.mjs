// OP-2026-032 — Escenario de prueba SOLO STAGING: "vendedora nueva vende a cliente ajeno".
// Reproduce el caso de DES-04808 (Wendy → cliente de Niki con cobro a destino pendiente)
// y tres casos vecinos, usando el Worker del código principal conectado a staging
// (configuraciones "rama-api-con-staging" en :8788 y "rama-web-con-staging" en :4173).
//
// Uso:  node scripts/op032-escenario-staging.mjs            → crea usuarios, clientes y 4 ventas
//       node scripts/op032-escenario-staging.mjs --estado   → muestra comisiones guardadas
//       node scripts/op032-escenario-staging.mjs --cobrar   → registra el cobro a destino de la venta 1
//       node scripts/op032-escenario-staging.mjs --cerrar   → desactiva usuarios OP032 y restaura la config
//
// PIN de prueba (solo staging, usuarios creados por este guion):
//   OP032 Vendedora (vendedor) 2580 · OP032 Duena (supervisor) 369258 · OP032 EMPRESA (sin comisión) 1470
//   OP032 Jefe (jefe) 852741 — también sirve para ver los reportes en la app (:4173)
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ORIGEN = 'http://localhost:8788' // Worker del código principal (la app en :4173 lo llama directo)
const STAGING_REF = 'spupqgkdsgohxxfoxydl'
const ESTADO_FILE = path.join('tmp', 'op032-escenario.json')

function leerEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z_]\w*)=(.*)$/.exec(l.trim())
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const vars = leerEnv('tmp/staging-local.dev.vars')
const e2e = leerEnv('construacero-staging/.env.e2e.local')
if (!String(vars.SUPABASE_URL).includes(STAGING_REF)) throw new Error('ABORTADO: la configuración no apunta a staging')

const USUARIOS = {
  vendedora: { nombre: 'OP032 Vendedora', rol: 'vendedor', pin: '2580', color: '#7C3AED' },
  duena: { nombre: 'OP032 Duena', rol: 'supervisor', pin: '369258', color: '#D97706' },
  empresa: { nombre: 'OP032 EMPRESA', rol: 'vendedor_sin_comision', pin: '1470', color: '#64748B' },
  // Aprueba y entrega (el desarrollador virtual no pertenece a la cuenta y la base lo rechaza).
  jefe: { nombre: 'OP032 Jefe', rol: 'jefe', pin: '852741', color: '#059669' },
}

const sb = createClient(vars.SUPABASE_URL, vars.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const svc = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
let superToken = null
let accessToken = null
const sesiones = {}

async function api(ruta, method = 'GET', body = null, operador = null, sinSesion = false) {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', Origin: 'http://localhost:4173' }
  // sinSesion: abrir la sesión de otro operador SIN mandar la actual (si se manda, el servidor la reemplaza).
  const token = sinSesion ? null : (operador ? sesiones[operador] : superToken)
  if (token) headers['X-Operator-Session'] = token
  if (operador) headers['X-Operator-Id'] = operador
  if (body) headers['Content-Type'] = 'application/json'
  const r = await fetch(`${ORIGEN}${ruta}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  let d = null; try { d = t ? JSON.parse(t) : null } catch { d = { raw: t } }
  if (!r.ok) throw new Error(`${method} ${ruta} → ${r.status}: ${d?.error || d?.message || t}`)
  return d
}

async function entrar() {
  const { data, error } = await sb.auth.signInWithPassword({ email: e2e.STAGING_E2E_EMAIL.trim().toLowerCase(), password: e2e.STAGING_E2E_PASSWORD })
  if (error) throw new Error(`login staging: ${error.message}`)
  accessToken = data.session.access_token
  const r = await api('/api/auth/super-admin', 'POST', { code: vars.DEV_SUPER_CODE })
  superToken = r?.operatorSession?.token
  if (!superToken) throw new Error('no se abrió la sesión de desarrollador')
  return data.user.id
}

async function asegurarUsuario(u) {
  const ops = (await api('/api/auth/operators'))?.operators || []
  let op = ops.find(o => o.nombre === u.nombre)
  if (!op) {
    const { data: inactivo } = await svc.from('usuarios').select('id').eq('nombre', u.nombre).maybeSingle()
    if (inactivo) {
      await svc.from('usuarios').update({ activo: true }).eq('id', inactivo.id)
      op = { id: inactivo.id }
    }
  }
  if (op) await api(`/api/admin/users/${op.id}`, 'PUT', { nombre: u.nombre, rol: u.rol, pin: u.pin })
  else op = await api('/api/admin/users', 'POST', { nombre: u.nombre, rol: u.rol, pin: u.pin, color: u.color })
  const s = await api('/api/auth/switch-operator', 'POST', { operator_id: op.id, pin: u.pin }, null, true)
  sesiones[op.id] = s?.operatorSession?.token
  return op.id
}

async function asegurarCliente(cuentaId, rif, nombre, vendedorId) {
  const payload = { rif_cedula: rif, nombre, tipo_cliente: 'particular', vendedor_id: vendedorId, cuenta_id: cuentaId, activo: true, saldo_pendiente: 0, telefono: '0414-0000032' }
  const { data: ex } = await svc.from('clientes').select('id').eq('rif_cedula', rif).eq('cuenta_id', cuentaId).maybeSingle()
  if (ex) { await svc.from('clientes').update(payload).eq('id', ex.id); return ex.id }
  const { data, error } = await svc.from('clientes').insert(payload).select('id').single()
  if (error) throw new Error(`cliente ${nombre}: ${error.message}`)
  return data.id
}

async function vender({ etiqueta, vendedorId, jefeId, clienteId, producto, cantidad, formaPago }) {
  const total = Math.round(cantidad * producto.precio_usd * 100) / 100
  const cot = await api('/api/cotizaciones/guardar', 'POST', {
    headerData: { cliente_id: clienteId, vendedor_id: vendedorId, notas_cliente: `OP032 ${etiqueta}`, notas_internas: 'OP-2026-032 prueba', descuento_global_pct: 0, costo_envio_usd: 0, subtotal_usd: total, descuento_usd: 0, total_usd: total },
    items: [{ producto_id: producto.id, codigo_snap: producto.codigo, nombre_snap: producto.nombre, unidad_snap: producto.unidad, cantidad, precio_unit_usd: producto.precio_usd, descuento_pct: 0, total_linea_usd: total }],
  }, vendedorId)
  await api('/api/cotizaciones/enviar', 'POST', { cotizacionId: cot.id, tasaBcv: 100 }, vendedorId)
  await svc.from('cotizaciones').update({ estado: 'aceptada' }).eq('id', cot.id)
  const fp = typeof formaPago === 'function' ? formaPago(total) : formaPago
  const desp = await api('/api/despachos/crear', 'POST', { cotizacionId: cot.id, formaPago: fp, transportistaId: null, fleteUsd: 0 }, vendedorId)
  await api('/api/despachos/estado', 'POST', { despachoId: desp.id, nuevoEstado: 'despachada' }, jefeId)
  await api('/api/despachos/estado', 'POST', { despachoId: desp.id, nuevoEstado: 'entregada' }, jefeId)
  const { data: nd } = await svc.from('notas_despacho').select('numero').eq('id', desp.id).single()
  console.log(`  ✓ ${etiqueta}: despacho #${nd.numero} ($${total})`)
  return { etiqueta, despachoId: desp.id, cotizacionId: cot.id, numero: nd.numero, total }
}

async function mostrarEstado(est) {
  const ids = est.ventas.map(v => v.despachoId)
  const { data: com } = await svc.from('comisiones').select('despachoid,vendedorid,totalcomision,estado').in('despachoid', ids)
  const { data: us } = await svc.from('usuarios').select('id,nombre').in('id', Object.values(est.usuarios))
  const nombre = id => us.find(u => u.id === id)?.nombre || id
  console.log('\nComisiones GUARDADAS en la base (lo que se paga):')
  for (const v of est.ventas) {
    const filas = com.filter(c => c.despachoid === v.despachoId)
    console.log(`  #${v.numero} ${v.etiqueta}: ${filas.length ? filas.map(c => `${nombre(c.vendedorid)} $${c.totalcomision}`).join(', ') : 'SIN comisión'}`)
  }
}

const modo = process.argv[2] || '--crear'
const cuentaId = await entrar()

if (modo === '--crear') {
  // Guardar el valor ORIGINAL una sola vez: si un intento anterior ya lo cambió, conservar el primero.
  const previo = fs.existsSync(ESTADO_FILE) ? JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8')).configOriginal : null
  const { data: cfgActual } = await svc.from('configuracion_negocio').select('comision_cod_solo_pagado').eq('cuenta_id', cuentaId).single()
  const cfg = previo || cfgActual
  const usuarios = {}
  for (const [k, u] of Object.entries(USUARIOS)) usuarios[k] = await asegurarUsuario(u)
  console.log('Usuarios de prueba listos')
  // Igual que producción: comisión solo con cobro a destino pagado.
  await api('/api/admin/config', 'PUT', { comision_cod_solo_pagado: true })
  const clientes = {
    deDuena: await asegurarCliente(cuentaId, 'V-03200001', 'OP032 Cliente de la Duena', usuarios.duena),
    deEmpresa: await asegurarCliente(cuentaId, 'V-03200002', 'OP032 Cliente de EMPRESA', usuarios.empresa),
    propio: await asegurarCliente(cuentaId, 'V-03200003', 'OP032 Cliente propio de la Vendedora', usuarios.vendedora),
  }
  const { data: prods } = await svc.from('productos').select('id,codigo,nombre,unidad,precio_usd').eq('cuenta_id', cuentaId).in('codigo', ['CLA-3', 'CEM-50'])
  const clavo = prods.find(p => p.codigo === 'CLA-3')
  const cemento = prods.find(p => p.codigo === 'CEM-50')
  console.log('Creando ventas (vende siempre OP032 Vendedora):')
  const ventas = []
  // 1) Igual a DES-04808: cliente ajeno + cobro a destino pendiente
  ventas.push(await vender({ etiqueta: 'Cliente ajeno + COD pendiente', vendedorId: usuarios.vendedora, jefeId: usuarios.jefe, clienteId: clientes.deDuena, producto: clavo, cantidad: 10,
    formaPago: t => [{ metodo: 'Zelle', monto: String(Math.round((t - 5) * 100) / 100) }, { metodo: 'Cobro a destino', monto: 5, diasVencimiento: 0, cobro_destino_pagado: false, metodo_propuesto: [{ metodo: 'Efectivo $', monto: 5 }] }] }))
  // 2) Cliente ajeno pagado completo → comisión a la DUEÑA
  ventas.push(await vender({ etiqueta: 'Cliente ajeno pagado', vendedorId: usuarios.vendedora, jefeId: usuarios.jefe, clienteId: clientes.deDuena, producto: cemento, cantidad: 4, formaPago: t => [{ metodo: 'Zelle', monto: String(t) }] }))
  // 3) Cliente de EMPRESA → sin comisión
  ventas.push(await vender({ etiqueta: 'Cliente de EMPRESA', vendedorId: usuarios.vendedora, jefeId: usuarios.jefe, clienteId: clientes.deEmpresa, producto: cemento, cantidad: 2, formaPago: t => [{ metodo: 'Zelle', monto: String(t) }] }))
  // 4) Cliente propio → comisión a la VENDEDORA
  ventas.push(await vender({ etiqueta: 'Cliente propio', vendedorId: usuarios.vendedora, jefeId: usuarios.jefe, clienteId: clientes.propio, producto: clavo, cantidad: 5, formaPago: t => [{ metodo: 'Zelle', monto: String(t) }] }))
  const est = { cuentaId, usuarios, clientes, ventas, configOriginal: cfg }
  fs.mkdirSync('tmp', { recursive: true })
  fs.writeFileSync(ESTADO_FILE, JSON.stringify(est, null, 2))
  await mostrarEstado(est)
} else {
  const est = JSON.parse(fs.readFileSync(ESTADO_FILE, 'utf8'))
  // Sesión del jefe de prueba para aprobar/anular/cobrar.
  const sj = await api('/api/auth/switch-operator', 'POST', { operator_id: est.usuarios.jefe, pin: USUARIOS.jefe.pin }, null, true)
  sesiones[est.usuarios.jefe] = sj?.operatorSession?.token
  if (modo === '--estado') await mostrarEstado(est)
  if (modo === '--cobrar') {
    const v = est.ventas[0]
    // Registro oficial del cobro a destino (el mismo paso que usa la pantalla "Registrar cobro / abono COD").
    await api('/api/despachos/conciliar-cod', 'POST', {
      despachoId: v.despachoId,
      pagos: [{ metodo: 'Efectivo $', monto: 5 }],
      evidencia: 'OP-2026-032 prueba en staging',
      idempotencyKey: crypto.randomUUID(),
    }, est.usuarios.jefe)
    console.log(`Cobro a destino registrado en #${v.numero}`)
    await mostrarEstado(est)
  }
  if (modo === '--anular') {
    // Anula un despacho de prueba suelto (p. ej. de un intento fallido): node ... --anular 3728
    const numero = Number(process.argv[3])
    const { data: nd } = await svc.from('notas_despacho').select('id,numero').eq('numero', numero).eq('cuenta_id', est.cuentaId).single()
    await api('/api/despachos/estado', 'POST', { despachoId: nd.id, nuevoEstado: 'anulada' }, est.usuarios.jefe)
    console.log(`Despacho #${numero} anulado`)
  }
  if (modo === '--cerrar') {
    await api('/api/admin/config', 'PUT', { comision_cod_solo_pagado: !!est.configOriginal?.comision_cod_solo_pagado })
    // Todos los OP032 de la cuenta (incluye duplicados de intentos anteriores).
    await svc.from('usuarios').update({ activo: false }).eq('cuenta_id', est.cuentaId).like('nombre', 'OP032 %')
    console.log('Config restaurada y usuarios OP032 desactivados (ventas de prueba quedan en staging, marcadas "OP032").')
  }
}
