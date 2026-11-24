# OP-2026-062 — Auditoría de Reportes → Crédito (cuentas por cobrar)

**Fecha:** 2026-11-24 · **Estado:** auditoría terminada; arreglos preparados en la rama `claude/op-062-auditoria-reporte-cxc-2d1843`, **sin publicar** (falta la aprobación del dueño) · **Producción:** solo se leyó, no se cambió nada.

## En resumen

- **El dinero que muestra el reporte está bien.** Las cifras principales de la captura (deuda al cierre $72.399,70 de 18 clientes, cargos, abonos y cobros) coinciden al centavo con la base de datos.
- **Sí había una falla real en "Antigüedad de deuda" y en las alertas.** Cuando un pago queda anotado *antes* que la nota que paga, el reporte "perdía" el sobrante y dejaba esa nota como deuda vieja. Es como un cajero que recibe un pago adelantado, no lo apunta en ninguna parte y después ve la factura nueva como pendiente. Por eso Antigüedad sumaba $302,26 de más y había **3 alertas falsas**: las reales son **36, y las 36 están vencidas**, no 39 con 38 vencidas.
- **Había otra falla en los períodos pasados** (Mes pasado, Ayer, Corte viernes–jueves…). Quedaban fuera los clientes que debían en esa fecha y pagaron *después*. Ejemplo: **septiembre mostraba $739 menos de deuda al cierre (3 clientes menos)**.
- Las otras 3 diferencias de la captura **no son errores**: son devoluciones o saldo a favor que la tarjeta no nombraba. Se agregó el texto que lo explica.
- Además, el botón **Imprimir** dejaba una pestaña en blanco abierta. Ya está arreglado.
- **Qué tienes que hacer tú:** decidir si se publican los arreglos (paso "Qué se propone" al final).

## Qué se revisó

- Pantalla `src/views/ReportesView.jsx`, pestaña Crédito: filtros de período, tarjetas, Antigüedad de deuda y las sub-pestañas Resumen, Alertas, Clientes, Movimientos y Proveedores.
- El cálculo del reporte: `src/utils/cxcPeriodReport.js` y su prueba.
- La consulta que trae los datos: `src/hooks/useReportePeriodoCxC.js` (lee todas las páginas con `leerTodasLasPaginas`). La pestaña ya **no** usa `useCuentasCobrar.js` ni `useReporteVentas.js`.
- El PDF (resumen y detallado) y la impresión: `src/services/pdf/cxcPDF.js`.
- **Comprobación con datos reales:** se bajaron de producción, solo para leer, los mismos datos que pide la pantalla (51 clientes, 556 movimientos) y se pasaron por el mismo cálculo del programa. Se obtuvieron **exactamente** las cifras de la captura. Después se repitió con *todos* los clientes para ver quién faltaba en otros períodos. Los datos bajados quedaron fuera del repositorio, en una carpeta temporal del equipo.

## Las 5 dudas de la captura (período 01-nov a 24-nov-2026)

