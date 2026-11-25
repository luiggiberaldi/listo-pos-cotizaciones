# OP-2026-070 — Vendedores: editar productos y cantidades de sus despachos que esperan aprobación

**Fecha:** 2026-11-24 · **Estado:** **hecho y probado en staging; falta publicar en producción** (necesita el visto bueno del dueño y aplicar la migración 311 en la base de producción) · Rama `feat/op-070-vendedor-edita-despacho`

## En resumen

- El vendedor ahora tiene un botón **Editar productos** en sus despachos que están **Esperando aprobación**.
- Puede **agregar, quitar y cambiar cantidades**, eligiendo el precio de una lista con los **precios de lista**, igual que al cotizar. No puede escribir precios a mano, poner descuentos, agregar artículos externos ni préstamos.
- **No toca pagos:** si el despacho tiene un solo método de pago, su monto se ajusta solo al nuevo total con el mismo método. Si tiene pagos combinados, adelantos o saldo a favor, debe pedirlo a administración.
- Solo **sus propios** despachos y solo mientras **esperan aprobación**. El supervisor sigue aprobando después.
- Las reglas las aplican **tres capas**: la pantalla, el servidor y la base de datos. Se probaron 7 intentos de saltárselas y todos fueron bloqueados.

## Decisión del dueño

Pregunta: "En un despacho suyo que espera aprobación, ¿qué puede cambiar el vendedor?". Respuesta (2026-11-24): **productos y cantidades**, solo con los precios de lista que ya puede usar al cotizar, sin tocar pagos. Era la opción recomendada. Se descartaron "igual que administración" (precios libres y pagos) y "solo cantidades y quitar".

## Cómo funcionaba antes

- **Edición básica** (chofer, notas, dirección): el vendedor ya podía usarla en sus despachos pendientes.
- **Edición de productos** ("edición profunda"): solo administración, jefe y desarrollador. Lo bloqueaban la pantalla, el servidor y la regla `editar_despacho_profundidad` de la base.

## Qué se cambió (producción y staging)

| Capa | Archivo | Cambio |
|---|---|---|
| Base de datos | `supabase/migrations/311_vendedor_edita_despacho_pendiente.sql` (staging: `construacero-staging/supabase/migrations/311_staging_…`) y su `_rollback` | `editar_despacho_profundidad` también acepta `vendedor` y `vendedor_sin_comision`, pero solo si el despacho es **suyo** y está **pendiente**. Hecha a partir de la definición viva, idéntica en producción y staging; el resto de la función no cambia |
| Servidor | [`api/lib/edicionVendedorDespacho.js`](../../api/lib/edicionVendedorDespacho.js) (nuevo, igual en staging) y [`api/handlers/despachos.js`](../../api/handlers/despachos.js) | Para el vendedor: despacho suyo y pendiente; precios de lista (P1/P2/P3 habilitados, con su recargo de externo y el descuento de cliente personal) o el precio que ya tenía; artículos externos y préstamos solo los que ya estaban; sin descuentos nuevos; pagos solo con el mismo método y el monto igual al nuevo total; nunca "qué hacer con pagos ya hechos" |
| Pantalla | [`DetalleModal.jsx`](../../src/components/ui/DetalleModal.jsx), [`EditarItemsDespachoModal.jsx`](../../src/components/despachos/EditarItemsDespachoModal.jsx) | Botón "Editar productos" para el vendedor en sus despachos pendientes. "Modo vendedor": precio como lista desplegable (sale de la misma función que usa el servidor), sin botón de artículo manual, sin la sección de pagos (en su lugar, un aviso) y pagos ajustados solos al guardar |

Administración, jefe y desarrollador: **sin cambios**.

## Pruebas

- **Automáticas:** 22 pruebas nuevas de las reglas (`api/lib/__tests__/edicionVendedorDespacho.test.js`). Producción: **1.230 de 1.230**. Staging: **277 de 277**. La app se construye. Revisión de estilo sin errores nuevos.
- **En pantalla (staging local, como "Vendedor E2E Staging"):**
  1. Se creó el despacho DES-04907 desde la cotización COT-04907, pagado con "Efectivo $" ($0,35), en estado "Esperando aprobación".
  2. En su ficha apareció **Editar productos**, con el modo vendedor: lista de precios, sin producto manual y con el aviso de pagos.
  3. Se quitó un producto, se agregó **Cemento CPC 50 kg** ×2 a $6,75 y se guardó: "Ítems del despacho actualizados con éxito".
  4. En la base: 2 × $6,75 = **$13,50**, pago **"Efectivo $" por $13,50** (mismo método, ajustado solo), sigue **pendiente**, y la auditoría anota EDITAR_DESPACHO_PROFUNDIDAD con rol **vendedor**.
- **Intentos de saltarse las reglas** (como vendedor, llamando al servidor directamente): bajar el precio a $1, cambiar el método a Zelle, pago que no cuadra con el total, descuento por renglón, despacho de otro vendedor y decidir sobre pagos ya hechos. **Los 6 rechazados.** Además, llamando a la base directamente con un despacho ajeno, **la base también lo rechazó**. El despacho no cambió.
- **Hallazgo de staging (no es de este cambio):** el catálogo de la cuenta de pruebas muestra productos de **otra** cuenta de pruebas. Al guardar con uno de ellos, la base responde "producto no disponible en la cuenta del despacho", y lo mismo le pasaría a administración. Para la prueba se usaron productos de la cuenta correcta.

## Cómo publicar (cuando el dueño apruebe)

1. **Aplicar la migración 311 en la base de producción.** Es la regla que deja entrar al vendedor. Si se publica el código sin ella, el vendedor ve el botón, pero al guardar la base lo rechaza: no hay riesgo, solo no funciona.
2. Aprobar la solicitud de cambio, con lo que se publican el servidor y la pantalla.
3. Probar con un vendedor real un despacho suyo que esté esperando aprobación.
4. **Para deshacer:** aplicar `311_vendedor_edita_despacho_pendiente_rollback.sql` y revertir la solicitud.

## Pendiente o sin verificar

- **No publicado en producción.** La migración 311 no se aplicó en producción; solo en staging.
- En staging, la ficha del despacho no muestra los productos nuevos hasta cerrarla y abrirla de nuevo. En producción sí se refresca sola (`onSaved`).
- Los vendedores con recargo (externos) no se probaron en pantalla. Están cubiertos por pruebas automáticas.
- El botón está en la ficha del despacho (se abre con "1 Ítem" en la tarjeta), no en la tarjeta misma.
