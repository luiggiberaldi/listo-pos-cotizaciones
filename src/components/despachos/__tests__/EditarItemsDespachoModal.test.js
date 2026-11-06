// src/components/despachos/__tests__/EditarItemsDespachoModal.test.js
// Contrato de fuente: la edición profunda carga el consolidado (neto) del
// despacho y NO las filas crudas de notas_despacho_items. Con devoluciones o
// intercambios, las filas crudas conservan el artículo viejo y la edición
// mostraría el artículo equivocado (bug DES-04243; misma raíz que DES-04161).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const fuente = readFileSync(path.join(aqui, '..', 'EditarItemsDespachoModal.jsx'), 'utf8')

describe('EditarItemsDespachoModal — carga de artículos netos', () => {
  it('usa fetchDespachoConsolidado para cargar los artículos del despacho', () => {
    expect(fuente).toContain("import('../../services/despachoItemsService')")
    expect(fuente).toContain('fetchDespachoConsolidado(despacho.id')
    // Se fuerza la consolidación aunque el flag venga desactualizado
    expect(fuente).toContain('tiene_devoluciones: true')
  })

  it('ya no consulta las filas crudas de notas_despacho_items', () => {
    expect(fuente).not.toContain(".from('notas_despacho_items')")
    expect(fuente).not.toContain('notas_despacho_items')
  })
})
