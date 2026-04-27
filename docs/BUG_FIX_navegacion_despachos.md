# Bug Fix: "No se puede salir de Despachos"

**Fecha**: 2026-04-27
**Severidad**: Critica (bloqueante para todos los roles)
**Afectaba**: PC y movil, todos los roles
**Estado**: RESUELTO

---

## Sintoma

Al entrar en la pestana de Despachos (o Entregas para logistica), no se podia navegar a ninguna otra pestana. El click llegaba a la barra de navegacion, `navigate()` se ejecutaba y `window.location.pathname` cambiaba internamente, pero la vista no se actualizaba visualmente. El usuario quedaba atrapado en DespachosView.

## Causa raiz

**Dos problemas combinados:**

### Problema 1: `React.startTransition()` en React Router v7

React Router v7 envuelve TODAS las actualizaciones de estado de navegacion en `React.startTransition()`. Esto permite que React 19 aborte transiciones si ocurren re-renders durante la reconciliacion.

DespachosView es la vista mas pesada de la app (DespachoCards con `memo`, multiples modales, hooks de TanStack Query, estados locales complejos). Su complejidad de reconciliacion creaba una ventana de tiempo lo suficientemente larga para que React 19 abortara la transicion de navegacion indefinidamente.

**Codigo relevante en React Router v7** (`node_modules/react-router`):
```javascript
// BrowserRouter envuelve setState en startTransition por defecto
let setState = React.useCallback(
  (newState) => {
    if (unstable_useTransitions === false) {
      setStateImpl(newState);        // sincrono — FUNCIONA
    } else {
      React.startTransition(() => setStateImpl(newState));  // asincrono — PUEDE FALLAR
    }
  },
  [unstable_useTransitions]
);
React.useLayoutEffect(() => history.listen(setState), [history, setState]);
```

### Problema 2: Zustand store updates innecesarios

Los eventos de auth de Supabase (`TOKEN_REFRESHED`, `SIGNED_IN`) disparaban `set({ user: session.user })` incondicionalmente, creando nuevos objetos en cada evento. Todos los componentes suscritos al store (via destructuring `const { perfil } = useAuthStore()`) se re-renderizaban, amplificando la interferencia con las transiciones.

### Cadena de eventos del bug:

1. Usuario navega de `/despachos` a `/` (click en Inicio)
2. React Router v7 inicia la transicion via `startTransition`
3. React 19 comienza a reconciliar el arbol de componentes
4. DespachosView es pesado — la reconciliacion toma tiempo
5. Durante ese tiempo, Supabase Auth dispara `TOKEN_REFRESHED` o cualquier otro re-render
6. React 19 aborta la transicion en curso y la reprograma
7. El ciclo se repite indefinidamente — la vista nunca cambia
8. `navigate()` retorna exitosamente pero la actualizacion visual nunca llega

### Por que solo Despachos?

Porque es la vista mas pesada. Las demas vistas reconcilian lo suficientemente rapido como para que la transicion termine antes de que llegue cualquier interrupcion. DespachosView crea una ventana de tiempo critica donde la transicion puede ser abortada.

## Solucion

### Fix principal: Deshabilitar `startTransition` en BrowserRouter (`App.jsx`)

```javascript
// ANTES — transiciones asincronas (pueden ser abortadas)
<BrowserRouter>

// DESPUES — actualizaciones sincronas (inmediatas, no abortables)
<BrowserRouter unstable_useTransitions={false}>
```

Esto hace que React Router actualice el estado de navegacion de forma sincrona. La navegacion es inmediata y no puede ser interrumpida por re-renders de componentes pesados ni por eventos externos como `TOKEN_REFRESHED`.

### Fix complementario 1: Auth store — evitar updates innecesarios (`useAuthStore.js`)

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

### Fix complementario 2: Selectores Zustand granulares (`App.jsx`, `AppLayout.jsx`)

**ANTES** — Destructuring suscribe a TODO el store:
```javascript
// Se re-renderiza cuando CUALQUIER campo del store cambia
const { user, perfil, initialized, _cargandoPerfil } = useAuthStore()
```

**DESPUES** — Selectores individuales:
```javascript
// Solo re-renderiza si el campo especifico cambia
const hasUser = useAuthStore(useCallback(s => !!s.user, []))
const perfil = useAuthStore(useCallback(s => s.perfil, []))
const initialized = useAuthStore(useCallback(s => s.initialized, []))
const cargandoPerfil = useAuthStore(useCallback(s => s._cargandoPerfil, []))
```

### Fix complementario 3: BottomNav — NavLink nativo (`BottomNav.jsx`)

```javascript
// ANTES — preventDefault mataba la navegacion interna de NavLink
onClick={(e) => {
  e.preventDefault()
  navigate(path)
}}

// DESPUES — NavLink maneja la navegacion nativamente
onClick={() => {
  document.querySelector('main')?.scrollTo(0, 0)
  window.scrollTo(0, 0)
}
```

### Fix complementario 4: Hooks con selectores (`useRealtimeSync.js`, `useDespachos.js`, `DashboardView.jsx`)

