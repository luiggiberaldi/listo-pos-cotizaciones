# OP-2026-052 — Reabrir y anular despachos sin perder pagos (staging)

**Fecha:** 2026-11-24 · **Entorno de los arreglos:** solo staging (copia de pruebas) · **Producción:** solo se leyó, sin cambios
**Fallas que atiende:** G2, N1 y M6 (fase 2 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md)). Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md)

## En resumen

- **Anular un despacho que tiene un pago anotado (Zelle, efectivo, USDT…) ya no hace desaparecer ese dinero.** El sistema muestra los pagos y obliga a elegir qué pasó:
  - el cliente pagó, y el pago pasa a su saldo a favor;
  - el pago se anotará en el despacho que reemplaza a este;
  - el pago nunca se recibió (con motivo).
  La elección queda en la auditoría. En producción hay **378 despachos anulados con pagos anotados**, y hoy no hay manera de saber qué pasó con ese dinero.
- **Reabrir un despacho entregado que ya estaba pagado ya no esconde ni borra el pago.** El sistema muestra cuánto dinero está en juego y pide elegir:
  - dejarlo en la cuenta del cliente: se vuelve a aplicar solo cuando el despacho se entregue de nuevo;
  - pasarlo a saldo a favor.
  Antes, o se bloqueaba sin salida, o el pago quedaba como "pagado de más" sin que nadie lo decidiera.
- **Un abono ya no inventa deudas.** Si se elige un despacho que no tiene deuda, el abono se rechaza con un mensaje claro. Antes, el sistema creaba un cargo por su cuenta.
- **Pruebas:**
  - 14 de 14 contra staging y 6 de 6 en un navegador real.
  - 441 de 441 automáticas, y la app se arma bien.
  - Las pruebas anteriores (abonos 20/20 y saldo a favor 12/12) siguen pasando.
  **Nada está en producción.**

## 1. Qué estaba mal

| Falla | Qué pasaba |
|---|---|
| **G2** | Al reabrir un despacho entregado, el sistema borraba su deuda y todos sus movimientos. Si un **abono suelto** (sin despacho) la había pagado, ese dinero quedaba como "pagado de más" escondido. Si había un **abono enlazado**, se bloqueaba con "anule los cobros primero", sin salida, y el rol desarrollador podía saltarse ese bloqueo y borrar el abono |
| **N1** | Al anular un despacho pendiente, los pagos anotados en su forma de pago desaparecían sin aviso. El propio aviso decía "Entiendo que esta acción no revierte el pago registrado". Caso real: Angel Pineda, Zelle de $3.557,50 |
| **M6** | Si se abonaba a un despacho sin deuda registrada, el sistema **inventaba un cargo** ("auto-sanación") para poder recibir el abono |

### Medición en producción (solo lectura)

Despachos anulados con pagos anotados en su forma de pago:

| Forma de pago | Pagos | Monto anotado |
|---|---|---|
| Transf. / Pago Móvil | 71 | $1.176.015,13 |
| Efectivo $ | 143 | $121.783,65 |
| USDT | 44 | $103.311,03 |
| Zelle | 54 | $46.519,68 |
| Efectivo (sin moneda) | 27 | $24.292,58 |
| Efectivo Bs | 13 | $23.365,79 |
| Pago Móvil | 9 | $17.168,79 |
| Punto de Venta | 39 | $4.593,22 |
| Cruce y Transferencia | 6 | $2.122,24 |

En total son **378 despachos**. Muchos seguramente se rehicieron como despacho nuevo y el pago se anotó allí, pero el sistema no lo pregunta ni lo registra, así que no se puede confirmar. Las cifras en "Transf. / Pago Móvil" parecen estar en bolívares escritos como dólares; conviene revisarlas con administración.

## 2. Qué cambió para el operador

### Reabrir un despacho entregado ("Reabrir despacho")

