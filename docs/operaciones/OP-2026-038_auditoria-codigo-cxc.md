# OP-2026-038 — Auditoría de código del flujo completo de Cuentas por Cobrar

**Fecha:** 23 de noviembre de 2026
**Tipo:** revisión (auditoría de código), solo lectura
**Alcance:** crear deuda al despachar, registrar pagos (abonos), saldo a favor, cruces, devoluciones, anulaciones, reversión de pagos, cálculo del saldo, pantallas e informes de CxC y aviso diario de cobranza.
**Cambios hechos:** ninguno. Cada hallazgo se comprobó contra el código y, cuando fue posible, contra los datos reales de producción (solo lectura).
**Sigue de:** [OP-2026-037](OP-2026-037_auditoria-reporte-carteras-abonos-cod.md) (los casos de REYKAR, Decoraciones Encendo y los $4.969,71 escondidos).

## En resumen

- **La suma de las deudas está bien hecha:** cargos menos pagos, y cuadra al centavo en todos los clientes.
- **El problema está en cómo se registran y borran los movimientos.** Hay **4 fallas graves** que pueden **esconder dinero** o **contar dos veces un pago**. Las de los casos reales de OP-2026-037 salen de aquí:
  1. **Las devoluciones no ven los pagos manuales** y vuelven a descontar una factura que ya estaba pagada (Decoraciones Encendo, $2.144).
  2. **Anular un despacho borra su deuda aunque ya se haya pagado** con un pago manual. El pago queda huérfano y escondido.
  3. **Cuando un cliente paga de más, el sistema lo esconde:** el saldo se queda en $0 y el excedente no pasa a "saldo a favor". Hoy son $4.969,71 en 16 clientes.
  4. **Un pago manual se puede registrar dos veces** sin ninguna advertencia (posible caso de REYKAR, $1.000).
- También hay fallas medianas: historiales con saldos viejos, historial cortado en 100 movimientos, y que **cualquier vendedor podría leer las deudas de todos los clientes** si accede a la base de datos por fuera de la pantalla.
- **Recomendación:** arreglar primero 1, 2 y 3 (son las que pierden dinero de vista), luego 4. Ninguna requiere borrar datos. Plan sugerido al final.

## Cómo funciona hoy (en una frase)

Cada despacho a crédito o con cobro a destino crea un **cargo** (deuda). Cada pago crea un **abono**. La deuda del cliente es "cargos menos abonos". Los pagos que se cargan a mano desde la ficha del cliente **nunca quedan enlazados a un despacho**: hoy son 482 de 624 pagos. Para saber qué despacho está pagado, la pantalla reparte esos pagos del despacho más viejo al más nuevo.

## Hallazgos

### 🔴 Graves (esconden dinero o lo cuentan dos veces)

**G1. Las devoluciones ignoran los pagos manuales y descuentan dos veces.**
- Dónde: `api/handlers/despachos.js` líneas 2916–2929.
- Qué pasa: para saber cuánto debe todavía el despacho, la devolución solo mira los pagos **enlazados** a ese despacho. Si el cliente lo pagó con un pago manual (lo normal), el sistema cree que el despacho sigue debiéndose completo. Entonces aplica la devolución como **otro pago** contra esa deuda, en lugar de darle **saldo a favor** al cliente.
- Efecto: el dinero de la devolución desaparece de la vista. Si el cliente no tiene otras deudas, queda escondido; si las tiene, se las baja sin que nadie lo note.
- Caso real: Decoraciones Encendo, despacho #1863. Se pagó con un "Cruce – NO PROCEDE" manual de $2.144 y luego la devolución descontó otros $2.144. Eso esconde una deuda real de $195 y deja $1.949 ocultos.

**G2. Anular o devolver un despacho borra su deuda aunque ya se haya pagado.**
- Dónde: la función de la base de datos `revertir_entrega_finanzas_atomica` (la protección de las líneas 44–63 solo revisa pagos enlazados) y `api/handlers/despachos.js` líneas 1120–1135.
- Qué pasa:
  - Al anular un despacho **entregado**, el sistema revisa si tiene pagos antes de borrar la deuda, pero solo mira los enlazados. Un pago manual no lo ve: borra la deuda y el pago queda **huérfano**, como si el cliente hubiera pagado de más.
  - Al anular un despacho **despachado** (todavía no entregado), el camino viejo borra **todo** lo enlazado al despacho, incluso pagos reales, **sin ninguna protección**. Ese dinero cobrado desaparece del historial.
