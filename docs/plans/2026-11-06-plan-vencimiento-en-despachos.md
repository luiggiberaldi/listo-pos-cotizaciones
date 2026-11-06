# Plan: fecha de vencimiento en despachos a crédito

**Fecha:** 2026-11-06 · **Estado:** propuesto, pendiente de que el dueño lo retome · **Origen:** petición de Administración en el Buzón (27/10/2026): "que las notas de despacho, de acuerdo a los días de crédito, me digan la fecha de vencimiento".

## En resumen

La ficha del despacho ya muestra los días restantes ("Cta. por cobrar - 15 días (15d restantes)"). Lo que falta es que **la nota de despacho en PDF** diga la fecha de vencimiento (hoy no imprime nada de forma de pago). Se agrega en 3 lugares pequeños, sin recargar la ficha.

## Dónde

1. **PDF de la nota de despacho** (solo ventas a crédito): una línea junto a los datos del cliente. Ejemplo: `Crédito 15 días · Vence: 21/11/2026`. Contado: no cambia nada. En papel va la **fecha**, no los días restantes (quedarían desactualizados).
2. **Ficha del despacho**: la misma línea de una fila, con color: normal (más de 3 días), amarillo (3 o menos), rojo (vencido). La fecha completa al pasar el cursor.
3. **Detalle del despacho** (al abrirlo): "Vence el viernes 21/11/2026 · quedan 15 días".

## Reglas

- Fecha de vencimiento = fecha de creación + días de crédito, **en hora de Venezuela** (que una venta de la noche no se corra un día). Hay una utilidad lista: `fechaCaracas` y `sumarDias` en `src/utils/cobranza.js`.
- Pago mixto: la línea del PDF dice cuánto queda a crédito, ej. `$1.200 a crédito · vence 21/11/2026`.
- No hay cambios en la base de datos: los días de crédito ya viven en `forma_pago` (`diasVencimiento`).

## Pasos

1. Función única `vencimientoDespacho(despacho)` (fecha, días restantes, estado, texto) en `src/utils/` con pruebas (contado, crédito, mixto, vencido, venta nocturna, sin días).
2. PDF de la nota de despacho (`src/services/pdf/despachoPDF.js` y la plantilla de nota de entrega): línea de crédito. Probar que contado no cambia.
3. Ficha (`DespachoCard.jsx`): usar la función única, con color y tooltip.
4. Detalle (`DetalleModal.jsx`): línea completa.
5. Probar en staging (PDF de muestra + ficha + detalle), mostrar al dueño, y recién entonces pasar a producción (PR, unir, comprobar despliegue).

## Riesgos

- Bajo: solo cambia lo que se muestra. Revisar que el PDF no desborde la página con nombres largos de cliente.
- La ficha hoy calcula con milisegundos (puede correr un día en ventas nocturnas); la función única lo corrige.

## Cómo retomarlo

Decir "retoma el plan de vencimiento en despachos". Se construye primero en staging.
