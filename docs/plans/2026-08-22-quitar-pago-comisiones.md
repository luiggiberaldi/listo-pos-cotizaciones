# Plan: Eliminar flujo de pago de comisiones + Excluir CxC de totalcomision

**Fecha:** 2026-08-22
**Alcance:** Solo comisiones. Despachos, seguimiento, órdenes y logs quedan intactos.
**Riesgo:** Alto (toca BD, API, hooks, UI, PDF, tests).

---

## Visión general

**Antes:**
- `calcularcomisiondespacho` calcula `totalcomision` sobre el total completo del despacho (incluye CxC).
- Split `comision_liberada` / `comision_retenida` según métodos de pago.
- `estado` puede ser `pendiente`, `cta_cobrar`, `pagada`.
- Existen handlers para pagar comisiones, liberar CxC y cambiar estado.
- UI muestra badges de pagada/pendiente/CxC, botones "Pagar Todo" y "Pagar Solo Comisiones".
- PDF resumido excluye `cta_cobrar` y agrega campo manual "Comisión CxC".

**Después:**
- `calcularcomisiondespacho` calcula `totalcomision` solo sobre la porción **no-CxC** (contado + COD + otros).
- No hay split liberada/retenida: `comision_liberada = totalcomision`, `comision_retenida = 0`.
- `estado` único: `'generada'`.
- No existen handlers de pago, liberación ni cambio de estado.
- UI elimina toda referencia a pago, badges pagada/pendiente/CxC, botones de pagar.
- PDF resumido ya funciona correctamente (excluye `cta_cobrar` y usa campo manual).
- **Datos históricos quedan intactos.** Las columnas `montopagado`, `pagadaen`, `pagadapor` se dejan como legacy (no se dropean).

---

## Fase 1: BD — Migración SQL (NO EJECUTAR sin confirmación)

### 1.1 Nueva migración `238_excluir_cxc_comision_estado_generada.sql`

```sql
-- Reemplazar calcularcomisiondespacho:
--   1. totalcomision solo sobre porción no-CxC
--   2. estado siempre 'generada' (nunca cta_cobrar/pendiente/pagada)
--   3. comision_liberada = totalcomision, comision_retenida = 0
--   4. No inserta en comision_liberaciones (sin trigger de pago)

DROP FUNCTION IF EXISTS public.calcularcomisiondespacho(UUID) CASCADE;
-- ... (nueva definición igual al código actual pero con:
--      v_monto_cxc calculado, 
--      fracción no-CxC aplicada antes de ROUND,
--      estado := 'generada',
--      sin INSERT en comision_liberaciones)
```

### 1.2 Estado 'generada' en el CHECK constraint

```sql
-- Agregar 'generada' al enum implícito del CHECK si existe
ALTER TABLE public.comisiones DROP CONSTRAINT IF EXISTS comisiones_estado_check;
ALTER TABLE public.comisiones ADD CONSTRAINT comisiones_estado_check
  CHECK (estado IN ('pendiente', 'cta_cobrar', 'pagada', 'generada'));
```

### 1.3 Actualizar RPC de resumen `obtener_resumen_comisiones_v2`

La RPC actualmente calcula `pendientepago`, `yapagado`, `numpendientes`, `numpagadas` basado en `estado`. Debe actualizarse para usar `estado = 'generada'` y `totalcomision` como métrica única.

---

## Fase 2: API — Handlers

### Archivo: `api/handlers/comisiones.js`

#### 2.1 ELIMINAR handlers completos:
- `handleMarcarComisionPagada` (líneas 84–167): ~83 líneas
- `handleLiberarComisionCxc` (líneas 169–~265): ~96 líneas
- `handleActualizarEstadoComision` (líneas ~267–~310): ~43 líneas

#### 2.2 SIMPLIFICAR `handleGetComisiones`:
- Remover `comision_liberada`, `comision_retenida`, `montopagado`, `pagadaen`, `pagadapor` del `select`.
- Remover `estado` del `select` y del mapeo de respuesta.
- Remover filtro `estado=in.(pendiente,cta_cobrar)` en `aplicarFiltrosComisiones` (línea 49).
- La vista `eventos` ya no necesita `comision_liberaciones` (sin eventos de pago).

#### 2.3 SIMPLIFICAR `handleGetComisionesResumen`:
- Remover la consulta secundaria de breakdown (pendienteRegular/pendienteCxc).
- Simplificar respuesta: solo `totalAcumulado`, `numComisiones`, `total`.

---

## Fase 3: Worker — Rutas

### Archivo: `worker.js`

