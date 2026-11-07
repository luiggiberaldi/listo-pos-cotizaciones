# Propuesta: reporte de ventas del sábado (Logística → Administración)

**Fecha:** 2026-11-07 · **Tipo:** propuesta (todavía no cambia nada del sistema) · **Caso:** OP-2026-016

## En resumen

- Hoy, los sábados Logística llena **a mano** la hoja "Ventas generales diarias" y se la deja a Administración, que no trabaja ese día.
- La propuesta es que **el sistema llene esa hoja solo**, con el mismo formato que ya conocen, y que Logística solo la revise, cuente el efectivo y la imprima o la mande.
- **El reporte es solo para Logística:** solo ese rol lo ve en el sistema. Administración no lo abre; recibe la hoja impresa o el PDF, como hoy recibe la de papel.
- Las mejoras principales: **no hay que sumar a mano**, **avisa si falta una nota**, **separa lo cobrado de lo que se debe** y **trae las referencias del pago móvil** para que Administración las confirme con el banco el lunes.

## De dónde salió

Revisamos una foto de la hoja del 24-10-2026. Las sumas estaban bien (total 1.175,85 $ con tasa 1.012 Bs/$), pero aparecieron estos problemas:

| Problema en la hoja de papel | Cómo lo resuelve el reporte nuevo |
|---|---|
| Faltaban 7 números de nota (04249, 04250, 04253, 04254, 04258, 04267, 04269) y no se sabe por qué | Una sección "Notas que no aparecen" con el motivo de cada una (anulada, de otro día, pendiente) |
| Una nota en 0 (Ana Rivero, 04270) | Se marca en amarillo: "sin pago registrado" |
| 20 $ en una columna que no se sabe si era "por cobrar" u "otros" | Cada forma de pago tiene su columna, con nombre claro |
| "Efectivo" y "Pago móvil" escritos a mano para aclarar las columnas | Los títulos de las columnas ya dicen eso |
| Notas fuera de orden (04259 después de 04260) | Se ordenan solas por número |
| Sumas hechas a mano y casillas en blanco ("Totales", "Tasa de hoy") | El sistema suma y pone la tasa |
| Administración no puede comprobar los pagos móviles | Cada pago móvil trae su número de referencia |

## Cómo se vería

Una sola hoja horizontal, parecida a la de papel:

```
CONSTRUACERO — VENTAS GENERALES DEL DÍA            Sábado 24-10-2026
Preparado por: (usuario de Logística)    Tasa del día: 1.012,00 Bs/$

 #  Cliente             Nota   Efectivo $  Pago móvil Bs  Ref.    Zelle $  Punto Bs  Por cobrar $  Total $
 1  Alejandro Cortez    04248       0,00      21.150,80  123456     0,00      0,00         0,00    20,90
 2  ...
16  Ana Rivero          04270       0,00           0,00              0,00      0,00         0,00     0,00  ⚠ sin pago
---------------------------------------------------------------------------------------------------------
SUBTOTALES                        813,76     346.194,04             0,00      0,00        20,00
En dólares                        813,76         342,09             0,00      0,00        20,00

RESUMEN
  Dinero que entró hoy (cobrado) ...................  1.155,85 $
  Quedó por cobrar (crédito) .......................     20,00 $
  TOTAL VENDIDO ....................................  1.175,85 $

CUADRE DE EFECTIVO (lo llena Logística)
  Efectivo $ que dice el sistema: 813,76   Contado en caja: ______   Diferencia: ______

NOTAS QUE NO APARECEN EN ESTA HOJA
  04249 anulada · 04250 es del viernes · 04258 pendiente de pago · ...

```

Detalles:

- **Solo se muestran las columnas que se usaron ese día.** Si nadie pagó con USDT, esa columna no sale y la hoja queda tan simple como la de papel.
- Si un cliente pagó con dos formas (por ejemplo, dólares y pago móvil), sale **en una sola fila** con cada monto en su columna, igual que ahora.
- La columna **Total $** de cada fila ya convierte los bolívares a dólares con la tasa del día.

## Cómo se usaría (para Logística, el sábado)

1. Entrar a **Reportes → Ventas del día** (esta opción solo le aparece a Logística).
2. La fecha de hoy ya aparece puesta. Revisar la lista.
3. Contar el efectivo de la caja y escribir el monto en "Contado en caja". El sistema calcula la diferencia.
4. Pulsar **Imprimir / PDF** (o **Enviar por WhatsApp** a Administración).
5. Dejar la hoja impresa con el efectivo.

El lunes, Administración recibe la hoja (impresa o PDF) y, con las referencias de pago móvil que vienen en ella, puede compararlas con el banco. Administración **no** usa esta pantalla en el sistema.

## Lo que necesito que decidas