Al abrir el modal, el sistema consulta qué dinero está en juego. Si hay:
- muestra cuánto, por ejemplo: "Al quitar su deuda ($634.00), $300.00 del cliente quedarían sin deuda que pagar";
- pide elegir una opción (el botón de confirmar queda desactivado hasta elegir):
  - **Dejar el dinero en la cuenta del cliente.** Los abonos no se borran. Cuando el despacho se vuelva a entregar, se aplican solos a su deuda. Mientras tanto se ven como "pagado de más".
  - **Pasarlo a saldo a favor del cliente.** El sobrante queda como saldo a favor.

Si no hay pagos, no pregunta nada.

### Anular un despacho pendiente ("Anular despacho")

Ahora se pide siempre un motivo (mínimo 10 caracteres), también desde la lista de despachos. Si el despacho tiene pagos anotados:
- se listan, por ejemplo: "Zelle: $500.00 (ref. Z-PANTALLA)";
- hay que elegir:
  - **El cliente pagó: pasarlo a saldo a favor.** Se crea saldo a favor por cada pago, con su método y referencia.
  - **El pago se anotará en el despacho que reemplaza a este.** No se mueve dinero; queda escrito en la auditoría.
  - **El pago nunca se recibió.** No se mueve dinero; el motivo queda en la auditoría junto con los pagos.

### Abonar a un despacho sin deuda

Ahora sale el mensaje: "Ese despacho no tiene deuda registrada. Registra el abono sin elegir despacho o revisa el despacho con administración."

## 3. Cómo funciona (explicado simple)

- **Consulta previa:** una función de la base (`cxc_pagos_en_juego_despacho`) calcula, para un despacho:
  - sus pagos anotados de dinero real (no cuentan crédito, cobro a destino, donación, saldo a favor ni préstamo);
  - sus abonos enlazados;
  - cuánto quedaría como "pagado de más" si se quita su deuda.
  La pantalla la consulta (`GET /api/despachos/pagos-en-juego`) y el servidor la vuelve a revisar al confirmar. Si falta la decisión, el servidor responde "elige qué hacer con ese dinero" (`DECISION_PAGOS_REQUERIDA`).
- **Reabrir** (`reabrir_despacho_con_pagos_staging`), todo en un solo paso, con el despacho y el cliente bloqueados:
  1. Desenlaza los abonos reales: no se borran, quedan como pagos del cliente con una nota "[despacho #N reabierto]".
  2. Si se eligió saldo a favor, pasa el sobrante de "abono" a "saldo a favor", empezando por los pagos sueltos más recientes. Si un pago cubre solo una parte, se divide y se conservan su fecha, método y referencia.
  3. Hace la reversión de siempre (inventario, deuda del despacho, comisión).
  4. Anota todo en la auditoría (`REABRIR_DESPACHO_PAGOS`), con copias de los abonos tocados.
- **Anular** (`anular_despacho_con_pagos_staging`), en un solo paso: aplica la decisión, cambia el estado a anulada con su motivo y anota en la auditoría (`ANULAR_DESPACHO_PAGOS`) los pagos, la decisión y el motivo.

## 4. Pruebas

**Contra staging** (`construacero-staging/scripts/op052-reabrir-anular-api.mjs`, cliente temporal con un despacho de $634): **14/14 bien**.

| # | Caso | Resultado |
|---|---|---|
| R1 | Reabrir con un pago suelto de $300 que cubre la deuda | 409 "elige qué hacer"; nada cambia |
| R2 | …eligiendo "saldo a favor" | Reabierto; saldo a favor $300; pagado de más $0; en la auditoría, con copia del pago original |
| R3 | Reabrir con un abono de $200 enlazado | Pide decisión (ya no bloquea sin salida) |
| R4 | …eligiendo "mantener" | El abono **no se borra**: queda sin despacho y visible como pagado de más ($200); en la auditoría |
| R5 | Reabrir sin pagos | No pregunta nada |
| A1 | Anular con un Zelle de $500 anotado | 409 con el pago; no anula |
| A2 | …eligiendo "saldo a favor" | Anulado; saldo a favor $500 con la referencia del Zelle; en la auditoría con el motivo |
| A3 | "No se cobró" con motivo corto | "Escribe el motivo de la anulación (mínimo 10 caracteres)." |
| A4 | "No se cobró" con motivo | Anulado, sin crear dinero, en la auditoría |
| A5 | Anular un despacho a crédito (sin pagos anotados) | No pregunta nada |
| M6 | Abonar a un despacho sin deuda | Rechazado; no se crea ningún cargo |

