# OP-2026-087 — Aviso de unidades "por aprobar" (staging)

**Fecha:** 2026-11-25 · **Alcance:** solo staging (`construacero-staging/` y su base de pruebas). **No cambia producción.**
**Estado:** hecho y probado en staging. Falta tu revisión de pantalla y la solicitud de cambio.

## En resumen

- **El problema:** si un despacho está *por aprobar* (pendiente) con 100 unidades de un producto, nadie más lo veía. La tarjeta decía "Stock 600" como si todo estuviera libre y otro vendedor podía vender esas mismas unidades.
- **Lo que ya existía:** el aviso "comprometido" solo cuenta despachos **aprobados** (migración 222). Los pendientes no contaban.
- **Lo nuevo:** una etiqueta azul **"100 por aprobar"** junto al stock, en todas las pantallas donde se elige un producto. Al tocarla (en Inventario) se ve quién tiene el despacho pendiente, su número (DES-…) y cuántas unidades.
- **Decisión de diseño:** es **solo un aviso, no resta** del stock disponible. Un despacho pendiente todavía puede rechazarse o anularse; restarlo daría falsos "agotado". Es coherente con la regla actual de que un despacho sin stock solo avisa y no bloquea.

## Dónde se ve

| Pantalla | Cómo se ve |
|---|---|
| Inventario (tarjeta de producto) | Etiqueta azul "N por aprobar" bajo el stock; al tocarla abre el detalle por vendedor y despacho |
| Venta rápida (tarjetas) | Línea azul "N por aprobar" bajo el stock |
| Cotización → buscador de productos (tarjetas) | Igual que venta rápida |
| Cotización → búsqueda rápida por nombre | "Stock: 600 · 100 por aprobar" |

## Cómo está hecho (detalle técnico)

- Migración `324_staging_stock_por_aprobar.sql` (+ rollback): funciones `obtener_stock_por_aprobar()` y `obtener_stock_por_aprobar_detalle(producto)`. Cuentan despachos en estado `pendiente`, filtran por empresa (`nd.cuenta_id = auth.uid()`, igual que la migración 317 de OP-086) y solo las puede usar una sesión iniciada (sin permiso para anónimos).
- Hooks `useStockPorAprobar` / `useStockPorAprobarDetalle` en `src/hooks/useStockComprometido.js`. Comparten el prefijo de clave del "comprometido", así se refrescan juntos cuando algo cambia.
- Componente nuevo `StockPorAprobarDetalle.jsx`; ajustes en `ProductoCard`, `ProductCard`, `CotizacionBuscador`, `ProductoAutocomplete`, `InventarioView` y `VentaRapidaView`.
- **Aprobar o rechazar un despacho** cambia su estado, y el aviso se actualiza solo (refresco cada 30 s y al invalidar el "comprometido").

## Pruebas

- `vitest`: **288/288**; `vite build`: OK.
- `scripts/op087-prueba-por-aprobar-staging.mjs` (contra la base real de staging, solo lectura): totales y detalle coinciden con la base; el detalle sin producto devuelve solo las 3 líneas de la empresa (hay 204 de otras empresas que **no** se filtran); sin sesión se rechaza. **6/6 OK.**
- Migración aplicada en la base de staging.

## Pendiente / sin verificar

- Revisión visual en el navegador por el dueño (celular y computadora).
- Solicitud de cambio: se une a `main` por separado; los números de migración 312–323 están reservados por la solicitud #84 (OP-086), por eso esta es la **324**.
- Producción: no incluido; sería un caso aparte con autorización.
- La búsqueda por nombre dentro de los cuadros de "Escanear lista" y "Devolución parcial" no muestra el aviso (no usaban el "comprometido" tampoco).