| # | Lo que se ve | ¿Error? | Explicación |
|---|---|---|---|
| 1 | CxC al cierre $72.399,70 vs Antigüedad $72.701,96 (diferencia $302,26) | **Sí, error del programa** (falla N19) | La diferencia es de 2 clientes que hoy deben **$0**: **Osniel Coronel** ($301,92) y **Ferretería El Gran Adonay** ($0,34). Ver hallazgo 1. Con el arreglo, Antigüedad suma **$72.399,70**, igual que el cierre. |
| 2 | $94.845,15 + $44.976,59 − $67.421,70 = $72.400,04 vs $72.399,70 (diferencia $0,34) | No, es correcto | La tarjeta "Saldo inicial" solo suma a quienes **deben**, pero los cargos y abonos son de todos. Ferretería El Gran Adonay empezó el mes **con $8,10 a favor**, recibió un cargo de $0,34 y quedó con $7,76 a favor. Esos $0,34 aparecen en "cargos", pero el cliente no debe nada al cierre. La cuenta exacta usa el **Neto**: $94.837,05 + $44.976,59 − $67.421,70 = **$72.391,94** de deuda neta. Si se le suman los $7,76 a favor de Adonay, da **$72.399,70**. El recuadro "Cuadre de movimientos", debajo de Antigüedad, ya hace esta cuenta y marca diferencia **$0**. |
| 3 | "Neto" $94.837,05 ≠ Saldo inicial $94.845,15 | No, es correcto | Son los mismos $8,10 a favor de Ferretería El Gran Adonay al 1-nov: Neto = deuda − saldo a favor. La tarjeta ahora lo dice: *"Neto: $94,837.05 (resta $8.10 a favor)"*. |
| 4 | 18 clientes con deuda, 39 alertas (38 vencidas) | **18 sí cuadra; las alertas no** | En la base hay **18 clientes activos con deuda, que suman $72.399,70**, y no hay clientes inactivos con deuda. Las alertas incluían **3 falsas** de los dos clientes del punto 1: 2 vencidas de Osniel Coronel y 1 "vence en 2 días" de Adonay. Las reales son **36, todas vencidas**. |
| 5 | Cobros $64.328,75 + cruces $3.085,55 = $67.414,30 vs abonos $67.421,70 (diferencia $7,40) | No, es correcto | Los $7,40 son una **devolución**: INVERSIONES Y SUMINISTRO YAHVEH, despacho #4804, del 18-nov. Una devolución rebaja la deuda, pero no es dinero cobrado ni un cruce. Antes solo se mencionaba más abajo, en el recuadro del cuadre. Ahora la tarjeta dice *"Saldo a favor/cruces: $3,085.55 · Devoluciones: $7.40"*. Suma: 64.328,75 + 3.085,55 + 7,40 = **67.421,70** ✔. |

**Los 4 pagos atrasados de hoy (OP-2026-060)** están bien reflejados. El Cruce de $850 (21-sep), los $60,59 (29-sep) y los $64,50 (02-oct) son de antes de noviembre: solo entran en el saldo inicial. El USDT de $313,43 (20-nov) entra en "Cobros en dinero", porque USDT cuenta como dinero. Ninguno tiene fecha de hoy.

## Hallazgos, de más grave a menos grave

### 1. Deuda "fantasma" en Antigüedad, Alertas y Riesgo cuando el pago se anota antes que la nota — **Importante** (falla N19) — ✅ arreglado en la rama

- **Qué pasa:** para saber qué notas siguen abiertas, el reporte reparte cada pago entre las notas que ya existían, empezando por la más vieja. Si un pago es más grande que lo pendiente en ese momento (pago adelantado, o nota cargada unos minutos después del pago), el sobrante **se descartaba**. La nota siguiente quedaba "sin pagar" para siempre en Antigüedad y en Alertas, aunque el saldo real del cliente fuera $0.
- **Ejemplo real:** Osniel Coronel pagó $1.075,28 por Zelle el 03-jun a las 12:45. La nota #877 de $301,92 que también cubría ese pago se cargó a las 16:52 del mismo día. El cliente debe $0, pero el reporte mostraba $301,92 de deuda vieja y 2 alertas de vencido. Ferretería El Gran Adonay tenía $8,10 a favor desde julio y le cargaron $0,34 el 18-nov: el reporte mostraba $0,34 por vencer.
- **Daño:** Antigüedad infla la deuda ($302,26 hoy), aparecen alertas falsas (3 hoy) y la columna de días o riesgo de un cliente puede salir peor de lo que es. **No cambia** el total "CxC al cierre" ni los saldos guardados.
- **Arreglo:** el sobrante de un pago se guarda como crédito y se descuenta de las notas siguientes (`distribuirAbonos` en `cxcPeriodReport.js`). Con los datos reales de hoy: Antigüedad = **$72.399,70** (0–30 días $6.047,10 · 31–60 $3.340,09 · 61–90 $25.890,80 · 90+ $37.121,71) y alertas = **36 (36 vencidas)**. Se agregaron 3 pruebas automáticas con estos casos.
- **Riesgo del arreglo:** bajo. Solo cambia la vista; no escribe en la base. Algunas notas pueden cambiar de tramo de antigüedad, porque ahora el pago adelantado se descuenta de la nota correcta.

