# OP-2026-073 — Revisión completa de diseño móvil en todas las pestañas

**Fecha:** 2026-11-25 · **Estado:** 🔍 **Diagnóstico terminado (solo lectura, sin cambios aplicados todavía)** sobre la versión publicada en producción (`ed76e680`, tras solicitud #76).

## En resumen

- Se revisaron **todas las pestañas del sistema en tamaño de teléfono celular** (`375×812 px` y muestra crítica de `360×800 px`, además de revisión directa de código), probando los flujos de **Login, Gerencia/Jefe, Administración, Vendedor y Desarrollador** con datos de prueba sin tocar la base real.
- La mayoría del sistema se ve bien en celular (Login, Inicio, Despachos, Cotizaciones, Venta rápida, Proveedores, Usuarios, Auditoría, Buzón y menús inferiores), **pero hay 4 fallas graves donde botones de acción o filtros se salen por el borde derecho de la pantalla** y **3 detalles importantes** de textos cortados o botones flotantes encima de contenido.
- El arreglo principal es sencillo: permitir que esas filas de botones bajen a una segunda línea en teléfono y quitar un candado de ancho mínimo en la barra de Comisiones.

---

## 1. Fallas graves (cortan botones o empujan la pantalla hacia los lados)

| Pantalla | Qué se rompe en celular | A quién afecta | Dónde está en el código |
|---|---|---|---|
| **Comisiones** y **Reportes → Comisiones** | La barra con las tasas (*Euro BCV / USDT*) y los botones de **Imprimir / Descargar** tiene un bloqueo que le impide encogerse (`450 px` fijos en bloque). Empuja toda la pantalla a **`479 px`** en teléfonos de `375 px` y `360 px`, **sacando los botones de imprimir/descargar fuera de la pantalla**. | Vendedores, supervisores, administración, jefe | `src/views/ComisionesView.jsx` (líneas 965–967) |
| **Transportistas** | La fila superior `[↻] [Imprimir] [Descargar PDF] [+ Nuevo]` no baja de línea. Ensancha la pantalla a **`451 px`** y **corta el botón dorado `+ Nuevo` fuera de la pantalla** (apenas asoma el borde). | Jefe, administración, desarrollador | `src/views/TransportistasView.jsx` (líneas 561–591) |
| **Personal** y **Clientes** | Cuando el rol ve los botones de impresión (`Imprimir` y `Descargar PDF` junto al botón de crear), la fila no salta a otra línea: **Personal** se va a **`408 px`** y recorta **"trabajador"** de *"+ Nuevo trabajador"*; **Clientes** se va a **`383 px`** y corta el borde derecho de *"+ Nuevo cliente"*. *(En vendedores no ocurre porque no ven imprimir/PDF).* | Jefe, administración, desarrollador | `src/views/PersonalView.jsx` (líneas 327–354), `src/views/ClientesView.jsx` (líneas 341–368) y `src/components/ui/PageHeader.jsx` (línea 35) |
| **Orden de Compra** | La tira de filtros (`VER TODOS · PENDIENTE · APROBADA · ANULADA`) fuerza el contenedor externo hasta **`445 px`** en vez de deslizarse por dentro, creando desplazamiento horizontal de toda la página. | Supervisor, jefe, desarrollador | `src/views/OrdenCompraView.jsx` (línea 986) |

---

## 2. Detalles importantes (textos recortados y botones encima de tarjetas)

1. **Configuración (`src/views/ConfiguracionView.jsx`, líneas 909–933):**
   - Las 4 pestañas (*Negocio · Administración · Usuarios · Datos*) quedan muy justas en `375 px` y cada botón recorta entre `4` y `10 px` de espacio en los bordes. Conviene darles un poco más de aire o permitir que deslicen sin recortar el texto.
2. **Reportes → Crédito (`src/views/ReportesView.jsx`):**
   - El selector de formato junto a *Imprimir* y *Descargar* queda muy angosto y corta el nombre a **`"Detallado Pl..."`**.
   - Algunas tarjetas de resumen (2 columnas en celular) truncan subtítulos como *"Excluye cruces internos y de..."*.
   - La fila de subpestañas (*Resumen · Alertas · Clientes · Movimientos · Proveedores*, `500 px`) esconde *Proveedores* a la derecha sin una señal visual obvia de que se puede deslizar.
3. **Botones flotantes (`+` Crear y Buzón 💬) encima del texto en la parte baja:**
   - En **Inicio**, ambos botones flotantes quedan apilados abajo a la derecha tapando parte del encabezado de *"Resultados por vendedor"*.
   - En pantallas de listas o tablas (**Mis ventas, Clientes, Proveedores, Reporte Vendedores, Tester Flow**), el botón flotante `+` queda encima de montos o enlaces de esquina (*"Editar"*) mientras te desplazas.
4. **Botones o enlaces un poco bajos para tocar con el dedo:**
   - En **Proveedores**, el botón **"Editar"** mide `24 px` de alto (lo cómodo en celular es al menos `36–44 px`).
   - En **Tutorial**, el enlace *"Restablecer progreso"* mide `14 px` y el botón *"Iniciar"* `27 px`.
   - En **Inventario**, las etiquetas de código tipo `# CAB-38-6M` miden `25 px` de alto (aceptable si son solo etiquetas rápidas, ampliable si se tocan mucho).

---

## 3. Pantallas que SÍ se ven bien y caben limpias en celular (`375 px`)

- **Login (`/` acceso):** correo/clave y **"¿Quién está operando?"** con la barra de tasas nueva arriba (`48 px`), tarjetas ordenadas y sin desbordamiento útil.
- **Menú inferior (`BottomNav`) y panel "Más":** botones grandes, centrados y claros.
- **Despachos** y **Cotizaciones** (tarjetas): se adaptan perfecto a `375 px` y `360 px` con todos los montos, estados y acciones visibles.
- **Venta rápida:** pasos, buscador y categorías sin desbordamientos.
- **Inventario (Productos y Movimientos):** encaja dentro de `375 px`; su tira de chips (*Stock bajo · Stock Negativo · Solo desactivados…*) se desliza horizontalmente sin ensanchar la página.
- **Mis ventas:** tarjetas de resumen y botones *Descargar PDF / Imprimir / Enviar por WhatsApp* caben bien en `375 px`.
- **Proveedores, Usuarios, Auditoría, Buzón / Logs, Tester, Tester Flow, Tutorial:** todas caben dentro de `375 px` sin desbordarse hacia los lados.
- **Reportes → Ventas, Reportes → Transportistas, Reportes → Artículos Externos y Reporte de Vendedores:** caben en `375 px`, usando tablas internas que se deslizan horizontalmente dentro de su propio recuadro sin romper el ancho de la pantalla. *(Nota: en **Reportes → Ventas del día**, la inspección automática con datos de prueba falló por un campo faltante del simulador; por lectura directa de `src/components/reportes/TabVentasDia.jsx`, su barra de botones envuelve en varias filas y su tabla usa desplazamiento interno `overflow-x-auto`).*

---

## 4. Qué se propone hacer después (cuando lo apruebes)

Arreglar primero los **4 problemas graves** en **staging** (`construacero-staging/`), probar en navegador móvil (`360 px` y `375 px`), y luego pasar el lote a producción:
1. Agregar salto de línea (`flex-wrap`) a los botones superiores de **Clientes**, **Personal** y **Transportistas**, y quitar el `shrink-0` excesivo en la barra de tasa/exportar de **Comisiones**.
2. Encerrar correctamente el contenedor deslizable de filtros en **Orden de Compra** (`w-full min-w-0`) para que no empuje toda la pantalla.
3. Ajustar las pestañas de **Configuración**, el ancho del selector de **Reportes → Crédito**, el área táctil de **Editar** en Proveedores y dar un poco más de aire inferior o reubicar los botones flotantes donde estorban.
