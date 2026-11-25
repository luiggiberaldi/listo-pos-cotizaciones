# OP-2026-083 — Plan para ordenar la carpeta raíz `construacero`

**Fecha:** 2026-11-25 · **Estado:** 📝 Propuesta, pendiente de tu aprobación. No se ha movido ni borrado nada. · **Base:** inventario [OP-2026-082](../operaciones/OP-2026-082_inventario-carpetas-locales.md).

## En resumen

- La carpeta principal está **desordenada y atrasada**: trabaja en una rama vieja (`fix/op-025-busqueda-sin-limites`, ya publicada), va **68 cambios detrás** de producción y tiene **360 cambios sin guardar**, mezclados de muchos casos.
- Además tiene **unos 120 archivos sueltos** en la raíz: 108 PDF de prueba (facturas, órdenes y notas de "Antonio Carrillo"), 4 reportes PDF, 4 respaldos de base de datos (`.dump`, con datos reales), una captura de pantalla y notas viejas.
- Propuesta: **guardar todo primero en una copia de seguridad local** (nada se pierde), poner la carpeta al día con producción, separar cada trabajo pendiente en su propia rama y mover o borrar lo suelto. Es como vaciar un escritorio lleno: primero se mete todo en una caja rotulada, luego se ordena por carpetas y al final se tira lo que sobra.

## Pasos propuestos

| # | Paso | Riesgo | Se puede deshacer |
|---|---|---|---|
| 1 | **Copia de seguridad total**: guardar los 360 cambios en una rama local `respaldo/carpeta-principal-2026-11-25` (solo en tu PC, no se sube) y copiar los `.dump` a `construacero-backups/`. | Ninguno | Sí |
| 2 | **Separar lo que sí falta subir**, cada uno en su rama: (a) documentos pendientes (OP-023, 028, 029, 030, 033, 060, 063, 065–068, 075, 076, 082, 083, planes) → una solicitud solo de documentación; (b) inventario de staging (OP-075) → rama `wip/op-075-inventario-staging` (no se publica hasta cumplir el plan OP-078); (c) auditor de saldos sección 3 → junto con (b). | Bajo | Sí |
| 3 | **Poner la carpeta al día**: cambiarla a `main` actualizado. Lo que ya estaba publicado por otras ramas (≈ 212 archivos) desaparece de la lista de pendientes porque ya es igual a producción. | Bajo (todo quedó en el paso 1) | Sí |
| 4 | **Archivos sueltos de la raíz**: mover los 108 PDF de prueba y los 4 reportes a `tmp/pdfs-generados/` (o borrarlos si confirmas que son de prueba); los 4 `.dump` a `construacero-backups/`; borrar la captura `2026-08-31 ... .png`, `scratch-results.json` y `scratch/`; mover `AUDITORIA_COD_Y_DEVOLUCIONES.*` y `PLAN_SOLUCION_DEFINITIVA_COD.md` a `docs/archivo/`. | Bajo | Sí, salvo lo que se borre |
| 5 | **Limpiar `tmp/`** (311 archivos temporales de pruebas y PDF de demostración) dejando solo los ficheros de configuración de prueba que usan los servidores locales. | Bajo | No (son temporales) |
| 6 | **Carpetas de trabajo**: borrar las ya limpias y publicadas (`construacero-op080` tras unir #78, `construacero-op025`, `construacero-op065`, `construacero-publicacion-op059`, `.claude/worktrees/peaceful-bun-…`); mover el documento de OP-063 de `.claude/worktrees/op-062-…` al paso 2a y borrarla; dejar `construacero-work` hasta terminar el PDF de clientes. | Bajo | No (solo se borran las que no tienen nada pendiente) |
| 7 | **Regla para el futuro**: no trabajar directamente en la carpeta principal; cada caso en su propia carpeta de trabajo desde `main` (como se hizo hoy con OP-080 y OP-025), y la carpeta principal siempre en `main` y limpia. Se añade a `AGENTS.md`. | Ninguno | Sí |

## Qué necesito que decidas

1. ¿Los **108 PDF de "Antonio Carrillo"** y los 4 reportes son de prueba (se pueden **borrar**) o prefieres **guardarlos** en `tmp/pdfs-generados/`?
2. ¿Apruebas el orden de pasos? Propongo ejecutar **1 → 3** primero (seguridad y puesta al día) y revisar contigo antes de borrar nada (pasos 4–6).

## Qué no se toca

- Producción, la base de datos y GitHub (salvo abrir la solicitud de documentación del paso 2a, con tu visto bueno).
- Los archivos de configuración con claves (`.env*`, `tmp/staging-local.dev.vars`): se quedan donde están y nunca se suben.
