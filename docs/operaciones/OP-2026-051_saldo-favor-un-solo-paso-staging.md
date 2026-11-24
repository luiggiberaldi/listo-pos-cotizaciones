# OP-2026-051 — Cargar, devolver y cruzar saldo a favor en un solo paso (staging)

**Fecha:** 2026-11-23 · **Entorno:** solo staging (copia de pruebas) · **Producción:** sin tocar
**Sigue a:** [OP-2026-050](OP-2026-050_abonos-un-solo-paso-y-auditoria-completa.md), que hizo lo mismo con los abonos. Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md) (falla N15)

## En resumen

- **"Cargar Crédito", "Devolver Crédito" y "Cruzar Saldo" ahora funcionan igual que el abono.** Cada uno se guarda en un solo paso dentro de la base de datos, con turno por cliente, y la anotación de auditoría se guarda en ese mismo paso.
- **Ya no se puede devolver ni cruzar dos veces el mismo saldo a favor.** Antes, dos personas a la vez (o un reintento) podían devolver al cliente más dinero del que tenía a favor. Probado en staging: solo se acepta una; la otra recibe "El cliente no tiene saldo a favor disponible".
- **Doble clic y reintentos no duplican.** Si se carga o devuelve el mismo monto al mismo cliente en menos de 15 minutos, la pantalla pregunta "¿Es otro movimiento?".
- **Todo queda en la auditoría**, también los intentos rechazados, con su motivo. Los montos inválidos reciben un mensaje claro.
- **Pruebas:** 12 de 12 contra staging, 12 de 12 en un navegador real, 431 de 431 automáticas, y la app se arma bien. **Nada está en producción.**

## Qué estaba mal (N15)

Los tres formularios del saldo a favor tenían el mismo problema que tenía el abono (I2 y G4):

| Problema | Riesgo |
|---|---|
| Leían el saldo, comparaban y guardaban en pasos separados | Dos devoluciones a la vez del saldo a favor completo se aceptaban las dos: se le devolvía al cliente el doble |
| Sin huella de operación | Un reintento o un doble clic podía guardar dos veces una carga o una devolución |
| La anotación de auditoría iba aparte, después de guardar | Si fallaba, el dinero se movía sin rastro |
| Los rechazos no se anotaban | No se sabía quién intentó qué |
| Monto inválido | Mensaje técnico o "Monto inválido" sin más |

## Qué cambió para el operador

| Situación | Ahora (staging) |
|---|---|
| Cargar o devolver el mismo monto al mismo cliente en menos de 15 minutos | Aviso amarillo "¿Es otro movimiento?" con **Sí, es otro: registrarlo** / **No, cancelar** |
| Doble clic o reintento tras un fallo | Se guarda una sola vez |
| Devolver más que el saldo a favor | "El monto ($X) es mayor que el saldo a favor del cliente ($Y). Revisa el monto." |
| Cruzar sin deuda o sin saldo a favor | "El cliente no tiene deuda pendiente para cruzar." / "El cliente no tiene saldo a favor disponible." |
| El servidor falla | Aviso rojo en el formulario (igual que en OP-049); lo escrito se conserva |

El cruce no pregunta "¿Es otro movimiento?": es un movimiento interno, y los saldos ya ponen el límite. Sí tiene huella, así que el doble clic no lo duplica.

## Cómo funciona (explicado simple)

Una sola función dentro de la base (`cxc_saldo_favor_atomico`) atiende las tres operaciones. Es como una ventanilla con turno por cliente:
1. Mientras se atiende un movimiento del cliente, el siguiente espera.
2. Si la huella ya existe, es un reintento: se devuelve lo que ya estaba guardado.
3. En carga y devolución, si hay un movimiento igual en los últimos 15 minutos, se pregunta antes de guardar.
4. Se calculan la deuda y el saldo a favor reales, y se comparan con el monto.
5. Se guardan el movimiento y su anotación de auditoría juntos: o quedan los dos o ninguno.

Anotaciones nuevas en la auditoría:
- `SALDO_FAVOR_RECHAZADO`, `DEVOLUCION_SALDO_RECHAZADA` y `CRUCE_SALDO_FAVOR_RECHAZADO`: intentos que no se guardaron, con motivo, monto, forma de pago y referencia.
- Las anotaciones de siempre (`REGISTRAR_SALDO_FAVOR`, `REGISTRAR_DEVOLUCION_CREDITO`, `CRUZAR_SALDO_FAVOR`) ahora traen el movimiento, los saldos de antes y de después, la forma de pago, la referencia y la huella.

