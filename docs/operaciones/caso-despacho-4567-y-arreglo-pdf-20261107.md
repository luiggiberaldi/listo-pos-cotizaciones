# Caso despacho #4567 y arreglo de PDF — 2026-11-06 / 2026-11-07

## En resumen

- El despacho #4567 salió con dos montos distintos en los PDF: **$24.995** y **$24.875**. La causa del primero fue un error del sistema (el PDF mezclaba productos nuevos con un total viejo). El segundo fue un cambio real hecho por el usuario ADMINISTRADOR, que bajó el tubo de $115 a $111.
- Se corrigió el sistema para que cada PDF lea el monto actualizado justo antes de imprimirse. Está probado en staging y **publicado en producción** (solicitud #30, unida a `main` con el commit `516825af`).
- Quedan preguntas abiertas que solo puede responder la empresa: cuál es el precio correcto del tubo y si la referencia de pago "1234" es real.

## Qué pasó con el despacho #4567 (producción)

Cronología según el historial de auditoría (hora UTC; en Venezuela restar 4 horas):

| Hora UTC | Usuario | Acción | Total |
|---|---|---|---|
| 15:31 | EMPRESA (vendedor sin comisión) | Venta rápida: cotización y despacho #4567 | $25.010 |
| 15:33 | ADMINISTRADOR | Edición: cabilla 10 mm $10,55→$10,45 y 16 mm $24,90→$24,75 | $24.875 |
| 17:52 | ADMINISTRADOR | Edición: tubo $111→$115 | $24.995 |
| 21:06 | ADMINISTRADOR | Edición: tubo $115→$111 | $24.875 |
| 21:09 | ADMINISTRADOR | Cobro a destino registrado en USDT, referencia "1234" | $24.875 |

Estado actual: entregada, cobrada, total $24.875, con cuatro líneas que suman exactamente $24.875.

### Por qué el primer PDF salió mal (error del sistema)
La tarjeta del despacho en pantalla guardaba una copia del total y de la forma de pago. Al imprimir, los productos se leían de la base de datos (con el tubo a $115), pero el total y el monto de cobro se tomaban de la copia vieja ($24.875). Resultado: líneas de $24.995 con total de $24.875.

### Por qué el segundo cambio no es un error del sistema
El tubo fue editado manualmente por el usuario ADMINISTRADOR dos veces. Los montos coinciden entre sí. Lo que sí queda por confirmar es si el precio correcto es $111 o $115: si era $115, se cobraron $120 de menos.

## Arreglo aplicado al sistema

**Qué cambia:** los nueve accesos a PDF de la tarjeta del despacho (nota de entrega, orden de despacho, guía y factura; descargar, imprimir y WhatsApp) ahora vuelven a leer el despacho de la base de datos antes de generar el documento. Si la lectura falla, no se imprime y se muestra un aviso.

**Dónde está:**
- Archivo: `src/components/despachos/DespachoCard.jsx` (producción) y su copia en `construacero-staging/src/components/despachos/DespachoCard.jsx`.
- Rama limpia desde `main`: `fix/pdf-monto-actualizado`, carpeta `construacero-fixpdf` en el escritorio.
- Solicitud de publicación: [luiggiberaldi/listo-pos-cotizaciones#30](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/30).

**Estado de publicación:** la solicitud #30 está **unida a `main`** (commit `516825af`). GitHub indica que se unió el 2026-11-06 a las 21:56 UTC desde la cuenta `luiggiberaldi`. El asistente solo preparó la solicitud y esperó la aprobación de publicación.

**Revisión automática:** "Kilo Code Review" falló en 1 segundo, sin revisar código. Ya había fallado en las publicaciones #28 y #29. Es una falla del servicio externo, no del cambio.

## Prueba en staging (2026-11-06)

- Despacho de prueba #3499 (staging), cargado en pantalla con $634.
- Se cambió el total a $777 directamente en la base de datos, sin refrescar la pantalla.
- La Orden de Despacho descargada salió con $777,00 en forma de pago, subtotal y total.
- Solo se probó la Orden de Despacho a mano; los demás accesos llevan el mismo cambio.

**Limpieza de la prueba:**
- El despacho #3499 se restauró a $634.
- Se creó un operador temporal ("TEMP PRUEBA PDF") para entrar a la app; se borró después y se verificó que no quedó ninguno.
- Se apagaron los dos servidores de prueba.
- No se tocó producción durante la prueba.

## Preguntas abiertas (para la empresa)

1. ¿El precio correcto del tubo es $111 o $115? Si era $115, faltan $120 por cobrar.
2. ¿La referencia "1234" del pago en USDT corresponde a un pago real?
3. ¿Por qué el usuario ADMINISTRADOR cambió el tubo tres veces? Conviene que cada persona entre con su propio usuario: hoy, si varias personas comparten "ADMINISTRADOR", el historial no dice quién hizo cada cambio.
4. ¿Qué papel tiene el chofer? Si conserva la orden de $24.995, ya no sirve.

## Pendientes técnicos

- Confirmar en producción que la solicitud #30 está publicada (ya confirmado: está en `main`) y probar un PDF de un despacho real (sin cambiar datos). **Pendiente.**
- Probar en staging los otros ocho accesos a PDF, no solo la Orden de Despacho.
- Decidir si la carpeta `construacero-fixpdf` se conserva o se elimina después de confirmar la publicación.
- Los cambios de abonos COD que estaban en curso en la carpeta principal no se tocaron.

## Nota sobre credenciales

Durante la prueba se usaron credenciales de staging que ya existen en los archivos del proyecto. No se escriben en este documento.
