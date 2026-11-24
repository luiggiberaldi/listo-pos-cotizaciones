# OP-2026-053 — Edición profunda de despachos sin borrar créditos ni esconder pagos (staging)

**Fecha:** 2026-11-24 · **Entorno de los arreglos:** solo staging (copia de pruebas) · **Producción:** solo se leyó, sin cambios
**Falla que atiende:** G2, la parte de la edición profunda. Con esto, G2 queda completa en staging (fase 2 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md)). Sigue a [OP-2026-052](OP-2026-052_reabrir-anular-sin-perder-pagos-staging.md). Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md)

## En resumen

- **"Editar Ítems (Admin)" ya no borra saldos a favor ajenos.** Antes, al guardar la edición de un despacho aprobado, el sistema borraba **cualquier** crédito del despacho si no había "vuelto a favor", incluido el saldo a favor de una devolución o de un intercambio.
- **Si la edición deja pagos sin deuda, ahora pregunta qué hacer.** Por ejemplo, al pasar de crédito a contado cuando el cliente ya había abonado, la pantalla pregunta "¿Qué hacemos con ese dinero?": dejarlo en la cuenta del cliente o pasarlo a saldo a favor. Antes quedaba como "pagado de más" sin aviso.
- **No deja usar más saldo a favor del que el cliente tiene**, ni quitar un vuelto que el cliente ya gastó.
- **Todo se hace en un solo paso y queda en la auditoría** con el antes y el después: artículos y cuenta del cliente, juntos. Si algo falla, no se guarda nada; antes eran pasos sueltos sin anotación.
- **Pruebas:**
  - 7 de 7 contra staging y 4 de 4 en un navegador real.
  - 449 de 449 automáticas, y la app se arma bien.
  - Repetición de todas las pruebas anteriores, abajo.
  **Nada está en producción.**

## 1. Qué estaba mal

Al guardar "Editar Ítems (Admin)" en un despacho **aprobado** ("despachada", que ya tiene su deuda registrada), el servidor ajustaba la cuenta del cliente en pasos sueltos, después de guardar los artículos:

| Problema | Consecuencia |
|---|---|
| Buscaba "el crédito del despacho" sin fijarse de dónde venía y lo borraba si no había vuelto a favor | Se perdía el saldo a favor de una devolución o de un intercambio. En producción hay 16 créditos de devolución o intercambio enlazados a despachos que podían perderse así (12 por intercambio y 4 para reembolso) |
| Si la deuda bajaba o desaparecía (por ejemplo, de crédito a contado), la borraba o reducía sin mirar los abonos | El pago del cliente quedaba "pagado de más", escondido |
| Creaba el consumo de saldo a favor aunque el cliente no tuviera saldo suficiente | Saldo a favor "negativo" que el sistema recortaba a cero sin avisar |
| Pasos sueltos, sin auditoría y con los errores ignorados | Si un paso fallaba, los artículos quedaban cambiados y la cuenta a medias, sin rastro |

## 2. Qué cambió para el operador

- Si el cambio deja pagos del cliente sin deuda, al pulsar **Guardar Cambios** aparece la pregunta "¿Qué hacemos con ese dinero?", con el monto. Por ejemplo: "Con este cambio, $300.00 que el cliente ya pagó quedarían sin deuda". Las opciones son:
  - **Dejarlo en la cuenta del cliente.** Los abonos no se borran; se ven como "pagado de más" y se aplican solos a la próxima deuda.
  - **Pasarlo a saldo a favor del cliente.**
  - **Cancelar (no guardar todavía).**
- Si se pide pagar con más saldo a favor del disponible: "El cliente solo tiene $100.00 de saldo a favor disponible. Ajusta el pago con saldo a favor."
- Si se intenta quitar un vuelto que ya se usó: "El vuelto que quedó como saldo a favor ya se usó…".
- Si no hay pagos en juego, todo funciona igual que antes.

## 3. Cómo funciona (explicado simple)

Una sola función de la base (`editar_despacho_profundidad_con_cxc_staging`) hace todo en un paso, con el despacho y el cliente bloqueados:
1. Edita los artículos con la función de siempre.
2. Si el despacho está aprobado, ajusta **solo los movimientos que le pertenecen**, reconocidos por su tipo y su descripción:
   - las deudas a crédito y de cobro a destino;
   - el consumo de saldo a favor ("Pago con Saldo a Favor…");
   - el crédito por vuelto ("Excedente de pago en Despacho…").
   
   Los créditos de devolución o intercambio, los abonos de devolución y los abonos reales **no se tocan**.
