# OP-2026-107 — Ajuste de ancho y centrado en la pantalla de Configuración

## En resumen

La pantalla de **Configuración** tenía un tope de ancho fijo de `896 px` (`max-w-4xl`) pegado al lado izquierdo, lo que en monitores de PC grandes dejaba casi la mitad derecha de la pantalla en blanco.

- **Qué cambió:** se amplió el ancho máximo a **`1.152 px` (`max-w-6xl`)** y se **centró (`mx-auto`)** en el área de trabajo (`src/views/ConfiguracionView.jsx`).
- **Qué significa para el usuario:**
  - En **laptops**, aprovecha prácticamente todo el ancho disponible junto al menú lateral.
  - En **monitores grandes de PC**, el formulario y las pestañas (`Negocio`, `Administración`, `Usuarios`, `Datos`) se ven centrados, equilibrados y cómodos de leer sin estirar en exceso los campos de texto.
- **Cambios en base de datos o servidor:** ninguno (cambio puramente visual).
- **Estado:** Publicado en producción (2026-11-27).

---

## Impacto en probadores automáticos (regla OP-2026-105)

- **Sin impacto** en ninguno de los probadores automáticos (12:00 a. m., 1:00 a. m., 2:00 a. m., `vitest` ni avisos programados del servidor): solo se modificó una clase de diseño del contenedor de `ConfiguracionView.jsx`.

---

## Verificación y publicación

- Compilación de producción (`npx vite build` + PWA): verificada sin errores antes de publicar.
- Solicitud de cambio: *(PR de `fix/op-107-ancho-configuracion` hacia `main`)*.
