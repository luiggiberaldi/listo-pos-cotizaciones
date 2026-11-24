# OP-2026-057 — Acceso, consistencia y detalles de la cartera (staging)

**Fecha:** 2026-11-24 · **Entorno de los arreglos:** solo staging (copia de pruebas) · **Producción:** solo se leyó, sin cambios
**Fallas que atiende:** I4, M1, M2 (corrección), M3, M4, M5 y M7 (fase 6 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md)). Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md)

## En resumen

- **I4 no era un problema real.** Un vendedor que consulta la base directamente solo ve sus clientes y sus movimientos: en la prueba vio 1 cliente de 780 y 1 movimiento de 674, los suyos. Administración ve todo. La revisión de código de OP-038 no notó que la regla general de la base es "restrictiva" (se cumple siempre, además de las demás). Producción tiene las mismas reglas. No se cambió nada.
- **El historial de la ficha seguía cortado en 100 movimientos (M2).** OP-042 había ampliado otra consulta, y la prueba de OP-056 midió la equivocada. Ahora la ficha carga todo, leyendo por páginas (REYKAR: 124 de 124).
- **El saldo de cada línea del historial se calcula al mostrarlo (M1).** Antes se mostraba un saldo "foto" que quedaba viejo si después se anulaba algo.
- **Despachos con dos deudas (M3):** un pago enlazado paga primero la deuda de su mismo tipo (crédito o cobro a destino) y después la otra del mismo despacho, en la pantalla y en la base por igual.
- **Las mismas cifras en todos lados (M4):** comparación de todos los clientes de staging, sin ninguna diferencia (211 cargos y 104 saldos).
- **Los fallos de recálculo quedan anotados (M5)**, y **las lecturas del reporte de cartera se hacen por páginas (M7)**, para no perder movimientos.
- **Pruebas:**
  - acceso 4/4, comparación sin diferencias e historial 124/124;
  - 476 de 476 automáticas, y la app se arma bien.
  **Nada está en producción.**

## 1. I4 — ¿un vendedor puede leer toda la cartera?

Prueba `construacero-staging/scripts/op057-acceso-vendedor.mjs`. Se crea un vendedor temporal con un cliente propio, que consulta la base directamente con su sesión (como se haría desde la consola del navegador):

| Qué lee | Resultado |
|---|---|
| Movimientos de cuentas por cobrar | El vendedor ve **1 de 674** (solo los de su cliente); administración ve 674 de 674 |
| Clientes (con su saldo) | El vendedor ve **1 de 780** (solo el suyo) |

**Por qué:** las reglas `isolation_*` y `dashboard_scope_select` son **restrictivas**. Exigen que el operador tenga permiso para ese vendedor (`can_read_seller`), y la pantalla manda la sesión del operador en cada consulta. **Producción tiene exactamente las mismas reglas** (comparadas en `pg_policies`). I4 queda como "no existe en la práctica"; se mantiene la prueba para que avise si alguien cambia esas reglas.

## 2. M2 y M7 — leer todo, por páginas

- `src/utils/leerPaginado.js` (nuevo): lee de 1.000 en 1.000 hasta traer todo. La base entrega como máximo un número fijo de filas por consulta.
- Se usa en:
  - el historial de la ficha (antes `.limit(100)`) y el resumen de la cuenta;
  - el reporte de cartera: movimientos por lotes de clientes, deudas del período y abonos con rango de fechas.
- **Medido** (`scripts/op056-historial-pantalla.mjs`, ahora sobre la consulta correcta): la ficha de REYKAR recibe **124 de 124** movimientos. Con el código anterior habría recibido 100.

## 3. M1 — saldo de cada línea

`src/utils/cxcSaldos.js` (nuevo) calcula el saldo acumulado línea por línea con los movimientos que existen hoy, con la misma fórmula que la base:
- en abonos y deudas, la deuda;
- en saldo a favor, devoluciones de saldo y consumos, el saldo a favor.

La ficha lo usa en lugar del saldo guardado al registrar. Por ejemplo: si se anuló un abono viejo, la línea siguiente ya no muestra el saldo de cuando ese abono existía.