**Pantalla en navegador real** (`scripts/op052-reabrir-anular-pantalla.mjs`): **6/6 bien**.
- Reabrir: el modal muestra el dinero en juego y no deja confirmar sin decidir; con "saldo a favor" el despacho queda reabierto y aparecen $300 como saldo a favor.
- Anular: el modal lista el Zelle con su referencia y no deja confirmar sin decidir; con "saldo a favor" el despacho queda anulado y el Zelle pasa a saldo a favor.

Capturas en `tmp/op052/` (no se suben a GitHub).

**Repetición de pruebas anteriores:** abonos 20/20 (`op047-abonos-api.mjs`) y saldo a favor 12/12 (`op051-saldo-favor-api.mjs`).
**Automáticas:** 441/441 en 47 archivos (nuevo: `api/handlers/__tests__/despachoPagos052.test.js`). **Construcción de la app:** correcta.

Al terminar se borraron el cliente temporal (restos 0) y el operador temporal (HTTP 200).

## 5. Archivos cambiados (staging)

- `construacero-staging/supabase/migrations/304_staging_despacho_pagos_al_reabrir_anular.sql` (+ `_rollback.sql`): funciones `cxc_es_pago_real`, `cxc_pagos_en_juego_despacho`, `reabrir_despacho_con_pagos_staging` y `anular_despacho_con_pagos_staging`. **Aplicada en staging y verificada.**
- `construacero-staging/api/handlers/despachos.js`:
  - reemplaza el bloqueo viejo de "cobros reales" por la decisión sobre los pagos;
  - reabrir usa la función nueva;
  - anular un pendiente con pagos usa la función nueva y guarda el motivo;
  - nueva consulta `handlePagosEnJuegoDespacho`.
- `construacero-staging/worker.js`: ruta `GET /api/despachos/pagos-en-juego`.
- `construacero-staging/api/handlers/cxc.js`: se quita la auto-sanación (M6).
- `construacero-staging/src/components/despachos/DevolverAnularModal.jsx`:
  - consulta los pagos en juego al servidor (antes leía la tabla directamente);
  - pide la decisión;
  - nuevo texto de confirmación;
  - muestra el error dentro del modal.
- `construacero-staging/src/components/despachos/DespachoCard.jsx`, `src/views/DespachosView.jsx` y `src/hooks/useDespachos.js`: pasan la decisión al servidor. Anular desde la lista usa el mismo modal, con motivo.
- Pruebas: `api/handlers/__tests__/despachoPagos052.test.js`, `scripts/op052-reabrir-anular-api.mjs` y `scripts/op052-reabrir-anular-pantalla.mjs`.

## 6. Pendiente

- **No está en producción.** Necesita un caso propio, las migraciones 301 a 304 en producción y tu aprobación.
- **Edición profunda (parte de G2):** que no borre créditos de devolución ni consumos de saldo a favor ajenos, y que avise si el despacho tenía abonos. Queda para el siguiente caso.
- Con "mantener", los abonos desenlazados no se vuelven a enlazar solos al despacho cuando se entrega de nuevo. Se aplican por la regla de reparto (del cargo más viejo al más nuevo), así que el saldo total del cliente queda bien.
- Los 378 despachos anulados con pagos anotados que ya existen en producción no se tocaron. Revisarlos uno por uno sería trabajo de datos con administración.
- Sin publicar en GitHub: no hay solicitud de cambio ni commit.
