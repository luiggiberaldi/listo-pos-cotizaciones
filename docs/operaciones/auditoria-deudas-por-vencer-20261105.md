# Auditoría: tarjeta "Deudas por vencer" del inicio de administración

**Fecha:** 2026-11-05 · **Alcance:** cálculo de la tarjeta en `api/handlers/dashboard.js` (líneas 147-160). Solo lectura: no se cambió código ni datos. Medido en staging y en producción (solo lectura, autorizado por el dueño).

## En resumen

La tarjeta **suma mal**. Para cada deuda toma el número de "saldo" guardado en esa fila, pero ese número es **lo que debía el cliente en total en el momento en que se creó la deuda**, no lo que falta de esa deuda. Además, ese número no baja cuando el cliente paga. Por eso la tarjeta:

1. **Cuenta deudas ya pagadas.**
2. **Infla el monto** con todo lo que el cliente ya debía antes.
3. **Repite** la deuda previa del cliente si tiene dos deudas en la misma semana.

**Producción:** hoy la tarjeta muestra **$5,549 (2 deudas), y por casualidad es correcto**, porque esos dos clientes no tenían deuda previa ni pagos. Pero el método falla en general: aplicado a las 200 deudas a crédito con fecha de vencimiento da **$815,454 contra $60,159 reales (unas 13 veces más)**. 148 de las 200 ya están pagadas y se contarían igual. Cualquier semana con deudas de clientes que ya debían, o que ya pagaron, saldrá inflada.

Además, en producción hay **45 deudas vencidas por $49,976** que no aparecen en ninguna parte del inicio.

Solo esta tarjeta tiene el problema. El reporte de Crédito, su PDF, la ficha del cliente y el nuevo aviso de cobranza calculan bien.

## Cómo se comprobó

**En el código** (todas las vías que crean filas en `cuentas_por_cobrar`):

| Dónde | Qué guarda en `saldo_usd` |
|---|---|
| Cargo al despachar (`despachos.js` ~1256-1284) | `saldo_pendiente del cliente + monto` |
| Abono (`cxc.js` ~143-156) | `saldo del cliente − abono` (y no toca los cargos) |
| Cargo COD heredado (`cxc.js` ~95) | `saldo del cliente + monto` |
| Funciones de base de datos (migraciones 053, 061, 226) | Igual: saldo acumulado del cliente |

Ningún proceso actualiza después el `saldo_usd` de un cargo. Es una columna tipo "libreta" (saldo corrido del cliente), correcta para mostrarse en la ficha del cliente, pero **no** para saber cuánto falta de cada deuda.

El reporte de Crédito ya lo sabe: reconstruye lo pendiente de cada cargo aplicando los abonos (primero al mismo despacho y luego en orden de antigüedad). En staging, ese cálculo cuadra con el saldo del cliente en **32 de 32** clientes.

**Con datos** (`tmp/auditar-deudas-por-vencer.mjs`, solo lectura):

| Medida | Producción | Staging |
|---|---|---|
| Tarjeta hoy (5 al 11 de nov) | 2 deudas · $5,549 (correcto hoy) | 0 · $0 |
| Ya vencido, que la tarjeta no muestra | **45 · $49,976.45** | 36 · $43,497.15 |
| Simulación con todas las deudas a crédito con fecha | **$815,453.71** vs real **$60,158.89** | $347,407.04 vs $43,751.25 |
| — coinciden | 13 de 200 | 15 de 100 |
| — infladas por deuda previa del cliente | 39 | 22 |
| — ya pagadas que igual contarían | **148** | 63 |

Detalle de staging:

| Medida | Resultado |
|---|---|
| Tarjeta hoy (5 al 11 de nov) | 0 deudas · $0 (no hay vencimientos esa semana) |
| Ya vencido, que la tarjeta no muestra | **36 deudas · $43,497.15** |
| Simulación con todas las deudas a crédito con fecha | Método de la tarjeta **$347,407.04** vs real **$43,751.25** |
| — coinciden | 15 |
| — infladas por deuda previa del cliente | 22 |
| — ya pagadas que igual contarían | **63** |

## Hallazgos

| # | Gravedad | Hallazgo |
|---|---|---|
| 1 | **Alta** | El total suma `saldo_usd` (saldo corrido del cliente) en vez de lo pendiente de cada deuda: cuenta pagadas, infla y repite. |
| 2 | **Alta** | El filtro `saldo_usd > 0` no filtra nada útil: todo cargo nace con saldo > 0 y nunca baja. Por eso la **cantidad** de deudas también sale inflada. |
| 3 | **Media** | La tarjeta solo mira "los próximos 7 días". Lo **ya vencido** no aparece en ninguna parte del inicio (en producción, $49,976 en 45 deudas). El nuevo aviso diario cubre esto, pero el inicio no. |
| 4 | **Media** | La prueba automática (`dashboard.test.js`, línea 62) usa datos donde el saldo coincide con el monto, así que nunca detectó el error. |
| 5 | **Baja** | La fecha de vencimiento se calcula con la hora del servidor (UTC) (`despachos.js` ~1266-1269). Una venta registrada después de las 8 p. m. de Venezuela queda con vencimiento **un día más tarde**. También afecta, en un día, al aviso de cobranza. |
| 6 | **Baja** | Incluye clientes inactivos (el reporte de Crédito los excluye). |
| 7 | Informativo | Solo **administración** ve esta tarjeta; el jefe no la tiene en su inicio. |

## Propuesta de arreglo

1. Calcular la tarjeta con el mismo cálculo del reporte (`cargosPendientes` de `src/utils/cobranza.js`), solo para clientes activos con saldo.
2. Agregar al lado una cifra de **"Vencidas"** (cantidad y monto), para que el inicio muestre lo urgente.
3. Corregir la prueba con un caso realista: un cliente con deuda previa y un cargo pagado a medias.
4. Opcional: calcular la fecha de vencimiento con el día de Venezuela. Esto cambia datos nuevos, no los viejos, y conviene probarlo primero en staging.

Riesgo del arreglo: bajo. Solo cambia una lectura y no toca datos.

## Pendiente

- Nada de la auditoría. Para volver a medir: `node tmp/auditar-deudas-por-vencer.mjs produccion` (solo lee).
