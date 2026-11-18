# OP-2026-031 — Pantalla "¿Quién está operando?" más rápida y clara

**Fecha:** 2026-11-17
**Estado:** cambios hechos en el código (cuarta y quinta vuelta del 18-nov: PC con dos bloques lado a lado; celular y tablet sin tarjetas sueltas), **revisados en pantalla con datos de staging** (celular, tablet y computadora) y **PUBLICADO** el 18-nov-2026 con autorización del dueño: solicitud #60, commit b0420da9, unión 0dd6f193. Comprobado que la app en producción trae la pantalla nueva. El 18-nov el dueño aprobó cómo se ve en celular, tablet y PC. Staging ya quedó restaurado.

## En resumen

- La pantalla donde cada persona elige su usuario y pone su PIN ahora **recuerda quién entró la última vez en ese equipo** y lo pone **primero, con marco dorado y una estrella**.
- **Ya no hace falta bajar (scroll)** en celular, tablet, laptop ni PC con 11 usuarios: una sola cuadrícula compacta, ordenada por rol. Cada avatar mantiene **una sola letra**, como antes (se probaron dos iniciales y el usuario prefirió una).
- En el **celular** el logo es pequeño y va arriba, para que los usuarios se vean sin bajar. En **pantallas grandes** se muestran 4 o 5 columnas en vez de 3.
- Los nombres tienen todos el mismo tamaño, las etiquetas de rol se leen mejor y los botones de arriba dicen qué hacen ("Actualizar" y "Salir").

## Segunda vuelta: sin scroll (2026-11-17)

**Pedido:** "se ve mal ordenado; quiero evitar el scroll y optimizar espacio sin dañar la UI/UX, en móvil, laptop y PC".

**Medición antes:** con 11 usuarios la pantalla medía 1076 px de alto en una laptop de 768 px y 1142 px en un celular de 812 px: había que bajar en ambos.

**Qué se cambió:**
- **Una sola cuadrícula** en vez de grupos con títulos. Los grupos dejaban filas medio vacías (por ejemplo, Operaciones con una sola tarjeta). El orden sigue siendo por rol (Jefes → Administración → Logística → Jefe de ventas → Vendedores) y el color y la etiqueta de cada tarjeta siguen indicando el rol.
- La tarjeta grande "Último usuario en este equipo" se reemplazó por **marco dorado y una estrella ★** en la tarjeta de esa persona, que va **primera**. Al pasar el mouse dice "Último usuario que entró en este equipo".
- Tarjetas y avatares más compactos; 3 columnas en celular, 4 en tablet y laptop, 5 en pantallas grandes.
- En pantallas bajas (700 px de alto o menos, como celulares pequeños o laptops con la barra del navegador) se ocultan el logo pequeño y la frase "Selecciona tu usuario e ingresa tu PIN", y todo se aprieta un poco más.
- La etiqueta de Administración dice siempre "ADMIN." (la palabra completa partía en dos dentro de la tarjeta); al pasar el mouse muestra "Administración".

**Medición después (11 usuarios, sin scroll en todos):**

| Pantalla | Alto de la página | Alto de la pantalla |
|---|---|---|
| Celular pequeño 360×640 | 640 | 640 ✅ |
| Celular 375×812 | 812 | 812 ✅ |
| Tablet 768×1024 | 1024 | 1024 ✅ |
| Laptop 1366×657 (pantalla de 768 con barra del navegador) | 657 | 657 ✅ |
| Panel de 989×853 | 853 | 853 ✅ |

Detalle aceptado: en el celular más pequeño, un nombre muy largo como "María Fernanda González" se ve en dos líneas con "…" al final; el nombre completo aparece al mantener o pasar el dedo/mouse.

## Tercera vuelta: orden y sin huecos (2026-11-17)

Propuestas aceptadas por el usuario (las 3 primeras de 6) y ajustes pedidos al revisarlas:

| Cambio | Resultado |
|---|---|
| Quitar la etiqueta "VENDEDOR" de los vendedores | **Probado y revertido** a pedido del usuario: la etiqueta se queda. |
| Línea fina que separa dirección (jefes, administración, logística) de ventas (jefe de ventas y vendedores) | Solo en pantallas de 4 columnas (tablet, laptop, PC). En celular (3 columnas) la separación dejaba a una persona sola en una fila y obligaba a bajar, así que ahí todo va seguido. |
| Entrar escribiendo la inicial (computadora) | Escribir una letra resalta a la primera persona cuyo nombre empieza por ella; repetirla pasa a la siguiente; **Enter** abre su PIN. Probado: "E" dos veces → Elena; "W" + Enter → PIN de Wendy. El subtítulo en computadora dice "Elige tu usuario o escribe su inicial". |
| Huecos en filas incompletas (pedido del usuario) | La última fila de cada bloque se **centra** en vez de dejar un hueco a la derecha. |
| Columnas | Máximo 4 (antes 5 en pantallas grandes) para que el bloque de dirección de 4 personas llene su fila. |

Medido sin scroll después de estos cambios: celular pequeño 360×640, celular 375×812, ventana de 524×780, tablet 768×1024 y laptop 1366×657.