### 2. En períodos pasados faltan los clientes que pagaron después del corte — **Importante** (falla N20) — ✅ arreglado en la rama

- **Qué pasa:** el reporte junta a (a) quienes deben *hoy* y (b) quienes tuvieron movimientos *dentro* del rango. En un período pasado, alguien que debía en la fecha de corte, no se movió en ese rango y pagó después (hoy debe $0) no entra en ninguno de los dos grupos y **desaparece** del saldo inicial y del cierre.
- **Ejemplo real** (pantalla actual → valor correcto):

  | Período | CxC al cierre en pantalla | Correcto | Clientes con deuda |
  |---|---|---|---|
  | Septiembre 2026 | $171.406,80 | **$172.145,80** (−$739) | 27 → **30** |
  | Mes pasado (octubre) | $94.844,67 | **$94.845,15** | 28 → **30** |
  | Corte 13–19 nov | $70.497,53 | **$70.546,37** | 20 → **29** |
  | Este mes / Ayer | correcto | correcto | — |

  Por eso el cierre de "Mes pasado" ($94.844,67) no coincidía con el saldo inicial de "Este mes" ($94.845,15). Con el arreglo coinciden.
- **Arreglo:** la consulta (`useReportePeriodoCxC.js`) incluye a los clientes con movimientos **desde el inicio del rango en adelante**, sin tope al final. Comprobado con los datos reales en los 5 períodos de la tabla: ahora todos dan igual que el cálculo con todos los clientes.
- **Riesgo:** bajo. Trae algunos clientes más al pedir períodos viejos (hoy son unos cientos de movimientos en total).

### 3. "Imprimir" deja una pestaña en blanco — **Menor** (falla N21) — ✅ arreglado en la rama

- **Qué pasa:** al tocar Imprimir, la pantalla abre una ventana vacía para que el navegador no la bloquee y se la pasa al generador del PDF. Pero el generador la ignoraba y abría **otra** ventana. Quedaba una pestaña en blanco y, en algunos navegadores, la segunda se bloqueaba por ser una "ventana emergente".
- **Arreglo:** el PDF se carga en la ventana que ya estaba abierta (`cxcPDF.js`).
- **Pendiente:** no se probó todavía en un navegador real.

### 4. Tarjetas que mezclan "deuda" y "neto" sin explicarlo — **Menor** (falla N22) — ✅ arreglado en la rama

- **Qué pasa:** son las dudas 2, 3 y 5. Las cifras están bien, pero la tarjeta no decía de dónde salía la diferencia, y parecía un error.
- **Arreglo:** "Saldo inicial" muestra *"(resta $X a favor)"* cuando hay saldo a favor al inicio. "Abonos aplicados" muestra *"· Devoluciones: $X"* cuando las hay.

### 5. Antigüedad usa otro formato de números — **Menor** (falla N23) — ✅ arreglado en la rama

- **Qué pasa:** las tarjetas escriben $72,399.70 y Antigüedad escribía $72.701,96: punto y coma intercambiados. Es fácil leerlo mal.
- **Arreglo:** Antigüedad usa el mismo formato que las tarjetas.

### 6. El PDF no trae el resumen del período y calcula "vencido hace X días" contra hoy — **Menor** (falla N24) — 🔴 propuesto, sin arreglar

- **Qué pasa:**
  - El PDF muestra la deuda al cierre, Antigüedad y el detalle por nota, pero **no** el saldo inicial, los cargos, los abonos ni los cobros del período, que la pantalla sí muestra.
  - En el detalle, "Vencido hace X días" se cuenta contra **la fecha de hoy**, no contra la fecha de corte del reporte. En un PDF de "Mes pasado", los días no corresponden al 31-oct.
  - Por la forma de redondear, puede diferir en 1 día de lo que dice la pantalla.
