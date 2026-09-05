# INC-001: Service Worker con caché de `index.html` viejo y chunks dinámicos rotos

- Fecha: 26/04/2026 (recurrente en cada deploy con cambios de chunks)
- Estado: 🔄 Mitigado manualmente — prevención estructural pendiente (ver `ROADMAP.md`)
- Severidad: Alta (app inutilizable para el usuario afectado hasta limpieza manual)
- Impacto: Pantalla blanca / error de carga en cualquier vista con lazy-loading (Cotizaciones, Transportistas, etc.) tras un deploy nuevo.

## Síntoma

```
useTransportistas-B9MZUd0X.js:1 Failed to load module script: Expected a JavaScript-or-Wasm module script
but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for
module scripts per HTML spec.

TypeError: Failed to fetch dynamically imported module:
https://listo-pos-cotizaciones.vercel.app/assets/CotizacionesView-DWqyXTdQ.js
```

La app queda en pantalla blanca al navegar a cualquier vista con chunk renombrado.

## Causa raíz

El Service Worker (PWA) cachea el `index.html` junto con los hashes de chunks del build anterior. Cuando Vercel despliega un build nuevo, los nombres de chunks cambian (ej: `CotizacionesView-DWqyXTdQ.js` → `CotizacionesView-Cm27_ox_.js`), pero el SW sigue sirviendo el `index.html` viejo desde caché, que pide chunks que ya no existen. El servidor responde con el fallback HTML del SPA routing y el navegador lo rechaza por MIME type incorrecto (`text/html` en vez de `application/javascript`).

El SW tiene `skipWaiting()` y `clients.claim()`, pero solo se ejecutan cuando el navegador detecta un SW nuevo. Con la pestaña abierta sin recargar, o con la PWA instalada, el SW viejo sigue activo indefinidamente sirviendo assets obsoletos.

## Línea de tiempo

1. Deploy nuevo en Vercel con renombrado de chunks.
2. Usuarios con SW cacheado abren la app → el `index.html` viejo pide chunks inexistentes.
3. El servidor devuelve HTML (fallback SPA) → error MIME → pantalla blanca.
4. Diagnóstico documentado en la sesión 15 de la bitácora (26/04/2026); mitigación manual y propuestas de prevención.

## Mitigación inmediata (manual, por dispositivo)

- **Opción A:** Hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`).
- **Opción B (definitiva):** DevTools → Application → Service Workers → marcar "Update on reload"; Storage → "Clear site data"; recargar.
- **Opción C (Chrome):** `chrome://serviceworker-internals` → Unregister para el dominio → recargar.

## Corrección permanente

Pendiente. Estrategias propuestas en la sesión original (ninguna implementada aún):

1. **Version check en el SW:** comparar versión del SW contra el servidor al activarse; si hay mismatch, purgar caché y recargar.
2. **Cache-busting en `index.html`:** meta tag o query param con el hash del build.
3. **Stale-while-revalidate para HTML:** servir el HTML viejo y descargar el nuevo en background, notificando al usuario.
4. **No cachear `index.html` en el SW:** solo cachear assets con hash; el HTML siempre va al servidor. (Estrategia recomendada.)

## Prevención y validación

- Mientras la prevención no exista, cada deploy con cambios de chunks puede reproducir el incidente en clientes con SW viejo.
- El aviso conocido en builds ("chunks mayores a 500 kB") es solo un warning de tamaño, no este incidente.

## Referencias

- `BITACORA.md` — sesión 15 (26/04/2026).
- `ROADMAP.md` — pendiente de prevención definitiva del cache de `index.html`.
