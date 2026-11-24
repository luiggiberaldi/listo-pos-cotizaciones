# OP-2026-054 — Devolver mercancía donada ya no da crédito (staging)

**Fecha:** 2026-11-24 · **Entorno de los arreglos:** solo staging (copia de pruebas) · **Producción:** sin cambios
**Fallas que atiende:** N2 (grave); se vuelven a comprobar N6 y G1 (fase 3 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md)). Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md)

## En resumen

- **Devolver algo que se regaló ya no le da dinero al cliente.** La mercancía vuelve al inventario, pero la parte donada no se convierte en saldo a favor, ni en menos deuda, ni en reembolso. Antes se valoraba a precio completo, como si la hubiera pagado. Pasó con Construacero Los Guayos: $805 que no le corresponden ([OP-046](OP-2026-046_donaciones-y-registro-de-abonos.md)).
- **Si se quiere dar crédito de todas formas**, solo administración, jefe o desarrollador pueden autorizarlo, con motivo. Queda en la auditoría.
- **La pantalla de devolución lo avisa** antes de confirmar: "Este despacho fue donado…", la parte donada sin crédito y el balance correcto.
- **Las devoluciones ya quedan en la auditoría** (N6, comprobado), y el caso Encendo de G1 sigue dando el resultado correcto con todo lo nuevo.
- **Pruebas:**
  - 8 de 8 contra staging y 6 de 6 en un navegador real.
  - Repetición de G1: 16 de 16.
  - 458 de 458 automáticas, y la app se arma bien.
  **Nada está en producción**, y Los Guayos no se tocó (es corrección de datos, pendiente de la decisión de administración).

## 1. La regla

- **Parte donada del despacho** = monto "Donación" de su forma de pago ÷ total de su forma de pago. Ejemplos:
  - $1.350 donados de $1.350 = 100 %;
  - $317 donados y $317 a crédito = 50 %.
- De lo que se devuelve, **esa parte no cuenta como dinero del cliente**. El resto se trata como siempre: baja la deuda, queda como saldo a favor o se reembolsa.
- El total del despacho y el monto "Donación" bajan en la parte donada devuelta, para que los reportes de donaciones no cuenten mercancía que regresó.
- Con autorización (rol + motivo de 10 caracteres o más) se acredita todo, como antes, y queda anotado como `DEVOLUCION_DONACION_ACREDITADA`.
- La misma regla la usan la pantalla y el servidor (`src/utils/donacionDevolucion.js`), así lo que se ve es lo que se guarda.

Limitación: si un despacho es donado a medias, no se sabe cuáles artículos fueron los donados, así que se aplica la proporción.

## 2. Qué ve el operador

En "Devolución Parcial" de un despacho donado aparece un recuadro amarillo:
- "Este despacho fue donado. Lo devuelto vuelve al inventario, pero la parte donada no da crédito ni reembolso al cliente."
- "Parte donada (sin crédito): -$340.00", y el **Balance Neto** queda en $0.00.
- Solo para administración, jefe o desarrollador: la casilla "Autorizo dar crédito por lo donado (queda en la auditoría)". Al marcarla se pide el motivo y el balance pasa a -$340.00 (crédito).

## 3. Cómo funciona

- El servidor calcula la parte acreditable y se la pasa a la devolución de siempre como "total devuelto". Los artículos se registran con su valor real.
- Si el despacho tiene donación, la devolución pasa por `devolucion_con_donacion_staging` (migración 306). En la misma transacción:
  1. hace la devolución de siempre;
  2. baja el total del despacho y la "Donación" en la parte donada devuelta;
  3. anota `DEVOLUCION_DONACION_SIN_CREDITO` (o `…_ACREDITADA`) con el valor real, lo acreditado, la parte donada y la forma de pago anterior.
- Una repetición de la misma devolución (misma huella) no vuelve a ajustar nada.

## 4. Pruebas

**Contra staging** (`construacero-staging/scripts/op054-devolucion-donacion-api.mjs`): **8/8 bien**.

| # | Caso | Resultado |
|---|---|---|
| D1 | Despacho 100 % donado: devolver 2 sacos de cemento ($19,60) | Sin saldo a favor ni crédito; total y "Donación" del despacho $634 → $614,40; anotado `DEVOLUCION_DONACION_SIN_CREDITO` |
| D1 | (N6) Anotación de la devolución | `DEVOLUCION_PARCIAL` guardada con categoría DESPACHO (antes la base la rechazaba) |
| D2 | Autorizar crédito con motivo corto | Rechazado: "…mínimo 10 caracteres" |
| D2 | Autorizar con motivo | Saldo a favor $9,80; anotado `DEVOLUCION_DONACION_ACREDITADA` con el motivo |
| D3 | Despacho 50 % donado: devolver $17 | La deuda baja solo $8,50 ($317 → $308,50) |
| D4 | Como Los Guayos #4800: devolver $8,50 donados y llevarse $16,90 | Se cobran los **$16,90 completos** (antes se habrían cobrado $8,40) |

En D4 se descontaron 10 unidades de "ALAMBRE GALVANIZADO CALIBRE 18" del inventario de staging: es un intercambio real de prueba.

**Pantalla** (`scripts/op054-devolucion-donacion-pantalla.mjs`): **6/6 bien**. Aparece el aviso, se ve la parte donada sin crédito, el balance queda en $0,00, la autorización pide motivo y cambia el balance a -$340,00, y no hay errores en la página. Capturas en `tmp/op054/`.

**G1 de nuevo** (`scripts/verify-op042-cxc-staging.mjs`, escenario de OP-042): **16/16**. En el caso Encendo, la devolución confirmando el Cruce deja la deuda del despacho en $294 y el saldo a favor en $0.

**Automáticas:** 458/458 en 49 archivos (nuevo: `src/utils/__tests__/donacionDevolucion.test.js`). **Construcción de la app:** correcta.

## 5. Archivos cambiados (staging)

- `construacero-staging/src/utils/donacionDevolucion.js` (nuevo): la regla.
- `construacero-staging/supabase/migrations/306_staging_devolucion_donacion.sql` (+ `_rollback.sql`): funciones `cxc_restar_donacion_fp` y `devolucion_con_donacion_staging`. **Aplicada en staging y verificada.**
- `construacero-staging/api/handlers/despachos.js`: la devolución usa la parte acreditable, valida la autorización y devuelve cuánto no dio crédito.
- `construacero-staging/src/components/despachos/DevolucionParcialModal.jsx` y `src/hooks/useDespachos.js`: aviso, autorización y envío.
- Pruebas: `src/utils/__tests__/donacionDevolucion.test.js`, `scripts/op054-devolucion-donacion-api.mjs` y `scripts/op054-devolucion-donacion-pantalla.mjs`.

## 6. Pendiente

- **No está en producción.** Necesita un caso propio, las migraciones 301 a 306 y tu aprobación.
- **Los Guayos:** según OP-046, debería quedar con $1.700,50 de deuda y $0 a favor. Es corrección de datos y necesita la decisión de administración.
- Sin publicar en GitHub: no hay solicitud de cambio ni commit.
