# OP-2026-101 — Plan integral de arreglo de los 19 PDFs del sistema (primero en staging)

- **Fecha:** 2026-11-26
- **Estado:** **Propuesta lista para tu aprobación** (cero cambios de código ni de base aplicados todavía).
- **Entorno de trabajo:** **100 % en staging** (copia de pruebas conectada a la base `spupqgkdsgohxxfoxydl`). **Producción no se toca** en ninguna de las fases 0 a 5; la Fase 6 (paso a producción) es un caso aparte que solo ocurre cuando tú revises y apruebes.
- **Origen:** auditoría completa de PDFs [OP-2026-100](../operaciones/OP-2026-100_auditoria-todos-los-pdfs.md) y auditoría de CxC [OP-2026-098](../operaciones/OP-2026-098_auditoria-cxc-clientes-vs-reportes.md).
- **Base de datos:** **0 migraciones riesgosas** — el 99 % de los arreglos vive en las pantallas del navegador y en 1 ajuste menor del servidor (`api/handlers/transportistas.js`).

**Meta técnica:** Garantizar que cada uno de los 19 PDF activos del sistema salga siempre con información fresca de la base de datos, completa (sin cortes en 1.000 ni en 12 filas), exacta (mismas fórmulas que la pantalla y tasa/moneda correctas) y con fechas en hora de Venezuela (`America/Caracas`).

**Arquitectura y enfoque:** Cada tarea sigue ciclo corto de prueba primero (escribir prueba que reproduce el fallo → comprobar que falla → aplicar arreglo mínimo y limpio → confirmar que pasa → guardar paso en git). Se valida en staging con toda la suite automática (`vitest`), compilación (`vite build`) y generación real de PDFs de prueba en `tmp/pdfs-generados/op101/` inspeccionando su contenido real.

---

## En resumen

- **Qué arregla este plan:** cierra las **12 fallas críticas**, las **14 altas** y los detalles principales detectados en la auditoría **OP-2026-100**, más las mejoras de claridad en alertas y Personal de **OP-2026-098**.
- **Cómo se ordena:** en **5 fases dentro de staging**, empezando por lo que afecta dinero o llega a manos del cliente (Lista de Precios BCV, Despachos, Cotizaciones y Órdenes de Compra), luego reportes financieros (evitar datos del período anterior y recortes de 1.000 filas), luego catálogos/flota y finalmente pruebas reales de punta a punta en staging.
- **Riesgo para producción mientras trabajamos:** **ninguno**. Todo se construye y prueba en staging; producción sigue intacta hasta que veas los PDF nuevos en staging y nos des luz verde.
- **Qué tienes que confirmar tú antes de empezar:** solo **3 decisiones cortas** al final de este documento (cada una trae nuestra recomendación).

> **Glosario rápido.** *Caché (memoria temporal):* copia de los datos que el navegador guarda unos minutos para abrir más rápido; si otro empleado editó algo, esa copia puede quedar vieja hasta que se vuelve a pedir. *Refrescar (`refetch`):* pedirle al servidor la versión más reciente justo antes de armar el PDF. *Paginar:* pedir los datos en tandas de 1.000 hasta traerlos todos, como fotocopiar un libro completo sin detenerse en la página 1.000. *Hora mundial (UTC):* reloj de referencia que va 4 horas adelantado a Venezuela; por eso, a partir de las 8:00 p. m. en Venezuela ya marca el día siguiente.

---

## Mapa rápido de las fases

| Fase | Qué resuelve | Fallas que cierra | ¿Toca producción? |
|---|---|---|---|
| **Fase 0** | Preparar copia limpia de staging + arreglar utilidades compartidas de todos los PDFs (`pdfShared.js` y fecha Venezuela) | Fecha UTC en nombres de archivo, `fmtFecha` fuera de VE, `config` nulo, doble marca de agua, `$NaN` | No |
| **Fase 1** | **Documentos de clientes y compras:** Lista de Precios (Dólar BCV + sin inactivos + refresco), Despachos (devoluciones + cliente + Venta Rápida), Cotizaciones y Órdenes de Compra | 4 críticas + 4 altas de Grupo A + Lista de Precios (la más urgente de dinero) | No |
| **Fase 2** | **Blindar reportes:** bloquear botones mientras cambia el período + refresco al exportar + quitar topes silenciosos de 1.000 filas en Comisiones, Externos, Ventas y Vendedores | 4 críticas de datos del período anterior + topes de 1.000 filas | No |
| **Fase 3** | **Exactitud de reportes financieros:** Ventas (Internos/Externos + Caja Real), Comisiones (ajustes manuales + títulos + roles), Vendedores (hora VE + signo `-`), CxC (días al corte + resumen + claridad OP-098) y Ventas del día (COD cobrado) | 4 críticas + 6 altas de Grupo B | No |
| **Fase 4** | **Catálogos, Flota y limpieza:** Transportistas (todos los choferes + camiones locales), Flota (cuadrar Tabla 1 con Cuadro 2), Clientes/Personal (nombre de archivo, filtros visibles, columnas) y limpieza opcional de PDFs muertos | 2 críticas + 4 altas de Grupo C | No |
| **Fase 5** | **Verificación real en staging:** pruebas automáticas (`vitest`), compilación (`vite build`), generación de PDFs reales en `tmp/pdfs-generados/op101/` y tu revisión visual | Validación de los 19 PDFs | No |
| **Fase 6** | **Paso controlado a producción** *(caso aparte, solo con tu aprobación escrita tras Fase 5)* | Publicación limpia en `main`, Worker y Vercel | **Sí (con permiso)** |

