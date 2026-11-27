# OP-2026-091 — Facturar un préstamo: tasa principal, pago al facturar y comisión del vendedor (staging)

**Fecha:** 2026-11-25 · **Alcance:** solo staging; va dentro de la solicitud #84. **No cambia producción.**
**Estado:** hecho y probado contra la base real de staging; **falta verlo en pantalla con un préstamo real** y confirmar los puntos de "Pendiente".
**Decisiones del dueño (2026-11-25):** (1) se factura con la **tasa principal elegida en el sistema**; (2) por ahora el vendedor **cobra el mismo porcentaje** que en una venta normal.

## En resumen

- **Tasa:** ya no se usa siempre la BCV. Se usa la tasa principal que esté elegida (BCV, USDT o manual) y el cargo anota cuál fue ("tasa principal (USDT) 1108,00").
- **Pago:** al facturar hay dos opciones. **"A crédito"** (como antes: se suma a lo que el cliente debe) o **"Paga ahora"** (método y referencia): el cobro y el pago se registran juntos, en un solo paso.
- **Comisión:** al facturar, el vendedor del cliente recibe comisión sobre lo facturado, con las mismas reglas de una venta normal (porcentaje de cabilla u otros, vendedor externo, etc.).
  - **Paga ahora:** la comisión queda **liberada** al instante.
  - **A crédito:** queda **retenida** ("cuenta por cobrar") hasta que administración la libere con el botón que ya existe para eso, cuando el cliente pague.
- **Falla N44-INV corregida:** revertir un despacho entregado a "aprobado" ahora también revisa los préstamos y se bloquea si hay devueltos o facturados (antes borraba el cobro ya facturado).
- **Corrección de paso:** el texto del cargo mostraba "$22.00##" por un formato mal escrito; ahora sale "$22.00".

## Cómo se ve

En Clientes → ficha → Préstamos → Facturar: cantidad, "¿Cómo se cobra?" (A crédito / Paga ahora con método y referencia), la vista previa (precio del despacho, tasa principal con su tipo, monto en dólares y bolívares) y el botón "Facturar $X" o "Facturar y cobrar $X". Al terminar, el aviso verde incluye la comisión del vendedor.

## Detalle técnico

- Migración `326_staging_prestamo_pago_comision_tasa.sql` (+ rollback), **aplicada en staging**:
  - `facturar_prestamo_atomico` con 3 parámetros nuevos (tipo de tasa, método y referencia de pago); inserta el cargo y, si paga ahora, el abono con el mismo candado e idempotencia (la clave del abono se deriva de la del cargo).
  - `comision_prestamo_facturado_staging`: reutiliza `comision_238b_item_breakdown` y los mismos porcentajes del motor 238b; suma a la fila de comisión del despacho (o la crea con el motor si no existía); deja la evidencia en `calculo_evidencia`.
  - `revertir_entrega_finanzas_atomica` revisa los préstamos antes de revertir a cualquier estado.
- Servidor (`api/handlers/clientes.js`): acepta `tasa`, `tasaModo` y `pago`. **El servidor no puede saber qué tasa eligió el usuario en su pantalla** (esa elección vive en el navegador), así que solo rechaza una tasa absurda (menos de 1/4 o más de 4 veces la del despacho) y guarda la tasa y su tipo en el cargo y en la auditoría.
- Pantalla (`FichaClienteModal.jsx`): usa `tasaEfectiva` y `modoTasa` del sistema.

## Pruebas

- `vitest` **566/566**; `vite build` OK.
- Probador completo de staging **123/123**; pruebas de seguridad **17/17**.
- `scripts/op091-prueba-prestamo-cobro-staging.mjs` (base real, cada prueba se deshace sola): **9/9** — cargo con tasa principal y sin "##"; saldo; comisión retenida (2 % de $8,50 = $0,17); paga ahora con pago registrado y comisión liberada; método "Donación" rechazado; tipo de tasa inventado rechazado; revertir a "aprobado" y "pendiente" bloqueados; sin datos sobrantes.

## Pendiente / sin verificar

- **No se probó con clic real en pantalla** (el navegador integrado tiene otra empresa de prueba). Falta que el dueño lo pruebe con un préstamo pendiente.
- **La liberación de la comisión retenida sigue siendo manual** (botón "Liberar comisión CxC" de administración); no se liberó sola al pagar el cliente. Se dejó así a propósito para no tocar el motor de comisiones.
- **No se aplicó el reparto "designado del día"** (split) a la comisión del préstamo facturado: va completa al dueño del cliente con su porcentaje normal.
- **El pago de $2.640 anotado en el despacho DES-04938 (préstamo) sigue sin explicarse ni corregirse** (OP-090, punto 2); no se tocó.
- **Los cargos viejos** (como el de DES-04938) conservan su texto con "##" y su comisión en cero; no se corrigieron hacia atrás.
- Producción: no incluido; sería un caso aparte con autorización.
