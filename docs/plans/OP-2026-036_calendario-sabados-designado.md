# Plan: calendario mensual de sábados para elegir los vendedores designados

**Fecha:** 2026-11-22 · **Tipo:** plan + implementación + publicación en producción · **Caso:** OP-2026-036
**Estado:** **PUBLICADO en producción el 22-nov-2026** — solicitud **#64**, commit `579c0e19`, unión en `main` `c507d849`. Verificado en vivo en Vercel y Cloudflare Worker.

## En resumen

- Hoy el jefe tiene que buscar fecha por fecha en un calendario común para marcar al vendedor designado de cada sábado. Por eso ya pasó **dos sábados seguidos** (14-nov en [OP-2026-026](../operaciones/OP-2026-026_designado-sabado-olvidado.md) y 21-nov en [OP-2026-034](../operaciones/OP-2026-034_designado-sabado-tarde-eiker.md)) que se marcó tarde y hubo que recalcular las comisiones.
- La propuesta es reemplazar ese selector de fecha suelta por un **Calendario de Sábados del Mes** dentro de *Comisiones*: muestra directamente los **4 o 5 sábados del mes**, permite dejar **todo el mes programado de una sola vez** y avisa si queda algún sábado vacío.
- No hace falta cambiar la base de datos: cada sábado elegido se guarda en la misma tabla que ya existe hoy.

---

## Qué problemas resuelve

| Cómo funciona hoy | Cómo funcionará con el calendario de sábados |
|---|---|
| Hay que abrir un calendario de todos los días y buscar a ojo cuáles caen sábado | El sistema muestra **solo los 4 o 5 sábados del mes** elegido (imposible marcar un martes o viernes por error) |
| Para programar el mes hay que repetir el proceso 4 o 5 veces, uno por uno | Se pueden elegir los vendedores de **todos los sábados del mes en una sola vista** y pulsar **Guardar cambios** una sola vez |
| Los sábados que ya pasaron desaparecen de la pantalla al día siguiente | Los sábados pasados del mes **quedan visibles a modo de historial** (en gris, bloqueados para no cambiarlos por accidente) |
| Si se olvida marcar el sábado en la mañana, nadie se entera hasta la noche | Un **indicador de estado del mes** (*"4 de 4 sábados asignados ✓"* o *"Falta 1 sábado por asignar"*) + un **aviso en pantalla** si llega el sábado sin designado |

---

