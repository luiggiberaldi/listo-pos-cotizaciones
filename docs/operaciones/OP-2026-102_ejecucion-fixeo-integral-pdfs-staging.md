# OP-2026-102 — Ejecución del arreglo integral de los 19 PDFs en pruebas (staging)

**Fecha:** 2026-11-27  
**Plan de origen:** [OP-2026-101_plan-fixeo-integral-pdfs-staging.md](../plans/OP-2026-101_plan-fixeo-integral-pdfs-staging.md)  
**Rama de pruebas:** `fix/op-101-pdfs-integral-staging` (carpeta de trabajo `construacero-op-101`)  
**Entorno afectado:** **Solo staging (copia de pruebas). Producción NO se tocó.**

---

## En resumen

- **Se ejecutaron y verificaron las Fases 0 a 5 del plan OP-2026-101** en la rama de pruebas (`staging`).
- **Todos los PDFs activos del sistema ahora salen con datos frescos, completos y en hora de Venezuela:** se eliminaron los casos de precios en Dólar BCV impresos en USDT, productos desactivados en la lista de precios, datos viejos al cambiar rápido de fechas en reportes, recortes silenciosos al pasar de 1.000 registros, días vencidos mal contados en reportes de meses pasados y nombres/columnas que se pisaban en Personal y Flota.
- **Se limpió el código muerto y las plantillas en blanco sin uso** (4 generadores viejos, 1.533 líneas de comisiones viejas, la carpeta `backup/` y el menú oculto de plantillas vacías).
- **Verificación automática al 100 %:** **136 de 136 archivos de pruebas en verde (1.307 pruebas pasadas, 0 fallas)** y **compilación limpia (`vite build` + PWA sin errores)**.
- **Carpeta principal (`construacero/` en `main`) intacta y limpia.** Producción no se ha tocado; queda pendiente tu revisión visual en staging antes de autorizar la Fase 6 (paso a producción).

---

## Decisiones aprobadas y aplicadas

1. **Bloque de Crédito dentro del Reporte de Ventas:** ahora filtra por vendedores Internos/Externos, usa hora de Venezuela y se titula **"Créditos otorgados en el período (saldos pendientes)"** para no confundirlo con la deuda histórica total.
2. **Despachos "Por aprobar" en Flota / Transportistas:** se excluyeron de la Tabla 1 (`estado=in.(despachada,entregada)`) para que Tabla 1, Cuadro 2 y el Resumen dentro del mismo PDF cuadren al 100 %.
3. **Limpieza de código muerto y plantillas vacías:** eliminados `inventarioPDF.js`, `despachoReportePDF.js`, `liquidacionPDF.js`, `pipelinePDF.js`, `plantillaNotaEntregaPDF.js`, `plantillaOrdenDespachoPDF.js`, el menú muerto `_PlantillaDropdown`, `src/services/pdf/backup/` y las 1.533 líneas viejas de `generarComisionesPDF` en `comisionesPDF.js`.

---

## Resumen de cambios por fase (commits en `fix/op-101-pdfs-integral-staging`)

| Fase | Qué se corrigió | Commit |
|---|---|---|
| **Fase 0** | Utilidades compartidas (`pdfShared.js`): fechas en hora Venezuela (`America/Caracas`), nombres de archivo con fecha correcta después de las 8:00 p. m., soporte para páginas horizontales, protección contra datos vacíos. | `084c71e1` |
| **Fase 1** | **PDFs operativos y Lista de Precios:** conversión real a Dólar BCV (`tasaUsdt / tasaBcv`), exclusión de productos inactivos y recarga fresca en Lista de Precios; recarga fresca de cabecera e ítems en Despachos, Venta Rápida (corte, dirección alternativa y préstamo), Cotizaciones (marca `ANULADA`) y Órdenes de Compra (`ATENCIÓN A:` con contacto real del proveedor); arreglo de `CTA POR COBRAR` falsa en Orden de Despacho con devoluciones y typo `R.I.F./C.I.` en Factura. | `5c6b2368` |
| **Fase 2** | **Blindaje de reportes y fin de recortes en 1.000 filas:** botones Imprimir/Descargar deshabilitados mientras cambia el período + recarga fresca al exportar en Ventas, Comisiones, Crédito/CxC, Artículos Externos y Vendedores; paginación completa (sin tope de 1.000) en los 5 puntos de exportación de Comisiones, Artículos Externos y detalles de ítems; lectura de cotizaciones en tandas de 100. | `7d8fabb4` |
| **Fase 3** | **Exactitud financiera y CxC:** "Caja Real" unificada entre pantalla y PDF (descuenta `Saldo a Favor` sin importar mayúsculas) y filtro fiel de Internos/Externos en Ventas; limpieza automática de ajustes manuales al cambiar de semana y conservación de montos sin artículos clasificados en Comisiones; signo negativo (`-`) y hora Venezuela en Vendedores; días vencidos contra la fecha de corte (`rango.to`), bloque "Resumen del período", etiqueta `[PERSONAL]`, total en Cobranza, aviso naranja claro ("N notas en alerta de M clientes") y cuadro "Pagos de más sin deuda" en CxC; filtro y código visibles en Externos; cobros a destino pagados acreditados correctamente en Ventas del día; cabeceras repetidas al saltar de página en Ventas del día y Mis Ventas. | `c4f90d64` |
| **Fase 4** | **Catálogos, Flota y limpieza:** Transportistas ahora exporta todos los choferes del filtro (no solo los 12 visibles), cruza los camiones de flota propia e incluye teléfono y filtro; Flota refresca la Tabla 1 al exportar, cuadra con Cuadro 2 excluyendo "Por aprobar", avisa si falla el peso y corrige el `100%` con 0 viajes; Personal guarda como `Reporte_de_Personal_YYYY-MM-DD.pdf` sin columnas pisadas y con filtros visibles; limpieza total de PDFs muertos y respaldos obsoletos (`-12.578` líneas). | `a2f50db0` |

---

## Verificación ejecutada (Fase 5)

1. **Suite completa de pruebas automáticas (`npx vitest run`):**
   - **136 / 136 archivos en verde — 1.307 / 1.307 pruebas pasadas (0 fallas).**
   - Incluye nuevas pruebas de regresión específicas para cada fase (`listaPreciosPDF.test.js`, `op101Fase1Operativos.test.js`, `comisionesYExternosPaginacionPdf.test.js`, `op101Fase3Financieros.test.js`, `op101Fase4CatalogosFlota.test.js`).
2. **Compilación de producción (`npx vite build`):**
   - **Exitosa (0 errores)** — 2.333 módulos compilados + Service Worker PWA generado (`dist/sw.js`).
3. **Verificación de aislamiento:**
   - Carpeta principal `construacero/` verificada en rama `main` sin archivos modificados ni sueltos.
   - Base de datos y servidores de producción sin ningún cambio.

---

## Próximo paso

- Revisión visual de los PDFs en **staging** por tu parte.
- Solo cuando des tu **"Aprobado"**, se abrirá la **Fase 6** (paso controlado a producción con solicitud de cambio limpia y verificación en vivo).
