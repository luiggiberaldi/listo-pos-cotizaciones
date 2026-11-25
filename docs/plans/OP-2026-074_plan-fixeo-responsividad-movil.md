# OP-2026-074 — Plan de arreglo completo de responsividad móvil (primero en staging)

**Fecha:** 2026-11-25 · **Basado en:** diagnóstico [OP-2026-073](../operaciones/OP-2026-073_revision-responsividad-movil.md) · **Estado:** 🧪 **Aplicado y verificado en staging** (ver reporte [OP-2026-077](../operaciones/OP-2026-077_fixeo-responsividad-movil-staging.md); pendiente aprobación para producción).

## En resumen

- **Objetivo:** dejar **todas las pestañas y botones del sistema adaptados limpiamente a teléfono celular** (`360 px` y `375 px` de ancho) sin cortar botones, sin obligar a mover la pantalla de lado y sin dañar el diseño actual en computadora.
- **Orden de trabajo:** primero aplicamos y probamos **todo en `construacero-staging/` (copia de pruebas)** en navegador móvil (`360×800`, `375×812`) y PC (`1280×800`); solo cuando tú lo revises y apruebes, lo pasamos limpio a producción (`main`).
- **Base de datos:** **cero cambios** (es 100% visual en pantallas y componentes del navegador).

---

## Cómo leer los términos de este plan (en palabras simples)

- **"Salto de línea" (`flex-wrap`):** cuando varios botones no caben en una sola fila angosta, bajan ordenados a una segunda línea (como las palabras de un párrafo) en vez de salirse por el borde derecho.
- **"Candado de ancho" (`shrink-0`):** una regla de diseño que obliga a una caja a mantener un tamaño fijo aunque la pantalla sea pequeña. Quitarla o aplicarla solo en PC permite que en celular se acomode.
- **"Área táctil":** el tamaño mínimo cómodo de un botón para tocarlo con el dedo sin fallar (idealmente de `36` a `44 px` de alto).

---

## Alcance por tareas (en `construacero-staging/` primero)

### Tarea 1 — Botones superiores que se cortan en Clientes, Personal y Transportistas

**Problema observado:** cuando entras como Jefe, Administración o Desarrollador, los botones de `Imprimir` y `Descargar PDF` se suman al botón de `Nuevo...` en una sola fila rígida, empujando el último botón fuera de la pantalla (`383 px` en Clientes, `408 px` en Personal y `451 px` en Transportistas).

**Archivos a tocar en staging:**
- `construacero-staging/src/components/ui/PageHeader.jsx` (líneas 3–40):
  - Cambiar el contenedor derecho de acciones (`shrink-0 pl-5 sm:pl-0`) por `w-full sm:w-auto sm:shrink-0 min-w-0` para que use todo el ancho disponible en móvil sin sangría extra a la izquierda ni empujar el borde derecho.
- `construacero-staging/src/views/ClientesView.jsx` (líneas 340–369):
  - Agregar `flex-wrap` a la fila de botones (`flex flex-wrap items-center gap-2`) y tamaño ligeramente más compacto en teléfono (`px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm`).
- `construacero-staging/src/views/PersonalView.jsx` (líneas 326–355):
  - Mismo cambio: `flex flex-wrap items-center gap-2` y botones compactos en móvil para que `Imprimir`, `Descargar PDF` y `+ Nuevo trabajador` entren sin recortarse.
- `construacero-staging/src/views/TransportistasView.jsx` (líneas 561–592):
  - Agregar `flex-wrap` al contenedor de `[Actualizar] [Imprimir] [Descargar PDF] [+ Nuevo]` y padding compacto en celular (`px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm`), logrando que `+ Nuevo` baje limpio debajo si no cabe en la misma línea.

**Resultado esperado:** `0 px` de desbordamiento lateral en `360 px` y `375 px` para todos los roles; `+ Nuevo`, `+ Nuevo trabajador` y `+ Nuevo cliente` visibles al 100%.

---

### Tarea 2 — Barra de tasas y botones de Imprimir/Descargar cortados en Comisiones

**Problema observado:** en `Comisiones` (y en la pestaña `Reportes → Comisiones`), el bloque que agrupa la pastilla `Euro BCV / USDT` y los botones de `Imprimir / Descargar` tiene `shrink-0` tanto en el contenedor padre como en la pastilla de tasas (`450 px` mínimos). Eso empuja toda la página a **`479 px`** y deja los botones de impresión/descarga escondidos fuera de la pantalla a la derecha.

