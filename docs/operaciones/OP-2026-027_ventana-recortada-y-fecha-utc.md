# OP-2026-027 — Ventana de designar recortada y designado que "desaparece" de noche

**Fecha:** 2026-11-14 (noche) · **Estado:** corregido en el código; pendiente de publicar

## En resumen

Después de publicar OP-2026-026, el dueño reportó dos cosas en *Comisiones → Designado del día*:

1. **La ventana "¿Designar a…?" salía recortada por arriba.** Pasaba porque se dibujaba *dentro* del recuadro verde, y no sobre toda la pantalla. Ahora se dibuja sobre la pantalla completa.
2. **Edgar Ramírez ya no aparecía como designado del 14-nov**, aunque sí estaba guardado. Se comprobó en la base de datos, solo leyendo: la designación sigue ahí. Era un problema de la pantalla: desde las 8 p. m. de Venezuela tomaba la fecha con el reloj mundial (UTC), que ya marcaba domingo 15, y solo pedía las designaciones "desde el 15". Ahora usa la fecha local.

**No se tocó ningún dato.** Las comisiones recalculadas en OP-2026-026 siguen igual.

## Detalle técnico

- `src/components/ui/ConfirmModal.jsx`: la ventana se dibuja directamente sobre la página entera (`createPortal` a `document.body`). El recuadro del designado tiene un fondo difuminado (`backdrop-blur`), y ese efecto encerraba la ventana dentro del recuadro. El arreglo sirve también para la ventana de "Quitar designación" y para las otras 15 pantallas que usan esta misma ventana.
  - Se revisaron esas 15 pantallas: ninguna abre esta ventana desde otra ventana que quede por encima (nivel mayor a 200), así que no queda tapada.
- `src/views/ComisionesView.jsx`: `hoy` pasa de `new Date().toISOString().slice(0,10)` (fecha UTC) a `getLocalISODate()` (fecha local). Afecta tres cosas:
  - la lista de designaciones que se pide;
  - la fecha mínima del calendario;
  - el aviso de "ventas de hoy".

## Verificación

- Los dos archivos compilan sin errores.
- La designación de Edgar del 2026-11-14 está guardada en la base de datos (creada a las 00:24 UTC del 15-nov).
- **No se vio en pantalla** con un usuario jefe antes de publicar.

## Pendiente

- [ ] Publicar (solicitud de cambio y juntarla con `main`).
- [ ] Que el jefe confirme que la ventana se ve completa y que Edgar aparece como designado.
