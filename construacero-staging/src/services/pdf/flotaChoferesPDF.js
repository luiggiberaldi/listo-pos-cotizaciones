// src/services/pdf/flotaChoferesPDF.js
// PDF del reporte de flota (Fase 4 del plan): Cuadro 1 por vehículo y Cuadro 2
// por chofer local. La fuente estándar del PDF no tiene el símbolo ≈, así que
// los viajes estimados se marcan con "~" y se explica al pie (raíl R5).
import { jsPDF } from 'jspdf'
import { cargarLogo } from './pdfLogo'
import {
  PAGE_H, MARGIN, CONTENT_W,
  C_PRIMARY, C_DARK, C_WHITE, C_GRAY,
  fmtUsd, drawPremiumHeader,
} from './pdfShared'
import { num, totalesVehiculos, totalesChoferes } from '../../utils/flotaReporte'

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

export async function generarFlotaChoferesPDF({ porVehiculo = [], porChofer = [], desde = null, hasta = null, config = {}, action = 'download' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
  const logoData = await cargarLogo(config.logo_url)
  let y = drawPremiumHeader({
    doc,
    logoData,
    config,
    title: 'Reporte de Flota y Choferes Locales',
    subtitle: `Período: ${desde || 'inicio'} a ${hasta || 'hoy'}`,
  })

  const totV = totalesVehiculos(porVehiculo)
  y = tabla(doc, y + 2, 'Cuadro 1 · Productividad por vehículo', [
    { label: 'VEHÍCULO', w: 46 },
    { label: 'PLACA', w: 20 },
    { label: 'VIAJES', w: 18, align: 'right' },
    { label: 'FLETES', w: 24, align: 'right' },
    { label: 'MERCANCÍA', w: 26, align: 'right' },
    { label: 'PROM./VIAJE', w: 20, align: 'right' },
    { label: 'CHOFERES', w: CONTENT_W - 154 },
  ], porVehiculo.map(v => [
    `${v.codigo} ${v.nombre}${v.activo === false ? ' (inactivo)' : ''}`,
    v.placa,
    viajesPdf(v),
    fmtUsd(v.total_flete_usd),
    fmtUsd(v.total_mercancia_usd),
    fmtUsd(v.promedio_flete_viaje_usd),
    (v.desglose_choferes || []).map(d => `${d.chofer_nombre}: ${num(d.viajes)}`).join(' / ') || '—',
  ]), [
    'TOTAL', '',
    viajesPdf({ total_viajes: totV.viajes, viajes_estimados: totV.estimados }),
    fmtUsd(totV.flete), fmtUsd(totV.mercancia),
    fmtUsd(totV.viajes > 0 ? totV.flete / totV.viajes : 0), '',
  ])

  const totC = totalesChoferes(porChofer)
  tabla(doc, y, 'Cuadro 2 · Productividad y liquidación por chofer local', [
    { label: 'CHOFER', w: 34 },
    { label: 'VIAJES', w: 15, align: 'right' },
    { label: 'CBO/FUERA', w: 16, align: 'right' },
    { label: 'FLETES', w: 21, align: 'right' },
    { label: 'MERCANCÍA', w: 23, align: 'right' },
    { label: 'COM. GEN.', w: 20, align: 'right' },
    { label: 'PAGADA', w: 19, align: 'right' },
    { label: 'PENDIENTE', w: 20, align: 'right' },
    { label: 'VEHÍCULOS', w: CONTENT_W - 168 },
  ], porChofer.map(c => [
    `${c.chofer_nombre}${c.activo === false ? ' (inactivo)' : ''}`,
    viajesPdf(c),
    `${num(c.viajes_en_carabobo)}/${num(c.viajes_fuera_carabobo)}`,
    fmtUsd(c.total_flete_usd),
    fmtUsd(c.total_mercancia_usd),
    fmtUsd(c.comision_generada_usd),
    fmtUsd(c.comision_pagada_usd),
    fmtUsd(c.comision_pendiente_usd),
    (c.desglose_vehiculos || []).map(d => `${d.vehiculo_nombre}: ${num(d.viajes)}`).join(' | ') || '—',
  ]), [
    'TOTAL', String(totC.viajes), `${totC.enCarabobo}/${totC.fueraCarabobo}`,
    fmtUsd(totC.flete), fmtUsd(totC.mercancia), fmtUsd(totC.comisionGenerada),
    fmtUsd(totC.comisionPagada), fmtUsd(totC.comisionPendiente), '',
  ])

  drawFooter(doc, config)
  const nombre = `Flota_Choferes_${desde || 'inicio'}_${hasta || 'hoy'}.pdf`
  if (action === 'print') {
    doc.autoPrint()
    window.open(doc.output('bloburl'), '_blank')
  } else {
    doc.save(nombre)
  }
}