## Pruebas

**Contra staging** (`construacero-staging/scripts/op051-saldo-favor-api.mjs`, cliente temporal con deuda $634): **12/12 bien**.

| # | Caso | Resultado |
|---|---|---|
| S1 | Cargar $200 | Se guarda; saldo a favor $200 |
| S2 | La misma carga otra vez | 409 "¿Es otro movimiento?"; no guarda |
| S3 | Confirmada | Se guarda; $400 |
| S4 | Reintento con la misma huella | Una sola carga |
| S5 | Monto "abc" | "El monto debe ser un número (llegó: "abc")." |
| S6 | Devolver $10.000 con $415 a favor | "…es mayor que el saldo a favor del cliente ($415.00)" |
| S7 | Dos devoluciones a la vez de todo el saldo a favor | **Una aceptada**; la otra: "El cliente no tiene saldo a favor disponible." |
| S8 | Cruzar $100 | Deuda $634 → $534; saldo a favor $300 → $200 |
| S9 | Dos cruces a la vez de todo el saldo a favor | **Uno aceptado**; deuda $334, saldo a favor $0 |
| S10 | Cruzar sin saldo a favor | Mensaje claro |
| S11 | Auditoría | Los 7 movimientos guardados tienen su anotación; los rechazos de los tres tipos quedaron anotados con su motivo |

**Automáticas:** 431/431 en 46 archivos (nuevo: `api/handlers/__tests__/saldoFavorAtomico051.test.js`, 29 pruebas). **Construcción de la app:** correcta.

### Pantalla (navegador real)

`construacero-staging/scripts/op051-saldo-favor-pantalla.mjs`, en Chromium contra staging: **12/12 bien**.

- **Cargar Crédito:**
  - Una carga normal se guarda y el formulario queda vacío.
  - Si se repite el mismo monto, aparece "¿Es otro movimiento?". Mientras se decide no se guarda nada; con "No" tampoco; con "Sí" se guarda una.
  - El doble clic guarda una sola carga.
  - Si el servidor falla, sale el aviso rojo, no se guarda nada y lo escrito se conserva.
- **Devolver Crédito:** una devolución normal se guarda; al repetirla aparece el aviso y con "Sí" se guarda una.
- **Cruzar Saldo:** el doble clic guarda un solo cruce.

Capturas en `tmp/op051/` (no se suben a GitHub). En `01-carga-posible-duplicado.png` se ve el aviso amarillo con sus dos botones y el botón de confirmar desactivado mientras se decide.

Al terminar se borraron el cliente temporal (restos 0) y el operador temporal (HTTP 200; no queda en la base).

## Archivos cambiados (staging)

- `construacero-staging/supabase/migrations/303_staging_cxc_saldo_favor_atomico.sql` (+ `_rollback.sql`): función `cxc_saldo_favor_atomico`. **Aplicada en staging y verificada.**
- `construacero-staging/api/handlers/cxc.js`: las tres operaciones pasan por `movimientoSaldoFavor`, que valida, llama a la función de un solo paso y anota los rechazos. `leerMontoAbono` acepta una etiqueta para el mensaje.
- `construacero-staging/src/hooks/useCuentasCobrar.js`: las tres llamadas mandan la huella (y la confirmación de repetido en carga y devolución).
- `construacero-staging/src/components/clientes/FichaClienteModal.jsx`: `useClaveOperacion` (huella por operación) y `AvisoPosibleRepetido` en "Cargar Crédito" y "Devolver Crédito"; huella en "Cruzar Saldo"; botones con `data-testid` para las pruebas.
- Pruebas: `api/handlers/__tests__/saldoFavorAtomico051.test.js`, `scripts/op051-saldo-favor-api.mjs` y `scripts/op051-saldo-favor-pantalla.mjs`.

## Pendiente

- **No está en producción.** Necesita un caso propio, las migraciones 301, 302 y 303 en producción y tu aprobación.
- Siguen sin el tratamiento de "un solo paso" estos caminos:
  - "Revertir abono".
  - Las devoluciones de mercancía y los cambios de pago del despacho (fases 2 y 3 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md)).
- Sin publicar en GitHub: no hay solicitud de cambio ni commit.
