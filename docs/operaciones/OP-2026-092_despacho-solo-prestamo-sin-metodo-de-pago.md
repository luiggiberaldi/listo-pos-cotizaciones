# OP-2026-092 — Un despacho 100 % préstamo ya no exige método de pago al editar sus productos (staging)

**Fecha:** 2026-11-25 · **Alcance:** solo staging; va dentro de la solicitud #84. **No cambia producción.**
**Estado:** corregido y probado en código; falta verlo en pantalla con el despacho DES-04967.

## En resumen

- **Qué pasaba:** en "Editar productos" de un despacho donde **todo es préstamo** (total $0), el botón "Guardar cambios" quedaba bloqueado hasta anotar un método de pago, y la pantalla mostraba "Exceso: $0.00". No tiene sentido: no hay nada que cobrar.
- **Por qué:** la regla de "pagos cuadrados" exige al menos una fila de pago. Con total $0 y sin filas, daba "no cuadrado". Anotar cualquier pago (aunque fuera de más) la desbloqueaba.
- **Efecto secundario muy probable (explica un hallazgo de OP-090):** para poder guardar, alguien anotó un pago en efectivo. Por eso el despacho DES-04938 quedó con **$2.640 en efectivo anotados** aunque era un préstamo y nunca se cobró eso. Es una explicación probable, no comprobada: no hay un registro que diga quién lo anotó ni por qué.
- **Ahora:** si el total es $0 (y no es cobro a destino), no se exige ningún pago. La pantalla muestra en verde "Sin cobro: todo es préstamo ✓" y explica que lo prestado se factura después desde la ficha del cliente → Préstamos. Al guardar, se limpian los pagos anotados que ya no corresponden.

## Detalle técnico

- `src/components/despachos/EditarItemsDespachoModal.jsx`: `sinCobro = !esCod && total <= 0.015`; `estaCuadrado = pagoInmediatoCuadrado || sinCobro`; aviso explicativo; al guardar manda `pagos: []` si no hay cobro.
- Se comprobó en la base que el motor de comisiones trata un despacho de $0 con pagos vacíos sin pedir revisión manual (`comision_238b_pago_split`), así que guardar así es seguro para las comisiones.
- Prueba: `src/utils/__tests__/op092DespachoPrestamoSinPago.test.js`. `vitest` 569/569; `vite build` OK.

## Pendiente / sin verificar

- No se vio en pantalla con el despacho DES-04967 del dueño.
- **No cubierto:** la ventana "Editar despacho" (pagos y flete, `EditDespachoModal.jsx`) tiene la misma regla y seguiría pidiendo un pago en un despacho de $0. No se tocó porque su guardado no se pudo verificar; hay que revisarla aparte.
- No se revisó la creación del despacho (cotización → despacho) con todos los artículos en préstamo.
- El pago de $2.640 ya anotado en DES-04938 no se corrigió.
