# Auditoría de todos los reportes (exactitud y velocidad)

**Fecha:** 2026-11-06 · **Tipo:** revisión de solo lectura (no se cambió nada en producción) · **Estado:** Fase 1 construida y probada en la rama `fix/reportes-completos` (sin publicar). Fases 2 y 3 pendientes.

## Resultado de la Fase 1 (2026-11-06)

**Qué se arregló:**

- **Ventas, Vendedores, Cotizaciones (tasa de cierre), Comisiones, Crédito y Transportistas** ahora piden la información por páginas de 1.000 hasta traerla toda.
- **Corrección a este mismo informe:** el cuadro de totales de Comisiones también cortaba en 1.000 (aquí se había marcado como exacto). Ahora el total se calcula con la lista completa.
- La línea "cliente ajeno (split)" del reporte de vendedores ya no se suma dos veces.
- Si una lectura falla, el reporte muestra error en vez de números incompletos.
- Hay una red de seguridad: más de 50.000 filas pide elegir un período más corto.
- De paso, la pestaña Comisiones baja de 3 pedidos al servidor a 1. La tabla, el menú de vendedores y el cuadro de totales comparten la misma descarga.

**Comprobación con datos reales de producción (solo lectura, `tmp/verificar-paginas-produccion.mjs`):**

| Prueba | Antes | Ahora | En la base |
|---|---|---|---|
| Corte 23–29 oct | 118 ventas · $107.328,03 | **idéntico** | — |
| Mes pasado (octubre) | 478 ventas · $435.701,01 | **idéntico** | — |
| Ago–Oct | 1.000 ventas · $875.790,82 | **1.206 ventas · $1.033.227,21** | 1.206 |
| Cotizaciones Sep–Oct | 1.000 | **1.291** | 1.291 |
| Comisiones May–Oct | 1.000 | todas (el servidor informa el total: 1.522) | 1.522 |

El reporte viejo de agosto–octubre **dejaba fuera $157.436,39 en ventas**. El botón "Trimestre" del Reporte de Vendedores habría empezado a fallar hacia fines de cada trimestre.

**Pruebas:**

- 1.018 pruebas automáticas en verde, entre ellas 16 nuevas. Por ejemplo, "2.500 filas llegan completas" y "1.250 despachos de transportistas suman bien".
- Recorrido real del código nuevo conectado a la base de staging (`tmp/recorrer-reportes-rama-staging.mjs`). Las 5 pestañas de Reportes y el Reporte de Vendedores (Hoy y Trimestre) cargan sin errores, y ningún pedido fue a producción.

**Por qué no se probó en la copia `construacero-staging/`:** esa copia tiene una versión más vieja de los reportes. Por eso el código nuevo se probó desde la rama, conectado a la base de staging.

**Pendiente menor:** en el servidor queda el resumen viejo de comisiones (`/api/comisiones/resumen`), que corta en 1.000. Ninguna pantalla lo usa ya; se puede retirar en la Fase 3.

## En resumen

- **Hay reportes que salen incompletos sin avisar.** La base de datos entrega como máximo **1.000 filas por pedido**, como una fotocopiadora que se detiene a la hoja 1.000 aunque el documento tenga más. Varios reportes piden "todo" de una vez y no piden el resto.
  - Hoy ya pasa en el **reporte de ventas y en el de vendedores** con períodos de unos 2 meses y medio o más. Entre agosto y octubre hay 1.206 ventas y el reporte muestra 1.000.
  - Pasa también en la **tasa de cierre de vendedores** desde unos 2 meses (octubre solo tuvo 812 cotizaciones).
  - Está **a punto de pasar** en comisiones (3 meses = 964 filas), transportistas con rangos largos (1.059 en total) y cuentas por cobrar (880 en total).
- **Un error de cálculo pequeño:** en el reporte de vendedores, la comisión "cliente ajeno (split)" se suma **dos veces** y el PDF la muestra al doble. En septiembre y octubre eso fue $15,55 y $28,15 reales, mostrados como el doble en esa línea. El total de comisión de cada vendedor **no** está afectado.
- **La velocidad se puede mejorar bastante.** El reporte de ventas tarda unos 2–2,7 s y se puede bajar a cerca de 1 s. Casi un tercio del tiempo se va en un paso repetido. Además, al cambiar de filtro la pantalla se queda en blanco (lo mismo que se arregló en Mis ventas).
- **Mes a mes los reportes cuadran.** Un mes normal tiene 300–480 ventas, lejos del tope. El problema aparece con períodos largos o "Personalizado".

