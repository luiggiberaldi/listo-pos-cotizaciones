# OP-2026-024 — PDF: los textos largos ya no se recortan

**Fecha:** 2026-11-10 · **Estado:** **publicado en producción 2026-11-10** · **Solicitud/commit:** #52 (`e78d8f6f`, unida en `6f119baa`)

## En resumen

En el PDF de **Artículos Externos** el nombre del artículo, el cliente y el asesor salían cortados con "..." (por ejemplo "LAMINA METALICA 40CM X 40CM 1…"). Ahora el texto largo **se parte en varias líneas** dentro de su columna y la fila crece lo necesario. No se pierde ningún dato. Lo mismo se hizo en los dos PDF de transportistas (Reporte y Base de Datos de Choferes), que también cortaban nombres, vehículos y destinos.

## Qué se cambió

`articulosExternosPDF.js`, `flotaChoferesPDF.js` y `transportistasPDF.js`: se quitó el recorte y se agregó el partido en líneas; las filas ajustan su altura y el salto de hoja las considera.

## Cómo se verificó

Se generaron PDF de prueba con nombres muy largos y se revisaron como imagen: el texto completo se ve y no invade otras columnas. Las 1095 pruebas pasan. No se probó con datos reales.

## Pendiente (otros PDF que todavía recortan)

Estos archivos aún cortan textos y **no se tocaron** porque cada uno tiene su propio diseño de columnas: clientes, comisiones, comisiones generadas, cotización, cuentas por cobrar, despacho (reporte, guía y orden), factura, inventario, liquidación, lista de precios, mis ventas, orden de compra, pipeline, reporte de vendedores y ventas del día. Corregirlos requiere revisarlos uno por uno (en documentos como factura o cotización, partir líneas cambia la altura de la hoja).
