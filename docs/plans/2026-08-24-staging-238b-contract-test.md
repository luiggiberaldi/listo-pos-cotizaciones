# Prueba de contrato histórico 238b en staging

Fecha: 2026-08-24
Proyecto: `spupqgkdsgohxxfoxydl`
Estado: PASS / staging-only

## Resultado

Se probó el contrato histórico con cuatro filas de alta confianza: correlativos `763`, `1470`, `1610` y `2097`.

- Snapshot y preflight: `READ ONLY + ROLLBACK`.
- Filas registradas: `4`.
- Filas aprobadas: `4`.
- Filas aplicadas temporalmente: `4`.
- Filas restauradas por rollback: `4`.
- Apply idempotente: PASS.
- Rollback idempotente: PASS.
- Principal tocado: NO.

## Montos

| Métrica | Antes | Después del apply | Después del rollback |
|---|---:|---:|---:|
| Comisiones | 703 | 703 | 703 |
| Total | $14,415.07 | $14,103.38 | $14,415.07 |
| Cabilla | $3,570.59 | $3,570.59 | $3,570.59 |
| Otros | $10,844.48 | $10,532.79 | $10,844.48 |

Los cuatro casos fueron 100% no-CxC, por lo que `comision_cxc_excluida = $0.00` y `fraccion_no_cxc = 1`. Los cuatro terminaron temporalmente en `generada` con versión `238b`; luego regresaron exactamente a su estado y montos originales.

## Backup y evidencia

- Backup read-only: `tmp/backups/238b-staging-preapply-2026-08-24T14-21-32-296Z.json`.
- SHA-256 del backup: `811d4afccc21b3c7278c448cb842f812c267f581d1150338af5b902fb065e47a`.
- Batch probado: `a09fce5f-b678-4803-a0d3-f4de036081b8`.
- Evidencia completa: `tmp/238b-staging/238b-historical-contract-staging-v4-2026-08-24T14-26-11-333Z.json`.

## Observación importante

Staging ya tenía dos batches previos de pruebas; este ciclo dejó un tercer batch en estado `rolled_back` y sus filas en `rolled_back`. No hay datos de negocio aplicados, pero la metadata de auditoría se conserva deliberadamente.

El histórico del principal continúa sin aplicar. La única fila `manual_review` del principal y el residual global posterior a CxC permanecen bloqueados.
