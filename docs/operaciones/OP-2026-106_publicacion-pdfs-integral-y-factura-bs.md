# OP-2026-106 — Publicación a producción: arreglo integral de los 19 PDFs activos, Factura predeterminada en Bs e indicador de entorno de pruebas

## En resumen

Este caso documenta la **Fase 6 (paso a producción)** del plan [OP-2026-101](../plans/OP-2026-101_plan-fixeo-integral-pdfs-staging.md), ya probado y aprobado en pantalla por el usuario en el entorno de pruebas (`staging`).

- **Qué mejora para el negocio:**
  1. **Todos los 19 PDFs activos del sistema** fueron corregidos y unificados (fechas en hora de Venezuela, sin recortes de tablas, sin topes ocultos de 1.000 registros en reportes, sin marcas de agua duplicadas y sin plantillas vacías o código muerto).
  2. **Factura PDF siempre en Bolívares (`Bs`) por defecto:** cada vez que se abre *Generar Factura*, la moneda viene seleccionada en **Bs** de forma predeterminada; si se necesita otra moneda (`$` USDT o `BCV`), debe cambiarse manualmente dentro de la misma ventana.
  3. **Se conservó al 100 % el ahorro de tinta** en *Base de Datos de Clientes* y *Reporte de Personal* publicado en [OP-2026-102](OP-2026-102_pdf-clientes-optimizado-impresion.md).
  4. **Indicador visual permanente de entorno de pruebas (`STAGING`):** solo aparece cuando la app corre contra la base de pruebas; **nunca aparece en producción**.
- **Cambios en la base de datos de producción:** **Ninguno** (0 migraciones SQL; todo es interfaz y generación de PDFs).
- **Estado:** En publicación a producción (2026-11-27).

---

## Detalle de lo incluido

1. **Fase 0 — Base compartida de PDFs (`pdfShared.js`):**
   - Fechas de documentos y nombres de archivo en hora de Venezuela (`America/Caracas`).
   - Protección contra doble marca de agua y valores faltantes de configuración.
2. **Fase 1 — PDFs operativos y Lista de Precios:**
   - Corrección en Orden de Compra (`ATENCIÓN A` usa el contacto del proveedor), Factura (`R.I.F./C.I.`), Orden de Despacho (evita "CTA POR COBRAR" falsa en devoluciones con ajuste porcentual), Cotización (marca `ANULADA` cuando corresponde) y Lista de Precios.
3. **Fase 2 — Fin de los topes silenciosos de 1.000 filas:**
   - Los reportes ya no se truncan silenciosamente a 1.000 registros; se paginan completos antes de generar el PDF.
4. **Fase 3 — Reportes financieros, CxC, Artículos Externos y Ventas del día:**
   - Exactitud de montos, paginación y consistencia entre pantalla y PDF.
5. **Fase 4 — Catálogos, Flota/Transportistas y limpieza:**
   - Limpieza de más de 12.500 líneas de código muerto y plantillas viejas sin uso, conservando la optimización de impresión de [OP-2026-102](OP-2026-102_pdf-clientes-optimizado-impresion.md) en `clientesPDF.js`.
6. **Factura en Bolívares (`Bs`) predeterminado:**
   - `FacturaModal.jsx`: selector manual `Bs` / `$` / `BCV` que siempre inicia en `Bs`.
   - `DespachoCard.jsx` y `facturaPDF.js`: insignia `Bs` en los menús de Imprimir/Descargar y aviso claro si falta tasa de cambio para convertir a Bolívares.
7. **Indicador permanente de `STAGING` (`StagingBanner.jsx`):**
   - Activado únicamente cuando la URL de Supabase corresponde a staging (`spupqgkdsgohxxfoxydl`) o `VITE_APP_ENV === 'staging'`. En producción no se renderiza.

---

## Impacto en probadores automáticos (regla OP-2026-105)

- **Verificador diario de ventas reales en staging (12:00 a. m. L–S):** **Sin impacto negativo.** Sigue validando el PDF real de Ventas del día, ahora con las mejoras de fecha Caracas y paginación.
- **Probador nocturno completo en staging (1:00 a. m.):** **Reforzado.** Incluye todas las nuevas pruebas automáticas de PDFs y la verificación de Factura en `Bs` predeterminado.
- **Auditor de saldos y comisiones en producción (2:00 a. m.):** **Sin impacto** (no se tocaron tablas ni reglas contables).
- **Avisos programados del servidor (8:00 a. m. cobranza y limpieza nocturna):** **Sin impacto** (no se tocó el código del Worker).

---

## Verificación previa a producción

- Pruebas en pantalla aprobadas por el usuario en `http://localhost:5173` (copia de datos reales en staging), incluyendo los PDFs y la Factura en `Bs`.
- Batería completa de pruebas automáticas (`vitest`) y compilación de producción (`vite build` + PWA): verificadas antes de publicar (ver cierre de publicación).

---

## Cierre de publicación

- **Solicitud de cambio (PR):** *(se anotará al crear y fusionar)*
- **Commit en `main`:** *(se anotará al fusionar)*
- **Despliegue Vercel (frontend):** *(se verificará en vivo)*
- **Despliegue Cloudflare Worker:** no requiere cambios de código (verificado que `/api/ping` sigue respondiendo en producción).
