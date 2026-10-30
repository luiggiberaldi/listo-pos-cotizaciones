// src/services/pdf/flotaChoferesPDF.js
// PDF único del reporte de Transportistas (botón "Reporte"):
//  - Resumido: fletes por chofer (total / chofer / empresa), resumen del período
//    y Cuadro 1 por camión.
//  - Detallado: lo anterior + destinos y choferes por camión, Cuadro 2 por chofer
//    local y el detalle viaje por viaje (con los viajes sin camión). La fuente estándar del PDF no tiene el símbolo ≈, así que
// los viajes estimados se marcan con "~" y se explica al pie (raíl R5).
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY,
  fmtUsd, drawPremiumHeader,
} from './pdfShared'
import { num, totalesVehiculos, totalesChoferes, variacion, porcentaje, diasDelPeriodo, textoDestinos, repartoFlete } from '../../utils/flotaReporte'
import { nombreVehiculo } from '../../utils/vehiculoImpreso'

const MARCA_PDF = '~'

function viajesPdf(fila) {
  const est = num(fila.viajes_estimados)
  return est > 0 ? `${num(fila.total_viajes)} (${MARCA_PDF}${est})` : String(num(fila.total_viajes))
}

function cortar(doc, texto, ancho) {
  const s = String(texto ?? '')
  if (doc.getTextWidth(s) <= ancho) return s
  let t = s
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > ancho) t = t.slice(0, -1)
  return `${t}…`
}

function drawFooter(doc, config) {
  const total = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setDrawColor(...C_PRIMARY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, PAGE_H - 15, MARGIN + CONTENT_W, PAGE_H - 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...C_GRAY)
    doc.text((config && config.nombre_negocio) || 'Construacero Carabobo C.A.', MARGIN, PAGE_H - 10)
    doc.text(`${MARCA_PDF} = viajes viejos con camión estimado por la ficha del chofer. Mercancía = total - flete - corte.`, MARGIN, PAGE_H - 6)
    doc.text(`Página ${p} de ${total}`, MARGIN + CONTENT_W, PAGE_H - 10, { align: 'right' })
  }
}

function tabla(doc, y, titulo, cols, filas, totales) {
  const nuevaPagina = () => { doc.addPage(); return MARGIN + 6 }
  const encabezado = (yy) => {
    doc.setFillColor(...C_PRIMARY)
    doc.rect(MARGIN, yy, CONTENT_W, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_WHITE)
    let x = MARGIN
    cols.forEach(c => {
      doc.text(c.label, c.align === 'right' ? x + c.w - 1.5 : x + 1.5, yy + 4.8, { align: c.align === 'right' ? 'right' : 'left' })
      x += c.w
    })
    return yy + 8
  }

  if (y > PAGE_H - 50) y = nuevaPagina()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...C_DARK)
  doc.text(titulo, MARGIN, y + 3)
  y = encabezado(y + 6)

  const fila = (valores, negrita = false) => {
    if (y > PAGE_H - 22) { y = encabezado(nuevaPagina()) }
    doc.setFont('helvetica', negrita ? 'bold' : 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C_DARK)
    let x = MARGIN
    cols.forEach((c, i) => {
      const txt = cortar(doc, valores[i], c.w - 3)
      doc.text(txt, c.align === 'right' ? x + c.w - 1.5 : x + 1.5, y + 3.5, { align: c.align === 'right' ? 'right' : 'left' })
      x += c.w
    })
    doc.setDrawColor(225, 230, 238)
    doc.setLineWidth(0.2)
    doc.line(MARGIN, y + 5.5, MARGIN + CONTENT_W, y + 5.5)
    y += 6
  }

  if (filas.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7)
    doc.setTextColor(...C_GRAY)
    doc.text('Sin datos en el período.', MARGIN + 2, y + 4)
    return y + 10
  }
  filas.forEach(v => fila(v))
  if (totales) fila(totales, true)
  return y + 6
}

