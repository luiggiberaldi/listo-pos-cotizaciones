// src/components/despachos/__tests__/CodigosExternosEditor.test.js
// Contrato de la corrección de códigos externos al aprobar: el editor aparece
// solo al aprobar, guarda antes de aprobar y nunca toca inventario.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const editor = fs.readFileSync(new URL('../CodigosExternosEditor.jsx', import.meta.url), 'utf8')
const card = fs.readFileSync(new URL('../DespachoCard.jsx', import.meta.url), 'utf8')
const hooks = fs.readFileSync(new URL('../../../hooks/useDespachos.js', import.meta.url), 'utf8')
const handler = fs.readFileSync(new URL('../../../../api/handlers/despachos.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../../../../worker.js', import.meta.url), 'utf8')

describe('CodigosExternosEditor — contrato de interfaz', () => {
  it('solo lista líneas externas (sin producto_id del catálogo)', () => {
    expect(editor).toContain('export function esItemExterno')
    expect(editor).toContain("!it?.producto_id")
    expect(card).toContain('itemsExternosAprobacion')
    expect(card).toContain('itemsDelDespacho.filter(esItemExterno)')
  })

  it('aparece únicamente al aprobar el despacho (no al entregar)', () => {
    expect(card).toContain("accionPendiente?.estado === 'despachada' && itemsExternosAprobacion.length > 0")
    expect(card).toContain('<CodigosExternosEditor')
  })

  it('edita solo el texto del código, con límite de 40 caracteres', () => {
    expect(editor).toContain('codigos[it.id] ?? it.codigo_snap ?? \'\'')
    expect(editor).toContain('maxLength={40}')
    expect(editor).toContain('onChange(it.id, e.target.value.toUpperCase())')
    // El editor no muestra ni envía campos de cantidades, precios ni stock
    expect(editor).not.toContain('cantidad_snap')
    expect(editor).not.toContain('precio_unit_usd')
    expect(editor).not.toContain('precioUnitUsd')
    expect(editor).not.toContain('stock_actual')
    expect(editor).not.toContain('total_linea_usd')
  })

  it('guarda los códigos corregidos ANTES de aprobar y aborta si falla', () => {
    const idxGuardado = card.indexOf('editarCodigosExternos.mutateAsync')
    const idxAprobacion = card.indexOf('await onCambiarEstado(accionPendiente.id, accionPendiente.estado)')
    expect(idxGuardado).toBeGreaterThan(-1)
    expect(idxAprobacion).toBeGreaterThan(-1)
    expect(idxGuardado).toBeLessThan(idxAprobacion) // guardar primero, aprobar después
  })

  it('la tarjeta avisa cuántos productos externos traen código automático antes de aprobar', () => {
    expect(editor).toContain('export function esCodigoAutomatico')
    expect(editor).toContain('/^EXT\\d{5,}$/i')
    expect(card).toContain('itemsCodigoAutomatico = itemsExternosAprobacion.filter(it => esCodigoAutomatico(it.codigo_snap))')
    expect(card).toContain("itemsCodigoAutomatico.length > 0 && despacho.estado === 'pendiente' && esPrivilegiado")
    expect(card).toContain('con código automático')
    expect(card).toContain('Revisa el código al aprobar')
  })

  it('el endpoint exige rol administrativo, estado pendiente y línea externa', () => {
    expect(hooks).toContain("'/api/despachos/editar-codigos-externos'")
    expect(worker).toContain("'/api/despachos/editar-codigos-externos'")
    expect(handler).toContain('handleEditarCodigosExternos')
    expect(handler).toContain("['administracion', 'jefe', 'desarrollador'].includes(operador.rol)")
    expect(handler).toContain("despacho.estado !== 'pendiente'")
    expect(handler).toContain('producto_id=is.null')
  })
})
