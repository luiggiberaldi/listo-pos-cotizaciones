# "Mis ventas" — reporte detallado del vendedor (staging)

**Fecha:** 2026-11-05 · **Estado:** construido y probado en **staging** (`construacero-staging/`). **No está en producción** ni guardado en la versión oficial.

## En resumen

Cada vendedor tiene una pantalla nueva, **"Mis ventas"**, donde elige un período (por defecto el **corte viernes–jueves**) y ve todo lo que vendió:

- **Resumen:** total vendido, despachos, clientes, unidades y comisión (los vendedores sin comisión no la ven).
- **Detalle de cada despacho:** fecha, N° de despacho y cotización, cliente con RIF, estado, forma de pago y, al tocarlo, sus **artículos** (código, nombre, cantidad, unidad, precio, descuento y total), con flete, descuento y total del despacho.
- **Resumen por artículo** y **por cliente**.
- Buscador por cliente.
- **Descargar PDF** y **Enviar por WhatsApp**. En el teléfono, WhatsApp se abre con el PDF adjunto. En la computadora, el PDF se descarga y se abre WhatsApp Web para arrastrarlo al chat.

Solo cuentan los despachos **despachados o entregados** donde él es el vendedor. Los pendientes y anulados no aparecen.

## Seguridad

El servidor (`GET /api/reportes/mis-ventas`) decide de quién son los datos según el operador que inició sesión. Solo acepta las fechas: si el navegador intenta pedir las ventas de otro vendedor, responde **400**. Solo lo pueden usar vendedores, vendedores sin comisión y supervisores (cada uno ve únicamente lo suyo). Jefe, administración, logística y desarrollador no lo ven ni pueden pedirlo (403).

## Piezas (árbol staging)

| Pieza | Archivo |
|---|---|
| Cálculo del reporte | `construacero-staging/src/utils/misVentas.js` |
| Consulta del servidor | `construacero-staging/api/handlers/misVentas.js` (+ ruta en `worker.js`) |
| Pantalla | `construacero-staging/src/views/MisVentasView.jsx`, ruta `/mis-ventas` en `App.jsx`, menú en `AppLayout.jsx` y `BottomNav.jsx` |
| PDF | `construacero-staging/src/services/pdf/misVentasPDF.js` (mismo encabezado, logo, marca de agua y pie que el Reporte de Ventas) |

## Pruebas

- Automáticas (staging): 22 nuevas. Suite completa **271/271**. Build correcto.
- **Recorrido real en staging** (`node scripts/test-mis-ventas-ui.mjs`): crea una cuenta de prueba temporal con 2 vendedores, 2 clientes y 5 ventas (2 dentro del corte, 1 fuera, 1 de otro vendedor y 1 pendiente), entra con PIN como vendedor y comprueba que:
  - solo aparecen sus 2 ventas del corte ($195.50) con comisión $3.60;
  - los artículos, el buscador, el PDF (1,3 MB) y WhatsApp funcionan;
  - en el teléfono la página no se desborda;
  - pedir ventas de otro vendedor da 400 y sin sesión da 401.

  Al final **borra todo** (verificado: 0 restos). Las capturas quedan en `tmp/mis-ventas-ui/`.

## Hallazgo: los PDF pesaban de más

Sin compresión, la marca de agua sola agrega unos **12 MB** a cada PDF. Este reporte se genera **comprimido** (de 17 MB a ~1–3 MB, con el mismo aspecto). Los demás PDF del sistema (18 archivos que usan la marca de agua, entre ellos cotizaciones y notas) no usan compresión y probablemente pesan lo mismo. Eso queda fuera de este cambio.

## Notas

- El preset **"Corte viernes–jueves"** muestra el **último corte completo**. Un jueves muestra la semana anterior, no la que termina ese día (así funciona en todo el sistema).
- En el teléfono, el botón flotante "+" del sistema puede tapar parte de una fila al desplazarse (pasa igual en otras pantallas).

## Para pasar a producción (pendiente de autorización)

1. Portar los mismos archivos al árbol principal (`src/`, `api/`, `worker.js`) y correr sus pruebas y el build.
2. PR → unir a `main` (la pantalla se publica en Vercel y el servidor en Cloudflare automáticamente).
3. No requiere cambios en la base de datos.
