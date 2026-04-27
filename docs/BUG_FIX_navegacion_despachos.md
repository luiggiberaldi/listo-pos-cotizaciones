# Bug Fix: "No se puede salir de Despachos"

**Fecha**: 2026-04-27
**Severidad**: Critica (bloqueante para todos los roles)
**Afectaba**: PC y movil, todos los roles

---

## Sintoma

Al entrar en la pestana de Despachos (o Entregas para logistica), no se podia navegar a ninguna otra pestana. El click llegaba a la barra de navegacion, `navigate('/')` se ejecutaba y `location.pathname` cambiaba internamente, pero la vista no se actualizaba visualmente.

## Causa raiz

**Los eventos de auth de Supabase (`TOKEN_REFRESHED`, `SIGNED_IN`) disparaban actualizaciones innecesarias al Zustand store, causando re-renders del arbol completo de rutas durante las transiciones de navegacion.**

### Cadena de eventos del bug:

1. Usuario navega de `/despachos` a `/` (click en Inicio)
2. React Router v7 inicia la transicion via `startTransition` (React 19)
3. Durante la transicion, Supabase Auth dispara `TOKEN_REFRESHED`
4. El handler ejecuta `set({ user: session.user })` — crea un **nuevo objeto** `user` cada vez
5. Zustand notifica a TODOS los suscriptores del store
6. `RutaProtegida` (que leia `user` via destructuring) se re-renderiza
7. Todos los route guards y el `<Outlet />` se re-renderizan
8. React 19 aborta la transicion de navegacion en curso
9. La vista vieja (DespachosView) permanece visible a pesar de que la ruta cambio

### Por que solo Despachos?

DespachosView es la vista mas pesada (DespachoCards con `memo`, multiples modales, estados locales complejos). Su complejidad de reconciliacion hacia que la ventana de tiempo para la interferencia auth fuera mayor que en otras vistas.

## Solucion

### 1. Auth store: evitar updates innecesarios (`useAuthStore.js`)

**TOKEN_REFRESHED** — Solo actualizar `user` si realmente cambio:
```javascript
// ANTES (disparaba re-render en cada refresh de token)
set({ user: session.user })

// DESPUES (compara antes de actualizar)
const currentUser = get().user
if (!currentUser || currentUser.id !== session.user.id || currentUser.email !== session.user.email) {
  set({ user: session.user })
}
```

**SIGNED_IN** — Misma optimizacion:
```javascript
const currentUser = get().user
if (!currentUser || currentUser.id !== session.user.id) {
  set({ user: session.user })
}
```

**_cargarPerfil** — No sobreescribir perfil identico:
```javascript
const perfilActual = get().perfil
if (perfilActual && perfilActual.id === perfilNuevo.id && perfilActual.rol === perfilNuevo.rol
    && perfilActual.nombre === perfilNuevo.nombre && perfilActual.color === perfilNuevo.color) {
  return // perfil identico, no disparar re-render
}
```

### 2. Route guards: selectores Zustand granulares (`App.jsx`)

**ANTES** — Destructuring suscribe a TODO el store:
```javascript
function RutaProtegida() {
  const { user, perfil, initialized, _cargandoPerfil } = useAuthStore()
  // Se re-renderiza cuando CUALQUIER campo del store cambia
  // incluyendo user (que cambia en cada TOKEN_REFRESHED)
```

**DESPUES** — Selectores individuales, solo re-renderiza si el campo especifico cambia:
```javascript
function RutaProtegida() {
  const hasUser = useAuthStore(useCallback(s => !!s.user, []))
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  const initialized = useAuthStore(useCallback(s => s.initialized, []))
  const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))
  // hasUser es boolean — no cambia cuando el objeto user se reemplaza
```

### 3. BottomNav: eliminar anti-pattern (`BottomNav.jsx`)

**ANTES:**
```javascript
onClick={(e) => {
  e.preventDefault()  // mata el handler interno de NavLink
  navigate(path)      // navegacion manual
}}
```

**DESPUES:**
```javascript
onClick={() => {
  document.querySelector('main')?.scrollTo(0, 0)
  window.scrollTo(0, 0)
}
// NavLink maneja la navegacion nativamente
```

## Archivos modificados

| Archivo | Lineas | Cambio |
|---------|--------|--------|
| `src/store/useAuthStore.js` | 159-168 | SIGNED_IN: skip update si user no cambio |
| `src/store/useAuthStore.js` | 180-187 | TOKEN_REFRESHED: skip update si user no cambio |
| `src/store/useAuthStore.js` | 267-276 | _cargarPerfil: skip si perfil es identico |
| `src/App.jsx` | 149-157 | RutaProtegida: selectores Zustand |
| `src/App.jsx` | 161-167 | RutaPublica: selectores Zustand |
| `src/App.jsx` | 172-180 | RutaSupervisor: selectores Zustand |
| `src/App.jsx` | 184-192 | RutaSupervisorOAdmin: selectores Zustand |
| `src/App.jsx` | 195-203 | RutaDesarrollador: selectores Zustand |
| `src/App.jsx` | 207-215 | RutaExcluyeAdmin: selectores Zustand |
| `src/components/layout/BottomNav.jsx` | 98-104 | Eliminar preventDefault + navigate manual |

## Diagnostico (como se encontro)

1. Se agrego banner debug con ruta actual — confirmo que la ruta SI cambiaba
2. Se agregaron logs de mount/unmount a DashboardView y DespachosView
3. Los logs revelaron un **loop infinito de mount/unmount** alternando entre ambas vistas
4. Los eventos `[AUTH] TOKEN_REFRESHED` aparecian intercalados con los mount/unmount
5. Esto confirmo que los auth events causaban re-renders que interferían con la transicion de React Router

## Leccion aprendida

En apps con React 19 + React Router v7 + Zustand + Supabase Auth:
- **Nunca hacer `set({ user: session.user })` incondicionalmente** en handlers de auth que se disparan frecuentemente
- **Siempre usar selectores Zustand** en route guards para evitar re-renders por cambios irrelevantes
- `TOKEN_REFRESHED` puede dispararse multiples veces durante una sesion normal — tratar como evento de alta frecuencia