**Archivo a tocar en staging:**
- `construacero-staging/src/views/ComisionesView.jsx` (líneas 965–1085):
  1. Cambiar `<div className="flex flex-wrap items-center gap-2.5 ml-auto shrink-0 self-end">` por `w-full md:w-auto flex flex-wrap items-center gap-2 md:ml-auto min-w-0`.
  2. En el selector `Euro BCV / USDT`: quitar `shrink-0 h-9` fijo y permitir `flex-wrap sm:flex-nowrap w-full sm:w-auto min-h-9` (mostrando etiqueta corta `Euro:` / `USDT:` en pantalla angosta y completa en PC) para que quepa holgado dentro de `360 px`.
  3. En la pareja de botones `Imprimir PDF` / `Descargar PDF`: asegurar que sus textos cortos sean visibles en móvil (o quepan claros con icono + etiqueta corta) y revisar la alineación del menú desplegable (`left-0 sm:left-auto sm:right-0`) para que al abrirlo en celular no se salga del borde izquierdo ni del derecho.

**Resultado esperado:** en `360 px` y `375 px`, el ancho total de `Comisiones` y `Reportes → Comisiones` baja de `479 px` a **`<= 375 px`** y los botones de Imprimir/Descargar son totalmente visibles y tocables.

---

### Tarea 3 — Barra de filtros que ensancha Orden de Compra

**Problema observado:** la tira de botones `VER TODOS · PENDIENTE · APROBADA · ANULADA` se expande hasta `445 px` y empuja toda la pantalla hacia la derecha.

**Archivo a tocar en staging:**
- `construacero-staging/src/views/OrdenCompraView.jsx` (líneas 968–1008):
  1. Agregar `min-w-0` al contenedor de barra de filtros (`<div className="flex flex-col md:flex-row gap-3 min-w-0">`).
  2. En la tira de estado (`<div className="flex items-center gap-1.5 ...">`): cambiar a `w-full md:w-auto min-w-0 flex-wrap sm:flex-nowrap` (permitiendo que en teléfono los 4 estados salten en 2 líneas si no caben, sin forzar desplazamiento ni desbordamiento de `445 px`, mientras en PC conserva su fila única).

**Resultado esperado:** `Orden de Compra` se mantiene en `<= 375 px` / `<= 360 px` y todos los filtros de estado son visibles de un vistazo.

---

### Tarea 4 — Pestañas apretadas en Configuración y textos cortados en Reportes → Crédito

**Problemas observados:**
1. En **Configuración**, las 4 pestañas (`Negocio · Administración · Usuarios · Datos`) tienen `overflow-hidden` y se aprietan en `375 px` recortando varios píxeles a los lados.
2. En **Reportes → Crédito**:
   - El selector de formato junto a `Imprimir` y `Descargar` queda comprimido y corta el texto a `"Detallado Pl..."`.
   - En `KpiCard` (cuadrícula de 2 columnas en móvil), las descripciones debajo del monto usan `truncate` (una sola línea) y se cortan (`"Excluye cruces internos y de..."`).
   - La tira de subpestañas (`Resumen · Alertas · Clientes · Movimientos · Proveedores`, `500 px`) esconde `Proveedores` sin mostrar señal clara de que hay más opciones al lado.

**Archivos a tocar en staging:**
- `construacero-staging/src/views/ConfiguracionView.jsx` (líneas 908–934):
  - Usar `grid grid-cols-2 sm:flex gap-1` (o quitar `overflow-hidden` y usar `shrink-0`) en las 4 pestañas para que en móvil formen una cuadrícula 2×2 cómoda y legible sin recortar ninguna letra (y una sola barra horizontal de 4 en PC).
- `construacero-staging/src/views/ReportesView.jsx`:
  - **Selector CxC (`formato-reporte-cxc`, línea ~2055):** usar `flex flex-wrap items-center gap-2` donde el `<select>` ocupe `w-full sm:w-auto` encima o acompañado de los botones `Imprimir` / `Descargar` completos (`min-h-10`), evitando que diga `"Detallado Pl..."`.
  - **`KpiCard` (líneas 145–183):** cambiar `truncate` del subtítulo (`sub`) por `leading-snug line-clamp-2` (y ajustar el título a `leading-tight line-clamp-2`) para que se lean las aclaratorias completas en 2 líneas compactas.
  - **Subpestañas de Crédito (`nav` en línea ~2075) y pestañas principales de Reportes (línea ~2850):** usar `flex-wrap` en la sub-barra de Crédito (o compactar etiquetas como `Movim.` en móvil) para que las 5 opciones queden visibles o claramente accesibles sin ocultar *Proveedores*.

---

### Tarea 5 — Botones flotantes encima del contenido y áreas táctiles pequeñas

