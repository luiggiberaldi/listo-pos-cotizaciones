# Runbook — Rollback de base de datos

## Cuándo usarlo

- Un release SQL aplicado produce resultados incorrectos post-smoke y aún **no** hay datos de negocio montados encima.
- Un toggle de comportamiento debe volver a su estado seguro de inmediato.

## Cuándo NO usarlo (detenerse y escalar)

- Ya hay **datos reales del negocio** creados sobre el cambio (ventas, devoluciones, comisiones): el rollback estructural no revierte el tiempo; se necesita plan de reconciliación dato por dato con el dueño del negocio.
- El rollback del paquete no fue probado: nunca estrenar un rollback en caliente. Si no existe rollback, escribirlo y probarlo en staging antes de aplicar el release.
- No se sabe qué cuerpo vivía antes del cambio: sin backup previo no hay rollback seguro — escalar.

## Regla de oro: preflight → backup → apply → smoke → rollback → postflight

1. **Preflight (read-only)**: confirmar estado actual de objetos, firmas y toggles.
2. **Backup**: guardar los cuerpos vivos (`pg_get_functiondef`) y objetos que el release va a tocar, con SHA documentado en la bitácora.
3. **Apply** transaccional cuando el motor lo permita.
4. **Smoke**: verificar comportamiento real (no solo "no dio error").
5. **Rollback**: tenerlo escrito y probado ANTES del apply.
6. **Postflight**: verificar objetos finales y dejar evidencia en bitácora.

## Escalones de rollback (del más barato al más caro)

1. **Toggle OFF** — si el release introdujo un flag de comportamiento (ej: `comision_split_activo`), apagarlo es instantáneo y reversible. Siempre diseñar releases de comportamiento con toggle.
2. **Reversión de datos puntuales** — borrar/corregir solo las filas creadas por el feature (ej: filas split con evidencia `calculo_evidencia->split_*`), preservando lo del negocio.
3. **Reversión estructural completa** — ejecutar el `*_rollback.sql` del paquete (restaura cuerpos desde el backup SHA). Último recurso.

## Riesgos especiales de cambios financieros

- Las funciones financieras son transaccionales y a veces idempotentes por diseño (ADR-004): un rollback a medias puede romper esa garantía. Revertir la función **completa** desde el backup, nunca parchear en vivo.
- Verificar la **cadena de redefiniciones**: restaurar una versión vieja puede borrar fixes posteriores (lección 262→263). Comparar el cuerpo restaurado con el historial de migraciones.
- Después de revertir, recalcular/reprocesar solo con las RPC idempotentes del sistema (nunca UPDATE manual de comisiones).

## Cómo evitar residuos de pruebas

- Las pruebas en staging usan fixtures del E2E que se auto-limpian (`cleanupFixtures`). Si un run falla a mitad, re-ejecutar la suite completa (2 pasadas) para confirmar limpieza.
- Nunca probar rollbacks contra producción: el dry-run transaccional (`BEGIN…ROLLBACK`) contra staging valida sintaxis y dependencias sin persistir nada.
- Borrar archivos temporales de diagnóstico (`scripts/diag-*.mjs`, `tmp/`) o dejarlos gitignoreados; que no entren a un commit de rollback.

## Transacciones, savepoints y errores esperados

- Aplicar dentro de transacción cuando el entorno lo permita; si un statement falla, todo revienta junto (bien).
- Los errores "esperados" de guardarráiles (ej: `DESIGNADO_INVALIDO` del trigger) deben fallar **sin dejar filas**; validar que la prueba usó transacción propia y limpió.
- El warning de `BEGIN` anidado en paquetes con `BEGIN;` interno es inofensivo, pero preferir paquetes sin transacciones anidadas.

## Cuándo detenerse y escalar

- Cualquier duda sobre si hay datos de negocio encima del cambio → detener, capturar estado (tablas + conteos + evidencia), consultar.
- Si el rollback también falla → restauración puntual desde backup de base (requiere decisión explícita del propietario; hay precedentes documentados en bitácora 2026-08-21 con SHA y tamaños).

## Registro obligatorio

Toda ejecución de rollback se registra en `BITACORA.md` (fecha, motivo, escalones usados, SHA de backups, validación posterior).