## 4. M3 — despachos con dos deudas

- `src/utils/cxcReparto.js` y la función de la base `cxc_reparto_cliente` (migración 308) aplican la misma regla. Un abono enlazado paga:
  1. la deuda de su despacho del mismo tipo (cobro a destino con cobro a destino; el resto con crédito);
  2. después, la otra deuda del mismo despacho;
  3. solo lo que sobre, las deudas más viejas.
  
  Antes pagaba solo la primera deuda del despacho, y el resto se iba a otro despacho aunque la segunda deuda de este siguiera pendiente.
- **En producción** hay 7 despachos con dos deudas. Comparé la regla vieja con la nueva sobre los 1.050 movimientos de producción, solo leyendo: **ningún cargo cambia** con los datos de hoy. La regla protege los casos futuros, y está probada con casos armados en las pruebas automáticas.

## 5. M4 — mismas cifras en todos lados

Prueba de comparación (`docs/operaciones/OP-2026-040_scripts/op057_comparacion_datos.py` + `construacero-staging/scripts/op057-comparacion-reparto.mjs`) con **todos** los clientes de staging:

| Comparación | Resultado |
|---|---|
| Lo pendiente de cada cargo: pantalla vs base | **211 iguales, 0 distintos** |
| Deuda y saldo a favor final: pantalla vs guardado en el cliente | **104 iguales, 0 distintos** |

El reporte de cartera, la ficha y la devolución ya usaban la misma regla (OP-042); ahora también la base, con la regla de dos deudas.

## 6. M5 — fallos de recálculo visibles

`api/lib/cxcUtils.js`: si falla leer los movimientos, guardar el saldo o hay una excepción, queda la anotación `RECALCULO_SALDO_FALLIDO` (categoría SISTEMA) en la auditoría. La base además recalcula sola con su disparador, así que el saldo no queda mal. Probado forzando los dos tipos de fallo (`api/lib/__tests__/cxcUtilsFallo057.test.js`).

## 7. Pruebas

| Prueba | Resultado |
|---|---|
| Acceso por rol (`op057-acceso-vendedor.mjs`) | 4/4 |
| Comparación pantalla/base/saldos (todos los clientes de staging) | Sin diferencias |
| Historial de REYKAR en navegador real | 124/124 |
| Automáticas | **476/476** en 52 archivos (nuevas: `src/utils/__tests__/consistencia057.test.js` y `api/lib/__tests__/cxcUtilsFallo057.test.js`) |
| Construcción de la app | Correcta |

## 8. Archivos cambiados (staging)

- Nuevos: `src/utils/leerPaginado.js` y `src/utils/cxcSaldos.js`.
- `src/hooks/useCuentasCobrar.js`: historial y resumen completos, reporte por páginas, metodo_pago en el resumen.
- `src/utils/cxcReparto.js` y `supabase/migrations/308_staging_reparto_dos_deudas.sql` (+ `_rollback.sql` con la regla anterior exacta): regla de dos deudas. **Aplicada en staging.**
- `api/handlers/despachos.js`: la vista previa de devolución trae metodo_pago.
- `src/components/clientes/FichaClienteModal.jsx`: saldo por línea calculado.
- `api/lib/cxcUtils.js`: anotación de fallos.
- Pruebas: `scripts/op057-acceso-vendedor.mjs`, `scripts/op057-comparacion-reparto.mjs`, `scripts/op056-historial-pantalla.mjs` (afinada), `docs/operaciones/OP-2026-040_scripts/op057_comparacion_datos.py` y las dos pruebas automáticas nuevas.

## 9. Pendiente

- **No está en producción.** Necesita un caso propio, las migraciones 301 a 308 y tu aprobación.
- El PDF de cuentas por cobrar (`cxcPDF.js`) muestra el saldo de cada deuda calculado por la regla de reparto; el reporte de alertas sigue usando el saldo guardado de cada fila. Se revisará en la prueba final.
- Sin publicar en GitHub: no hay solicitud de cambio ni commit.
