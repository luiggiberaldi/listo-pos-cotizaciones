# OP-2026-082 — Qué hay en las carpetas locales que no está en `main`

**Fecha:** 2026-11-25 · **Tipo:** revisión de solo lectura (no se cambió, borró ni subió nada) · **Referencia:** `origin/main` = `fa13d0c2` (tras publicar la solicitud #77).

## En resumen

- Casi todo el trabajo local **ya está en producción**. De 7 carpetas de trabajo, 4 están limpias y al día.
- Lo que **falta subir** se reduce a 4 grupos: (1) la búsqueda sin límites **OP-025** (código listo, nunca publicado), (2) el arreglo de **PDF de clientes** sin recortes (continuación de OP-024, sin guardar), (3) el **inventario de staging** (OP-075, bloqueado por la auditoría OP-076 por fallas críticas), y (4) **documentos** de casos que nunca se subieron (OP-023, 028, 029, 030, 033, 060, 063, 065, 067, 068, 075, 076, etc.).
- Hay **una solicitud abierta**: #78 (solo documentación de la publicación de hoy).
- La carpeta principal tiene 360 cambios sin guardar, pero **197 de los cambios del programa ya son idénticos a producción**: son "copias viejas" de cosas ya publicadas por otras ramas.

## 1. Carpetas de trabajo

| Carpeta | Rama | Estado | ¿Falta algo en `main`? |
|---|---|---|---|
| `construacero` (principal) | `fix/op-025-busqueda-sin-limites` | **360 cambios sin guardar** (126 en `construacero-staging/`, 234 fuera) | **Sí** — ver sección 2 |
| `construacero-work` | `fix/op-025-pdf-sin-recortes` | 2 archivos sin guardar: `src/services/pdf/clientesPDF.js`, `src/services/pdf/pdfShared.js` | **Sí**: PDF de clientes con textos en varias líneas (función `wrapLines`, no existe en `main`). Continúa OP-024, que en el registro dice "falta el resto de los PDF". |
| `.claude/worktrees/op-062-auditoria-reporte-cxc-2d1843` | `docs/op-063-guayos` | 3 archivos preparados pero sin guardar | **Sí**: documento `OP-2026-063_guayos-deuda-en-cero.md` + script ejecutado `op063_guayos_ejecutado.sql` + fila de REGISTRO. |
| `.claude/worktrees/peaceful-bun-3c08e9` | `claude/peaceful-bun-3c08e9` | Limpia | No (OP-064 ya en `main`). |
| `construacero-op065` | `docs/op-069-070-publicado` | Limpia | No. |
| `construacero-publicacion-op059` | `fix/op-063-anular-sin-casilla` | Limpia | No. |
| `construacero-op080` | `docs/op-080-publicado` | Limpia, subida | Solo la solicitud **#78** (documentación) pendiente de unir. |

## 2. Carpeta principal: qué falta de verdad

Se comparó cada archivo contra `origin/main` y, en los que difieren, qué líneas nuevas locales **no existen** en producción.

### 2.1 Código del programa (raíz)

| Tema | Archivos | Estado |
|---|---|---|
| **OP-2026-025 — búsqueda sin límites** | `src/services/apiBase.js` (función `traerTodo`), `src/hooks/useCotizaciones.js`, `src/hooks/useDespachos.js` | **No está en `main`.** Hoy en producción la búsqueda de cotizaciones/despachos puede cortar resultados (tope de 60/1000). Es la rama actual de esta carpeta; no tiene commits propios: todo está sin guardar. |
| Auditor de saldos — sección 3 (inventario, OP-071) | `scripts/auditor-saldos-main.mjs` | **No está en `main`.** Añade chequeos de inventario/Kardex/préstamos. Depende de tablas/columnas de las migraciones de inventario de staging (`310`+): no subir antes que ellas. |
| Anulación con pagos (OP-052) y modales de despacho | `api/handlers/despachos.js`, `DevolverAnularModal.jsx`, `EditarItemsDespachoModal.jsx` | **Ya en `main`** con otra redacción (`anular_despacho_con_pagos`, `DECISION_PAGOS_REQUERIDA`). Las diferencias locales son de una versión anterior: **no subir**. |
| Resto (`AppLayout`, `ReportesView`, `DespachosView`, `CotizacionesView`, `DetalleModal`, `ConfirmModal`, `CotizacionBuilder`, `worker.js`, `README.md`, `api/handlers/cotizaciones.js`) | — | Todas sus líneas nuevas **ya existen en `main`**: son copias atrasadas. **No subir.** |
| 197 archivos más (pruebas, migraciones, utilidades) | — | **Idénticos a `main`**. |

### 2.2 Copia de staging (`construacero-staging/`, 126 cambios)

- Trabajo de inventario **OP-2026-075** (migraciones SQL `300`–`313`, Worker, pantallas de inventario, `StockComprometidoDetalle` y `useStockComprometido` retirados).
- **No apto para producción** según la auditoría OP-2026-076 (2 críticos: funciones de dinero abiertas a `anon`, respaldo truncado a 1000 filas). El plan para corregirlo es OP-2026-078 (sin ejecutar).
- Los arreglos móviles (OP-077) y la cuadrícula (OP-079) de esta copia **ya se publicaron** en la solicitud #77.

### 2.3 Documentos que no están en `main`

- **Informes:** OP-023 (auditoría de errores), OP-025 (búsqueda sin límites), OP-028 (respaldo en Google Drive), OP-029 (velocidad semanal + carpeta `velocidad-semanal/`), OP-030 (creación de usuarios), OP-033 (carpetas en la PC), OP-065, OP-067, OP-068, OP-075, OP-076, `REGISTRO-FALLAS-CODIGO.md`.
- **Planes:** OP-066, OP-071, OP-078 y 5 planes de octubre (reasignación de clientes, conciliación COD, release 17, editar pago entregado).
- **Datos de respaldo:** `OP-2026-026_comisiones_antes/despues.json`, `OP-2026-034_comisiones_antes/despues.json`.
- **Ramas solo-documento sin solicitud:** `docs/op-023-auditoria-errores` (1 commit, OP-023) y `docs/op-060-pagos-corregidos` (1 commit: scripts SQL ejecutados de OP-060 + nota en REGISTRO; la fila de OP-060 sí está en `main`).
- Nota: muchos `.md` están ocultos por `.gitignore` (`*.md`), por eso no aparecen en la lista normal; en `main` se suben con `git add -f`.

### 2.4 Basura local

- `2026-08-31 16_42_23-Extracting Variables for ....png` (captura suelta en la raíz): no subir.

## 3. Qué se recomienda

1. **OP-025 (búsqueda sin límites):** es el único arreglo de programa listo y útil para el negocio que falta. Portarlo en rama limpia desde `main` (como se hizo con OP-080), probar y publicar.
2. **PDF de clientes (`construacero-work`):** terminar, guardar y publicar como cierre de OP-024.
3. **Documentos:** juntar en **una** solicitud solo-documentación los informes y planes de la sección 2.3 (y OP-063 de la carpeta `op-062...`), sin código.
4. **Inventario de staging:** no tocar hasta ejecutar el plan OP-078.
5. **Limpieza:** tras subir lo anterior, borrar las carpetas de trabajo ya limpias (`peaceful-bun`, `op065`, `publicacion-op059`, `op080` tras unir #78).

## Estado

- Solo lectura. Este documento está **solo en la carpeta principal** (sin subir), igual que su fila en `REGISTRO.md`.
