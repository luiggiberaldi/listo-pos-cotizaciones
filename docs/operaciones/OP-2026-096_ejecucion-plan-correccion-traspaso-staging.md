# OP-2026-096 — Ejecución en staging del plan OP-2026-095 (Fases 0 a 5)

- **Fecha:** 2026-11-26
- **Plan ejecutado:** [OP-2026-095](../plans/OP-2026-095_plan-correccion-auditoria-traspaso-staging.md) (aprobado por el dueño el 2026-11-26).
- **Alcance:** GitHub (rescate de archivos y orden de solicitudes) y **solo staging** (`construacero-op086`, solicitud #84, base de pruebas `spupqgkdsgohxxfoxydl`). **Producción no se tocó.**
- **Estado:** 🟢 **Completado y verificado al 100 % en staging (Fases 0 a 6 + pruebas extra).** Listo para unir las solicitudes en GitHub (#78, #83, #84, #86, #87; cerrar #85 absorbida en #84) y luego —en caso aparte con autorización del dueño— evaluar la **Fase 7** (paso a producción).

---

## En resumen

- **Nada se perdió:** rescatamos en GitHub el plan **OP-2026-084** (solicitud #83) y sus dos programas de prueba (`op084-pruebas-staging.mjs` y `op084-restauracion-real-staging.mjs` en solicitud #84), resolvimos el conflicto de la solicitud olvidada **#78** (`construacero-op080`) y subimos la auditoría **OP-2026-094** (#86) y el plan **OP-2026-095** (#87).
- **Todo unido en una sola copia de pruebas (`construacero-op086` / solicitud #84):**
  - El aviso azul **"N por aprobar"** (#85) quedó integrado sin conflictos, con 4 decimales (`migración 324`), refresco automático al cambiar despachos y corregido un fallo oculto que habría roto Venta rápida al abrir la pantalla.
  - La **restauración de respaldos** (`migración 327` + `admin.js` v1.3) ya valida pertenencia de empresa **antes** de escribir en tablas hijas (cierra C3), no usa candado total que congele a otros usuarios, deduce columnas de todas las filas (M3), rechaza respaldos viejos recortados sin `completo: true`, e incluye las **26 tablas** del negocio (con descuentos, compras, proveedores y flota).
  - Las 3 funciones de catálogo exigen `auth.role() = 'service_role'` en vez de `auth.uid() IS NULL` (cierra A4).
  - **"Facturar préstamo" quedó oculto en la pantalla y apagado en el servidor** (devuelve 403 con interruptor fácil de reactivar), dejando visible solo **"Devolver"** hasta que consultes al cliente. Se conserva `N44-INV` y las devoluciones parciales ahora validan precio contra el despacho y guardan `origen_tipo = 'devolucion'` en el Kardex (`migración 328`).
  - Los despachos **100 % préstamo o total `$0`** ya funcionan sin exigir método de pago en las **4 pantallas** (Cotizaciones → Despacho, Venta rápida, Editar productos y Editar despacho), sin avisos falsos y distinguiendo préstamo de donación.
- **Pruebas:** **590/590** pruebas automáticas (`72/72` archivos), compilación del sitio **OK** y pruebas en vivo contra la base real de staging (ataque C3 bloqueado, validación de precios y origen de `328`, permisos `anon=false` y ensayo de rollback en transacción segura) **todas en verde**.

---

## Detalle por fase ejecutada

| Fase | Qué se hizo | Evidencia / commit |
|---|---|---|
| **Fase 0** | Rescatado `OP-2026-084_plan-testeo-completo-inventario.md` en #83 (`cd1feabc`); rescatados `op084-pruebas-staging.mjs` y `op084-restauracion-real-staging.mjs` en #84 (`4025a482`); resuelto conflicto de #78 (`1fbbf7c0`); subidos OP-094 (#86) y OP-095 (#87). | GitHub #78, #83, #84, #86, #87 |
| **Fase 1** | Integrado "por aprobar" (#85) sobre #84 con hook limpio `useStockPorAprobar.js`, 4 invalidaciones en `useDespachos.js`, corrección de prop faltante `stockPorAprobar` en `VentaRapidaView.jsx`, migración `324` a `NUMERIC(12,4)` aplicada en staging y 11 pruebas en `op087StockPorAprobar.test.js`. | Commit `621e86e0` · 11/11 OK |
| **Fase 2** | Migración `327_staging_seguridad_restauracion_y_catalogo.sql` (+ rollback) aplicada en staging: bandera `app.restaurando_respaldo` sin `DISABLE TRIGGER USER`, validación previa en tablas hijas (C3), unión de columnas de todas las filas (M3), 26 tablas en respaldo v1.3 y restauración, rechazo de respaldos antiguos sin `completo: true` y `auth.role() = 'service_role'` en catálogo (A4). | Commit `54bd8bdc` · prueba de ataque C3 en base real: `C3_BLOQUEADO_OK` · 11/11 OK |
| **Fase 3** | Oculto botón "Facturar" en `FichaClienteModal.jsx` (solo "Devolver"); quitada mención a "Facturar" en `DevolucionParcialModal.jsx`; interruptor `FACTURACION_PRESTAMOS_HABILITADA = false` (HTTP 403) en `api/handlers/clientes.js`; nota de legado en `api/handlers/comisiones.js`; migración `328_staging_devolucion_origen_y_precios.sql` (+ rollback) aplicada en staging. | Commit `a24619b1` · prueba en vivo `328`: `TEST_328_OK_DESHECHO` · 20/20 OK |
| **Fase 4** | Ayudante único `src/utils/despachoSinCobro.js` usado en `CotizacionesView`, `VentaRapidaView`, `EditarItemsDespachoModal` (corregidas líneas 1012 y 1262) y `EditDespachoModal`; mensajes sin mencionar "Facturar" y distinguiendo préstamo vs total `$0` (donación). | Commit `60384f28` · 8/8 OK |
| **Fase 5** | Actualizados `REGISTRO-FALLAS-CODIGO.md` (`N36-INV`–`N43`), `OP-2026-086`, `OP-2026-093` y `REGISTRO.md`; corrida completa de pruebas, compilación y verificaciones SQL en staging. | `vitest` **590/590** (`72/72`), `vite build` OK, SQL/rollback `FASE5_SQL_Y_ROLLBACK_OK` |

---

## Pruebas en vivo contra los servidores locales (`:5174` / `:8789`) y en navegador real

### 1. Programas automáticos contra la base real de staging (servidores encendidos)

- **Sincronización de usuario de prueba:** `node scripts/provision-staging-e2e.mjs` → OK (`staging-e2e@listo.sys`).
- **Aviso "por aprobar" (`scripts/op087-prueba-por-aprobar-staging.mjs`):** **6/6 OK** (4 productos con unidades por aprobar coinciden con la base; detalle coincide; 204 líneas de otras empresas no se filtran; sin sesión rechazado `42501`).
- **Pruebas de seguridad e integridad (`scripts/op084-pruebas-staging.mjs`):** **17/17 OK** (respaldo v1.3 completo; "sobrescribir" rechazado en servidor y base; funciones de dinero cerradas sin sesión y con sesión; 8 tablas cerradas a escritura directa; 0 filas ajenas en 12 tablas; candado concurrente de préstamo).
- **Restauración real completa de 26 tablas (`scripts/op084-restauracion-real-staging.mjs`):** **OK** — respaldo v1.3 de `3,11 MB` descargado en `1,97 s` y restaurado en `3,96 s` (`HTTP 200`); conteos, stock total (`7493.0000`), saldos (`2316.4000`), préstamos (`120.0000`) y comisiones (`18`) quedaron idénticos al decimal, con **0 disparadores apagados** (sin usar `DISABLE TRIGGER USER`).
- **Recorrido completo de 123 pasos (`scripts/test-e2e-staging.mjs`):** **123/123 OK** (`0` fallos en `140,30 s`, con limpieza automática verificada en el paso 69). *(Nota: un primer intento tuvo una pausa puntual de red de 5 s con Supabase en el paso 15; al re-ejecutar pasaron los 123 pasos sin fallo.)*

### 2. Revisión visual con clic real en el navegador (`http://localhost:5174/`, sesión de Jefe)

**0 errores de consola ni de página** en todas las pantallas y flujos revisados:

| Pantalla | Resultado | Qué se verificó visualmente |
|---|---|---|
| **Inventario** | ✅ **OK** | 11 productos sin errores; 4 etiquetas azules **"N por aprobar"** visibles; al tocar `2 por aprobar` abrió la ventana **"Despachos por aprobar"** (`Vendedor E2E Staging`, `DES-4907`, `2`); **Editar datos** bloquea `Stock actual (solo lectura)` con botón a Conteo físico; **Ingreso / Egreso** ya no tiene "Sobrescribir"; **Kardex** abre limpio. |
| **Venta rápida** | ✅ **OK** | Carga sin errores de consola (confirmando la corrección de `stockPorAprobar` de Fase 1) y muestra los 4 avisos azules **"N por aprobar"**. |
| **Cotizaciones** | ✅ **OK** | En **Nueva cotización → Productos** cargan los 11 productos con los 4 avisos **"N por aprobar"** y 0 errores. |
| **Despachos (devolución, editar ítems y editar despacho en `$0`)** | ✅ **OK** | • **Devolución parcial** en `DES-04938`: mensaje claro *"Este despacho no admite devolución parcial"* mencionando solo **"Devolver"** (sin "Facturar" ni jerga interna).<br>• **Editar productos** (`DES-04967` y prueba real `DES-04983`): al pasar a 100 % préstamo y quitar el pago, aparece el cartel verde sin mencionar "se factura después", sin aviso falso de "Los montos no cuadran", y **Guardar Cambios** guarda el despacho en `$0.00` con insignia verde `PRÉSTAMO`.<br>• **Editar despacho (`EditDespachoModal`)** sobre `DES-04983` ya guardado en `$0.00`: muestra el cartel verde de despacho sin cobro, mantiene **Guardar cambios** habilitado sin bloquear por "Los montos no cuadran" y sin mencionar "Facturar". |
| **Clientes → Ficha → Préstamos (flujo completo con clic en "Devolver")** | ✅ **OK** | Tras aprobar `DES-04983` (1 rollo de `ALA-GAL`, `ALEJANDRO CORTEZ (PRUEBA VD)`), apareció el préstamo `PENDIENTE` con **1 botón "Devolver"** visible y **0 botones "Facturar"**. Al pulsar **Devolver**, el servidor respondió `HTTP 200` (*"Devolución física registrada con éxito ✓"*), el préstamo pasó a **`DEVUELTO`**, desapareció el aviso de préstamo activo y el stock de `ALA-GAL` volvió exactamente a **`500`** en Inventario. |
| **Configuración → Datos** | ✅ **OK** | Sección **Copia de seguridad** (`Descargar backup` / `Importar backup`) carga limpia con 0 errores. |

*Hallazgo menor observado durante la prueba (fuera de alcance):* buscar `"0.00"` en el buscador numérico de Despachos envía `numero=eq.NaN` (HTTP 400 inofensivo, no bloquea la pantalla).

---

## Pendiente (fuera de esta entrega en staging)

1. **Fase 7 (paso a producción) y consulta al cliente sobre "Facturar préstamo":** caso aparte cuando el dueño dé luz verde explícita (incluye el ensayo de respaldo grande ~20 MB antes de tocar producción).
