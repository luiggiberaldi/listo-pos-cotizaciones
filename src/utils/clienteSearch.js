// src/utils/clienteSearch.js
// Búsqueda inteligente de clientes y personal.
import { rankEntities } from './entitySearch'

const CLIENT_FIELDS = [
  { key: 'nombre', weight: 10 },
  { key: 'rif_cedula', weight: 9 },
  { key: 'codigo_cliente', weight: 8 },
  { key: 'telefono', weight: 7 },
  { key: 'email', weight: 4 },
  { key: 'correo', weight: 4 },
  { key: 'ciudad', weight: 3 },
  { key: 'estado', weight: 2 },
  { key: 'categoria', weight: 2 },
]

/**
 * Busca clientes con normalización de acentos/separadores, coincidencia por
 * campos, códigos/RIF/teléfonos compactados, iniciales y typo-tolerance.
 */
export function buscarClientes(clientes = [], query = '', minScore = 1) {
  return rankEntities(clientes, query, CLIENT_FIELDS, { minScore })
}

export { CLIENT_FIELDS }
