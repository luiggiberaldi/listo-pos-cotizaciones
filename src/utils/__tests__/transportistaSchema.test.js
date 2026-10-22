import { describe, expect, it } from 'vitest'
import {
  isMissingTransportistaColumnError,
  normalizeTransportistaSchema,
  TRANSPORTISTA_SELECT_EXTENDED,
} from '../transportistaSchema'

describe('transportistaSchema', () => {
  it('detecta columnas nuevas ausentes en PostgREST', () => {
    expect(isMissingTransportistaColumnError({
      code: 'PGRST204',
      message: "Could not find the 'tipo_relacion' column of 'transportistas' in the schema cache",
    })).toBe(true)
    expect(isMissingTransportistaColumnError({ code: '42501', message: 'permission denied' })).toBe(false)
  })

  it('normaliza registros antiguos con valores compatibles', () => {
    expect(normalizeTransportistaSchema({ id: 't-1', nombre: 'Chofer' })).toMatchObject({
      id: 't-1',
      tipo_relacion: 'proveedor',
      empleado_id: null,
      emite_comprobante: false,
    })
  })

  it('mantiene las columnas nuevas en el selector extendido', () => {
    expect(TRANSPORTISTA_SELECT_EXTENDED).toContain('tipo_relacion')
    expect(TRANSPORTISTA_SELECT_EXTENDED).toContain('emite_comprobante')
  })
})
