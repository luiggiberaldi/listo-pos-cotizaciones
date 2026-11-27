# OP-2026-102 — Optimización de tinta, encabezado y colores del PDF Base de Datos de Clientes (y Personal)

**Fecha:** 2026-11-27 · **Estado:** **Listo para pasar a producción (solicitud [#90](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/90) abierta en `construacero-op-102`, rama `fix/op-102-pdf-clientes-optimizado`)**; producción intacta hasta tu aprobación final · **Pendiente:** aprobar y unir la solicitud #90.

## En resumen

- Se actualizó el PDF de **Base de Datos de Clientes** (y el de **Reporte de Personal**, que usa la misma plantilla) para que tenga exactamente el **mismo encabezado, lógica de colores y pie de página ahorradores de tinta** que los demás reportes optimizados del sistema (*Base de Datos de Choferes*, *Artículos Externos*, *Reporte de Ventas* y *Mis Ventas*).
- **Ahorro real de tinta al imprimir:** desaparecieron la franja azul oscura de extremo a extremo arriba y los tres bloques grandes rellenos de colores sólidos (azul oscuro, verde y marrón) de las tarjetas de resumen. Ahora usa fondo **blanco** con detalles y letras en **negro**, el logo corporativo a color que se distingue limpio sobre papel blanco y cajas de resumen claras (`#F8FAFC`) con borde fino.
- **Mejoras incluidas en la misma plantilla:**
  - Encabezado delgado `(Cont.)` en las hojas 2 en adelante y repetición automática de los títulos de la tabla.
  - Los nombres largos ya no se cortan a la mitad: se acomodan en varias líneas dentro de su columna (continuación del trabajo pendiente de [OP-2026-024](OP-2026-024_pdf-sin-recortes.md)).
  - El subtítulo muestra el filtro aplicado en pantalla (por ejemplo *"Mis clientes · Solo activos"* o *"Todos los clientes · Con deuda"*), los botones refrescan los datos antes de exportar y el archivo de **Personal** ahora se guarda como `Reporte_de_Personal_YYYY-MM-DD.pdf` en hora de Venezuela (`America/Caracas`).

---

## Qué cambió (antes vs. después)

| Parte del documento | Cómo salía antes | Cómo sale ahora |
|---|---|---|
| **Encabezado (Hoja 1)** | Franja azul oscura de 4 cm en todo lo ancho, acentos amarillos y logo en silueta negra poco legible. | Fondo **blanco**, diagonales y líneas **negras**, título y fecha **negros** y logo corporativo nítido (`LOGO_LISTA_PRECIOS`), igual al de Choferes y Ventas. |
| **Tarjetas de resumen (KPIs)** | 3 rectángulos grandes rellenos en azul oscuro, verde esmeralda y marrón/ámbar con texto blanco. | 3 cajas muy claras (`#F8FAFC`) con borde gris fino (`#E2E8F0`) y texto oscuro: prácticamente cero gasto de tóner/tinta. |
| **Hojas 2 en adelante** | Saltaba de hoja sin barra superior ni encabezado repetido. | Barra compacta blanca/negra `(Cont.)` y repetición automática de los encabezados de columna. |
| **Textos largos** | Recorte rígido con `.substring(...)` (perdía el final de nombres o razones sociales). | Ajuste en varias líneas con `wrapLines` y altura de fila dinámica (`rowHeight`), sin pisar la columna vecina. |
| **Pie de página** | Línea azul simple sin dirección ni contacto. | Pie estándar blanco/negro (`drawPremiumFooter`) con dirección, teléfono y correo, y margen inferior seguro (`35 mm` en la hoja 1, `14 mm` en las siguientes) para que ninguna fila se monte encima. |
| **Nombre del archivo y hora** | Siempre `Base_de_Datos_Clientes_...` (incluso en Personal) y fecha mundial UTC (saltaba al día siguiente después de las 8:00 p. m. VE). | `Base_de_Datos_Clientes_YYYY-MM-DD.pdf` o `Reporte_de_Personal_YYYY-MM-DD.pdf` usando siempre hora de Venezuela (`America/Caracas`). |
| **Filtros y datos al día** | No mostraba si estaba en *"Mis datos"* o filtrado, y leía solo la copia guardada en pantalla. | Intenta refrescar del servidor antes de armar el PDF (si no hay conexión, usa la lista en pantalla) y aclara en el subtítulo los filtros activos. |

---

## Archivos modificados o creados (rama `fix/op-102-pdf-clientes-optimizado`)

| Acción | Archivo | Propósito |
|---|---|---|
| Editado | `src/services/pdf/clientesPDF.js` | Encabezado y pie blanco/negro, logo `LOGO_LISTA_PRECIOS`, cajas KPI claras, continuación `(Cont.)`, líneas dinámicas sin recorte, cálculo mensual y nombre de archivo en hora Caracas. |
| Editado | `src/services/pdf/pdfShared.js` | Ayudantes compartidos `fechaArchivoCaracas`, `wrapLines` y `rowHeight`; protección de `config?.` y zona horaria `America/Caracas` en `fmtFecha`. |
| Creado | `src/utils/clientesListado.js` | Lógica compartida de filtrado/ordenamiento (`filtrarClientes`) y descripción legible de filtros (`resumenFiltrosClientes`). |
| Editado | `src/views/ClientesView.jsx` | Reutiliza `clientesListado.js`, refresca antes de exportar y pasa `filtroResumen` al PDF; bloquea botones mientras actualiza o con lista vacía. |
| Editado | `src/views/PersonalView.jsx` | Igual que `ClientesView`, conservando `title: 'Reporte de Personal'`. |
| Creado | `src/services/__tests__/clientesPersonalPdf.test.js` | 5 pruebas automáticas (estilo blanco/negro sin bloques oscuros, saltos multipágina, Personal, fecha Caracas nocturna, lista vacía / `config` nulo). |
| Creado | `src/utils/__tests__/clientesListado.test.js` | 3 pruebas automáticas de filtrado, ordenamiento y texto resumen de filtros. |
| Editado | `.gitignore` | Agrega las 2 pruebas nuevas para su seguimiento en Git. |

*(Nota sobre carpetas locales: `construacero-work` contenía un borrador incompleto de `wrapLines`/`rowHeight` en `clientesPDF.js` y `pdfShared.js` sobre una rama vieja de OP-024; ese ajuste quedó absorbido íntegramente aquí sobre `origin/main` limpio.)*

---

## Verificación realizada después del último cambio

1. **Revisión de código (`eslint`):** `0` errores en los archivos nuevos y editados de lógica y pruebas.
2. **Pruebas automáticas (`npm test` en `construacero-op-102`):** **133/133 archivos aprobados · 1.296/1.296 pruebas aprobadas** (incluidas las 8 pruebas nuevas de este caso y todas las pruebas previas de encabezados PDF, responsividad móvil y vista cuadrícula).
3. **Compilación de producción (`npm run build`):** terminada sin errores (`dist/sw.js`, 84 recursos en caché PWA).
4. **Inspección visual directa de PDFs de ejemplo (guardados fuera de Git en `tmp/pdfs-generados/op102/`):**
   - `despues_Base_de_Datos_Clientes_2026-11-27.pdf` (2 páginas, 45 clientes de ejemplo): verificadas visualmente página 1 y página 2 convertidas a imagen.
   - `despues_Reporte_de_Personal_2026-11-27.pdf` (1 página): verificada visualmente página 1 convertida a imagen.
   - Comparado lado a lado contra `antes_Base_de_Datos_Clientes_2026-11-27.pdf` y `despues_Base_de_Datos_Choferes_2026-11-27.pdf`.
5. **Prueba en navegador real (Chromium sobre `dist/` compilado, con datos sintéticos aislados):**
   - Sesión iniciada con PIN como `jefe`, apertura de `/clientes` (modos *"Mis datos"* y *"Todos"*) y `/personal`:
   - Descarga real verificada de `Base_de_Datos_Clientes_2026-11-27.pdf` (en *Mis datos* = 1 cliente y filtro visible; en *Todos* = 2 clientes con texto multilínea sin recortes) y `Reporte_de_Personal_2026-11-27.pdf` (1 trabajador).
   - Verificado que al pulsar **Descargar PDF** refresca los datos del servidor (`clientesCalls: 5`), que **Imprimir** ejecuta sin errores, **0 errores de página/consola** y **0 desbordamiento horizontal** en pantalla de computadora (`1280×800`) y teléfono (`360×800`).

---

## Preparación para paso seguro a producción

### 1. Control de alcance y riesgo (bajo)
- **Punto de partida:** `origin/main` = `e85518b0` (Merge PR #89, [OP-2026-097](../plans/OP-2026-097_plan-paso-a-produccion-inventario-y-seguridad.md)).
- **Qué entra:** únicamente código de pantalla y generación de PDFs (`src/`), pruebas automáticas y documentación.
- **Qué NO se toca:** **0 cambios** en base de datos (`supabase/migrations/`), **0 cambios** en el servidor (`api/`, `worker.js`), **0 cambios** en `vercel.json` ni `wrangler.toml`, ni en `construacero-staging/`.

### 2. Verificación posterior al unir a `main` (humo en producción)
1. Confirmar despliegue en verde de **Vercel** (frontend) y del flujo **Deploy Worker a Cloudflare** en GitHub Actions.
2. Comprobar que la app carga (`200`), `/api/ping` responde (`200`) y una ruta privada sin sesión sigue respondiendo `401`.
3. Entrar en **Clientes** (probar *Mis datos* y *Todos*) y en **Personal**, descargar el PDF e imprimir una hoja de prueba en papel para confirmar encabezado, logo y ahorro de tinta reales. *(Recordar recargar si ya había una sesión abierta con versión anterior.)*

### 3. Plan de vuelta atrás (rollback)
- **Opción A (más rápida para pantalla):** en **Vercel**, usar *Instant Rollback* al despliegue anterior (`e85518b0`).
- **Opción B (completa en Git):** revertir la solicitud de cambio en GitHub (`git revert` del merge sobre `main`), lo que vuelve a publicar pantalla y Worker al punto `e85518b0` en ~1 minuto.
- **Base de datos:** no hay migraciones que revertir.

---

## Pendiente

- **Tu aprobación para unir la solicitud de cambio a `main`** (y opcionalmente revisar la vista previa de Vercel con solo lectura antes de unir).
- *(Opcional al cerrar el caso)* Retirar las carpetas `construacero-op-102` y la antigua `construacero-work`, pues su ajuste de textos largos sin recorte quedó integrado aquí.
- *(Nota de numeración)* Los números `OP-2026-098` a `OP-2026-101` corresponden a trabajos previos que aún viven en sus propias carpetas locales antes de unirse a `main`.
