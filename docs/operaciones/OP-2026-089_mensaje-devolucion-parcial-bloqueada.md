# OP-2026-089 — Mensaje claro cuando no se puede hacer una devolución parcial (staging)

**Fecha:** 2026-11-25 · **Alcance:** solo staging; va dentro de la solicitud #84. **No cambia producción.**
**Estado:** hecho y probado en código; falta verlo en pantalla.

## En resumen

- **Qué se veía:** en un despacho cuyos artículos están en préstamo, la ventana de devolución parcial decía "Despacho totalmente devuelto — venta anulada económicamente… ajustes de devolución…". Era falso (nada se había devuelto) y hablaba de cosas internas que al usuario no le sirven.
- **Qué se ve ahora**, según el motivo real:
  - **Todo en préstamo:** "Este despacho no admite devolución parcial. Todos sus artículos están en préstamo y los préstamos no se devuelven desde aquí. Entra a la ficha del cliente, pestaña Préstamos, y usa Devolver o Facturar."
  - **Mezcla** (lo demás ya devuelto): "No queda nada por devolver desde aquí…" y apunta a la ficha del cliente.
  - **Todo ya devuelto:** "Ya se devolvió todo lo de este despacho. Si necesitas deshacer la entrega completa, usa Reabrir despacho."
- También se cambió el aviso de arriba: ya no habla de "ajustes en CxC"; dice que la mercancía vuelve al inventario y se descuenta de lo que el cliente debe.

## Detalle técnico

- `src/components/despachos/DevolucionParcialModal.jsx`: el bloque se decide por `es_prestamo` de los artículos. Se quitó el texto con la deuda y los "ajustes".
- Prueba `src/utils/__tests__/op089MensajeDevolucion.test.js`. `vitest`: 561/561; `vite build`: OK.

## Sin verificar

- No se vio en pantalla con el despacho DES-04938 del dueño.