```javascript
// ANTES — suscripcion completa al store
const { perfil } = useAuthStore()

// DESPUES — selector granular
const perfil = useAuthStore(useCallback(s => s.perfil, []))
```

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `src/App.jsx` | `<BrowserRouter unstable_useTransitions={false}>` |
| `src/App.jsx` | 6 route guards con selectores Zustand granulares |
| `src/store/useAuthStore.js` | SIGNED_IN: skip update si user no cambio |
| `src/store/useAuthStore.js` | TOKEN_REFRESHED: skip update si user no cambio |
| `src/store/useAuthStore.js` | _cargarPerfil: skip si perfil es identico |
| `src/components/layout/AppLayout.jsx` | Selectores Zustand granulares (perfil, switchOut) |
| `src/components/layout/BottomNav.jsx` | NavLink nativo (sin preventDefault + navigate) |
| `src/hooks/useRealtimeSync.js` | Selector Zustand para perfil |
| `src/hooks/useDespachos.js` | Selector Zustand para perfil |
| `src/views/DashboardView.jsx` | Selector Zustand para perfil (2 instancias) |
| `src/views/DespachosView.jsx` | Selector Zustand para perfil |

## Diagnostico (como se encontro)

### Fase 1: Identificar que la ruta SI cambiaba
1. Se agrego banner debug con ruta actual — confirmo que `location.pathname` cambiaba
2. Se agregaron logs de mount/unmount a DashboardView y DespachosView
3. Los logs revelaron un loop de mount/unmount causado por auth events
4. Se aplicaron fixes de auth store + selectores Zustand

### Fase 2: El bug persistia
5. Con los fixes de auth store, los re-renders innecesarios se eliminaron
6. Pero el bug seguia — `navigate()` no tenia efecto desde DespachosView
7. Se agrego captura de clicks a nivel global (capture phase)
8. Los clicks SI llegaban al NavLink, el onClick SI se ejecutaba
9. Pero NO habia renders de AppLayout despues del click — `navigate()` era completamente inerte

### Fase 3: Intentos fallidos
10. `flushSync(() => navigate(path))` — sin efecto (React Router wraps en startTransition internamente)
11. `history.pushState` + `popstate` event — URL cambiaba pero React no actualizaba
12. `window.location.reload()` — fallaba por X-Frame-Options en entorno iframe
13. `<Outlet key={location.pathname} />` — parcialmente funcional pero el LAST RESORT reload interferia

### Fase 4: Causa raiz encontrada
14. Se inspecciono el codigo fuente de React Router v7 en node_modules
15. Se descubrio que `BrowserRouter` envuelve TODOS los setState en `React.startTransition()`
16. El prop `unstable_useTransitions={false}` desactiva esta funcionalidad
17. Con transiciones deshabilitadas, la navegacion es sincrona e inmediata

## Recomendaciones

### Para este proyecto

1. **Mantener `unstable_useTransitions={false}`** hasta que React Router ofrezca un mecanismo mas robusto para manejar transiciones con componentes pesados.

2. **Continuar usando selectores Zustand granulares** en todos los componentes. Hay ~56 archivos que aun usan `const { perfil } = useAuthStore()` sin selector. Migrarlos progresivamente:
   ```javascript
   // Malo — suscribe a todo el store
   const { perfil } = useAuthStore()

   // Bueno — solo se re-renderiza si perfil cambia
   const perfil = useAuthStore(useCallback(s => s.perfil, []))

   // Tambien bueno — para funciones estables del store
   const switchOut = useAuthStore(s => s.switchOut)
   ```

3. **No usar `e.preventDefault()` en NavLink** a menos que sea estrictamente necesario. NavLink tiene logica interna para manejar navegacion, y `preventDefault()` la desactiva completamente.

4. **Optimizar DespachosView** — es la vista mas pesada. Considerar:
   - Virtualizar la lista de despachos (react-window o @tanstack/react-virtual)
   - Lazy-load de DespachoCard modales
   - Memoizar componentes pesados con React.memo + useMemo

### Para cualquier app con React 19 + React Router v7

1. **`startTransition` puede causar navegaciones fantasma.** Si una vista tarda mas de ~16ms en reconciliar, cualquier re-render externo (auth, websocket, polling) puede abortar la transicion indefinidamente.

2. **`unstable_useTransitions={false}` es el escape hatch.** Deshabilita `startTransition` para navegaciones, haciendolas sincronas. El trade-off es que navegaciones a vistas pesadas pueden causar un brief lag visual (en vez de mantener la vista anterior visible).

3. **Zustand + route guards = cuidado.** Si un route guard (layout route con `<Outlet />`) se suscribe a un store que cambia frecuentemente, cada cambio re-monta el arbol completo de rutas. Siempre usar selectores.

4. **`TOKEN_REFRESHED` de Supabase es un evento de alta frecuencia.** Tratarlo como un evento que NO debe causar re-renders a menos que los datos realmente hayan cambiado.

5. **Diagnosticar con `document.addEventListener('click', fn, true)`** en capture phase para verificar si los clicks llegan a los elementos de navegacion. Si llegan pero no hay efecto, el problema es en React/Router, no en CSS/z-index.
