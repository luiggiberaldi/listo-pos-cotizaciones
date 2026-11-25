# OP-2026-086 — Ejecución en staging del plan de correcciones (OP-2026-078) y del plan de pruebas (OP-2026-084)

- **Fecha de inicio:** 2026-11-25
- **Entorno:** solo **staging** (`construacero-staging/` y base de pruebas `spupqgkdsgohxxfoxydl`). Producción no se toca en este caso.
- **Carpeta de trabajo:** `construacero-op086`, rama `fix/op-086-inventario-staging`, creada desde `origin/main` (regla de OP-2026-083).
- **Planes que se ejecutan:** [OP-2026-078](../plans/OP-2026-078_plan-correccion-hallazgos-auditoria-inventario-staging.md) (correcciones) y [OP-2026-084](../plans/OP-2026-084_plan-testeo-completo-inventario.md) (pruebas). Aprobados por el dueño el 2026-11-25.
- **Estado:** 🔧 En ejecución. Fase 1 terminada.

---

## En resumen

- **Respaldo de staging hecho** antes de tocar nada: las 49 tablas completas (46 558 filas) más funciones, reglas de acceso, vistas y disparadores, en `construacero-backups/staging-2026-11-25-antes-op086/`.
- **Fase 1 terminada:** el trabajo de staging que estaba guardado solo en la PC quedó sobre la versión principal, **sin perder** los arreglos publicados (cotizaciones que no se pierden, OP-069; edición del vendedor, OP-070). Pasan las 545 pruebas automáticas y el sitio compila.
- **Cambio frente a lo que se dijo al dueño:** no fue posible llevar "solo inventario". En `despachos.js` (el archivo del servidor que maneja los despachos), lo de inventario está entrelazado con las copias de staging de Cuentas por Cobrar (migraciones `301`–`308`), que **ya están instaladas en la base de staging** y de las que inventario depende. Se llevó todo el trabajo local de staging y queda cubierto por las pruebas del plan OP-084 (bloque 9). **Nada de esto toca producción**: producción se publica desde otra carpeta.

## Fase 1 — detalle

1. **Mezcla de tres vías:** se tomaron como punto de partida la base vieja de la carpeta local (`e78d8f6f`), el trabajo local (rama `wip/op-075-inventario-staging`, solo la carpeta `construacero-staging/`) y `origin/main`. Git conservó lo publicado y sumó lo local. Hubo 2 conflictos:
   - `construacero-staging/.gitignore`: se dejaron ambas listas.
   - `EditarItemsDespachoModal.jsx`: se mantuvo la regla del vendedor (OP-070) **y** la decisión de pagos de la edición profunda (OP-053).
2. **Archivos que la copia local borraba y que se conservan:** `edicionVendedorDespacho.js`, la migración `311_staging_vendedor_edita_despacho_pendiente.sql`, `limpiezaCotizaciones.js` y sus pruebas.
3. **Borrados locales que se mantienen:** `ClienteRow.jsx`, `CotizacionRow.jsx` y `DespachoRow.jsx` (vista de lista eliminada en OP-079), y `StockComprometidoDetalle.jsx` / `useStockComprometido.js` (ningún archivo los usa).
4. **Migraciones renumeradas** para no chocar con la `311` de OP-070:

   | Antes | Ahora |
   |---|---|
   | `310_staging_inventario_ficha_y_kardex` | `312_…` |
   | `311_staging_prestamos_reapertura_intercambios` | `313_…` |
   | `312_staging_seguridad_inventario_rpcs_y_rls` | `314_…` |
   | `313_staging_higiene_decimales_lotes` | `315_…` |

   Ya están aplicadas en la base de staging con su contenido actual; solo cambia el nombre del archivo. Los documentos anteriores (OP-075, OP-076, OP-078) conservan los números viejos.
5. **Pruebas que no estaban guardadas:** las 4 pruebas `*071.test.js` existían solo como archivos sueltos (el proyecto las ignoraba). Ahora quedan guardadas en el repositorio y apuntan a los nuevos nombres. Otras 20 pruebas sueltas de casos anteriores se copiaron solo para correrlas aquí, sin guardarlas (siguen la regla de lista permitida del proyecto).
6. **Verificación:** `vitest`, 64 archivos y 545 pruebas OK; `vite build` OK.

## Pendiente

- Fases 2 a 6 de OP-078 (seguridad, respaldo y restauración, facturar préstamo, separación entre empresas, detalles menores).
- Ejecución del plan de pruebas OP-084 y su informe.
- Publicar el servidor de staging con esta versión.
- Anotar las migraciones `301`–`315` en el registro de migraciones de la base de staging.
- Solicitud de cambio en GitHub al terminar.