---

## Fase 0 — Base limpia en staging y utilidades compartidas de PDF

**Objetivo:** arrancar desde una copia limpia de `main` apuntando a staging (`spupqgkdsgohxxfoxydl`) y blindar el corazón común que usan todos los PDFs (`pdfShared.js`).

### Tarea 0.1 — Preparar carpeta de trabajo de staging y línea base
- Crear rama limpia `fix/op-101-pdfs-integral-staging` desde `origin/main` en su propia carpeta de trabajo (`../construacero-op101-staging`, sin ensuciar `construacero/`).
- Configurar entorno local apuntando exclusivamente a staging (`spupqgkdsgohxxfoxydl`).
- Verificar línea base antes de cambiar nada:
  - `npx vitest run` → esperado: `1.288/1.288` en verde.
  - `npx vite build` → esperado: compilación sin errores.

### Tarea 0.2 — Blindar `src/services/pdf/pdfShared.js` y agregar `fechaArchivoCaracas()`
**Archivos:**
- Modificar: `src/services/pdf/pdfShared.js:28-94, 121-131, 164-197, 287-288, 408-412, 464-586`
- Prueba: `src/utils/__tests__/pdfSharedHeader.test.js` (ampliar con casos de fecha Caracas, `config = null`, `"Invalid Date"`, `NaN`, tasa 0)

**Cambios concretos:**
1. Exportar helper `fechaArchivoCaracas(fecha = new Date())` usando `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', ... })` para que **ningún PDF** vuelva a usar `.toISOString().slice(0, 10)` (se acabaron los archivos con fecha de mañana entre 8:00 p. m. y 11:59 p. m.).
2. En `fmtFecha`: fijar `timeZone: 'America/Caracas'` para timestamps con `'T'` y devolver `'—'` (nunca `"Invalid Date"`) si la entrada es inválida.
3. En `fmtUsd` y `fmtBs`: usar `Number(n) || 0` para impedir `"$NaN"` / `"Bs NaN"`.
4. En `drawPremiumHeader`, `drawSimplifiedHeader` y `drawPremiumFooter`: proteger todos los accesos con `config?.`, arreglar el nombre de negocio de 1 palabra (no pegar `'CARABOBO C.A.'` a la fuerza), y usar `doc.internal.pageSize.getWidth()` / `getHeight()` en `drawWatermark`, `checkPage` y `drawPremiumFooter` para que también funcionen en PDFs horizontales.
5. Evitar doble marca de agua cuando un PDF parchea `doc.addPage` y a la vez usa `checkPage` (bandera `doc.__watermarkEnAddPage`).
6. En `fmtPrecio` / `fmtTotal`: cuando `moneda` es `'bs'` o `'bcv'` y la tasa/factor es `<= 0`, no disfrazar un monto USDT bajo etiqueta Bs/BCV (devolver `'—'` o forzar validación en el llamador antes de generar).

**Verificación:** `npx vitest run src/utils/__tests__/pdfSharedHeader.test.js` → PASS; commit `fix(pdf): blindar pdfShared con hora Caracas, config seguro y sin doble marca de agua`.

---

## Fase 1 — Documentos que ve el cliente, el chofer o el proveedor (Prioridad máxima)

### Tarea 1.1 — Lista de Precios: arreglar "Dólar BCV", excluir desactivados y refrescar precios/tasa
**Archivos:**
- Modificar: `src/views/InventarioView.jsx:66, 110, 129-136, 579-585`
- Modificar: `src/components/inventario/ListaPreciosModal.jsx:45-95, 150, 258-276, 313`
- Modificar: `src/services/pdf/listaPreciosPDF.js:282-295, 328-333, 522-528, 660, 698, 750-763, 793, 821, 873-886, 912, 964-977, 1003`
- Crear prueba: `src/services/__tests__/listaPreciosPDF.test.js`