## Cómo se vería en pantalla (*Comisiones → Designados del mes*)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ★ CALENDARIO DE DESIGNADOS (SÁBADOS)      [ ◀ Noviembre 2026 ▶ ]  🟢 4/4  │
│ Ese día, el designado cobra 0,5 % y el dueño del cliente 1,5 %.            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  Sáb 07 nov   Pasado          Josué Marciales (vendedor)         🔒 Cerrado│
│  Sáb 14 nov   Pasado          Edgar Ramírez (vendedor)           🔒 Cerrado│
│  Sáb 21 nov   Pasado          Eiker Montaner (vendedor)          🔒 Cerrado│
│  Sáb 28 nov   Próximo sábado  [ Elegir vendedor…          ▼ ]    ⚠ Vacío  │
│                                                                            │
│                                            [ Guardar cambios del mes ]     │
└────────────────────────────────────────────────────────────────────────────┘
```

### Detalles pensados para el día a día

1. **Programar el mes completo en 30 segundos:**
   - El jefe puede cambiar al mes actual o al mes siguiente con las flechas (`◀ Noviembre 2026 ▶` / `Diciembre 2026`).
   - En cada sábado futuro elige al vendedor en su lista desplegable (o deja en blanco los que aún no decida).
   - Al pulsar **Guardar cambios del mes**, sale una sola ventana de confirmación con el resumen claro (por ejemplo: *"Vas a designar: Sáb 05 dic → Josué, Sáb 12 dic → Edgar…"*).
2. **Cambiar un sábado si alguien cambia de guardia:**
   - En cualquier sábado futuro (o el mismo sábado) el jefe puede cambiar el vendedor elegido o quitarlo, y todo queda registrado en Auditoría con su nombre igual que hoy.
3. **Sábados pasados visibles pero protegidos:**
   - Los sábados que ya pasaron siguen apareciendo en la lista del mes para que el jefe vea quién estuvo cada sábado y no parezca que "se borraron", pero aparecen con candado para evitar tocarlos por error.
4. **Dos protecciones adicionales (opcionales, recomendadas):**
   - **Aviso de sábado sin designado:** si hoy es viernes o sábado y el sábado de esta semana no tiene vendedor asignado, mostrar una franja amarilla visible para el jefe: *"⚠️ El sábado 28 de noviembre aún no tiene vendedor designado"*.
   - **Qué pasa si se elige tarde el mismo sábado:** si el jefe asigna o cambia al designado un sábado en el que ya hubo ventas entregadas, la ventana de confirmación avisa cuántas ventas ya se hicieron ese día (como ya hace hoy) y podemos incluir la opción de recalcularlas en ese mismo paso.

---

## Decisiones rápidas para confirmar cuando lo vayamos a construir

1. **¿Permitir repetir vendedor o sugerir rotación?**
   - *Recomendado:* permitir elegir libremente a cualquier vendedor/supervisor en cada sábado (por si alguien cubre dos sábados), mostrando al lado cuántas veces lleva asignado en ese mes para ayudar a repartir parejo.
2. **¿Hasta cuántos meses hacia adelante poder programar?**
   - *Recomendado:* poder ver desde meses anteriores (historial) y programar el **mes actual y hasta 2 meses hacia adelante** (por ejemplo, a fin de mes ya dejar listo todo el mes siguiente).
3. **¿Incluimos el aviso amarillo cuando el sábado de la semana aún no tiene designado?**
   - *Recomendado:* sí, que le aparezca al jefe en la parte superior si llega el viernes o sábado y ese sábado sigue vacío.
4. **¿Si el jefe marca al designado tarde el mismo sábado, quieres que el botón recalcule solo las ventas que ya se hicieron ese día?**
   - *Recomendado:* sí (con confirmación del jefe y sin tocar comisiones pagadas), para que no tengas que pedirme el recálculo manual si algún día lo marcan a mitad de la tarde.

---

## Plan de trabajo (cuando decidas construirlo)

1. **Paso 1 — Lógica del calendario de sábados (con pruebas automáticas):**
   - Crear el calculador de sábados por mes (siempre en hora de Venezuela, sin saltos de fecha de noche) que devuelve los 4 o 5 sábados de cualquier mes y su estado (*pasado*, *hoy*, *próximo*, *futuro*).
2. **Paso 2 — Guardado por lote en el servidor:**
   - Mantener el guardado actual fecha por fecha y permitir enviar varios sábados del mes en un solo paso, registrando cada cambio en Auditoría.
3. **Paso 3 — Nueva vista de Calendario Mensual en *Comisiones* (en la copia de pruebas / staging):**
   - Reemplazar el selector de fecha suelta por la tarjeta con los 4–5 sábados del mes, navegación entre meses (`◀ Mes Año ▶`), contador de sábados asignados y ventana única de confirmación.
4. **Paso 4 — Revisión visual contigo en la copia de pruebas:**
   - Probarlo en celular y PC con los vendedores reales copiados en staging antes de tocar el sistema real.
5. **Paso 5 — Publicación en producción:**
   - Con tu visto bueno, pasarlo al sistema real.

---

## Detalle técnico (para cuando ejecutemos el plan)

- **Base de datos:** **sin cambios de tablas.** `public.comision_designacion_diaria` ya tiene clave única `(cuenta_id, fecha)` y `GET /api/comisiones/designacion?desde=YYYY-MM-01&hasta=YYYY-MM-31` ya devuelve cualquier rango de fechas.
- **Archivos a crear/modificar:**
  - Crear `src/utils/calendarioSabados.js`: funciones puras `obtenerSabadosDelMes(anio, mes, hoyISO)` y `resumirCambiosMes(sabados, actuales, borradores)` usando fecha local de Venezuela.
  - Crear `src/utils/__tests__/calendarioSabados.test.js`: pruebas de meses de 4 y 5 sábados, cambio de año (diciembre ↔ enero), bloqueo de sábados pasados y detección del sábado de hoy a cualquier hora (incluida después de las 8 p. m. VE).
  - Modificar `api/handlers/admin.js` (`handleDesignacionComision`): aceptar tanto `{ fecha, designado_id }` individual como `{ cambios: [{ fecha, designado_id | null }] }` para guardar o limpiar varios sábados del mes en una sola petición y registrar cada fila en `auditoria`.
  - Modificar `src/views/ComisionesView.jsx` (`PanelDesignacion`): vista mensual de los sábados del mes con selector `◀ Mes Año ▶`, contador `N/M asignados`, filas por sábado con `CustomSelect` y `ConfirmModal` con el resumen de cambios.

## Estado de implementación en staging (22-nov-2026)

**Construido, protegido con guardarraíles y verificado de punta a punta en `construacero-staging/`. Producción no se ha tocado.**

### Guardarraíles implementados (en pantalla y servidor)

1. **Solo sábados reales (`esFechaSabado`):** ni la pantalla ni el servidor permiten asignar días entre semana ni domingos. Si alguien envía un martes al servidor, responde error `400 ("La fecha YYYY-MM-DD no es un sábado")` sin guardar nada.
2. **Hora fija de Venezuela (`getFechaCaracasISO`, UTC-04:00):** evita que después de las 8:00 p. m. el sistema salte al día siguiente y bloquee el sábado de hoy antes de medianoche.
3. **Sábados pasados visibles pero bloqueados (`🔒 Cerrado`):** los sábados que ya pasaron se siguen viendo con el nombre de quien fue designado (historial completo del mes), pero no se pueden modificar ni borrar por accidente (la pantalla los muestra con candado y el servidor rechaza cualquier cambio sobre un sábado pasado con `400`).
4. **Pre-validación atómica de vendedores:** solo vendedores y supervisores **activos y no externos** de la misma empresa pueden ser designados. Si en un lote de varios sábados hay un usuario inválido o externo, el servidor rechaza todo el lote antes de tocar ninguna fecha.
5. **Solo el Jefe puede programar (`403` para demás roles):** vendedores, supervisores, logística y administración reciben `403`.
6. **Ventana de confirmación con resumen y freno al doble clic:** el botón **Guardar cambios (N)** solo se activa cuando hay cambios reales, abre `ConfirmModal` en pantalla completa (`createPortal` a `document.body`, sin recortarse) con el listado sábado por sábado y avisa si uno de los cambios afecta al sábado de hoy.
7. **Aviso preventivo de sábado vacío y contador de turnos por vendedor:** muestra arriba cuántos sábados del mes están asignados (`4 de 4 sábados asignados ✓` o `3 de 4 asignados (falta 1)`), alerta desde el jueves si el sábado de la semana sigue vacío y muestra abajo cuántos sábados lleva cada vendedor en ese mes.
8. **Registro completo en Auditoría:** cada sábado asignado o quitado en el lote deja su registro individual (`DESIGNAR_VENDEDOR_DIA` / `QUITAR_DESIGNACION_DIA`) con `origen: 'calendario_mensual'`.

### Arneses de prueba y resultados en staging

| Arnés de prueba | Archivo | Resultado |
|---|---|---|
| Pruebas de lógica del calendario y guardarraíles (11 pruebas) | `construacero-staging/src/utils/__tests__/calendarioSabados.test.js` | **11/11 en verde** |
| Pruebas del servidor `/api/comisiones/designacion` en lote (5 pruebas) | `construacero-staging/api/handlers/__tests__/designacionSabados.test.js` | **5/5 en verde** |
| Suite completa de pruebas automáticas de staging (42 archivos) | `npm --prefix construacero-staging test` | **360/360 en verde** |
| Construcción de la aplicación (`vite build` + PWA) | `npm --prefix construacero-staging run build` | **OK (0 errores)** |
| Prueba real E2E en servidor y navegador Chromium contra staging (`spupqgkdsgohxxfoxydl`) | `construacero-staging/scripts/verify-op036-calendario-sabados-staging.mjs` | **13/13 en verde (0 errores JS, limpieza verificada)** |

### Archivos creados o modificados en `construacero-staging/`

- `construacero-staging/src/utils/calendarioSabados.js` *(nuevo)*
- `construacero-staging/src/utils/__tests__/calendarioSabados.test.js` *(nuevo)*
- `construacero-staging/api/handlers/admin.js` *(modo lote en `handleDesignacion` + validación `es_externo=is.false`)*
- `construacero-staging/api/handlers/__tests__/designacionSabados.test.js` *(nuevo)*
- `construacero-staging/src/views/ComisionesView.jsx` *(nuevo `PanelDesignacion` con calendario mensual de sábados)*
- `construacero-staging/src/components/ui/ConfirmModal.jsx` *(portal a `document.body` para no recortarse)*
- `construacero-staging/scripts/verify-op036-calendario-sabados-staging.mjs` *(nuevo arnés E2E en navegador real)*
- `construacero-staging/.gitignore` *(incluye los 3 archivos nuevos de prueba)*

## Reauditoría previa a producción y cierre de los 5 puntos (22-nov-2026)

**Veredicto final:** **LISTO PARA PRODUCCIÓN.** Los 5 puntos encontrados en la reauditoría fueron corregidos y verificados en staging.

### Qué SÍ estaba sólido desde el inicio

- **Base de datos real (producción) comprobada (solo lectura):**
  - La tabla `comision_designacion_diaria` ya tiene clave única `(cuenta_id, fecha)` y no requiere migraciones.
  - El candado interno de la base (`trg_validar_designacion_diaria`) rechaza inactivos, externos y roles no válidos; los 7 vendedores/supervisores activos de producción tienen `es_externo = false`.
  - La ruta del servidor (`/api/comisiones/designacion`) y el resto de `ComisionesView.jsx` coinciden con producción.

### Los 5 puntos de la reauditoría — todos cerrados y verificados

| # | Qué se corrigió | Verificación |
|---|---|---|
| 1 | **Fallo silencioso al cargar un mes:** ahora muestra un aviso rojo con botón **"Reintentar"** y bloquea la edición y el guardado hasta cargar los datos reales del mes. | Implementado en `ComisionesView.jsx` |
| 2 | **Guardado en un solo bloque atómico + `DELETE` protegido:** el servidor guarda todos los sábados asignados en **1 solo bloque** y borra los quitados en **1 solo bloque**; si falla un guardado, la pantalla se resincroniza sola. Además, la ruta `DELETE` individual rechaza borrar fechas pasadas con `400`. | Verificado en `designacionSabados.test.js` (**6/6**) y en staging real |
| 3 | **Cambios sin guardar + clics rápidos en `◀`/`▶`:** cancela peticiones anteriores (`AbortController`) y bloquea las flechas de mes con aviso claro mientras haya cambios sin guardar. | Verificado en navegador real (`nextDisabled=true, aviso=true`) |
| 4 | **Sin parpadeo de falsa alerta amarilla:** la alerta de sábado vacío solo se muestra tras terminar la primera carga exitosa (`cargadoUnaVez && !errorCarga`). | Implementado en `ComisionesView.jsx` |
| 5 | **Prueba en celular (`390×844`) + limpieza de lint:** verificada vista móvil sin desborde horizontal (`scrollWidth=390 / innerWidth=390`), selector táctil abriendo limpio y **0 errores / 0 advertencias** en `calendarioSabados.js` y `admin.js`. | Verificado en Chromium móvil + ESLint |

### Resultado final de todas las pruebas en staging

- **Pruebas automáticas (`npm --prefix construacero-staging test`):** **42/42 archivos, 361/361 pruebas en verde** (11 de calendario + 6 de servidor).
- **Revisor de código (`eslint`):** **0 errores, 0 advertencias** en `calendarioSabados.js` y `admin.js`.
- **Construcción (`npm --prefix construacero-staging run build`):** **OK** (aplicación + PWA).
- **Prueba real E2E en staging (`verify-op036-calendario-sabados-staging.mjs`):** **17/17 en verde** (API + PC `1366×900` + Celular `390×844` + 0 errores JS + 0 datos residuales).

*(Nota técnica para cuando se porte a producción: el código principal en `origin/main` usa `supaServiceHeaders(env)` en `api/handlers/admin.js`, por lo que al pasar a producción se abrirá una rama limpia desde `origin/main`.)*

## Publicación en producción (22-nov-2026)

- **Solicitud de cambio:** PR **#64** (`feat/op-036-calendario-sabados` → `main`).
- **Commits:** `579c0e19` (código + pruebas), unión en `main` `c507d849`.
- **Pruebas en `main` antes de publicar:** **109/109 archivos, 1.085/1.085 pruebas automáticas en verde**; compilación de producción (`vite build` + Service Worker PWA) **OK**.
- **Verificación posterior al despliegue en producción:**
  - GitHub Actions (`Deploy Worker a Cloudflare`, ejecución `45045641378`): **en verde** (43 s).
  - Vercel (`https://listo-pos-cotizaciones.vercel.app`): **HTTP 200**; confirmado en vivo que el archivo publicado (`assets/ComisionesView-Bb7NTPUt.js`, cargado por `assets/index-Cfz3NFyJ.js`) ya incluye el nuevo `Calendario de designados (sábados)` y sus guardarraíles.
  - Worker en vivo: `/api/ping` → **200 `ok`**; `/api/comisiones/designacion` sin sesión → **401 `No autenticado`**.
- **Pendiente de verificación humana:** que un Jefe (Enzo o Gabi) abra *Comisiones* en producción (recargando si aparece el aviso "Hay una versión nueva") y programe el sábado 28 de noviembre y los sábados de diciembre.