**Problemas observados:**
1. En `Inicio`, el botón flotante del **Buzón (`BuzonFAB`)** queda apilado justo encima del botón **`+` (`QuickQuoteFAB`)** a la derecha, tapando texto de las tarjetas de abajo.
2. En pantallas de listado (`Mis ventas`, `Clientes`, `Proveedores`, `Reporte Vendedores`, `Tester Flow`), el botón `+` cubre temporalmente cifras o enlaces del rincón inferior derecho al llegar al final o mientras bajas.
3. En `Proveedores` (`Editar`, `24 px`) y `Tutorial` (`Restablecer progreso` `14 px`, `Iniciar` `27 px`), la altura táctil es muy baja para tocar cómodo en teléfono.

**Archivos a tocar en staging:**
- `construacero-staging/src/components/ui/BuzonFAB.jsx` (línea ~110):
  - En móvil, mover el botón flotante de Buzón a la **esquina inferior izquierda** (`left-4 bottom-20 md:left-auto md:bottom-6 md:right-6`) cuando el rol tiene también `QuickQuoteFAB`, o integrarlo más compacto arriba/izquierda para eliminar por completo la pila vertical doble en la derecha. *(Verificar que no choque con el menú inferior ni el banner offline).*
- `construacero-staging/src/components/layout/AppLayout.jsx` (línea ~689):
  - Aumentar el espacio de respiro inferior en móvil al final de `<main>` de `h-20` (`80 px`) a `h-24` (`96 px`) para que, al bajar hasta el final de cualquier lista o tabla, el último elemento suba por encima del botón flotante `+`.
  - En `QuickQuoteFAB.jsx`: revisar si debe ocultarse también en vistas puramente administrativas o de consulta donde ya no crea cotizaciones rápidamente (por ejemplo `/proveedores`, `/usuarios`, `/reporte-vendedores`, `/tester`, `/tester-flow`, `/auditoria`, `/logs`), dejando el `+` solo donde el usuario realmente cotiza o vende rápido (o manteniendo un criterio claro contigo antes de quitarlo de algún sitio).
- `construacero-staging/src/views/ProveedoresView.jsx` (línea ~587):
  - Cambiar el botón `Editar` de cada tarjeta (`p-1 text-xs`, `24 px`) a `min-h-9 px-3 py-1.5 rounded-lg bg-slate-100/80 hover:bg-slate-200/80 text-xs font-bold` (`36 px` cómodo).
- `construacero-staging/src/views/TutorialView.jsx`:
  - Subir área táctil de `Iniciar` / `Repasar` a `min-h-9 px-3.5 py-2` (`36 px` mínimo) y de `Restablecer progreso` (`py-1.5 px-2 -ml-2`).

---

### Tarea 6 — Revisión extra de modales en celular + pruebas automáticas en staging

Antes de cerrar staging, comprobaremos también que al abrir las ventanas emergentes (`Modal.jsx`, `ClienteForm`, `ConfirmModal`, `LoginPinModal` y formularios de creación/edición en `Clientes`, `Transportistas`, `Personal`, `Proveedores` y `Despachos`) dentro de `360×800` y `375×812`:
- Ninguna ventana emergente quede cortada por arriba/abajo ni tenga botones de **Guardar / Cancelar** ocultos sin poder bajar.
- Ningún menú desplegable se salga de los bordes.

**Verificación obligatoria en `construacero-staging/`:**
1. Crear prueba de contrato/regresión en `construacero-staging/src/utils/__tests__/mobileResponsiveContract074.test.js` verificando que las barras críticas mantengan envoltura (`flex-wrap`) y contención (`min-w-0`), sin volver a introducir `shrink-0` rígidos en `ComisionesView`.
2. Correr `npm test` y `npm run build` dentro de `construacero-staging/`.
3. Correr un guion de auditoría en navegador real (Playwright en Chromium a **`360×800`**, **`375×812`** y **`1280×800`** para PC, sin tocar base real) verificando:
   - `0` pantallas con `ERROR_BOUNDARY` (corrigiendo también el dato simulado de `Ventas del día` para ver esa pantalla renderizada al 100%).
   - `0` vistas con `mainScrollWidth > viewportWidth` (`Clientes`, `Personal`, `Transportistas`, `Comisiones`, `Orden de Compra`, `Configuración`, `Reportes`).
   - `0` texto recortado en pestañas de `Configuración` o select de `Reporte CxC`.
   - Inspección visual de capturas en celular y PC.

---

## Paso siguiente (después de probar en staging)

1. Documentar los resultados y capturas de staging en un caso operativo o actualización de `OP-2026-074`.
2. Cuando pruebes y apruebes en **staging**, portar exactamente los mismos archivos en una **rama limpia creada desde `main`** (igual que hicimos con **OP-2026-072** para no arrastrar cambios locales viejos de `OP-025` ni borradores de inventario), pasar pruebas y build, y desplegar con solicitud de cambio en GitHub.