1. **¿Qué tasa se usa?** La del BCV que ya tiene el sistema, o una tasa propia que Logística escribe ese día. La hoja de papel decía 1.012.
2. **¿Qué cuenta como "venta del día"?** Propongo contar **todo despacho creado ese día**, aunque esté "pendiente", porque los sábados Administración no está para aprobar. Cada fila mostraría su estado.
3. **¿Solo sábados o cualquier día?** Propongo que Logística pueda elegir cualquier fecha (el sábado es el uso principal), por si algún día hay que repetir una hoja.
4. **¿Hace falta el cuadre de efectivo contado?** Es la mejora que más protege contra pérdidas, pero agrega un paso.
5. **¿Se manda por WhatsApp, se imprime, o las dos?**

## Plan de trabajo (cuando lo apruebes)

1. Armar el reporte en **staging** (la copia de pruebas) y compararlo con una hoja de papel real del mismo día.
2. Que Logística lo pruebe un sábado **en paralelo** con la hoja de papel.
3. Si cuadra, publicarlo en **producción** y dejar la hoja de papel.

## Estado (2026-11-07)

**Construido y probado en staging. No está en producción ni guardado en git.**

Lo que hace hoy (con las decisiones que propuse como punto de partida, todas cambiables):
- Pestaña **Reportes → Ventas del día**, solo para Logística (y soporte técnico). Administración, jefe y vendedores reciben 403 si intentan pedirla.
- Cuenta todo despacho creado ese día (incluso pendiente, marcado en amarillo). Las anuladas salen en "Notas que no aparecen".
- Tasa: la del sistema, pero Logística puede escribir otra. Si el pago guardó los bolívares reales, se muestran esos.
- Cuadre de efectivo en dólares, imprimir, descargar PDF (1 hoja horizontal, ~200 KB) y enviar por WhatsApp.

Pruebas: 313 pruebas automáticas en verde, compilación correcta y un recorrido real en staging (`node scripts/test-ventas-dia-ui.mjs`, 26 comprobaciones; borra sus datos al final). También se reprodujo la hoja del 24-10-2026: efectivo 813,76 $, pago móvil 342,09 $, por cobrar 20 $, total 1.175,85 $ (igual al papel).

Archivos (árbol staging): `src/utils/ventasDia.js`, `api/handlers/ventasDia.js` (+ ruta en `worker.js`), `src/components/reportes/TabVentasDia.jsx`, `src/services/pdf/ventasDiaPDF.js`, pestaña en `src/views/ReportesView.jsx`.

Pendiente / sin verificar:
- Que el dueño confirme las 5 decisiones.
- Que Logística la pruebe un sábado en paralelo con el papel.
- Los pagos en bolívares guardan solo el monto en dólares; sin el monto real, los Bs se calculan con la tasa escrita (puede diferir unos Bs de lo que pagó el cliente).
- Portar al árbol principal y publicar en producción (requiere autorización).

## Datos de prueba en staging (2026-11-07)

- Operador **"Logística PRUEBA VD"** (PIN 000000) y **"Vendedor PRUEBA VD"** en la cuenta de prueba `staging-e2e@listo.sys`, con 6 clientes y 9 despachos de hoy (uno pendiente, uno anulado, uno sin pago, uno a crédito).
- Se crean con `node scripts/seed-ventas-dia-staging.mjs` y se borran con `node scripts/seed-ventas-dia-staging.mjs --borrar` (desde `construacero-staging/`).
- Solo staging; no toca producción.

## Cambios posteriores (2026-11-07)

- Se quitaron las líneas de firma del PDF. El nombre de quien preparó la hoja queda en el pie.
- Formas de pago distintas al efectivo en dólares: cada una tiene su columna (Efectivo Bs, Pago móvil, Punto, Zelle, USDT, Por cobrar, Cobro al entregar). Cruce y Donación van a la columna "Otros $" con su nombre en la última columna. Ver la respuesta en la conversación: las donaciones y cruces suman al total vendido pero no al "dinero cobrado".
- Se quitó el recuadro de **cuadre de efectivo** (pantalla y PDF) por pedido del dueño. Ya no hay casilla de "contado en caja".

## Publicación en producción (2026-11-07)
- Solicitud #39, commit `d6dcae86` en `main`. El servidor (Cloudflare) se desplegó con éxito y la pantalla (Vercel) también.
- Verificado: `GET /api/reportes/ventas-dia` sin sesión responde **401** (la ruta existe; una ruta inventada da 404) y el código de la pestaña está en la página publicada.
- **Sin verificar en producción:** abrir la pestaña con un usuario real de Logística. Pendiente: que Logística la pruebe un sábado real junto a la hoja de papel.
- Sin cambios en la base de datos. Para quitarlo: revertir la solicitud #39.