### Línea de luz "recortada" en el panel (2026-11-17)

- **Qué vio el usuario:** una línea vertical de luz que cortaba el panel de usuarios en la computadora.
- **Causa probable** (no se pudo reproducir en el navegador de pruebas): dos líneas decorativas muy finas del fondo (al 35 % y 65 % del ancho) que, con el panel más ancho, quedaban detrás del vidrio semitransparente y se veían cortadas. Además, cada tarjeta tenía su propio efecto de "vidrio esmerilado" encima del del panel; Chrome a veces dibuja ese efecto doble con una costura vertical dura.
- **Solución:** se quitaron las dos líneas decorativas y el efecto doble de las tarjetas (el panel conserva el suyo). El aspecto general no cambia.
- **Segundo intento (la línea seguía):** la línea es un borde recto que atraviesa todo el panel y no coincide con ningún elemento. Es el patrón de un fallo conocido de Chrome: el "vidrio esmerilado" (`backdrop-filter`) del panel se dibuja por bloques y, en algunas tarjetas gráficas, queda una costura entre bloques. No aparece en las capturas del navegador de pruebas, solo en la pantalla del usuario. Se quitó ese efecto del panel (y el desenfoque de sus dos manchas de color decorativas); se reemplazó por un tono semitransparente que se ve igual.
- **Resultado:** ✅ el usuario confirmó el 2026-11-17 que la línea ya no aparece. La causa era el "vidrio esmerilado" del panel.

## Cuarta vuelta: PC con dos bloques lado a lado (2026-11-18)

**En resumen:** en PC al dueño no le gustaba ver una tarjeta suelta en el medio (por ejemplo, "Luis Pérez" solo en su fila). Se le dieron 3 propuestas y eligió la **A: dos bloques lado a lado**. Celular y tablet no cambian.

- **Desde 1024 px de ancho (PC y laptop):** a la izquierda va **"Dirección y operaciones"** (jefes, administración y logística, en 2 columnas) y a la derecha **"Ventas"** (jefe de ventas, vendedores y EMPRESA, en 3 columnas). Cada bloque tiene su título y los separa una línea vertical suave.
- Con los usuarios de producción (2 jefes, administración, logística, jefa de ventas, 4 vendedores y EMPRESA) queda **2×2 a la izquierda y 3×2 a la derecha**: nadie suelto y sin bajar.
- El último usuario del equipo sigue primero dentro de su bloque, con el marco dorado.
- **Archivo:** `src/modules/auth/LoginPage.jsx` (`ladoALado = useMinWidth(1024)`).
- **Revisado en pantalla** con staging en 1440×900, 1280×720 y 1024×700. Pruebas automáticas: 1.109 de 1.109 OK; la app compila.

**Staging con los mismos usuarios que producción:** guion `construacero-staging/scripts/op031-usuarios-como-produccion.mjs`. Creó en la cuenta de pruebas los 10 usuarios activos de producción (mismo nombre, rol y color, **sin PIN**: solo para ver la pantalla) y ocultó temporalmente los otros 13. Las listas quedan en `construacero-staging/tmp/op031-prod-creados.json` y `op031-prod-ocultos.json`.
- ⚠️ **Para dejar staging como estaba:** `node scripts/op031-usuarios-como-produccion.mjs --restaurar` (en `construacero-staging/`). Borra esos 10 y reactiva los 13 ocultos, incluidos "Jefe E2E Staging" y "Vendedor E2E Designado", que necesita la prueba automática nocturna.

## Quinta vuelta: celular y tablet sin tarjetas sueltas (2026-11-18)

**En resumen:** al dueño le gustó la versión de PC y pidió arreglar también el celular y la tablet, donde jefes, logística y ventas salían mezclados y Wendy (o Josué y Wendy) quedaban solos en la última fila.

- **Celular (menos de 640 px):** dos bloques apilados, cada uno con su título: **"Dirección y operaciones"** (2×2) y debajo **"Ventas"** (3 filas de 2). Con los usuarios de producción, en un celular de 375×812 cabe todo **sin bajar**.
- **Tablet y laptop chica (640 a 1023 px):** arriba los 4 de dirección en una fila; debajo, una línea suave y **Ventas en 2 filas de 3**, centradas y del mismo tamaño. Esto se activa solo cuando el bloque se reparte exacto en filas de 3 y no de 4. Si no, sigue como antes: filas de 4 y la última centrada.
- **PC (1024 px o más):** sin cambios (propuesta A).
- **Archivo:** `src/modules/auth/LoginPage.jsx` (`esCelular` y `enFilasDe3`). Ahora los dos bloques se separan en todos los tamaños.
- **Revisado en pantalla** con staging en 375×812, 768×1024 y 950×800. Pruebas automáticas: 1.109 de 1.109 OK. La revisión de estilo solo marca un error que ya existía (línea del aviso de carga) y no tiene que ver con este cambio.

## Qué cambió (las 8 mejoras de la primera vuelta)