## 1. Qué se revisó

Las pestañas de Reportes (Ventas, Comisiones, Crédito, Transportistas, Artículos externos), el Reporte de Vendedores y el reporte de Flota/Choferes. Para cada uno se miró:

1. Qué datos pide.
2. Si puede chocar con el tope de 1.000 filas.
3. Cuántos pasos en cadena hace.
4. Qué pasa en pantalla al cambiar el período.

Las cantidades se midieron en producción **solo leyendo**. Los scripts están en `tmp/auditar-reportes-tamanos*.mjs` y `tmp/medir-cadena-reporte-ventas.mjs`.

### Tamaño real de los datos por mes (producción)

| Mes | Ventas | Cotizaciones | Filas de comisión | Movimientos de crédito |
|---|---|---|---|---|
| Jun | 308 | 365 | 232 | 144 |
| Jul | 353 | 418 | 235 | 141 |
| Ago | 333 | 401 | 232 | 184 |
| Sep | 395 | 479 | 316 | 185 |
| Oct | 478 | **812** | 416 | 180 |

El negocio crece y los números suben mes a mes, así que el tope se alcanzará con períodos cada vez más cortos.

## 2. Hallazgos de exactitud (lo más importante)

| # | Reporte | Qué pide | ¿Choca con el tope? | Gravedad |
|---|---|---|---|---|
| E1 | **Ventas** (pestaña) | Lista de ventas del período y del período anterior | **Sí, ya.** Ago–Oct: 1.206 reales, llegan 1.000. Totales, ranking de vendedores, clientes, productos y formas de pago salen bajos | Alta |
| E2 | **Vendedores** (reporte detallado) | La misma lista de ventas | **Sí, ya.** Mismo caso que E1 | Alta |
| E3 | **Vendedores**: tasa de cierre | Cotizaciones del período. El código pide "hasta 5.000", pero la base igual corta en 1.000 | **Sí, desde unos 2 meses** (Sep+Oct = 1.291) | Alta |
| E4 | **Comisiones** (pestaña) | Filas de comisión del período, una sola página de 1.000 | Casi: 3 meses = 964. El cuadro de arriba (total exacto) y la tabla de abajo no coincidirían | Media (pronto alta) |
| E5 | **Ventas / Vendedores**: comisiones | Las mismas filas de comisión, una sola página | Casi (igual que E4). Las que faltan se "estiman" en vez de leerse | Media |
| E6 | **Transportistas** | Despachos con transportista. Pide "hasta 5.000", la base corta en 1.000 | Con rangos de casi todo el año: 1.059 en total. 3 meses = 534 | Media |
| E7 | **Crédito (CxC por período)** | Historial completo de los clientes en tandas de 50, y movimientos del rango | Todavía no: 880 movimientos en total, la tanda más grande 467. Con el crecimiento (~180/mes) llegará en unos meses | Media (a futuro) |
| E8 | **Vendedores**: comisión split | Se suma dos veces la línea "cliente ajeno (split)" | No es tope: es un error de suma. Afecta solo esa línea del PDF | Baja (montos chicos) |
| — | Artículos externos | Su propia consulta | No: el año completo son 184 filas | OK |
| — | Flota / choferes | Consultas que devuelven un solo paquete | No les aplica el tope | OK |

## 3. Hallazgos de velocidad

Se midió el reporte de ventas imitando sus pasos con datos reales.

| Período | Paso 1 (ventas, comisiones, usuarios…) | Artículos | Artículos de cotización | Categorías | **Categorías otra vez, una tanda tras otra** | Total |
|---|---|---|---|---|---|---|
| Corte 7 días | 0,8–1,3 s | 0,4–0,5 s | 0,25 s | 0,25 s | **0,5 s** | 2,3–2,8 s |
| Mes pasado | 0,3–0,4 s | 0,6 s | 0,25 s | 0,2 s | **0,7 s** | 2,0–2,3 s |
| 3 meses | 0,4 s | 0,6–0,9 s | 0,24 s | 0,2 s | **0,9 s** | 2,5–2,7 s |

En el teléfono o computador del usuario suma algo más, por la conexión y por los cálculos en el propio aparato.

