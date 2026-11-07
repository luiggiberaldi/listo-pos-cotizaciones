# Aviso "Hay una versión nueva" adaptado al celular

**Fecha:** 2026-11-07 · **Caso:** OP-2026-018 · **Estado:** hecho y probado; ver la solicitud de cambio en el registro.

## En resumen
En el celular el aviso salía como una columna angosta con el texto partido palabra por palabra y pegado sobre la barra de abajo. Ahora ocupa el ancho de la pantalla, el texto se lee en 2 líneas, los botones quedan debajo a la derecha y todo flota por encima de la barra inferior. En la computadora sigue centrado y compacto.

## Qué cambió
Solo `src/components/ui/AvisoVersionNueva.jsx` (estilos). No cambia cuándo aparece ni qué hace.

## Cómo se probó
Se dibujó el aviso en una pantalla de 390 px de ancho (celular) y de 1020 px (computadora): en el celular mide 366 px y no se parte; en la computadora queda centrado a 16 px del borde de abajo. **Sin verificar:** verlo con la barra inferior real en un celular con sesión iniciada.
