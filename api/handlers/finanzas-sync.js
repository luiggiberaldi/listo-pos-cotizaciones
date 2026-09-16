// api/handlers/finanzas-sync.js
// Endpoint seguro para exportar el cierre de ventas hacia el sistema de Nómina y Finanzas
// Reglas:
// 1. Solo ingresos líquidos reales en total_ingresos_usd (efectivo, zelle, usdt, pago móvil, transf, punto).
// 2. Créditos otorgados (CxC y COD) y fletes foráneos se reportan de forma informativa pero NO entran a total_ingresos_usd.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { readAllRows } from '../lib/dashboardData.js'

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100
}

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

export async function handleCierreDiarioSync(request, env) {
  if (request.method !== 'GET') {
    return jsonError('Método no permitido', 405, request)
  }

  // 1. Verificación de seguridad por token compartido
  const authHeader = request.headers.get('Authorization') || ''
  const syncHeader = request.headers.get('x-sync-secret') || ''
  const expectedSecret = env.FINANZAS_SYNC_SECRET || env.SYNC_SECRET_KEY
  const accountId = env.FINANZAS_SYNC_ACCOUNT_ID
  if (!expectedSecret || !isValidUuid(accountId)) {
    return jsonError('Integración financiera no configurada', 503, request)
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : syncHeader.trim()
  if (!token || token !== expectedSecret) {
    return jsonError('No autorizado para sincronización de finanzas', 401, request)
  }

  const url = new URL(request.url)
  const fecha = url.searchParams.get('fecha') || new Date().toISOString().slice(0, 10)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return jsonError('Formato de fecha inválido (use YYYY-MM-DD)', 400, request)
  }

  try {
    // 2. La integración también se acota explícitamente a una sola cuenta.
    const salesQuery = new URLSearchParams({
      select: 'id,flete_usd,tasa_snapshot,forma_pago,forma_pago_cliente',
      cuenta_id: `eq.${accountId}`, estado: 'in.(despachada,entregada)',
    })
    salesQuery.append('creado_en', `gte.${fecha}T00:00:00-04:00`)
    salesQuery.append('creado_en', `lte.${fecha}T23:59:59.999-04:00`)
    const despachosRaw = (await readAllRows(env, serviceHeaders(env), 'notas_despacho', salesQuery))
      .map(row => ({ ...row, tasa: row.tasa_snapshot, forma_pago: row.forma_pago_cliente || row.forma_pago }))

    const cxcQuery = new URLSearchParams({ select: 'id,tipo,monto_usd,forma_pago_abono,referencia', cuenta_id: `eq.${accountId}` })
    cxcQuery.append('creado_en', `gte.${fecha}T00:00:00-04:00`)
    cxcQuery.append('creado_en', `lte.${fecha}T23:59:59.999-04:00`)
    const cxcList = await readAllRows(env, serviceHeaders(env), 'cuentas_por_cobrar', cxcQuery)

    // 4. Procesar formas de pago de ventas de contado líquidas (sin créditos y sin fletes)
    const desglose = {
      efectivo_usd: 0,
      zelle_usd: 0,
      usdt_usd: 0,
      efectivo_ves: 0,
      transferencia_ves: 0,
      pago_movil_ves: 0,
      punto_venta_ves: 0,
      otros_usd: 0,
    }

    let ventasLiquidasUsd = 0
    let cxcOtorgadoUsd = 0
    let codOtorgadoUsd = 0
    let fletesForaneosUsd = 0
    let totalDespachos = 0
    let tasaPromedioBcv = 1

    for (const d of (Array.isArray(despachosRaw) ? despachosRaw : [])) {
      totalDespachos += 1
      const flete = Number(d.flete_usd || 0)
      const tasaDoc = Number(d.tasa || 1)
      if (tasaDoc > 1) tasaPromedioBcv = tasaDoc
      fletesForaneosUsd += flete

      let formas = d.forma_pago
      if (typeof formas === 'string') {
        try {
          formas = JSON.parse(formas)
        } catch {
          formas = []
        }
      }
      formas = Array.isArray(formas) ? formas : []

      for (const f of formas) {
        if (!f) continue
        const metodo = String(f.metodo || f.formaPago || '').toLowerCase()
        const montoUsd = Number(f.monto || 0)

        // Excluir créditos otorgados (Cuentas por cobrar y Cobro a destino no son ingresos en caja aún)
        if (metodo.includes('cta por cobrar') || metodo.includes('cuenta por cobrar')) {
          cxcOtorgadoUsd += montoUsd
          continue
        }
        if (metodo.includes('cobro a destino') || metodo.includes('cod')) {
          codOtorgadoUsd += montoUsd
          continue
        }

        // Excluir formas no monetarias
        if (metodo.includes('cruce') || metodo.includes('donacion') || metodo.includes('donación') || metodo.includes('saldo a favor')) {
          continue
        }

        ventasLiquidasUsd += montoUsd

        if (metodo.includes('usdt')) {
          desglose.usdt_usd += montoUsd
        } else if (metodo.includes('zelle')) {
          desglose.zelle_usd += montoUsd
        } else if (metodo.includes('efectivo') && (metodo.includes('$') || metodo.includes('dolar') || metodo.includes('dólar') || !metodo.includes('bs'))) {
          desglose.efectivo_usd += montoUsd
        } else if (metodo.includes('efectivo') && (metodo.includes('bs') || metodo.includes('bolivar') || metodo.includes('bolívar'))) {
          desglose.efectivo_ves += (montoUsd * tasaDoc)
        } else if (metodo.includes('pago móvil') || metodo.includes('pago movil')) {
          desglose.pago_movil_ves += (montoUsd * tasaDoc)
        } else if (metodo.includes('transferencia')) {
          desglose.transferencia_ves += (montoUsd * tasaDoc)
        } else if (metodo.includes('punto') || metodo.includes('tarjeta') || metodo.includes('debito') || metodo.includes('débito')) {
          desglose.punto_venta_ves += (montoUsd * tasaDoc)
        } else {
          desglose.otros_usd += montoUsd
        }
      }
    }

    // 5. Procesar abonos de CxC líquidos
    let cobrosCxcLiquidosUsd = 0
    let devolucionesUsd = 0

    for (const item of (Array.isArray(cxcList) ? cxcList : [])) {
      if (!item) continue
      const montoUsd = Number(item.monto_usd || 0)
      if (item.tipo === 'devolucion_credito') {
        devolucionesUsd += montoUsd
        continue
      }

      if (item.tipo === 'abono') {
        const metodoAbono = String(item.forma_pago_abono || item.referencia || '').toLowerCase()

        // Excluir cruces
        if (metodoAbono.includes('cruce') || metodoAbono.includes('donacion')) {
          continue
        }

        cobrosCxcLiquidosUsd += montoUsd

        if (metodoAbono.includes('usdt')) {
          desglose.usdt_usd += montoUsd
        } else if (metodoAbono.includes('zelle')) {
          desglose.zelle_usd += montoUsd
        } else if (metodoAbono.includes('efectivo') && (metodoAbono.includes('$') || !metodoAbono.includes('bs'))) {
          desglose.efectivo_usd += montoUsd
        } else if (metodoAbono.includes('efectivo') && metodoAbono.includes('bs')) {
          desglose.efectivo_ves += (montoUsd * tasaPromedioBcv)
        } else if (metodoAbono.includes('pago móvil') || metodoAbono.includes('pago movil')) {
          desglose.pago_movil_ves += (montoUsd * tasaPromedioBcv)
        } else if (metodoAbono.includes('transferencia')) {
          desglose.transferencia_ves += (montoUsd * tasaPromedioBcv)
        } else if (metodoAbono.includes('punto') || metodoAbono.includes('tarjeta')) {
          desglose.punto_venta_ves += (montoUsd * tasaPromedioBcv)
        } else {
          desglose.efectivo_usd += montoUsd
        }
      }
    }

    // 6. Resumen de dinero líquido real que entra a las carteras
    const creditosPendientesUsd = round2(cxcOtorgadoUsd + codOtorgadoUsd)
    const totalIngresosUsdLiquidos = round2(
      desglose.efectivo_usd +
      desglose.zelle_usd +
      desglose.usdt_usd +
      ((desglose.efectivo_ves + desglose.transferencia_ves + desglose.pago_movil_ves + desglose.punto_venta_ves) / (tasaPromedioBcv || 1)) +
      desglose.otros_usd -
      devolucionesUsd
    )

    const payload = {
      ok: true,
      fecha,
      origen: 'POS Construacero Cotizaciones',
      total_despachos: totalDespachos,
      ventas_contado_usd: round2(ventasLiquidasUsd),
      cobros_cxc_usd: round2(cobrosCxcLiquidosUsd),
      cxc_otorgado_usd: round2(cxcOtorgadoUsd),
      cod_otorgado_usd: round2(codOtorgadoUsd),
      creditos_pendientes_usd: creditosPendientesUsd,
      creditos_otorgados_usd: creditosPendientesUsd,
      fletes_foraneos_usd: round2(fletesForaneosUsd),
      devoluciones_usd: round2(devolucionesUsd),
      total_ingresos_usd: totalIngresosUsdLiquidos,
      tasa_bcv: tasaPromedioBcv,
      desglose_pagos: {
        efectivo_usd: round2(desglose.efectivo_usd),
        zelle_usd: round2(desglose.zelle_usd),
        usdt_usd: round2(desglose.usdt_usd),
        efectivo_ves: round2(desglose.efectivo_ves),
        transferencia_ves: round2(desglose.transferencia_ves),
        pago_movil_ves: round2(desglose.pago_movil_ves),
        punto_venta_ves: round2(desglose.punto_venta_ves),
        otros_usd: round2(desglose.otros_usd),
      },
      generado_en: new Date().toISOString(),
    }

    return json(payload, 200, request)
  } catch (error) {
    return jsonError(`Error al consultar cierre de ventas: ${error.message}`, 500, request)
  }
}