#### 3.1 ELIMINAR rutas:
- Línea 352: `/api/comisiones/pagar` → `handleMarcarComisionPagada`
- Línea 357: `/api/comisiones/liberar-cxc` → `handleLiberarComisionCxc`
- Línea 361: `/api/comisiones/estado` → `handleActualizarEstadoComision`

#### 3.2 ELIMINAR imports:
- Remover imports de los 3 handlers eliminados.

---

## Fase 4: Hooks

### 4.1 `src/hooks/useComisiones.js`

**ELIMINAR:**
- `useMarcarComisionPagada()` completo (~líneas 170–210).

**SIMPLIFICAR `useComisiones`:**
- Remover del mapeo: `montopagado`, `comision_liberada`, `comision_retenida`, `pagadaen`, `pagadapor`.

**SIMPLIFICAR `useComisionesResumen`:**
- Remover: `pendiente`, `pagado`, `retenida`, `countPendiente`, `countPagado`, `pendienteRegular`, `pendienteCxc`.
- Dejar solo: `total`, `totalAcumulado`, `numComisiones`.

### 4.2 `src/hooks/useReporteVentas.js`

**SIMPLIFICAR:**
- Líneas 431–433: eliminar `comisionesPagadas`, `comisionesPendientes`.
- Línea 291: cambiar `estado: 'pagada'` → `estado: 'generada'`.
- Línea 386: cambiar `estado: 'pendiente'` → `estado: 'generada'`.

### 4.3 `src/hooks/useReporteVendedores.js`

**SIMPLIFICAR:**
- Línea 484–486: eliminar `if (c.estado === 'pagada')` / `else if (c.estado === 'cta_cobrar')`.
- Líneas 257, 269: cambiar `estado: 'pagada'/'pendiente'` → `estado: 'generada'`.

### 4.4 `src/hooks/useReporteLiquidacion.js`

**SIMPLIFICAR:**
- Línea 121: eliminar `if (r.comision.estado === 'pagada')`.
- Líneas 132–133: eliminar `totalPagado`, `totalPendiente`.

### 4.5 `src/hooks/useDashboardMetrics.js`

**SOLO COMISIONES:**
- Línea 150: eliminar `c.estado === 'pendiente'` → `porVendedor[vid].pendiente`.
- NO tocar despachos pendientes (línea 24, 48, etc.).

---

## Fase 5: Vistas

### 5.1 `src/views/ReportesView.jsx` (archivo más afectado)

**ELIMINAR estados y variables:**
- `comisionAPagar` (línea 1004)
- `pagoMasivoData` (línea 1005)
- `pagandoMasivo` (línea 1006)
- `selectedIds` (línea 1008)
- `puedePagarComisiones` (línea 997)
- `marcar` (línea 986)

**ELIMINAR useMemos:**
- `comisionesPendientes` (línea 1010) → simplificar
- `comisionesSoloPendientes` (línea 1013)
- `montoPendiente` (línea 1024)
- `montoSoloPendiente` (línea 1031)
- `selectedPendientes` (línea 1039)
- `montoSeleccionado` (línea 1043)
- `allPendienteIds`, `allSelected`, `someSelected` (línea 1049+)

**ELIMINAR funciones:**
- `toggleId` (línea 1052)
- `toggleAll` (línea 1059)
- `handlePagarTodoVendedor` (línea 1585+)

**ELIMINAR UI:**
- Badges de estado (pagada/pendiente/cta_cobrar) en tabla de detalle
- Botones "Pagar Todo" y "Pagar Solo Comisiones"
- Columnas `montopagado`, `comision_liberada`, `comision_retenida` en tabla de detalle
- Modal de pago masivo
- Modal de pago individual (`comisionAPagar`)

**SIMPLIFICAR:**
- `totales` (línea 1073): remover `c.estado === 'cta_cobrar'` branch
- `vendedoresAgrupados`: remover `pendSoloComisUsd`, `pagUsd`; cambiar estado logic
- `exportarPDF`: remover referencia a `comision_liberada`
- Filtro de estado: simplificar (sin `pendiente`/`cta_cobrar`/`pagada`)

### 5.2 `src/views/ComisionesView.jsx`

**ELIMINAR:**
- `useMarcarComisionPagada` import
- Botones "Pagar" individuales (línea ~222)
- Botón "Pagar Todo" / "Liberar CxC" (línea ~288)
- Badge `cta_cobrar` (línea ~95)
- `montoRetenido` display (línea ~56)
- `montoPendienteRegular` / `montoPendienteCxc` (línea ~67–74)
- `accionesVisibles` (línea ~57)
- `onLiberarCxc`, `liberando` props
- Columnas `comision_liberada` / `comision_retenida` en tabla expandida

