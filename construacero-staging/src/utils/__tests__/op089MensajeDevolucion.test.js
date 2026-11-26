// OP-2026-089 — el mensaje de "no hay nada que devolver" explica el motivo sin términos internos.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const s = readFileSync(path.resolve(__dirname, '../../..', 'src/components/despachos/DevolucionParcialModal.jsx'), 'utf8')

describe('OP-2026-089 mensaje de devolución parcial bloqueada', () => {
  it('distingue préstamo, mezcla y todo devuelto', () => {
    expect(s).toContain('Este despacho no admite devolución parcial')
    expect(s).toContain('Ya se devolvió todo lo de este despacho')
    expect(s).toContain('No queda nada por devolver desde aquí')
  })
  it('no usa jerga interna ni confunde un préstamo con una venta anulada', () => {
    expect(s).not.toContain('venta anulada económicamente')
    expect(s).not.toContain('ajustes de devolución')
    expect(s).not.toContain('ajustes en CxC')
  })
})
