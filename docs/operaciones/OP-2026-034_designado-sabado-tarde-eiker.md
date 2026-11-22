# OP-2026-034 — Sábado 21-nov-2026: Eiker Montaner se marcó como designado al final del día

**Fecha:** 2026-11-21 · **Estado:** **recálculo ejecutado y verificado en producción** (2026-11-21); sin cambios de código

## En resumen

- **Eiker Montaner** fue el vendedor designado de hoy sábado **21 de noviembre de 2026**, pero se marcó al final del día (11:24 p. m., registrado por Enzo Patti).
- Como las ventas del día se habían hecho antes, las comisiones se calcularon normales (2 % al dueño del cliente).
- Con autorización expresa del dueño, se **recalcularon los 7 despachos afectados** en producción usando la herramienta segura del sistema (`recalcularcomisiondespacho_238b`), dejando intacto el despacho **#4868** (Niki Ramírez / EMPRESA) tal como pidió el dueño.
- Se guardaron fotos completas del **antes** y el **después** solo en la computadora del dueño. Ninguna comisión pagada fue tocada.

## Qué se revisó antes de cambiar nada (solo lectura)

- **Designación de hoy:** guardada correctamente para el `2026-11-21` a nombre de **Eiker Montaner** (por Enzo Patti a las 11:24 p. m., hora de Venezuela).
- **Ventas de hoy:** **16 despachos** (#4863 al #4878) y 0 cotizaciones pendientes sin despacho.
- **Pagos de comisión:** **0 comisiones pagadas** hoy. Todas estaban en estado "generada".
- **Despachos que no requerían cambio (9):**
  - 5 clientes propios de Eiker (#4870 despachada, #4872, #4874, #4876, #4877): suman \$15,70 para Eiker; como él es dueño y designado, mantiene su 2 % normal.
  - 2 clientes de EMPRESA (#4863 y #4873): sin comisión.
  - 1 despacho anulado (#4871): sin comisión.
  - 1 caso especial (#4868, \$98,00, cliente de Niki Ramírez, vendedor registrado EMPRESA): el dueño decidió dejarlo como estaba (Niki \$1,96, sin dividir).

## Recálculo autorizado y ejecutado (21-nov-2026)

Se ejecutó en un solo bloque seguro con doble verificación automática (confirmando que Eiker estaba designado para el `2026-11-21` y que ninguna comisión estaba pagada). Solo se tocaron los **7 despachos** que aplican división de sábado.

### Resultado verificado por despacho

| Despacho | Vendió | Dueño del cliente | Antes | Después (verificado) |
|---|---|---|---|---|
| 4864 | Josué Marciales | Josué Marciales | Josué \$0,40 | Josué \$0,30 + Eiker \$0,10 |
| 4865 | Josué Marciales | Josué Marciales | Josué \$2,20 | Josué \$1,65 + Eiker \$0,55 |
| 4866 | Eiker Montaner | Edgar Ramírez | Edgar \$0,57 | Edgar \$0,43 + Eiker \$0,15 |
| 4867 | Eiker Montaner | Edgar Ramírez | Edgar \$0,20 | Edgar \$0,15 + Eiker \$0,05 |
| 4869 | Eiker Montaner | Josué Marciales | Josué \$0,20 | Josué \$0,15 + Eiker \$0,05 |
| 4875 | Eiker Montaner | Edgar Ramírez | Edgar \$4,72 | Edgar \$3,54 + Eiker \$1,18 |
| 4878 | Eiker Montaner | Edgar Ramírez | Edgar \$0,20 | Edgar \$0,15 + Eiker \$0,05 |

Despachos con comisión que se dejaron intactos: **#4868** (Niki \$1,96), **#4870** (Eiker \$4,56), **#4872** (Eiker \$2,00), **#4874** (Eiker \$3,42), **#4876** (Eiker \$5,20), **#4877** (Eiker \$0,52).

### Totales verificados del día por vendedor

| Vendedor | Antes | Después | Diferencia |
|---|---:|---:|---:|
| **Eiker Montaner** | \$15,70 | \$17,83 | +\$2,13 |
| **Edgar Ramírez** | \$5,69 | \$4,27 | -\$1,42 |
| **Josué Marciales** | \$2,80 | \$2,10 | -\$0,70 |
| **Niki Ramírez** | \$1,96 | \$1,96 | \$0,00 |
| **Total del día** | **\$26,15** | **\$26,16** | **+\$0,01** (redondeo en #4866) |

### Respaldos locales (no se suben a git)

- Foto de antes (13 filas): `docs/operaciones/OP-2026-034_comisiones_antes.json`
- Foto de después (20 filas): `docs/operaciones/OP-2026-034_comisiones_despues.json`

Con la foto de antes se puede volver atrás exactamente si hiciera falta.

## Pendiente / ideas para después

- [x] Autorización del dueño para recalcular los 7 despachos del 21-nov y dejar el #4868 intacto.
- [x] Recálculo ejecutado y verificado en producción; respaldos locales guardados.
- [x] **Próxima mejora pedida por el dueño (plan creado en [OP-2026-036](../plans/OP-2026-036_calendario-sabados-designado.md)):** crear un **calendario de todos los sábados del mes** para elegir de una sola vez los vendedores designados del mes completo y evitar que se olvide marcarlo cada sábado.
