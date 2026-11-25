# OP-2026-033 — Revisión de las carpetas "construacero" en la PC

**Fecha:** 2026-11-18 · **Estado:** 3 copias de trabajo **borradas** el 2026-11-18 (aprobado por el usuario); lo demás sin tocar · **Entorno:** solo la PC (no toca producción ni staging)

## En resumen

- Además de la carpeta principal (`Desktop\construacero`), hay **4 copias de trabajo** en el Escritorio, **1 carpeta de respaldos** y **3 proyectos aparte** (nómina, página web, notas del ERP).
- **2 copias se pueden borrar ya** sin perder nada (`ca-op026` y `construacero-wt-op023`). **1 se puede borrar** porque su trabajo ya está en la principal (`construacero-op032`). **1 NO se debe borrar** todavía: `construacero-work` tiene trabajo sin guardar (los PDF de clientes) que no existe en ningún otro lado.
- La carpeta `Desktop\construacero-backups` **es la que usa el respaldo semanal**: no se toca.

## Qué es una "copia de trabajo"

Es como sacar una fotocopia del proyecto para trabajar un arreglo aparte sin desordenar el original. Todas comparten el mismo historial; cuando el arreglo se publica, la fotocopia ya no hace falta. Cada una ocupa unos 36 MB (más si tiene programas instalados).

## Detalle por carpeta

| Carpeta | Qué es | ¿Tiene algo único? | Recomendación |
|---|---|---|---|
| `Desktop\construacero` | **Proyecto principal** | — | Se queda |
| `Desktop\ca-op026` | Copia usada para publicar OP-2026-026/027 (solicitud #56, ya unida) | No: todo está en GitHub y en principal | **Borrar** |
| `Desktop\construacero-wt-op023` | Copia con el informe OP-2026-023 | No: el informe está idéntico en la principal y también subido a GitHub (rama sin solicitud de cambio) | **Borrar** |
| `Desktop\construacero-op032` | Copia del arreglo del Reporte de Vendedores (OP-2026-032) | Sus 5 archivos cambiados son **idénticos** a los de la principal | **Borrar** (el trabajo sigue en la principal) |
| `Desktop\construacero-work` | Copia del arreglo de PDF (continuación de OP-2026-024: PDF de clientes) | **Sí**: 2 archivos cambiados (`clientesPDF.js`, `pdfShared.js`) que no están ni en la principal ni en GitHub | **No borrar**. Primero pasar ese trabajo a la principal o terminarlo |
| `Desktop\construacero-backups` (713 MB) | Destino del respaldo semanal (`scripts/backup-semanal.mjs`) y respaldos antes de cambios grandes | Sí, son los respaldos | **Se queda.** Opcional: borrar `miniaturas-prueba` y `muestra-miniaturas.png` (pruebas viejas) |
| `Desktop\construacero\construacero-backups` (88 MB) | Respaldo viejo del 2026-10-18 guardado dentro del proyecto (Git lo ignora) | Copia antigua | **Mover** a `Desktop\construacero-backups` para tener todos los respaldos juntos |
| `sistemas personalizados\construacero\nomina y staging` | **Otro proyecto**: el sistema de nómina (GitHub `construacero-sistemas/sistema-nomina-construacero`) + imágenes de ejemplo | Sí (16 cambios sin guardar) | **No tocar**: es otro sistema |
| `sistemas personalizados\construacero\pagina-construacero` | **Otro proyecto**: la página web (GitHub `paginaconstruacerocarabobo`), último cambio mayo 2026 | Sí (13 cambios sin guardar) | No tocar. Si ya no se usa, archivar más adelante |
| `sistemas personalizados\construacero\ERP` | Notas sueltas y registros de pruebas viejas (`supabase.txt`, `clonado cotizaciones.txt`, logs) | Notas | Revisar si `supabase.txt` tiene llaves; si las tiene, no dejarlo suelto |

Fuera del Escritorio también hay carpetas de configuración de herramientas (Claude, Freebuff, WorkBuddy, opencode). Son de los programas de IA, no del sistema: no hace falta tocarlas.

## Cómo se borraría (cuando se decida)

Las copias de trabajo se quitan con `git worktree remove <carpeta>`: así Git deja de recordarlas y se borra la carpeta. Si Git avisa de cambios sin guardar, se detiene; solo se fuerza después de comprobar que esos cambios ya existen en otro lado.

## Qué se hizo (2026-11-18)

- Se borraron `ca-op026` y `construacero-wt-op023` con `git worktree remove` (sin forzar).
- `construacero-op032`: Git se detuvo porque tenía 5 archivos sin guardar. Se volvió a comprobar que los 5 eran **idénticos** a los de la carpeta principal y entonces se borró con `--force`. No se perdió nada.
- Se liberaron unos 108 MB. Las "ramas" (etiquetas con el nombre de cada arreglo) quedan guardadas en el historial; no ocupan espacio y no molestan.
- Comprobado: `git worktree list` solo muestra la carpeta principal y `construacero-work`.

## Pendiente

- Mover `Desktop\construacero\construacero-backups` a `Desktop\construacero-backups` (no hecho).
- Revisar `ERP\supabase.txt` por si tiene llaves (no hecho).
- Rescatar el trabajo de `construacero-work` antes de borrarla.
