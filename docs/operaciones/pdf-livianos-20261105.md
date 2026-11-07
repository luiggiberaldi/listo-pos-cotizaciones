# PDF más livianos (comprimidos y con el logo al tamaño correcto)

**Fecha:** 2026-11-05 · **Estado:** PUBLICADO en producción el 2026-11-06 (entró dentro del PR #28 por un descuido mío al guardar cambios; ver nota abajo). Staging tiene la misma versión.

## En resumen

Los PDF del sistema pesaban mucho más de lo necesario. Los reportes llegaban a **15 MB**, y las notas, órdenes y facturas a **0,7 MB**. Ahora pesan entre **4 y 50 veces menos**, se ven igual y se generan igual de rápido o más. Así es más fácil mandarlos por WhatsApp y abrirlos en el teléfono.

| PDF | Antes | Ahora | Ahorro |
|---|---|---|---|
| Cotización | 133 KB | 92 KB | 30 % |
| Nota de entrega | 735 KB | 193 KB | 74 % |
| Orden de despacho | 734 KB | 192 KB | 74 % |
| Factura | 732 KB | 192 KB | 74 % |
| Guía del chofer | 727 KB | 192 KB | 74 % |
| Reporte de ventas | 15,4 MB | 300 KB | 98 % |
| Reporte de vendedores | 15,4 MB | 301 KB | 98 % |

(Medido con documentos de ejemplo de 1 página; los reales con más páginas bajan en la misma proporción.)

## Qué se cambió

1. **Compresión activada** en los 21 generadores de PDF (`src/services/pdf/*.js`) y en sus 22 espejos de staging: `new jsPDF({ …, compress: true })`. Es una sola línea por archivo. La compresión no pierde calidad: solo empaqueta mejor el archivo.
2. **Logo de los reportes reducido** (`logoListaPreciosBase64.js`, en ambos árboles): pasa de 2000×2000 píxeles (1,4 MB) a 600×600 (184 KB), con la misma transparencia. Se imprime a 3,4 cm, así que 600 píxeles sigue siendo más que nítido (≈450 ppp). Lo usan: reporte de ventas, comisiones, crédito/CxC, despachos, inventario, lista de precios, artículos externos y reporte de vendedores.

## Por qué hizo falta lo segundo

Con solo comprimir, los reportes quedaban en 1,3 MB pero tardaban **unos 2 segundos más** en generarse, porque había que comprimir la imagen gigante del logo cada vez. Con el logo al tamaño correcto quedan en 300 KB y se generan en ~0,4 s (antes 0,5–0,7 s).

## Verificación

- Revisión visual del Reporte de Ventas antes y después: mismo logo, marca de agua, cuadros, textos y pie.
- Pruebas automáticas y build en ambos árboles (ver resultado en la conversación del 2026-11-05).
- **No verificado:** abrir cada uno de los 21 tipos de PDF a ojo e imprimir uno en papel.

## Cómo deshacerlo

Revertir el cambio. No toca datos ni la base de datos. El logo original quedó guardado en `tmp/logoListaPreciosBase64.original.js` (no se sube al repositorio).

## Nota de publicación (2026-11-06)

El cambio salió a producción dentro del PR #28 (aviso "Actualizando"), porque al guardar ese PR se incluyeron por error los archivos de PDF que estaban pendientes. Después se pidió publicarlo, así que el resultado es el esperado, pero se publicó antes de pedir permiso. Pruebas automáticas: 1.020 en verde.