- **Arreglo propuesto:** agregar al PDF el bloque "Saldo inicial + cargos − abonos = cierre" y contar los días desde la fecha de corte.

### 7. El recuadro "Pagos de más sin deuda" de Clientes nunca aparece — **Menor** (falla N25) — 🔴 propuesto, sin arreglar

- **Qué pasa:** la pestaña Clientes tiene un recuadro de OP-2026-042 para clientes que pagaron más de lo que debían, pero el cálculo actual del reporte ya no entrega esa lista. El recuadro nunca se muestra. Hoy le correspondería a Ferretería El Gran Adonay, con $7,76 a favor en el libro de cuentas.
- **Arreglo propuesto:** decidir si se vuelve a calcular (clientes con neto negativo al cierre) o si se quita el recuadro.

### Observaciones sin daño hoy

- Los clientes **inactivos** con deuda no entran en el reporte salvo que tengan movimientos en el rango. Hoy hay 0 clientes así.
- "Saldo a favor actual" ($674,15, de 25 clientes) es el saldo a favor guardado en la ficha *hoy*, no en la fecha de corte; la tarjeta lo dice. No es lo mismo que el "saldo a favor" del libro de cuentas: los $7,76 de Adonay salen de pagos de más, no de la ficha.
- Las sub-pestañas Movimientos (89) y Proveedores (3) y los filtros de fecha se revisaron sin fallas: los días se cuentan en hora de Venezuela y la medianoche siguiente queda fuera.

## Qué se cambió en la rama (sin publicar)

| Archivo | Cambio |
|---|---|
| `src/utils/cxcPeriodReport.js` | El sobrante de un pago se aplica a las notas siguientes (hallazgo 1) |
| `src/utils/__tests__/cxcPeriodReport.test.js` | 3 pruebas nuevas: el caso de Osniel Coronel, el de Ferretería El Gran Adonay y "Antigüedad = deuda al cierre" |
| `src/hooks/useReportePeriodoCxC.js` | Clientes con movimientos desde el inicio del rango, sin tope (hallazgo 2) |
| `src/services/pdf/cxcPDF.js` | Imprimir usa la ventana ya abierta (hallazgo 3) |
| `src/views/ReportesView.jsx` | Textos de las tarjetas (hallazgo 4) y formato de Antigüedad (hallazgo 5) |

**Pruebas:** 1.207/1.207 en verde y compilación correcta (detalle en "Estado de verificación").

## Estado de verificación

- ✅ Las cifras de la captura se reprodujeron al centavo con los datos reales y el cálculo del programa.
- ✅ Con los arreglos y los datos reales: Antigüedad = CxC al cierre ($72.399,70), 36 alertas, y los períodos pasados coinciden con el cálculo completo.
- ✅ Pruebas automáticas (`npx vitest run`): **1.207/1.207 en verde** (120 archivos; antes 1.204, más las 3 nuevas). En esta copia de trabajo no hay archivo `.env`, por eso se corrieron con valores de conexión de mentira: ninguna prueba se conecta a la base.
- ✅ Compilación (`npm run build`): correcta.
- ⏳ **No se probó en pantalla** (navegador) ni la impresión real.
- ⏳ Sin commit, sin solicitud de cambio y sin publicar: falta la aprobación del dueño.

## Qué se propone

1. Aprobar la publicación de los arreglos 1 a 5 (solo cambian lo que se ve en pantalla; no tocan la base de datos).
2. Decidir los hallazgos 6 (resumen del período en el PDF) y 7 (recuadro "Pagos de más").
3. Después de publicar, abrir Reportes → Crédito → Este mes y comprobar que Antigüedad dice **Total $72,399.70** y que aparecen **36 alertas**.