| # | Problema | Dónde | Efecto |
|---|---|---|---|
| V1 | **Las categorías se piden dos veces**, la segunda tanda por tanda | Reporte de ventas | 0,5–1 s perdidos (un tercio del tiempo) |
| V2 | **Pasos en cadena**: cada paso espera al anterior (5 pasos en ventas, 6 en vendedores) | Ventas, Vendedores | Se suman las esperas |
| V3 | Los **artículos de cotización** se piden para todas las ventas, aunque solo hacen falta para las que no tienen artículos propios (1 de 478 en octubre) | Ventas, Vendedores | ~0,25 s por nada |
| V4 | **Pantalla en blanco al cambiar de filtro** (no se mantiene lo anterior mientras carga) | Todos los reportes | Se siente lento aunque no lo sea |
| V5 | **La lista de comisiones se pide dos veces** cuando no hay vendedor elegido (una para la tabla y otra para el menú de vendedores) | Comisiones | Doble trabajo |
| V6 | **Búsquedas "uno contra todos"**: para cada venta se recorre la lista completa de artículos | Ventas, Vendedores | Lento en teléfonos con períodos largos |
| V7 | Los usuarios se piden al final, en un paso aparte | Vendedores | Un paso extra en la cadena |
| V8 | Las tandas de crédito se piden una por una | Crédito | Poco hoy, crece con los clientes |

### Otros detalles (orden y limpieza)

- Hay mensajes de prueba (`[DEBUG]`) que se escriben en la consola en cada carga del reporte de ventas.
- Hay 4 reportes viejos que **ya no se usan en ninguna pantalla**: `useReporteDespachos`, `useReportePipeline`, `useReporteLiquidacion` (con `TabLiquidacion`) y `useReporteVentasComisiones`. Se pueden retirar para que nadie los arregle por error.

## 4. Plan de arreglo

Todo se construye y se prueba **primero en staging**. Para cada reporte se compara el resultado nuevo contra el viejo con datos reales, solo leyendo. Recién después se pasa a producción.

### Fase 1 — Exactitud (urgente)

1. **"Pedir por páginas hasta traer todo"** con una sola herramienta común. Funciona como pedir las hojas de la fotocopiadora de 1.000 en 1.000 hasta que no quede ninguna. Se aplica a:
   - la lista de ventas (E1, E2);
   - las cotizaciones (E3);
   - las comisiones (E4, E5);
   - los transportistas (E6);
   - el crédito (E7).
   
   Con prueba automática: una lista falsa de 2.500 filas tiene que llegar completa.
2. **Red de seguridad:** si alguna lista llega justo con 1.000 filas, el reporte avisa en vez de mostrar un total falso.
3. **Corregir la suma doble del split** (E8), con su prueba.
4. **Comprobación con datos reales (solo lectura):**
   - "Mes pasado" debe dar **exactamente lo mismo** que hoy.
   - Ago–Oct debe pasar de 1.000 a **1.206 ventas**.

### Fase 2 — Velocidad

5. **Mantener lo anterior en pantalla** al cambiar de filtro, en todos los reportes, con un indicador de "actualizando" (V4). Es lo mismo que ya funciona en Mis ventas.
6. **Acortar la cadena del reporte de ventas y del de vendedores** (V1, V2, V3, V7):
   - quitar el paso repetido de categorías;
   - traer la categoría junto con los artículos;
   - pedir artículos de cotización solo cuando hagan falta;
   - pedir los usuarios desde el inicio.
   
   Meta: de ~2,3 s a ~1 s.
7. **Una sola lista de comisiones** para la tabla y el menú (V5).
8. **Búsquedas con índice** en lugar de "uno contra todos" (V6), y tandas de crédito en paralelo (V8).
9. Quitar los mensajes `[DEBUG]`.

### Fase 3 — Opcional, solo si después sigue lento

10. Calcular el reporte de ventas completo en el servidor y entregarlo ya armado (un solo pedido). Es el cambio más grande; solo vale la pena si la Fase 2 no alcanza.
11. Precargar "Mes pasado" y "Corte" al entrar a Reportes.
12. Retirar los 4 reportes viejos que ya no se usan.

### Riesgos y cómo se cuidan

- **Cambiar cómo se suman los reportes es delicado** porque son cifras del negocio. Por eso cada paso se compara contra el resultado actual con datos reales: en períodos cortos los números tienen que salir idénticos.
- Al traer más filas, los períodos largos pueden tardar un poco más. Es el precio de que salgan completos, y la Fase 2 lo compensa.
- No hace falta cambiar la base de datos en las Fases 1 y 2.

## Cómo retomarlo

Decir "empieza la fase 1 de reportes" (o la fase que se quiera). Se construye en staging, se muestra y luego se publica.
