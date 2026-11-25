# OP-2026-079 — Unificación a vista única en cuadrícula (solo staging)

## En resumen

Se eliminó el botón para alternar entre **cuadrícula** y **lista** junto con las filas de lista en las cuatro pantallas que aún lo tenían (**Clientes**, **Personal**, **Cotizaciones** y **Despachos**) dentro de `construacero-staging/`. Ahora todo el sistema opera siempre con tarjetas en cuadrícula (como ya hacían **Inventario** y **Proveedores**), con menos código por mantener y mejor aprovechamiento del ancho tanto en teléfono como en computadora. No se tocó producción ni la base de datos, y se mantuvieron intactos el selector de formato de la **Lista de Precios en PDF** y las tablas de **Reportes**.

---

## Qué cambió para el negocio

1. **Una sola experiencia visual consistente:** en **Clientes**, **Personal**, **Cotizaciones** y **Despachos** desapareció el selector `[⊞ | ☰]` y las tarjetas son ahora la única vista. Todas las acciones que antes estaban en la vista lista ya existían en las tarjetas.
2. **Transición transparente para quien usaba vista lista:** si algún teléfono o computadora tenía guardada en el navegador la preferencia `"list"`, al abrir la pantalla se convierte automáticamente a `"grid"` mediante el ayudante `limpiarVistaListaGuardada` (`construacero-staging/src/utils/vistaCuadricula.js`), equivalente a cambiar una sola vez la configuración guardada sin que nadie note un error ni un botón desaparecido.
3. **Menos piezas duplicadas:** se retiraron los tres componentes obsoletos que solo dibujaban renglones de lista (`ClienteRow.jsx`, `CotizacionRow.jsx` y `DespachoRow.jsx`).
4. **Lo que se dejó intacto por decisión confirmada:**
   - **Lista de Precios en PDF** (`construacero-staging/src/components/inventario/ListaPreciosModal.jsx`): conserva la elección entre formato *Lista* y *Cuadrícula (Catálogo)* porque define el diseño del documento impreso, no la pantalla.
   - **Reportes** (`construacero-staging/src/views/ReportesView.jsx`): conserva sus tablas en computadora y tarjetas en celular porque responden a análisis financiero y consultas contables.

---

## Archivos modificados, creados y eliminados (`construacero-staging/`)

| Acción | Archivo | Propósito |
| --- | --- | --- |
| Creado | `construacero-staging/src/utils/vistaCuadricula.js` | Ayudante `limpiarVistaListaGuardada` para migrar preferencias `"list"` a `"grid"` en el almacenamiento local del navegador (`localStorage`, la libreta de preferencias del propio dispositivo). |
| Editado | `construacero-staging/src/views/ClientesView.jsx` | Quita el selector lista/cuadrícula, el estado `vistaMode` y `ClienteRow`; ejecuta la migración automática al abrir. |
| Editado | `construacero-staging/src/views/PersonalView.jsx` | Quita el selector lista/cuadrícula, el estado `vistaMode` y `ClienteRow`; ejecuta la migración automática al abrir. |
| Editado | `construacero-staging/src/views/CotizacionesView.jsx` | Quita el selector lista/cuadrícula, `CotizacionRow` y el modal auxiliar que solo usaba esa fila; ejecuta la migración automática al abrir. |
| Editado | `construacero-staging/src/views/DespachosView.jsx` | Quita el selector lista/cuadrícula, `DespachoRow` y los modales que solo abría la vista lista; ejecuta la migración automática al abrir. |
| Editado | `construacero-staging/src/views/ProveedoresView.jsx` | Retira los íconos `LayoutGrid` y `List` que ya habían quedado sin uso. |
| Eliminado | `construacero-staging/src/components/clientes/ClienteRow.jsx` | Archivo sin ningún otro uso en el proyecto. |
| Eliminado | `construacero-staging/src/components/cotizaciones/CotizacionRow.jsx` | Archivo sin ningún otro uso en el proyecto. |
| Eliminado | `construacero-staging/src/components/despachos/DespachoRow.jsx` | Archivo sin ningún otro uso en el proyecto. |
| Creado | `construacero-staging/src/utils/__tests__/soloVistaCuadricula079.test.js` | Pruebas automáticas (4 verificaciones) sobre `limpiarVistaListaGuardada`, ausencia de botones de alternancia y conservación intacta del PDF de Lista de Precios. |

---

## Verificación realizada después del último cambio

Todas las pruebas se ejecutaron sobre `construacero-staging/` **sin modificar producción ni la base de datos**:

1. **Pruebas automáticas (`npm --prefix construacero-staging test`):**
   - **61/61** archivos de prueba aprobados (**521/521** pruebas individuales), incluidas las 4 pruebas nuevas de `soloVistaCuadricula079.test.js` y las 9 pruebas de contrato móvil de [OP-2026-077](OP-2026-077_fixeo-responsividad-movil-staging.md).
2. **Compilación completa (`npm --prefix construacero-staging run build`):**
   - Compilación de interfaz y generación del paquete sin conexión (PWA / *service worker* `dist/sw.js` con 84 entradas) terminadas sin errores ni advertencias de importaciones rotas.
3. **Inspección en navegador real (Chromium sobre `construacero-staging/dist`, con datos simulados de cuenta):**
   - **68 de 68** comprobaciones sin incidentes en tamaños **360 × 800 px** (teléfono compacto), **375 × 812 px** (teléfono estándar) y **1280 × 800 px** (computadora).
   - **0** desbordamientos horizontales (`docScroll` y `mainScroll` igual al ancho visible en todas las pantallas) y **0** errores en pantalla o en consola.
   - **0** botones de alternancia (`title="Vista lista"` o `title="Vista cuadrícula"`) visibles en ninguna ruta.
   - Sembrado previo de `"list"` en `clientes_vista`, `personal_vista`, `cotizaciones_vista` y `despachos_vista` confirmado automáticamente convertido a `"grid"` en los tres tamaños de pantalla.
   - Revisión visual directa de capturas en `Clientes`, `Personal`, `Cotizaciones` y `Despachos` (en `360 px` tarjetas en 1 columna limpia; en `1280 px` cuadrícula de varias columnas).

---

## Estado y próximo paso

- **Estado:** Aplicado y verificado únicamente en **`construacero-staging/`** (sin confirmar ni subir todavía a producción/`main`).
- **Pendiente para cerrar en producción:** Cuando revises **staging** y des el visto bueno, integrar en una rama limpia desde `main` tanto las mejoras móviles ([OP-2026-077](OP-2026-077_fixeo-responsividad-movil-staging.md)) como esta unificación a cuadrícula (**OP-2026-079**).