- Efecto: pagos que quedan escondidos, o que desaparecen del registro.

**G3. Cuando un cliente paga de más, el excedente se esconde.**
- Dónde: el cálculo del saldo en la base de datos (`trg_recalcular_saldo_pendiente`, el `GREATEST(0, …)`) y su copia en `api/lib/cxcUtils.js` línea 46.
- Qué pasa: si los pagos superan las deudas, el saldo se queda en $0 y el sobrante **no se muestra en ningún lado**: el "saldo a favor" se calcula aparte y no lo incluye. La próxima compra a crédito del cliente aparecerá más baja de lo real sin explicación.
- Efecto hoy: **$4.969,71 escondidos en 16 clientes**. Es la consecuencia visible de G1 y G2.

**G4. Un pago manual se puede registrar dos veces sin aviso.**
- Dónde: `src/components/clientes/FichaClienteModal.jsx` líneas 66–72 y `api/handlers/cxc.js` líneas 28–51.
- Qué pasa: la protección contra duplicados solo se activa si la pantalla manda una "clave única de operación". La ficha del cliente **no la manda**. Si la conexión falla después de guardar y el operador vuelve a pulsar, o si carga dos veces el mismo pago, el sistema acepta ambos sin preguntar.
- Caso posible: REYKAR, dos pagos de $1.000 con 32 segundos de diferencia y la misma nota ("ENZO CONFIRMO").

### 🟠 Importantes

**I1. Los pagos manuales no se pueden enlazar a un despacho.** El formulario de la ficha del cliente no tiene dónde elegir el despacho. Por eso 482 de 624 pagos están sin enlace, y G1 y G2 los pasan por alto. Es la raíz común de los graves.

**I2. Registrar un pago no está protegido contra dos operadores al mismo tiempo.** `api/handlers/cxc.js` líneas 57–125: primero lee la deuda, luego valida y al final guarda, en pasos separados. Si dos personas registran un pago del mismo cliente al mismo tiempo, las dos validaciones pasan con la deuda vieja y el cliente puede quedar pagado de más. Lo mismo pasa al cruzar saldo a favor (líneas 380–450).

**I3. "Revertir pago" borra el movimiento para siempre.** `api/handlers/cxc.js` (`handleRevertirAbono`) borra la fila; solo queda una nota en la auditoría. Además permite revertir un pago de tipo "Devolución": la mercancía queda devuelta en inventario, pero la deuda revive.

**I4. Cualquier vendedor puede leer la cartera de todos los clientes.** En la base de datos, la regla de acceso `isolation_cuentas_por_cobrar` deja leer todo a cualquier sesión de la cuenta. Esa regla se suma a la de "vendedor solo ve sus clientes" y la anula. La pantalla filtra por vendedor, pero alguien que consulte la base de datos directamente con su sesión ve todo. No pueden **modificar** nada: eso está bien bloqueado.

### 🟡 Medianos y menores

**M1. El historial del cliente muestra saldos viejos.** La línea "Saldo: $…" de cada movimiento es una foto del momento en que se guardó. Si después se revierte o se edita un movimiento anterior, esa foto no se corrige. Hoy hay **59 movimientos de 25 clientes** con un saldo mostrado que no coincide con el real. (`FichaClienteModal.jsx` línea 1087).

**M2. El historial se corta en 100 movimientos.** `src/hooks/useCuentasCobrar.js` línea 28. REYKAR ya tiene 124: sus 24 movimientos más viejos no se ven en la ficha.

**M3. Despachos con dos deudas (crédito + cobro a destino).** Si un pago está enlazado al despacho, se aplica a la primera deuda que encuentra, que puede no ser la correcta. Eso puede marcar como "vencida" la parte equivocada. Pasa en 7 despachos. (`useCuentasCobrar.js` línea 114, `src/utils/cobranza.js` línea 44).

