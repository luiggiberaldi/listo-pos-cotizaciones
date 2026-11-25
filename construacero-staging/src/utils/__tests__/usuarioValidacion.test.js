// OP-2026-030: reglas del formulario "Nuevo usuario" (las mismas que usa el servidor)
import { describe, expect, it } from 'vitest'
import {
  largoPin,
  normalizarNombreUsuario,
  buscarNombreRepetido,
  validarNuevoUsuario,
} from '../usuarioValidacion.js'

const usuarios = [
  { id: '1', nombre: 'José Pérez', activo: true },
  { id: '2', nombre: 'María López', activo: false },
]
const base = { nombre: 'Ana Gómez', pin: '1234', pinConfirm: '1234', rol: 'vendedor', color: '#111111' }

describe('largoPin', () => {
  it('vendedores 4 dígitos, el resto 6', () => {
    expect(largoPin('vendedor')).toBe(4)
    expect(largoPin('vendedor_sin_comision')).toBe(4)
    for (const rol of ['jefe', 'supervisor', 'administracion', 'logistica', 'desarrollador']) {
      expect(largoPin(rol)).toBe(6)
    }
  })
})

describe('comparación de nombres', () => {
  it('ignora mayúsculas, acentos y espacios de más', () => {
    expect(normalizarNombreUsuario('  JOSÉ   Pérez ')).toBe('jose perez')
  })
  it('encuentra el repetido y excluye al propio usuario al editar', () => {
    expect(buscarNombreRepetido(usuarios, 'jose perez')?.id).toBe('1')
    expect(buscarNombreRepetido(usuarios, 'jose perez', '1')).toBeNull()
    expect(buscarNombreRepetido(usuarios, '   ')).toBeNull()
  })
})

describe('validarNuevoUsuario', () => {
  it('acepta datos correctos', () => {
    expect(validarNuevoUsuario(base, { usuarios })).toBeNull()
  })
  it('pide repetir el PIN igual', () => {
    expect(validarNuevoUsuario({ ...base, pinConfirm: '1243' }, { usuarios })).toMatch(/no coinciden/)
    expect(validarNuevoUsuario({ ...base, pinConfirm: '' }, { usuarios })).toMatch(/no coinciden/)
  })
  it('exige el largo de PIN del rol', () => {
    expect(validarNuevoUsuario({ ...base, rol: 'jefe' }, { usuarios })).toMatch(/6 dígitos/)
  })
  it('avisa del nombre repetido, y si está desactivado sugiere reactivarlo', () => {
    expect(validarNuevoUsuario({ ...base, nombre: 'JOSE PEREZ' }, { usuarios })).toMatch(/Ya existe/)
    expect(validarNuevoUsuario({ ...base, nombre: 'maria lopez' }, { usuarios })).toMatch(/reactivarlo/)
  })
  it('nombre vacío y color ocupado', () => {
    expect(validarNuevoUsuario({ ...base, nombre: '  ' }, { usuarios })).toMatch(/obligatorio/)
    expect(validarNuevoUsuario(base, { usuarios, coloresUsados: ['#111111'] })).toMatch(/color/)
  })
})