| # | Mejora | Qué ve el usuario |
|---|---|---|
| 1 | Recordar el último usuario | Tarjeta dorada "Último usuario en este equipo" arriba del todo. Se guarda en ese equipo al entrar con el PIN correcto. |
| 2 | ~~Dos iniciales~~ **(descartada)** | Se probó "Enzo Patti" → EP, "Eiker" → EI, pero el usuario prefirió **una sola letra** como antes; se revirtió el mismo día. |
| 3 | Grupos por rol | Dirección (Jefe, Administración) · Operaciones (Logística) · Ventas (Jefe de ventas primero, luego vendedores). Dentro de cada rol, en orden alfabético. *Cambio pedido durante la revisión: el Jefe de ventas pasó de Operaciones a Ventas.* |
| 4 | Logo compacto en celular y tablet | Logo pequeño y "Sistema de Gestión" en una franja arriba. En computadora sigue el logo grande a la izquierda. |
| 5 | Más columnas | 2 columnas en teléfonos muy angostos, 3 en celulares normales y tablets, 4 en laptops y 5 en pantallas grandes. |
| 6 | Nombres completos | Todos del mismo tamaño; los largos bajan a dos líneas en vez de achicarse. |
| 7 | Botones con texto | "Actualizar" (vuelve a cargar la lista) y "Salir" (cierra la cuenta de la empresa en ese equipo; luego pide correo y clave). Al pasar el mouse explican qué hacen. |
| 8 | Etiquetas más legibles | Letra más grande y más contraste en "VENDEDOR", "JEFE DE VENTAS", etc. En celulares angostos "Administración" se abrevia como "Admin." y "Jefe de ventas" baja a dos líneas, para que nada se corte. |

Extra: las tarjetas ahora se pueden elegir con el teclado (tecla Tab y luego Enter).

## Seguridad

- Lo único que se guarda en el equipo es **qué usuario** entró por última vez, nunca el PIN.
- Se guarda por separado para cada cuenta de empresa: si en el mismo equipo se entra con otra cuenta, no se mezcla.
- Si ese usuario ya no está activo, la tarjeta de "último usuario" simplemente no aparece.

## Archivos tocados

- `src/modules/auth/LoginPage.jsx` — pantalla de selección de usuario.
- `src/components/auth/LoginAvatar.jsx` — un tamaño intermedio (más pequeño) para las tarjetas de esta pantalla. Sigue con una sola letra.

## Verificación

- [x] Revisión automática de estilo del código: sin errores nuevos (el único error que aparece ya existía antes, en otra parte del archivo).
- [x] Pantalla revisada con datos de staging (2026-11-17), con 2 jefes, 1 administración, 1 logística, 1 jefe de ventas y 6 vendedores (uno externo y uno sin comisión):
  - Celular (375 px): 3 columnas, logo pequeño arriba, nombres largos en 2-3 líneas sin cortarse.
  - Tablet (768 px): 3 columnas, botones "Actualizar" y "Salir" con texto.
  - Computadora: logo grande a la izquierda y 4 columnas (5 en pantallas muy anchas).
  - Tarjeta "Último en este equipo" vista funcionando después de entrar con un PIN.
- Problemas encontrados y corregidos durante la revisión: "ADMINISTRACIÓN" se salía de la tarjeta en celular; nombres y "JEFE DE VENTAS" se cortaban con "…".
- [ ] Publicar en producción (requiere aprobación).

## Datos de prueba usados (staging, cuenta `staging-e2e@listo.sys`)

- La cuenta de pruebas no dejaba entrar: su contraseña ya no coincidía con la guardada. Se volvió a crear con `npm run provision:e2e:staging` (en `construacero-staging/`), que la deja igual a la del archivo `.env.e2e.local`.
- Se crearon 11 usuarios demo (sin PIN, solo para ver la pantalla) con `construacero-staging/scripts/op031-usuarios-demo.mjs`.
- Para que la pantalla mostrara solo esos, se **ocultaron temporalmente** (desactivaron) 12 usuarios de prueba que usan las pruebas automáticas (Jefe E2E, Vendedor E2E, etc.). La lista exacta quedó en `construacero-staging/tmp/op031-ocultos.json`.

## Pendiente / notas

- ✅ **Staging restaurado (18-nov):** se borraron los 10 usuarios copiados de producción (`op031-usuarios-como-produccion.mjs --restaurar`) y se reactivaron todos los usuarios de prueba ocultos en las dos vueltas (`op031-usuarios-demo.mjs --restaurar`), incluidos los que usa la prueba automática nocturna. Los 11 usuarios demo siguen activos; para borrarlos: `node scripts/op031-usuarios-demo.mjs --borrar`.
- La contraseña de la cuenta de pruebas quedó visible en capturas del chat. Es solo de staging; conviene cambiarla (borrar la línea de la contraseña en `.env.e2e.local` y volver a correr `npm run provision:e2e:staging`).
- El cambio está solo en el código principal; la copia `construacero-staging/src` no se tocó.

- Se publica **separado** de OP-2026-025: rama `feat/op-031-pantalla-quien-opera`, creada desde `main`, solo con `LoginPage.jsx`, `LoginAvatar.jsx` y esta documentación.
