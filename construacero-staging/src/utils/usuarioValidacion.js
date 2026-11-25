// src/utils/usuarioValidacion.js
// Reglas compartidas para crear usuarios (OP-2026-030).
// Las usa la pantalla (aviso inmediato) y el servidor (la decisión final),
// así ambas dicen exactamente lo mismo.

// Largo del PIN según el rol: vendedores 4 dígitos, el resto 6.
export function largoPin(rol) {
  return (rol === 'vendedor' || rol === 'vendedor_sin_comision') ? 4 : 6
}

// Deja el nombre "limpio" para guardarlo: sin espacios al inicio/fin ni dobles.
export function limpiarNombreUsuario(nombre) {
  return String(nombre ?? '').replace(/\s+/g, ' ').trim()
}

// Forma de comparar nombres: "José  Pérez", "jose perez" y " JOSE PÉREZ " son el mismo.
export function normalizarNombreUsuario(nombre) {
  return limpiarNombreUsuario(nombre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

// Busca en una lista de usuarios [{ id, nombre, activo }] uno con el mismo nombre.
// `excluirId` sirve al editar: el propio usuario no cuenta como repetido.
export function buscarNombreRepetido(usuarios, nombre, excluirId = null) {
  const objetivo = normalizarNombreUsuario(nombre)
  if (!objetivo) return null
  return (usuarios ?? []).find(u =>
    u && u.id !== excluirId && normalizarNombreUsuario(u.nombre) === objetivo,
  ) ?? null
}

export function mensajeNombreRepetido(existente) {
  const nombre = limpiarNombreUsuario(existente?.nombre)
  return existente?.activo === false
    ? `Ya existe un usuario llamado "${nombre}" (está desactivado). Puedes reactivarlo en vez de crear otro.`
    : `Ya existe un usuario llamado "${nombre}". Usa otro nombre (por ejemplo, agrega el apellido).`
}

// Validación del formulario "Nuevo usuario". Devuelve el texto del error o null si todo está bien.
export function validarNuevoUsuario({ nombre, pin, pinConfirm, rol, color }, { usuarios = [], coloresUsados = [] } = {}) {
  const largo = largoPin(rol)
  if (!limpiarNombreUsuario(nombre)) return 'El nombre es obligatorio'
  const repetido = buscarNombreRepetido(usuarios, nombre)
  if (repetido) return mensajeNombreRepetido(repetido)
  if (!new RegExp(`^\\d{${largo}}$`).test(String(pin ?? ''))) return `El PIN debe ser exactamente ${largo} dígitos numéricos`
  if (pinConfirm !== pin) return 'Los PIN no coinciden. Escríbelo igual en los dos campos.'
  if (color && coloresUsados.includes(color)) return 'Ese color ya está en uso por otro usuario'
  return null
}
