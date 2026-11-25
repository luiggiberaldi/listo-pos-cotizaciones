// Pruebas y contrato de unificación a vista única en cuadrícula (OP-2026-079).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { limpiarVistaListaGuardada } from '../vistaCuadricula.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const leer = rel => fs.readFileSync(path.join(projectRoot, rel), 'utf8')
const existe = rel => fs.existsSync(path.join(projectRoot, rel))

describe('OP-2026-079 — Solo vista de cuadrícula en Clientes, Personal, Cotizaciones y Despachos', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('limpiarVistaListaGuardada migra preferencias "list" a "grid" sin tocar otras claves', () => {
    const store = new Map([
      ['clientes_vista-acc1', 'list'],
      ['clientes_vista', 'list'],
      ['despachos_vista-acc1', 'grid'],
      ['otra_clave', 'list'],
    ])
    vi.stubGlobal('localStorage', {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    })

    limpiarVistaListaGuardada('clientes_vista', 'acc1')
    limpiarVistaListaGuardada('despachos_vista', 'acc1')

    expect(store.get('clientes_vista-acc1')).toBe('grid')
    expect(store.get('clientes_vista')).toBe('grid')
    expect(store.get('despachos_vista-acc1')).toBe('grid')
    expect(store.get('otra_clave')).toBe('list')
  })

  it('limpiarVistaListaGuardada no falla si localStorage no está disponible', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(() => limpiarVistaListaGuardada('clientes_vista', 'acc1')).not.toThrow()
  })

  it('las 4 pantallas migradas ya no tienen toggle lista/cuadrícula ni componentes Row', () => {
    const vistas = [
      { archivo: 'src/views/ClientesView.jsx', clave: 'clientes_vista' },
      { archivo: 'src/views/PersonalView.jsx', clave: 'personal_vista' },
      { archivo: 'src/views/CotizacionesView.jsx', clave: 'cotizaciones_vista' },
      { archivo: 'src/views/DespachosView.jsx', clave: 'despachos_vista' },
    ]

    for (const { archivo, clave } of vistas) {
      const src = leer(archivo)
      expect(src).not.toContain('vistaMode')
      expect(src).not.toContain('cambiarVista')
      expect(src).not.toContain('title="Vista lista"')
      expect(src).not.toContain('title="Vista cuadrícula"')
      expect(src).not.toMatch(/<LayoutGrid(?:\s|\/|>)/)
      expect(src).not.toMatch(/<List(?:\s|\/|>)/)
      expect(src).not.toContain('ClienteRow')
      expect(src).not.toContain('CotizacionRow')
      expect(src).not.toContain('DespachoRow')
      expect(src).toContain(`limpiarVistaListaGuardada('${clave}'`)
    }
  })

  it('se retiraron los archivos muertos ClienteRow, CotizacionRow y DespachoRow y ListaPreciosModal PDF quedó intacto', () => {
    expect(existe('src/components/clientes/ClienteRow.jsx')).toBe(false)
    expect(existe('src/components/cotizaciones/CotizacionRow.jsx')).toBe(false)
    expect(existe('src/components/despachos/DespachoRow.jsx')).toBe(false)

    const pdfModal = leer('src/components/inventario/ListaPreciosModal.jsx')
    expect(pdfModal).toContain("useState('lista')")
    expect(pdfModal).toContain("{ id: 'cuadricula', label: 'Cuadrícula (Catálogo)' }")
  })
})