**Pasos (TDD):**
1. **Prueba que falla:** generar PDF en modo `moneda: 'bcv'` con `precio_usd: 10`, `tasaUsdt: 60`, `tasaBcv: 40` (`factorBcv = 1.5`) → debe imprimir `$15,00` (hoy imprime `$10,00` → falla); incluir un producto `activo: false` → no debe aparecer en el catálogo; fecha a las 10:00 p. m. VE → filename debe llevar fecha de hoy VE.
2. **Implementación:**
   - En `InventarioView.jsx`: extraer `{ tasaEfectiva, tasaBcv, refrescar }` de `useTasaCambio()` y pasar `productosTodos` activos (`activo !== false`) + indicador si hay filtros activos en pantalla, junto con `tasaBcv`, `factorBcv = (tasaEfectiva > 0 && tasaBcv > 0) ? tasaEfectiva / tasaBcv : 0`, `refetchInventario` y `refrescarTasa`.
   - En `ListaPreciosModal.jsx`:
     - Al pulsar **Generar PDF**, refrescar inventario (`refetch`) y tasa (`refrescar`) antes de generar; si falla, mostrar `showToast(..., 'error')` y no generar con datos viejos.
     - Si `moneda === 'bs'` y `tasa <= 0`, o `moneda === 'bcv'` y `factorBcv <= 0`: bloquear con aviso claro ("No se pudo obtener la tasa vigente").
     - Filtrar siempre `p.activo !== false`; deshabilitar botón cuando `productosFiltrados.length === 0`; limitar `ajustePorcentaje` mínimo a `-99` (nunca precios negativos o cero).
     - Mostrar aviso si el inventario viene truncado (`truncado === true`) y alinear el listado de categorías del selector con `corregirCategoriaCruzada` para que el filtro del modal coincida 100 % con las secciones del PDF.
   - En `listaPreciosPDF.js`:
     - Aceptar `factorBcv`; en los 3 bucles de render, si `moneda === 'bcv' && factorBcv > 0`, imprimir `'$' + (usd * factorBcv)`.
     - Restaurar fuente (`helvetica`, `normal`, `7pt`) *antes* de llamar `splitTextToSize`, recalcular `bottomMargin` por página en subcategorías, soportar teléfonos `+58` de 12 dígitos y usar `fechaArchivoCaracas()` para el nombre del archivo.
3. **Verificación:** `npx vitest run src/services/__tests__/listaPreciosPDF.test.js` → PASS; commit.

### Tarea 1.2 — Despachos (Nota, Orden, Guía, Factura) y Venta Rápida: 0 devoluciones omitidas y 0 campos faltantes
**Archivos:**
- Modificar: `src/components/despachos/DespachoCard.jsx:109-111, 150-162, 491-510, 673-805`
- Modificar: `src/services/despachoItemsService.js:33-55, 105`
- Modificar: `src/utils/despachoPdfDatos.js:12-34`
- Modificar: `src/views/VentaRapidaView.jsx:108-162, 904-927`
- Modificar: `src/services/pdf/despachoPDF.js:520-555, 585-605, 798`
- Modificar: `src/services/pdf/ordenDespachoPDF.js:18, 345-350, 427, 467, 508-601, 779`
- Modificar: `src/services/pdf/guiaDespachoPDF.js:395, 496`
- Modificar: `src/services/pdf/facturaPDF.js:51, 209, 343-348, 473, 500-512, 624`
- Ampliar pruebas: `src/utils/__tests__/despachoCardPdfFresco.test.js`, `src/utils/__tests__/despachoPdfDatos.test.js` + crear `src/services/__tests__/despachosPdfIntegridad.test.js`

**Pasos (TDD):**
1. **Pruebas que fallan:**
   - Tarjeta con `tiene_devoluciones: false`, BD devuelve `tiene_devoluciones: true` → `fetchDatosParaPdf` debe leer las devoluciones y descontarlas antes de armar el PDF.
   - `combinarDespachoFresco`: cambio de `cliente_factura_id` de `id → null` y de `null → id` debe re-leer/limpiar `cliente_factura`, nunca conservar el viejo.
   - `despachoItemsService`: si `devRes.error` o `intRes.error` ocurre, debe lanzar error (nunca imprimir ítems originales en silencio).
   - `personal` con compra ($100) + préstamo ($50): `SubTotal` y `Descuento personal` deben cuadrar con `Total`.
   - `ordenDespachoPDF` con `tiene_devoluciones: true` y `porcentaje: 110`: no debe inventar casilla falsa `CTA POR COBRAR (DIFERENCIA)`.