3. Si quedarían pagos sin deuda, exige la decisión. Con "saldo a favor", el sobrante pasa de abono a saldo a favor, empezando por los abonos de ese despacho y conservando su fecha, método y referencia.
4. Anota en la auditoría (`EDICION_PROFUNDA_CXC`) el antes, el después, lo que pedía la forma de pago y lo que se pasó a saldo a favor.

## 4. Pruebas

**Contra staging** (`construacero-staging/scripts/op053-edicion-profunda-api.mjs`, despacho aprobado de $634 a crédito): **7/7 bien**.

| # | Caso | Resultado |
|---|---|---|
| E1 | Editar un despacho que tiene $100 de saldo a favor por devolución | El crédito de la devolución **sigue**; saldo a favor $100 |
| E2 | Pasar a contado con un abono de $300 ya registrado | 409 "…$300.00 que el cliente ya pagó quedarían sin deuda…"; **no se guarda nada** (la deuda y la forma de pago siguen igual) |
| E3 | …eligiendo "saldo a favor" | Deuda del despacho eliminada; el abono pasa a saldo a favor ($100 + $300 = $400); pagado de más $0. Queda en la auditoría con el antes, el después y el pago pasado a saldo a favor |
| E4 | Pasar a contado con un abono enlazado de $200, eligiendo "mantener" | El abono no se borra; se ve como pagado de más ($200) |
| E5 | Pagar $300 con saldo a favor teniendo $100 | "El cliente solo tiene $100.00…"; no se guarda nada |
| E6 | Lo mismo, con saldo a favor suficiente | Deuda $334, consumo de saldo a favor $300, saldo a favor que queda $200 |

**Pantalla en navegador real** (`scripts/op053-edicion-profunda-pantalla.mjs`): **4/4 bien**.
- Aparece la pregunta con el monto.
- "Cancelar" no reenvía nada.
- Al elegir "saldo a favor", la pantalla reenvía el guardado con esa decisión, el servidor real de staging lo acepta y el modal se cierra.

La **primera** respuesta del servidor se simuló, para no tener que cambiar la forma de pago con el ratón; lo que hace el servidor con datos reales lo prueba la tabla de arriba. Capturas en `tmp/op053/`.

**Automáticas:** 449/449 en 48 archivos (nuevo: `api/handlers/__tests__/edicionProfundaCxc053.test.js`). **Construcción de la app:** correcta.

**Repetición de todas las pruebas contra staging:** ver apartado 4.1.

### 4.1 Repetición

Con el cliente de prueba recién creado antes de cada grupo, todo sigue bien:

| Prueba | Resultado |
|---|---|
| Abonos (`op047-abonos-api.mjs`, OP-047/049/050) | 20/20 |
| Saldo a favor (`op051-saldo-favor-api.mjs`, OP-051) | 12/12 |
| Reabrir y anular (`op052-reabrir-anular-api.mjs`, OP-052) | 14/14 |
| Edición profunda (`op053-edicion-profunda-api.mjs`, este caso) | 7/7 |

Al terminar se borraron el cliente temporal (restos 0) y el operador temporal.

## 5. Archivos cambiados (staging)

- `construacero-staging/supabase/migrations/305_staging_edicion_profunda_cxc.sql` (+ `_rollback.sql`): funciones `cxc_num` y `editar_despacho_profundidad_con_cxc_staging`. **Aplicada en staging y verificada.**
- `construacero-staging/api/handlers/despachos.js`:
  - "Editar Ítems" llama a la función nueva y pasa la decisión;
  - nuevos mensajes claros;
  - **se quitó el bloque viejo** que ajustaba la cuenta en pasos sueltos.
- `construacero-staging/src/hooks/useDespachos.js`: envía la decisión y conserva el código del error.
- `construacero-staging/src/components/despachos/EditarItemsDespachoModal.jsx`: pregunta "¿Qué hacemos con ese dinero?" y reenvía con la opción elegida.
- Pruebas: `api/handlers/__tests__/edicionProfundaCxc053.test.js`, `scripts/op053-edicion-profunda-api.mjs` y `scripts/op053-edicion-profunda-pantalla.mjs`.

## 6. Pendiente

- **No está en producción.** Necesita un caso propio, las migraciones 301 a 305 en producción y tu aprobación.
- La lógica de "pasar el sobrante a saldo a favor" está repetida en la función de reabrir (OP-052) y en esta. Conviene unificarla cuando se pase a producción.
- `handleEditarPagoDespacho` (corrección del pago de un despacho **entregado**, con su cuadre de OP-044) no se tocó en este caso.
- Siguen las fases 3 a 7 del plan (devoluciones correctas, "nada sin rastro", repaso, acceso y prueba final).
- Sin publicar en GitHub: no hay solicitud de cambio ni commit.
