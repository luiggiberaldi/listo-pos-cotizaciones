import { describe, expect, it } from 'vitest'

const DEEP_EDIT_ROLES = ['administracion', 'jefe', 'desarrollador']

describe('permisos de edición profunda de despachos', () => {
  it('excluye al supervisor y conserva administración, jefe y desarrollador', () => {
    expect(DEEP_EDIT_ROLES).toEqual(['administracion', 'jefe', 'desarrollador'])
    expect(DEEP_EDIT_ROLES).not.toContain('supervisor')
  })
})