2. **Implementación:**
   - En `DespachoCard.jsx`: leer primero `notas_despacho` fresco (`SELECT_DESPACHO_PARA_PDF`), luego pasar `freshRes.data` a `fetchDespachoConsolidado(despacho.id, freshRes.data)` (secuencial, ~50 ms, elimina para siempre el #4567 de devoluciones). Re-leer `cliente`, `cliente_factura` y `vendedor` frescos cuando correspondan (en paralelo con los ítems, usando los IDs de `freshRes.data`).
   - En `despachoItemsService.js`: lanzar error explícito si `devRes.error` o `intRes.error`.
   - En `despachoPdfDatos.js`: manejar `id → null` limpiando `cliente_factura: null` y re-hidratando cuando cambia o falta `cliente`/`cliente_factura`/`vendedor`.
   - En `VentaRapidaView.jsx`: en `ModalVentaExitosa`, leer la fila real recién creada de `notas_despacho` (incluyendo `corte_usd`, `direccion_envio_*`, `referencia_pago`, `creado_en`) + ítems con `es_prestamo`, validar errores de lookup (sin silenciar) y **no** abrir `ModalVentaExitosa` cuando `result._queued === true` (modo offline: mostrar aviso de "Guardado pendiente por conexión").
   - En los 4 generadores: corregir cálculo `personal` + `es_prestamo` (excluir préstamos de `total` o tratarlos consistentemente en ambos lados), multiplicar `sumOriginalPagos` por `factor` en `ordenDespachoPDF`, dibujar `despacho.notas` en `ordenDespachoPDF`, aplicar `tasaPersonalizada` también en modo BCV (o aclarar su uso solo para Bs), subir `limitY` para evitar solapamiento en 15–20 ítems, corregir `'R.F.I/C.I.'` → `'R.I.F./C.I.'` y usar `fechaArchivoCaracas()` en los 4 nombres de archivo.
3. **Verificación:** `npx vitest run src/utils/__tests__/despachoCardPdfFresco.test.js src/utils/__tests__/despachoPdfDatos.test.js src/services/__tests__/despachosPdfIntegridad.test.js` → PASS; commit.

### Tarea 1.3 — Cotizaciones: re-leer cabecera fresca + arreglar crash offline
**Archivos:**
- Modificar: `src/components/cotizaciones/CotizacionCard.jsx:20-49, 91-214`
- Modificar: `src/components/cotizaciones/CotizacionBuilder.jsx:1008-1168`
- Modificar: `src/services/pdf/cotizacionPDF.js:24, 240-241, 355-365, 407-429, 629`
- Crear prueba: `src/services/__tests__/cotizacionPdfFresco.test.js`

**Pasos (TDD):**
1. **Pruebas que fallan:** `CotizacionCard` con total viejo en prop pero editado en BD → PDF debe salir con el total, flete, corte, notas y estado frescos de BD; `CotizacionBuilder` offline (`local_...`) no debe lanzar `ReferenceError: descuento_usd` ni reinflar precios `personal`.
2. **Implementación:**
   - En `CotizacionCard.jsx`: incluir `supabase.from('cotizaciones').select(...).eq('id', cotizacion.id).single()` dentro del `Promise.all` (o antes de leer cliente/vendedor si cambiaron los IDs); validar errores de `cotRes`, `itemsRes`, `cliente` y `vendedor`; en `catch` de WhatsApp mostrar `showToast(..., 'error')` en vez de abrir `wa.me` sin teléfono ni PDF.
   - En `CotizacionBuilder.jsx`: corregir `descuento_usd` → `descuentoUsd` (:1018), evitar doble reinflado `personal` offline, usar `cotRes.data.vendedor_id` y totales de `cot` en WhatsApp, y mostrar `showToast` en errores de `descargarPDF`.
   - En `cotizacionPDF.js`: dibujar marca de agua `ANULADA` si `cotizacion.estado === 'anulada'`, impedir títulos BCV/Bs si tasa = 0, excluir `!esServicio` al reinflar `subtotalOriginal` en `personal`, y usar `fechaArchivoCaracas()`.
3. **Verificación:** `npx vitest run src/services/__tests__/cotizacionPdfFresco.test.js` → PASS; commit.

### Tarea 1.4 — Órdenes de Compra: re-leer cabecera fresca, bloquear descarga vacía y arreglar contacto/footer
**Archivos:**
- Modificar: `src/views/OrdenCompraView.jsx:177-195, 321-333, 801-813, 1040-1049`
- Modificar: `src/services/pdf/ordenCompraPDF.js:216-228, 460-471`
- Crear prueba: `src/services/__tests__/ordenCompraPdfFresco.test.js`

**Pasos (TDD):**
1. **Pruebas que fallan:** descarga desde listado y modal debe re-leer `ordenes_compra` + `orden_compra_items` (y fallar con aviso si hay error); `ATENCIÓN A:` debe mostrar `orden.proveedor_contacto`; botón de modal deshabilitado mientras `isLoading`.
2. **Implementación:**
   - Extraer helper `cargarOrdenFrescaParaPdf(ordenId)` que consulte `ordenes_compra` y `orden_compra_items` verificando `.error` en ambos; usarlo tanto en listado como en modal.
   - Pasar `config` real de `useConfigNegocio()` (con `supervisorNombre: perfil?.nombre`) en los 3 puntos para que el footer muestre teléfono y correo.
   - En `ordenCompraPDF.js`: usar `orden.proveedor_contacto || orden.proveedor_nombre || '—'` en `ATENCIÓN A:`, mover el nombre del supervisor a "Elaborado por", y usar `fechaArchivoCaracas()`.
3. **Verificación:** `npx vitest run src/services/__tests__/ordenCompraPdfFresco.test.js` → PASS; commit.

---

## Fase 2 — Blindar reportes contra datos del período anterior y recortes de 1.000 filas

### Tarea 2.1 — Bloqueo universal de botones PDF durante `isPlaceholderData || isFetching` + refresco al exportar
**Archivos:**
- Modificar: `src/views/ReportesView.jsx:619, 626, 714-767, 1064, 1405-1480, 1658-1727, 1900, 1930-1956, 2069-2073, 2561, 2678-2695`
- Modificar: `src/views/ReporteVendedoresView.jsx:287, 359-393`
- Modificar: `src/views/ComisionesView.jsx:1284-1291, 1349-1356`
- Modificar: `src/components/reportes/ModalDetalleVendedor.jsx` (deshabilitar con `detalle.length === 0` o cargando)
- Crear prueba: `src/utils/__tests__/reportesPdfBloqueoCarga.test.js`

**Cambios concretos:**
1. En **todos** los botones de Imprimir y Descargar PDF de `TabVentas`, `TabComisiones`, `TabCredito`, `TabArticulosExternos`, `ReporteVendedoresView` y tarjetas individuales de `ComisionesView`: agregar `isPlaceholderData || isFetching` al `disabled` (y bloquear si `cxcFetching` en `TabVentas`, o si `!cxcData` en `TabCredito`).
2. Antes de generar el PDF en reportes cacheados (`TabVentas`, `TabCredito`, `TabArticulosExternos`, `ReporteVendedoresView`), ejecutar `await refetch()` (usando el `data` fresco devuelto por `refetch()`, abortando con toast si falla) — garantiza que si alguien aprobó un despacho o cobró un abono hace 10 segundos en otra PC, el PDF salga actualizado.

### Tarea 2.2 — Eliminar todos los topes silenciosos de 1.000 filas en PDFs de reportes
**Archivos:**
- Modificar: `src/views/ReportesView.jsx:1156-1293`
- Modificar: `src/views/ComisionesView.jsx:736-859`
- Modificar: `src/components/reportes/ModalDetalleVendedor.jsx:139-171`
- Modificar: `src/hooks/useReporteExternos.js:9-15`
- Modificar: `src/hooks/useReporteVentas.js:168-183`
- Modificar: `src/hooks/useReporteVendedores.js:123-138`
- Crear prueba: `src/utils/__tests__/comisionesYExternosPaginacionPdf.test.js`

**Cambios concretos:**
1. Crear helper compartido `cargarEventosComisionesParaPdf({ desde, hasta, vendedorId })` usando `fetchComisionesTodas({ ..., vista: 'eventos' })` (paginado completo, adiós `page=1&pageSize=1000`) + lectura de `cotizaciones` en **tandas de 100 IDs** verificando errores (adiós HTTP 414 con >200 cotizaciones). Usarlo en los **5 puntos** de exportación de Comisiones.
2. En `useReporteExternos.js`: envolver la RPC `obtener_reporte_articulos_externos` con `leerTodasLasPaginas` (o validar rango) para que nunca corte silenciosamente en 1.000 filas.
3. En `useReporteVentas.js` y `useReporteVendedores.js`: envolver la lectura de `notas_despacho_items` por tandas de 50 despachos con `leerTodasLasPaginas`.

**Verificación:** `npx vitest run src/utils/__tests__/reportesPdfBloqueoCarga.test.js src/utils/__tests__/comisionesYExternosPaginacionPdf.test.js` → PASS; commit.

---

## Fase 3 — Exactitud total en Reportes Financieros (Ventas, Comisiones, Vendedores, CxC, Externos, Ventas del día)

### Tarea 3.1 — Reporte de Ventas: Internos/Externos fieles + "Caja Real" cuadrada con pantalla
**Archivos:**
- Modificar: `src/views/ReportesView.jsx:184-198, 504-604, 626-658, 827`
- Modificar: `src/services/pdf/comisionesPDF.js:1578-2652`
- Modificar: `src/hooks/useCuentasCobrar.js:139, 149, 222, 231` (o sustituir uso en `TabVentas` según **Decisión 1**)
- Crear prueba: `src/services/__tests__/reporteVentasPdfExactitud.test.js`

**Cambios concretos:**
1. En `filtrarReporteVentas(reporte, tipoFiltro)`:
   - Conservar y recalcular `totalDevoluciones` y `totalComisionesSplit` solo para los vendedores del filtro.
   - Filtrar `reporte.devoluciones` por los vendedores incluidos (`sellerIds`) y restarlas de `porFormaPago` exactamente igual que `useReporteVentas`.
   - Filtrar también `cxcData` (clientes y abonos) al grupo de vendedores elegido (`internos` / `externos`) antes de pasarlo a `generarReporteVentasPDF` — nunca más una "Caja Real" negativa por mezclar CxC de toda la empresa.
2. Unificar "Caja Real" entre pantalla (`FormaPagoSection`) y PDF (`comisionesPDF.js`):
   - Corregir comparación insensible a mayúsculas (`'saldo a favor'`) para que `Saldo a Favor` sí se descuente en ambos lados.
   - Pasar el mismo `cxcData` a `FormaPagoSection` en pantalla (o calcular ambos con el mismo criterio) y eliminar código muerto de `totalDonacion`.
3. Corregir fecha UTC en `useResumenCxC` (usar fecha `America/Caracas` en lugar de `.split('T')[0]`) y etiquetar claramente la sección 6.7 del PDF como **"Créditos otorgados en el período"** (o según **Decisión 1**).
4. Arreglar matching de despachos `unassigned` (`comisionesPDF.js:1919`) y normalizar etiqueta/bucket de reembolsos.

### Tarea 3.2 — Reporte de Comisiones: ajustes manuales por período, roles limpios, título de filtro y buckets completos
**Archivos:**
- Modificar: `src/views/ReportesView.jsx:1053, 1179-1225, 1303, 1334`
- Modificar: `src/views/ComisionesView.jsx:619, 753-795, 869, 910`
- Modificar: `src/components/reportes/ModalDetalleVendedor.jsx:92, 113, 187`
- Modificar: `src/services/pdf/comisionesGeneradasPDF.js:280-345, 703-726`
- Ampliar prueba: `src/utils/__tests__/comisionesGeneradasPDF.test.js`

**Cambios concretos:**
1. Reiniciar `ajustesManuales` (`setAjustesManuales({})`) cada vez que cambia `rango` (en `TabComisiones` y `ComisionesView`).
2. Excluir roles `desarrollador`, `administracion` y `logistica` también en el exportador PDF (paridad con pantalla); añadir fallback `r.comisiones?.vendedor` en `ComisionesView.jsx`.
3. Usar `tipoVendedor` (antes `_tipoVendedor` ignorado) en el título del documento y nombre del archivo (`Internos` / `Externos` / `General`), con `fechaArchivoCaracas()`.
4. En `expandCommissionRows`: si un bucket tiene monto `> 0` pero `items.length === 0`, emitir una línea de ajuste `"Comisión sin artículos clasificados"` para que el PDF Detallado **siempre sume exactamente igual** al Resumido y a la pantalla.
5. Pasar `id` y `codigo` en `vendedor` al generador y sincronizar `tipoTasaComision`/`formatoReporte` iniciales en `ModalDetalleVendedor` desde la vista padre.

### Tarea 3.3 — Reporte de Vendedores: hora Venezuela en `getRango`, signo `-` y descuentos en Top Productos
**Archivos:**
- Modificar: `src/views/ReporteVendedoresView.jsx:14-50, 335, 365`
- Modificar: `src/hooks/useReporteVendedores.js:61-63, 175-185, 219-237, 385`
- Modificar: `src/services/pdf/reporteVendedoresPDF.js:58-62, 190-202, 460-467, 502-574, 645`
- Crear prueba: `src/services/__tests__/reporteVendedoresPdfExactitud.test.js`

**Cambios concretos:**
1. En `ReporteVendedoresView.jsx`: reemplazar `toISOString().split('T')[0]` en `getRango()` por `fechaArchivoCaracas` / `getLocalISODate` (elimina el fallo nocturno de 8:00 p. m.–11:59 p. m.).
2. En `reporteVendedoresPDF.js`: arreglar signo negativo en variación (`const arrow = v.variacionUsd > 0 ? '+' : v.variacionUsd < 0 ? '-' : ''`), mostrar `localTotalComisionOtros` en la tarjeta KPI #4, corregir el avance vertical `y += 40` para que la caja de Cotizaciones no tape `Top Clientes`, y aclarar `"Últimos 10 despachos del período (de N)"` cuando el historial se acota.
3. En `useReporteVendedores.js`: incluir `codigo` en `SELECT` de usuarios, aplicar `aplicarDescuentosItems` en `topProductos`, y pasar lista ya filtrada por `shouldIncludeReporteVendedor` para supervisores (alineando `% vs período anterior` entre pantalla y PDF).

### Tarea 3.4 — Reporte de CxC / Crédito (incluye mejoras de OP-2026-098)
**Archivos:**
- Modificar: `src/services/pdf/cxcPDF.js:80-158, 212-350, 401-416, 435-496, 522-597`
- Modificar: `src/views/ReportesView.jsx:2132-2210`
- Modificar: `src/hooks/useReportePeriodoCxC.js` (incluir `tipo_cliente` en `SELECT_CLIENTE` y calcular `clientesPagadoDeMas` — cierra falla N25 de OP-062)
- Modificar: `src/utils/cxcPeriodReport.js:430` (ordenar `clientesConDeuda` por saldo descendente)
- Crear prueba: `src/services/__tests__/cxcPdfExactitud.test.js`

**Cambios concretos:**
1. En `cxcPDF.js`:
   - Mostrar el **rango de fechas del reporte** (`rango.from — rango.to`) en el encabezado.
   - Agregar bloque compacto de **Resumen del período**: `Saldo inicial + Cargos − Abonos (Cobros en dinero / Cruces / Devoluciones) = CxC al cierre`.
   - Calcular **"Vencido hace X días" / "Vence en X días"** del detalle contra la **fecha de corte (`rango.to`)** en hora `America/Caracas`, **nunca contra `new Date()` UTC** (coherencia 100 % con la tabla superior en períodos pasados).
   - Identificar con etiqueta `[PERSONAL]` a los empleados (ej. Alejandra Hidalgo) y mostrar subtotal `Clientes + Personal` si hay personal con deuda.
   - Agregar fila de **TOTAL** en la tabla de Cobranza, sección opcional de clientes que saldaron 100 % durante el período (para que sus abonos no queden "huérfanos"), arreglar margen inferior en pág. 1 (`35 mm`), y usar `fechaArchivoCaracas()` (o `rango.from_a_rango.to`) en el nombre del archivo.
2. En `ReportesView.jsx` (claridad de **OP-2026-098**):
   - Cambiar aviso naranja a: `"37 notas en alerta (de 15 clientes) · 35 vencidas · $44.669,18"` para dejar claro de inmediato que son **notas**, no clientes.
   - Mostrar insignia **"Personal"** junto al nombre de empleados en la tabla de Crédito y alimentar el recuadro **"Pagos de más sin deuda"** (falla N25).

### Tarea 3.5 — Artículos Externos, Ventas del día y Mis Ventas
**Archivos:**
- Modificar: `src/views/ReportesView.jsx:2593, 2608-2614` + `src/services/pdf/articulosExternosPDF.js:30-49, 91-109`
- Modificar: `src/utils/ventasDia.js:115-124` + `src/components/reportes/TabVentasDia.jsx:70, 90, 138` + `src/services/pdf/ventasDiaPDF.js:189`
- Modificar: `src/services/pdf/misVentasPDF.js:111-130`
- Ampliar pruebas: `src/services/__tests__/ventasDiaPDF.test.js`, `src/services/__tests__/misVentasPDF.test.js`

**Cambios concretos:**
1. **Artículos Externos:** mostrar asesor/búsqueda aplicada en el subtítulo del PDF, agregar columna `Código`, contar `clientesUnicos` por `cliente_id || cliente_nombre` (no solo RIF) y limpiar `filtroAsesor` si ya no existe al cambiar rango.
2. **Ventas del día:** en `ventasDia.js`, si un `Cobro a destino` tiene `cobro_destino_pagado: true`, sumar sus `metodos_pagados` en `cobradoUsd` en vez de `porCobrarUsd`; resetear `tasaEditada` al cambiar de fecha; habilitar PDF cuando haya notas en `sinEntregar` o `entregadasOtroDia`; repetir cabecera al saltar página.
3. **Mis Ventas:** llamar `checkPage` antes de la línea de cierre de cada despacho y repetir cabecera de artículos al cruzar página.

**Verificación Fase 3:** `npx vitest run` → PASS en toda la suite; commit por submódulo.

---

## Fase 4 — Catálogos, Flota y limpieza segura de código muerto

### Tarea 4.1 — Base de Datos de Transportistas: exportar TODOS los choferes + camiones de flota propia
**Archivos:**
- Modificar: `src/views/TransportistasView.jsx:447-514, 569-577`
- Modificar: `src/hooks/useTransportistas.js:135-139, 173-176, 297-300`
- Modificar: `src/services/pdf/transportistasPDF.js:45-154`
- Crear prueba: `src/services/__tests__/transportistasPdfCompleto.test.js`

**Cambios concretos:**
1. Al pulsar Imprimir/Descargar en `TransportistasView`, pedir **todos los transportistas** que coincidan con el filtro (`paginado: false`, fresco del servidor) en lugar de pasar los 12 de la página visible.
2. Cruzar cada chofer local con `vehiculosPorId[t.vehiculo_habitual_id]` para rellenar `vehiculo`, `color`, `placa_chuto`, `placa_batea` y `capacidad` antes de generar el PDF.
3. Corregir `setQueriesData` optimista en `useTransportistas.js` para que **solo** modifique cachés tipo Array (y nunca pise el objeto `{ items, total }` paginado ni `{ todos, locales, generales }`).
4. Mostrar filtro aplicado en subtítulo, incluir teléfono, usar `fechaArchivoCaracas()` y deshabilitar botones con 0 resultados o `isFetching`.

### Tarea 4.2 — Reporte de Flota / Transportistas: cuadrar Tabla 1 con Cuadro 2
**Archivos:**
- Modificar: `src/components/reportes/TabTransportistas.jsx:33-102`
- Modificar: `api/handlers/transportistas.js:127` (alinear `estado=in.(despachada,entregada)` igual que las RPCs de flota, sujeto a **Decisión 2**)
- Modificar: `src/services/pdf/flotaChoferesPDF.js:237, 281, 287-298`
- Ampliar prueba: `src/services/__tests__/pesoPdfs.test.js`

**Cambios concretos:**
1. En `TabTransportistas.jsx`: incluir `refetch()` de `useReporteTransportistas` dentro del `Promise.all` de `generarReporte` para que la Tabla 1 sea tan fresca como el resto del PDF; deshabilitar botones en `isLoading || isFetching || isError`; si falla `cargarPesoFlota`, mostrar aviso en pantalla y nota en el PDF ("Datos de peso no disponibles temporalmente") en vez de callar.
2. En `api/handlers/transportistas.js:127`: filtrar `estado=in.(despachada,entregada)` para excluir despachos `pendiente` (por aprobar), logrando que Tabla 1 ("Fletes por chofer local") y Cuadro 2 ("Productividad por chofer local") cuadren exactamente.
3. En `flotaChoferesPDF.js`: mostrar nota explícita si el detalle llega a 1.000 viajes ("Mostrando primeros 1.000 viajes"), arreglar `100%` cuando hay 0 viajes, mostrar `(~N)` también en total de Cuadro 2 y ajustar anchos de columnas con peso para que montos ≥ `$1.000,00` no se partan en dos líneas.

### Tarea 4.3 — Clientes y Personal: refresco, nombre de archivo de Personal, filtros visibles y columnas limpias
**Archivos:**
- Modificar: `src/views/ClientesView.jsx:153-167, 334-352`
- Modificar: `src/views/PersonalView.jsx:150-164, 320-338`
- Modificar: `src/services/pdf/clientesPDF.js:12-24, 46, 69-89, 107-188, 206-209`
- Crear prueba: `src/services/__tests__/clientesPersonalPdf.test.js`

**Cambios concretos:**
1. Refrescar (`await refetch()`) antes de exportar en `ClientesView` y `PersonalView`; deshabilitar botones en `isLoading || isFetching || clientesFiltrados.length === 0`.
2. Pasar texto descriptivo de filtros activos (ej. `"Filtro: Solo mis clientes · Con deuda"` o `"Todos los clientes activos"`) para que salga en el subtítulo del PDF — se acaba la trampa silenciosa de "Mis datos".
3. En `clientesPDF.js`:
   - Guardar con nombre `Reporte_de_Personal_${fechaArchivoCaracas()}.pdf` cuando es Personal (nunca `Base_de_Datos_Clientes`).
   - Calcular "Nuevos Este Mes" en `America/Caracas`.
   - Reemplazar `.substring(...)` rígidos por `splitTextToSize` / elipsis real con anchos calibrados para que el nombre en Personal nunca pise `ROL / CARGO`.
   - Agregar `drawSimplifiedHeader` en páginas 2+ y proteger `config?.nombre_negocio`.

### Tarea 4.4 — Limpieza de PDFs muertos (opcional, sujeta a Decisión 3)
- Eliminar los 4 generadores sin uso confirmado: `inventarioPDF.js`, `despachoReportePDF.js`, `liquidacionPDF.js`, `pipelinePDF.js`.
- Retirar la función legacy rota `generarComisionesPDF` de `comisionesPDF.js` (1.530 líneas; migrar `comisionesTasa.test.js` hacia `comisionesGeneradasPDF.js`).
- Retirar `src/services/pdf/backup/` y decidir si `_PlantillaDropdown` en `DespachosView.jsx` se elimina o se reconecta.

---

## Fase 5 — Verificación integral en staging (pruebas automáticas + PDFs reales)

Antes de mostrarte el resultado en staging, se ejecutan **4 capas de verificación obligatoria**:

1. **Suite automática completa:** `npx vitest run` (todas las pruebas existentes + ~45–60 pruebas nuevas de regresión PDF) → 100 % verde, 0 advertencias rotas.
2. **Compilación limpia:** `npx vite build` → 0 errores.
3. **Pruebas reales de generación de PDF contra staging (en `tmp/pdfs-generados/op101/`):**
   - Generar PDFs reales con datos de staging y leer su texto extraído (automáticamente con un guion de prueba + revisión visual):
     - **Lista de Precios BCV:** confirmar que un artículo de `$10` USDT sale convertido a `$10 × (tasaUsdt/tasaBcv)` y que un producto desactivado **no aparece**.
     - **Despacho con devolución hecha desde otra sesión sin recargar:** confirmar que Nota, Orden, Guía y Factura reflejan la devolución y el total nuevo al centavo.
     - **Venta Rápida con corte + dirección alternativa + préstamo:** confirmar que los 3 datos salen impresos en el PDF del cartel de éxito.
     - **Cotización y Orden de Compra editadas sin recargar:** confirmar que cabecera e ítems coinciden 100 %.
     - **Cambio rápido de período en Ventas / Vendedores / Externos / CxC:** confirmar botones bloqueados mientras carga (`0` PDFs con datos viejos).
     - **Comisiones >1.000 filas (simulado) y cambio de semana con ajustes manuales:** confirmar total completo y ajustes limpiados.
     - **Reporte de Vendedores a las 10:00 p. m. VE y con vendedor en caída:** confirmar fecha de hoy VE y signo `-`.
     - **Reporte de CxC de "Mes pasado":** confirmar días vencidos calculados al 31-oct (no a hoy) y rango visible.
     - **Transportistas (página 1 de 3) y Flota con despacho pendiente:** confirmar todos los choferes + camiones locales + Tabla 1 igual a Cuadro 2.
     - **Personal:** confirmar nombre de archivo `Reporte_de_Personal_YYYY-MM-DD.pdf` sin columnas pisadas.
4. **Tu revisión visual en staging:** arrancar staging local y mostrarte los PDFs reales en pantalla antes de pensar en producción.

---

## Fase 6 — Paso controlado a producción (caso aparte, solo con tu aprobación)

- Solo se abre tras tu **"Aprobado"** al terminar la Fase 5.
- Se porta en una rama limpia desde `origin/main` (sin mezclar nada externo), se corre batería completa + `vite build`, se abre solicitud de cambio (PR) en GitHub y se despliega Worker + Vercel con verificación en vivo y plan de vuelta atrás listo.

---

## 3 decisiones rápidas antes de empezar

Por favor confírmame estas 3 cosas (o dime **"Sí a todas las recomendaciones"** para arrancar de una vez):

1. **Bloque CxC dentro del PDF de Reporte de Ventas (Tarea 3.1):**
   - **(Recomendado)** Mantener que muestre solo los **créditos otorgados en ese período**, corrigiendo la hora a Venezuela, filtrándolo por Internos/Externos y cambiando el título a **"Créditos otorgados en el período (saldos pendientes)"** para que no se confunda con la deuda histórica total.
   - *Alternativa:* quitar el bloque CxC del PDF de Ventas porque ya existe el Reporte de Crédito completo.
2. **Despachos "Por aprobar" en la Tabla 1 de Transportistas/Flota (Tarea 4.2):**
   - **(Recomendado)** Excluir despachos *por aprobar* de la Tabla 1 ("Fletes por chofer local") para que cuadre exacto con el resto del reporte de Flota (solo aprobados y entregados).
   - *Alternativa:* dejarlos en Tabla 1, pero rotulados aparte como "Incluye despachos por aprobar".
3. **Limpieza de código muerto y plantillas en blanco (Tarea 4.4):**
   - **(Recomendado)** Borrar los 4 PDF antiguos sin uso y las copias viejas en `src/services/pdf/backup/` en la Fase 4 para que nadie vuelva a tocarlos por error; y confirmar si las **Plantillas en blanco** (Nota de entrega / Orden vacía) las necesitas en la pantalla de Despachos o si también se retiran.
