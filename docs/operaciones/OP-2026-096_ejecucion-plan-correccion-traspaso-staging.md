# OP-2026-096 — Ejecución en staging del plan OP-2026-095 (Fases 0 a 5)

- **Fecha:** 2026-11-26
- **Plan ejecutado:** [OP-2026-095](../plans/OP-2026-095_plan-correccion-auditoria-traspaso-staging.md) (aprobado por el dueño el 2026-11-26).
- **Alcance:** GitHub (rescate de archivos y orden de solicitudes) y **solo staging** (`construacero-op086`, solicitud #84, base de pruebas `spupqgkdsgohxxfoxydl`). **Producción no se tocó.**
- **Estado:** 🟡 **Fases 0 a 5 terminadas y verificadas en staging.** Falta la **Fase 6** (tu revisión visual en pantalla con todo unido y tu aprobación para unir solicitudes) y luego —en caso aparte con permiso expreso— la **Fase 7** (paso a producción).

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

## Pendiente / sin verificar todavía

1. **Pruebas con servidores locales encendidos (`:5174` / `:8789`) y credencial E2E:** en esta corrida no se encendieron los servidores locales de staging ni se corrió el probador completo de 123 pasos ni la restauración de 20 MB; además el usuario de prueba de `.env.e2e.local` devolvió `Invalid login credentials` al intentar autenticar `op087-prueba-por-aprobar-staging.mjs` (requiere correr `npm run provision:e2e:staging` en staging si se quieren re-correr los scripts E2E automáticos).
2. **Fase 6 (tu revisión visual en pantalla):** levantar `op086-api-staging` (`:8789`) y `op086-web-staging` (`:5174`) y probar todo en el navegador antes de unir las solicitudes (#78, #83, #84, #86, #87; cerrar #85 como absorbida en #84).
3. **Fase 7 (paso a producción):** caso aparte, solo con tu autorización expresa y después de la Fase 6.
