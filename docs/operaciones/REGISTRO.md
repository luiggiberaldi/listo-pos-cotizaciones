# Registro maestro de casos — construacero

**Para qué sirve:** es la puerta de entrada a todo lo que se ha hecho, arreglado o revisado en el sistema. Cada caso tiene un número fijo (por ejemplo `OP-2026-007`) que se usa para encontrarlo y para citarlo en otras conversaciones.

## En resumen

- Cada cambio, error, solución o revisión tiene **un número** y **una fila** en la tabla de abajo.
- El número se asigna en orden: el siguiente es el último número + 1.
- Para buscar algo: busca el número, o una palabra en la columna "Tema".
- Los casos anteriores a noviembre de 2026 todavía no tienen número; están listados al final.

## Cómo se nombra un documento nuevo

`OP-AAAA-NNN_tema-corto.md`, por ejemplo `OP-2026-015_cobranza-fecha-limite.md`.
- `OP` = operación, `AAAA` = año, `NNN` = número del caso.
- El tema va en minúsculas, con guiones, sin tildes.
- Los documentos antiguos conservan su nombre actual; el número está en esta tabla.

## Casos numerados

| Nº | Fecha | Tema | Estado | Solicitud de cambio / commit | Documento |
|---|---|---|---|---|---|
| OP-2026-001 | 2026-11-05 | Deudas por vencer: revisión y plan de arreglo | Ver documento | — | [auditoria-deudas-por-vencer-20261105.md](auditoria-deudas-por-vencer-20261105.md) · [plan](../plans/2026-11-05-plan-fix-deudas-por-vencer.md) |
| OP-2026-002 | 2026-11-05 | Aviso de cobranza | Ver documento | — | [aviso-cobranza-20261105.md](aviso-cobranza-20261105.md) |
| OP-2026-003 | 2026-11-05 | Buzón e intercomunicador: auditoría | Ver documento | — | [auditoria-buzon-e-intercomunicador-20261105.md](auditoria-buzon-e-intercomunicador-20261105.md) |
| OP-2026-004 | 2026-11-05 | Devoluciones: auditoría (corrección pausada) | Pausado: falta confirmación de Administración | — | [auditoria-devoluciones-20261105.md](auditoria-devoluciones-20261105.md) |
| OP-2026-005 | 2026-11-05 | Mis ventas en staging | Ver documento (respaldo por WhatsApp no construido) | — | [mis-ventas-staging-20261105.md](mis-ventas-staging-20261105.md) |
| OP-2026-006 | 2026-11-05 | PDF más livianos | Publicado | Solicitud #28 (se publicó junto con el aviso "Actualizando…") | [pdf-livianos-20261105.md](pdf-livianos-20261105.md) |
| OP-2026-007 | 2026-11-06 | Auditoría de todos los reportes: exactitud y velocidad | Publicado (fases 1 y 2); fase 3 pendiente y opcional | Solicitudes #26, #27, #28 | [auditoria-reportes-20261106.md](auditoria-reportes-20261106.md) |
| OP-2026-008 | 2026-11-06 | Auditoría de PDF de comisiones | Ver documento | — | [auditoria-pdf-comisiones-20261106.md](auditoria-pdf-comisiones-20261106.md) |
| OP-2026-009 | 2026-11-06 | Error "permission denied" en Auditoría por despacho | Publicado 2026-11-07 | Solicitud #31 (`cf9fb263`) | [error-auditoria-usuarios-20261106.md](error-auditoria-usuarios-20261106.md) |
| OP-2026-010 | 2026-11-06 | Plan de optimización de velocidad | Guardado en git (commit `a7a23ddf`) | — | [plan-optimizacion-velocidad-20261106.md](plan-optimizacion-velocidad-20261106.md) |
| OP-2026-011 | 2026-11-06 | Fecha de vencimiento en despachos a crédito | Publicado 2026-11-07 | Solicitud #29 (`ce3a0cc7`) | [plan](../plans/2026-11-06-plan-vencimiento-en-despachos.md) |
| OP-2026-012 | 2026-11-06 / 11-07 | Despacho #4567: montos distintos en PDF y arreglo | Publicado (falta probar un PDF real en producción) | Solicitud #30 (`516825af`) | [caso-despacho-4567-y-arreglo-pdf-20261107.md](caso-despacho-4567-y-arreglo-pdf-20261107.md) |
| OP-2026-013 | 2026-11-07 | Etapa 2 de velocidad: lista de clientes y verificación en paralelo | Publicado | Solicitudes #35, #36, #37 | [etapa2-velocidad-20261107.md](etapa2-velocidad-20261107.md) |
| OP-2026-014 | 2026-11-07 | Auditoría de salud de Supabase (solo lectura) | Revisión terminada; no hubo cambios. **El documento no está en la carpeta** (desapareció del árbol de trabajo el 7-nov a las 10:38; pendiente de recuperar) | — | — |
| OP-2026-015 | 2026-11-07 | Mapa del negocio, README actualizado y ley de documentación | Documento listo; pendiente de guardar en git | — | [OP-2026-015_mapa-de-negocio.md](OP-2026-015_mapa-de-negocio.md) · [README.md](../../README.md) |

**Nota:** los casos OP-2026-001 a 008 y 010 dicen "Ver documento" porque su estado se confirma leyendo el documento. Se completarán en la próxima revisión.

## Documentos anteriores (sin número todavía)

Están en `docs/operaciones/` con fecha en el nombre desde octubre de 2026 y anteriores, más las carpetas `docs/plans/`, `docs/incidentes/` (INC-001 a INC-003), `docs/decisiones/` (ADR-002 a ADR-004) y `docs/runbooks/`. Se numerarán cuando se revisen. Mientras tanto, para buscarlos, usa el nombre del archivo, que tiene la fecha.

Carpetas de referencia:
- Incidentes (fallos graves): `docs/incidentes/`
- Decisiones de diseño: `docs/decisiones/`
- Planes: `docs/plans/`
- Bitácora antigua (dejó de actualizarse el 5 de septiembre de 2026): `docs/history/BITACORA.md`

## Cómo agregar un caso

1. Tomar el siguiente número libre (hoy: **OP-2026-016**).
2. Crear el documento con el nombre `OP-AAAA-NNN_tema.md` y una sección "En resumen" al inicio.
3. Agregar una fila a la tabla de arriba con el número, la fecha, el estado y el enlace.
4. Si el caso se publica, poner el número de la solicitud de cambio y el commit en la fila.
