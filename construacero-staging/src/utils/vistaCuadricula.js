// Guardarraíl: la vista de lista fue retirada; migra cualquier preferencia 'list'
// guardada en localStorage a 'grid' sin romper navegadores con historial previo.
export function limpiarVistaListaGuardada(baseKey, accountId) {
  if (typeof localStorage === 'undefined') return
  const keys = accountId ? [`${baseKey}-${accountId}`, baseKey] : [baseKey]
  for (const key of keys) {
    try {
      if (localStorage.getItem(key) === 'list') {
        localStorage.setItem(key, 'grid')
      }
    } catch {
      /* Almacenamiento no disponible */
    }
  }
}