**M4. El mismo cálculo está copiado en varios lugares.**
- El reparto "del despacho más viejo al más nuevo" existe 3 veces: dos en `useCuentasCobrar.js` y una en `src/utils/cobranza.js`.
- El saldo se calcula 2 veces: en la base de datos y en `api/lib/cxcUtils.js`.
- Si alguien corrige una copia y olvida las otras, la pantalla, el reporte y el aviso diario van a dar números distintos.

**M5. Si falla el recálculo del saldo, nadie se entera.** `api/lib/cxcUtils.js` captura el error y sigue. Hoy no hace daño, porque la base de datos vuelve a calcular el saldo por su cuenta.

**M6. "Auto-sanación" de cobros a destino viejos.** `api/handlers/cxc.js` líneas 62–110: si un pago enlazado no encuentra deuda, **inventa** una deuda con el monto del cobro a destino, o con el del propio pago si no lo encuentra. Nunca se ha activado en producción (0 casos), pero es una puerta peligrosa. Conviene quitarla.

**M7. Lecturas sin paginar.** El reporte de cartera trae los movimientos en lotes de 50 clientes, sin paginar. Con el tamaño actual (353 movimientos) no hay problema, pero si un lote pasa de 1.000 filas, el reporte se cortaría sin avisar.

## Plan sugerido (en orden)

| Paso | Qué | Arregla | Riesgo |
|---|---|---|---|
| 1 | Hacer **visible** el pago de más: mostrar "pagado de más: $X" en la ficha y en el reporte, y una lista de clientes afectados para que administración decida caso por caso. | G3 | Bajo: solo muestra, no cambia datos. |
| 2 | Que las devoluciones calculen lo pendiente del despacho con el **mismo reparto que usa la pantalla** (incluyendo pagos manuales). Si ya estaba pagado, la devolución va a saldo a favor. | G1 | Medio |
| 3 | Antes de anular o devolver un despacho, revisar también los pagos manuales que lo cubren según ese reparto. Si existen, avisar y convertir ese dinero en saldo a favor en lugar de dejarlo huérfano. Quitar el camino viejo que borra todo sin protección. | G2 | Medio |
| 4 | Ficha del cliente: mandar la clave única de operación y avisar "ya hay un pago igual hace X minutos, ¿seguro?". | G4 | Bajo |
| 5 | Agregar al formulario de pago un selector opcional de despacho. | I1 | Bajo |
| 6 | Pasar el registro de pagos y cruces a una sola operación dentro de la base de datos. | I2 | Medio |
| 7 | Revertir = anular con marca, no borrar; y no permitir revertir pagos de tipo "Devolución". | I3 | Bajo |
| 8 | Ajustar la regla de lectura para que cada vendedor vea solo a sus clientes. | I4 | Medio: hay que probar todas las pantallas. |
| 9 | Menores: calcular el saldo de cada línea al mostrarla, paginar el historial, unificar el reparto en una sola función, quitar la auto-sanación. | M1–M7 | Bajo |

Todo se haría primero en **staging** (la copia de pruebas) y después en producción, como siempre.

## Cómo se comprobó

- Lectura del código: `api/handlers/cxc.js`, `api/handlers/despachos.js` (anulación, devolución, entrega), `api/lib/cxcUtils.js`, `api/lib/cobranza.js`, `src/hooks/useCuentasCobrar.js`, `src/utils/cobranza.js`, `src/components/clientes/FichaClienteModal.jsx` y `src/services/pdf/cxcPDF.js`.
- Funciones y reglas de acceso **instaladas en producción** (no solo las del repositorio): `trg_recalcular_saldo_pendiente`, `revertir_entrega_finanzas_atomica`, `current_operator_context` y las reglas de acceso de la tabla `cuentas_por_cobrar`. También se comprobó que los usuarios de la aplicación no pueden escribir directamente en esa tabla.
- Cifras sacadas de producción en modo solo lectura: 482 pagos sin enlace, 16 clientes y $4.969,71 en pagos de más, 59 saldos de historial desfasados, 7 despachos con dos deudas, 0 casos de auto-sanación.

## Pendiente / sin verificar

- No se probó ningún arreglo: este documento solo diagnostica.
- No se pudo confirmar desde la base de datos qué despacho anulado dejó huérfano cada pago de mayo (Adalberto Rojas, A_40, Carlos Escalona). Puede ser G2 o deudas del sistema anterior que nunca se cargaron.
- Guardado en GitHub: pendiente (ver el registro).