export async function generarFlotaChoferesPDF({
  porVehiculo = [], porChofer = [], desde = null, hasta = null,
  sinCamion = null, anterior = null, detalle = [], detalleSinCamion = [],
  tablaChoferes = [], modo = 'detallado',
  config = {}, action = 'download',
}) {
  const detallado = modo === 'detallado'
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  let y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: detallado ? 'Reporte de Transportistas · Detallado' : 'Reporte de Transportistas · Resumido',
    subtitle: `Período: ${desde || 'inicio'} a ${hasta || 'hoy'}`,
  })

  const totV = totalesVehiculos(porVehiculo)
  const totChoferes = porVehiculo.reduce((s, v) => s + num(v.comision_choferes_usd), 0)
  const totEmpresa = porVehiculo.reduce((s, v) => s + num(v.empresa_usd), 0)
  const dias = diasDelPeriodo(desde, hasta)
  const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', timeZone: 'America/Caracas' }) : '—')

  // Fletes por chofer local (misma tabla que la pantalla)
  if (tablaChoferes.length > 0) {
    const tot = tablaChoferes.reduce((acc, t) => {
      const r = repartoFlete(t)
      return { despachos: acc.despachos + num(t.despachos), total: acc.total + r.total, chofer: acc.chofer + r.chofer, empresa: acc.empresa + r.empresa }
    }, { despachos: 0, total: 0, chofer: 0, empresa: 0 })
    y = tabla(doc, y + 2, 'Fletes por chofer local', [
      { label: 'CHOFER', w: 70 },
      { label: 'DESPACHOS', w: 22, align: 'right' },
      { label: 'TOTAL FLETES', w: 32, align: 'right' },
      { label: 'PARA EL CHOFER', w: 32, align: 'right' },
      { label: 'PARA LA EMPRESA', w: CONTENT_W - 156, align: 'right' },
    ], tablaChoferes.map(t => {
      const r = repartoFlete(t)
      return [
        `${t.nombre}${t.activo === false ? ' (inactivo)' : ''}${num(t.despachos_nomina) > 0 ? ` · ${num(t.despachos_nomina)} en Carabobo (nómina)` : ''}`,
        String(num(t.despachos)), fmtUsd(r.total), fmtUsd(r.chofer), fmtUsd(r.empresa),
      ]
    }), ['TOTAL', String(tot.despachos), fmtUsd(tot.total), fmtUsd(tot.chofer), fmtUsd(tot.empresa)])
  }

  // Resumen del período (con comparación si hay período anterior)
  const totAnt = Array.isArray(anterior) ? totalesVehiculos(anterior) : null
  const empresaAnt = Array.isArray(anterior) ? anterior.reduce((s, v) => s + num(v.empresa_usd), 0) : 0
  const comp = (a, b) => (totAnt ? `  ${variacion(a, b).texto.replace('▲', '+').replace('▼', '-')} vs período anterior` : '')
  y = tabla(doc, y + 2, 'Resumen del período', [
    { label: 'CONCEPTO', w: 70 },
    { label: 'VALOR', w: 40, align: 'right' },
    { label: 'COMPARACIÓN', w: CONTENT_W - 110 },
  ], [
    ['Viajes de la flota', String(totV.viajes), comp(totV.viajes, totAnt?.viajes).trim()],
    ['Fletes cobrados', fmtUsd(totV.flete), comp(totV.flete, totAnt?.flete).trim()],
    ['Para los choferes', fmtUsd(totChoferes), ''],
    ['Para la empresa', fmtUsd(totEmpresa), comp(totEmpresa, empresaAnt).trim()],
    ['Viajes sin camión registrado', `${num(sinCamion?.viajes)} (${fmtUsd(sinCamion?.flete_usd)})`, num(sinCamion?.viajes) > 0 ? 'Ver lista al final' : ''],
  ])

  // Cuadro 1 · por camión
  y = tabla(doc, y, 'Cuadro 1 · Productividad por vehículo', [
    { label: 'VEHÍCULO', w: 38 },
    { label: 'PLACAS', w: 26 },
    { label: 'VIAJES', w: 14, align: 'right' },
    { label: '% TOTAL', w: 12, align: 'right' },
    { label: dias ? `DÍAS/${dias}` : 'DÍAS', w: 14, align: 'right' },
    { label: 'FLETES', w: 21, align: 'right' },
    { label: 'CHOFERES', w: 20, align: 'right' },
    { label: 'EMPRESA', w: 21, align: 'right' },
    { label: 'ÚLTIMO VIAJE', w: CONTENT_W - 166 },
  ], porVehiculo.map(v => [
    `${nombreVehiculo(v)}${v.activo === false ? ' (inactivo)' : ''}`,
    [v.placa, v.placa_batea].filter(Boolean).join(' / '),
    viajesPdf(v),
    `${porcentaje(v.total_viajes, totV.viajes)}%`,
    String(num(v.dias_trabajados)),
    fmtUsd(v.total_flete_usd),
    fmtUsd(v.comision_choferes_usd),
    fmtUsd(v.empresa_usd),
    v.ultimo_viaje_en ? `${fecha(v.ultimo_viaje_en)} ${v.ultimo_chofer_nombre || ''}` : '—',
  ]), [
    'TOTAL', '', viajesPdf({ total_viajes: totV.viajes, viajes_estimados: totV.estimados }), '100%', '',
    fmtUsd(totV.flete), fmtUsd(totChoferes), fmtUsd(totEmpresa), '',
  ])

  // Cuadro 1 (b) · destinos y choferes por camión (solo camiones con viajes)
  const conViajes = porVehiculo.filter(v => num(v.total_viajes) > 0)
  if (detallado && conViajes.length > 0) {
    y = tabla(doc, y, 'Destinos y choferes por camión', [
      { label: 'VEHÍCULO', w: 38 },
      { label: 'CBO/FUERA', w: 18, align: 'right' },
      { label: 'MERCANCÍA', w: 22, align: 'right' },
      { label: 'DESTINOS FRECUENTES', w: 62 },
      { label: 'CHOFERES', w: CONTENT_W - 140 },
    ], conViajes.map(v => [
      nombreVehiculo(v),
      `${num(v.viajes_en_carabobo)}/${num(v.viajes_fuera_carabobo)}`,
      fmtUsd(v.total_mercancia_usd),
      textoDestinos(v.destinos_top) || '—',
      (v.desglose_choferes || []).map(d => `${d.chofer_nombre}: ${num(d.viajes)}`).join(' / ') || '—',
    ]))
  }

  // Cuadro 2 · por chofer local (reparto chofer / empresa, sin pagado)
  const totC = totalesChoferes(porChofer)
  if (detallado) y = tabla(doc, y, 'Cuadro 2 · Productividad por chofer local', [
    { label: 'CHOFER', w: 34 },
    { label: 'VIAJES', w: 15, align: 'right' },
    { label: 'CBO/FUERA', w: 16, align: 'right' },
    { label: 'FLETES', w: 22, align: 'right' },
    { label: 'MERCANCÍA', w: 22, align: 'right' },
    { label: 'CHOFER', w: 22, align: 'right' },
    { label: 'EMPRESA', w: 22, align: 'right' },
    { label: 'VEHÍCULOS', w: CONTENT_W - 153 },
  ], porChofer.map(c => [
    `${c.chofer_nombre}${c.activo === false ? ' (inactivo)' : ''}`,
    viajesPdf(c),
    `${num(c.viajes_en_carabobo)}/${num(c.viajes_fuera_carabobo)}`,
    fmtUsd(c.total_flete_usd),
    fmtUsd(c.total_mercancia_usd),
    fmtUsd(c.comision_generada_usd),
    fmtUsd(num(c.total_flete_usd) - num(c.comision_generada_usd)),
    (c.desglose_vehiculos || []).map(d => `${d.vehiculo_nombre}: ${num(d.viajes)}`).join(' | ') || '—',
  ]), [
    'TOTAL', String(totC.viajes), `${totC.enCarabobo}/${totC.fueraCarabobo}`,
    fmtUsd(totC.flete), fmtUsd(totC.mercancia), fmtUsd(totC.comisionGenerada),
    fmtUsd(totC.flete - totC.comisionGenerada), '',
  ])

  // Detalle viaje por viaje
  const columnasViaje = [
    { label: 'FECHA', w: 15 },
    { label: 'DESPACHO', w: 20 },
    { label: 'CLIENTE', w: 36 },
    { label: 'DESTINO', w: 33 },
    { label: 'CHOFER', w: 26 },
    { label: 'CAMIÓN', w: 16 },
    { label: 'FLETE', w: 14, align: 'right' },
    { label: 'CHOFER', w: 14, align: 'right' },
    { label: 'EMPRESA', w: CONTENT_W - 174, align: 'right' },
  ]
  const filaViaje = (v) => [
    fecha(v.fecha),
    `DES-${String(v.numero).padStart(5, '0')}${v.vehiculo_origen === 'backfill' ? ` ${MARCA_PDF}` : ''}`,
    v.cliente_nombre || '—',
    [v.ciudad, v.estado_destino].filter(Boolean).join(', ') || '—',
    v.chofer_nombre || '—',
    v.vehiculo_codigo || 'Sin camión',
    fmtUsd(v.flete_usd),
    fmtUsd(v.chofer_usd),
    fmtUsd(v.empresa_usd),
  ]
  if (detallado && detalle.length > 0) {
    y = tabla(doc, y, 'Detalle viaje por viaje (camiones de la empresa)', columnasViaje, detalle.map(filaViaje))
  }
  if (detallado && detalleSinCamion.length > 0) {
    tabla(doc, y, 'Viajes de choferes locales sin camión registrado', columnasViaje, detalleSinCamion.map(filaViaje))
  }

  drawFooter(doc, config)
  const nombre = `Reporte_Transportistas_${detallado ? 'Detallado' : 'Resumido'}_${desde || 'inicio'}_${hasta || 'hoy'}.pdf`
  if (action === 'print') {
    doc.autoPrint()
    const blobUrl = doc.output('bloburl')
    const iframe = document.createElement('iframe')
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' })
    iframe.src = blobUrl
    document.body.appendChild(iframe)
    iframe.onload = () => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch { window.open(blobUrl, '_blank') }
      setTimeout(() => {
        try { document.body.removeChild(iframe) } catch { /* ya no está */ }
        try { URL.revokeObjectURL(blobUrl) } catch { /* sin efecto */ }
      }, 60000)
    }
  } else {
    doc.save(nombre)
  }
}