**SIMPLIFICAR:**
- `pendientes`: solo filtrar `generada` o mostrar todas
- `montoPendiente`: sumar `totalcomision` directo

### 5.3 `src/views/TesterFlowView.jsx`

**ELIMINAR steps:**
- `pay_commission` (línea 150): "28. Pagar comisión"
- `assert_commission_paid` (línea 151): "29. Assert: comisión estado=pagada"

**SIMPLIFICAR assertions:**
- Línea 877: cambiar `estadoEsperado === 'cta_cobrar'` → `estadoEsperado === 'generada'`
- Líneas 883–886: simplificar validación de comision_liberada/retenida

### 5.4 `src/views/AuditoriaView.jsx`

**SIMPLIFICAR:**
- Línea 598: remover `comision_liberada`, `comision_retenida` del select
- Línea 961–967: simplificar badges de estado comisión
- Línea 1258: remover columna "Liberada/Retenida"

### 5.5 `src/views/ReporteVendedoresView.jsx`

**SIMPLIFICAR:**
- Línea 206: cambiar "Comisión pagada" → "Comisión generada"
- Línea 210: eliminar "Comisión pendiente"

### 5.6 `src/components/reportes/TabLiquidacion.jsx`

**SIMPLIFICAR:**
- Línea 89: remover filtro `comision_liberada` en pendientes
- Línea 94: simplificar `comisionesAsesor.reduce`
- Línea 197: remover `comision_liberada` y `comision_pagada_monto`

---

## Fase 6: PDF

### Archivo: `src/services/pdf/comisionesPDF.js`

**SIMPLIFICAR:**
- Línea 84: eliminar badge `cta_cobrar`
- Línea 330: cambiar `c.despacho_comision_liberada ?? c.montopagado ?? 0`
- Línea 376: eliminar filtro `c.estado !== 'cta_cobrar'` (ya no existirá)
- Línea 714–728: eliminar sección CxC del resumen
- Línea 1179–1180: eliminar separación normal/CxC
- Línea 1474: eliminar `if (c.estado === 'cta_cobrar') return` del resumido
- Simplificar `dibujarTablaResumida`: remover `totalCxC`, `totalDescCarro` si no se usan

---

## Fase 7: Tests

### Archivos a actualizar:
- `api/handlers/__tests__/testerCleanup.test.js`
- `api/handlers/__tests__/productKardex.test.js`
- `src/utils/__tests__/rpcProductContract.test.js`
- `api/handlers/__tests__/cotizacionesTester.test.js`

---

## Archivos que NO se tocan

| Archivo | Razón |
|---|---|
| `api/handlers/despachos.js` | "pendiente" = estado de despacho, no comisión |
| `src/hooks/useDespachos.js` | ídem |
| `src/hooks/useCuentasCobrar.js` | `saldo_pendiente` = deuda de cliente, no comisión |
| `src/hooks/useOrdenesCompra.js` | "pendiente" = estado de orden de compra |
| `src/hooks/useRecordatoriosCotizaciones.js` | despachos pendientes |
| `src/views/DashboardView.jsx` | despachos pendientes |
| `src/views/LogsView.jsx` | mensajes pendientes |
| `src/views/TutorialView.jsx` | despachos pendientes |
| `src/views/VentaRapidaView.jsx` | cotización pendiente |
| `src/views/OrdenCompraView.jsx` | orden pendiente |
| `supabase/migrations/200_comision_cxc_manual.sql` | es el archivo fuente actual (se reemplaza en 238) |

---

## Orden de ejecución recomendado

1. **Fase 1 (BD):** Crear migración 238 y revisar SIN APLICAR.
2. **Fase 2 (API):** Modificar `comisiones.js`.
3. **Fase 3 (Worker):** Eliminar rutas.
4. **Fase 4 (Hooks):** Simplificar hooks.
5. **Fase 5 (UI):** Simplificar vistas.
6. **Fase 6 (PDF):** Simplificar generación.
7. **Fase 7 (Tests):** Actualizar y ejecutar `npm test`.
8. **Verificar build:** `npm run build`.
9. **Verificar sintaxis:** `node --check` en cada archivo modificado.
10. **Ejecutar DB migration** en staging/principal con backup previo.
11. **Desplegar Worker + Frontend.**
12. **Smoke test.**
13. **Auditoría post-cambio (baseline).**

---

**Total estimado de archivos modificados: 15–20**
**Total estimado de líneas eliminadas: ~400–500 LOC**
**Riesgo: Alto** (requiere backup fresco antes de aplicar migración)