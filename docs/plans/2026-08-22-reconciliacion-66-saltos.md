# Plan de reconciliación de los 66 saltos del Kardex (37 productos)

**Estado:** PLAN / REVISIÓN — **nada aplicado**. Todas las consultas de este plan son read-only.
**Fecha de generación:** 22/08/2026.
**Alcance:** tenant `74dd6821-963d-406e-8621-47352e0df27e` (único tenant con brechas).

---

## 1. Resumen ejecutivo

- **66 brechas de continuidad** en **37 productos**, todas en un único tenant.
- **0 errores matemáticos** (todas las filas cumplen `stock_anterior ± cantidad = stock_nuevo`).
- Dirección: **41 saltos hacia arriba** (stock sube sin ingreso registrado) y **25 hacia abajo** (stock baja sin egreso registrado).
- Magnitud: mínimo **1**, máximo **8.640**, promedio **498,88**.
- Por `motivo_tipo` del movimiento anómalo: `venta` 56, `ajuste_inventario` 7, `compra_proveedor` 2, `devolucion` 1.
- **9 de las 66** tienen motivo con `devolución`/`reversión`/`anulación` (el síntoma original: "pasó de 151 a 385 sin explicar").
- Ya existe **un batch previo aplicado** (`d350bea3-4f7f-40ae-b80a-3a943297e130`, 24 correctivos, `estado=aplicado`, Δ = −525). Este plan cubre **los 66 restantes**.

---

## 2. Contrato de detección (exacto, igual al audit y a la RPC)

Ventana por producto, ordenada por:

```
PARTITION BY producto_id
ORDER BY creado_en, COALESCE(numero, 0), id
```

Sobre esa ventana, `prev_stock_nuevo = lag(stock_nuevo)`.

- **Continuity gap (brecha):**
  `prev_stock_nuevo IS NOT NULL AND abs(prev_stock_nuevo - stock_anterior) > 0.01`
- **Math error (hoy 0):**
  `abs(stock_anterior + (ingreso ? +cantidad : -cantidad) - stock_nuevo) > 0.01`

La brecha significa: el `stock_anterior` que declara un movimiento **no coincide** con el `stock_nuevo` que dejó el movimiento inmediatamente anterior. Es decir, entre dos movimientos el stock cambió sin que exista un movimiento que lo explique.

---

## 3. Caracterización y clasificación

| Dimensión | Resultado |
|---|---:|
| Total brechas | 66 |
| Productos afectados | 37 |
| Tenants afectados | 1 (`74dd6821…`) |
| Saltos hacia arriba (falta ingreso) | 41 |
| Saltos hacia abajo (falta egreso) | 25 |
| Magnitud min / max / promedio | 1,00 / 8.640,00 / 498,88 |
| Relacionadas con devolución/reversión/anulación | 9 |

**Distribución de brechas por producto** (productos con 2+ brechas): 14 productos concentran múltiples brechas; el más afectado tiene **8 brechas** (`1afd93a1…`). Los 23 restantes tienen 1 brecha cada uno.

**Hallazgo clave:** muchos movimientos anómalos ya llevan motivos tipo
`[Ajuste de inventario de +X und previo a la venta #N]`. Son **intentos previos de ajuste** que no cerraron bien la secuencia (su `stock_anterior`/`stock_nuevo` no empalma con el movimiento vecino). La RPC de reconciliación **revalida cada propuesta contra el estado actual** (`PROPUESTA_RECONCILIACION_DESACTUALIZADA`), así que estas filas se tratan como cualquier otra brecha: se mide el delta real hoy, no el motivo histórico.

---

## 4. Artefactos de evidencia generados (read-only)

| Archivo | Contenido |
|---|---|
| `tmp/reconciliacion-66/evidencia-66-saltos.json` | 66 filas con evidencia completa: producto, código, movimiento ancla y anterior, `stock_anterior_esperado`, `stock_actual_movimiento`, delta, tipo, motivo anómalo y anterior, timestamps y flag `relacionado_devolucion`. |
| `tmp/reconciliacion-66/evidencia-66-saltos.csv` | Mismo contenido en CSV para revisión humana (BOM, separador `\|`). |
| `tmp/reconciliacion-66/p_propuestas.json` | **Arreglo JSONB puro** listo para pasar a `reconciliar_kardex(…, p_propuestas, …)`. |
| `tmp/reconciliacion-66/propuestas-66.jsonb.json` | Versión envuelta con `generated_at` y alcance, para revisión. |

Cada propuesta contiene exactamente los campos que consume `jsonb_to_recordset` dentro de `reconciliar_kardex`:

```jsonc
{
  "clase": "continuity_gap",
  "producto_id": "01b5c155-…",
  "movimiento_id": "9947a0c9-…",            // movimiento ancla (anómalo)
  "movimiento_numero": 1891,
  "movimiento_anterior_id": "4cc092eb-…",   // movimiento previo en la secuencia
  "stock_anterior_esperado": "854.0000",    // stock_nuevo del previo
  "stock_actual_movimiento": "636.0000",    // stock_anterior del ancla
  "delta": "-218.0000",                     // stock_actual_movimiento - stock_anterior_esperado
  "stock_actual_catalogo": "581.0000",      // solo evidencia (no se usa en continuity_gap)
  "reason": "continuity_gap entre 1891 y anterior …"
}
```

**Regla de signo (importante):**
- `delta > 0` → el correctivo será un **ingreso** de `|delta|` que empalma `prev → stock_anterior`.
- `delta < 0` → el correctivo será un **egreso** de `|delta|`.

---

## 5. Semántica del correctivo (lo que hará `reconciliar_kardex`)

Para cada propuesta `continuity_gap`, la RPC **inserta un movimiento compensatorio** que cierra la secuencia:

- `stock_anterior = stock_nuevo del movimiento previo` (empalma hacia atrás).
- `stock_nuevo = stock_anterior del movimiento ancla` (empalma hacia adelante).
- `creado_en = creado_en(del ancla) − 1 microsegundo` (queda exactamente antes del ancla).
- `origen_tipo = 'reconciliacion_kardex'`, `origen_id = movimiento ancla`, `idempotency_key = batch_key`.
- Registra la fila en `kardex_reconciliaciones` con `batch_key`, `ancla_key`, snapshot y evidencia.

**No reescribe, no borra y no muta ningún movimiento original ni `productos.stock_actual`.**

Verificación de colisión de timestamps: **0 anclas** comparten `creado_en` con su movimiento anterior, así que la inserción a `−1µs` no genera empates.

---

## 6. Estrategia de `batch_key`

- **Un UUID fijo por lote** (se genera una vez y se guarda en el runner; nunca se reutiliza).
- El `batch_key` es la **clave de idempotencia** del lote: repetir la misma llamada con el mismo `batch_key` devuelve el resultado original sin duplicar movimientos (`reservar_operacion_inventario` + `UNIQUE(batch_key, ancla_key)`).
- Recomendación: **dividir en 2–4 lotes** en lugar de 1 gigante, porque la RPC es **atómica por lote**: si una sola propuesta está desactualizada, todo el lote revierte. Lotes más pequeños = menor blast radius y rollback más granular.

Propuesta de partición (a validar en la revisión humana):

1. **Lote A — alta confianza por evidencia de documento:** brechas cuyo motivo ancla referencia un número de venta/devolución/reversión verificable contra `cotizaciones`/`notas_despacho` (incluye las 9 relacionadas con devolución).
2. **Lote B — ajustes/compras pequeñas:** las 9 de `ajuste_inventario` + `compra_proveedor` (magnitudes ≤ 22).
3. **Lote C — ventas restantes de gran magnitud** (los 8.640, 2.400, 600, etc.), cada una con revisión individual obligatoria del documento de origen.

Cada lote tendrá su propio `batch_key` y su propio `rollback_key`.

---

## 7. Estrategia de snapshot

Tres capas, todas previas a aplicar:

1. **Backup completo de datos** (`pg_dump` custom, timeout 30 min) + `pg_restore --list` + SHA-256. Archivo con nombre `kardex-principal-pre-reconciliacion-66-<stamp>.dump`.
2. **Baseline de auditoría read-only** (`scripts/audit-kardex-main-readonly.mjs`) guardado antes del apply: 66 brechas esperadas, stock total, conteos por tabla.
3. **Snapshot por fila (automático):** `reconciliar_kardex` ya persiste en `kardex_reconciliaciones` el `stock_catalogo_snapshot` y `producto_actualizado_en_snapshot` de cada producto al aplicar. Este es el ancla que valida el rollback.

---

## 8. Estrategia de rollback y guardas

Rollback mediante `revertir_reconciliacion_kardex(p_cuenta_id, p_batch_key, p_rollback_key, …)`.

**Guardas obligatorias (implementadas en la RPC, verificadas antes de confiar en ellas):**

1. El batch existe y **no está parcialmente revertido**.
2. El producto **no cambió** desde el snapshot (`stock_actual` y `actualizado_en` idénticos).
3. **No hay movimientos posteriores** al batch para ese producto, salvo los correctivos del propio batch.
4. El rollback **NO modifica `productos.stock_actual`** (la reconciliación corrige la secuencia histórica, no el saldo operativo vigente).
5. `rollback_key` repetida → devuelve el resultado original (idempotente).

El rollback **inserta movimientos inversos** (marca `reconciliacion_rollback`) y marca el batch `revertido`. **Nunca elimina** la propuesta, el movimiento original ni la evidencia.

**Regla de aprobación:** no se aplica ningún lote sin antes haber **ensayado el rollback en un entorno desechable** con el mismo contrato de esquema.

---

## 9. Gates de aprobación (pre-aplicación)

1. ✅ Backup fresco completo verificado (checksum + `pg_restore --list`).
2. ✅ Baseline read-only antes del apply (66 brechas, stock, conteos).
3. ✅ Revisión humana de las 66 propuestas (CSV/JSON) y **enriquecimiento del campo `reason`** con la causa real (n.º de venta/devolución/reversión), no solo "continuity_gap entre X y Y".
4. ✅ Dry-run en entorno desechable/disposable con el mismo esquema: aplicar → re-auditar (0 brechas) → **rollback ensayado** → re-auditar (vuelve a 66).
5. ✅ Operador autorizado: solo rol `administracion` o `desarrollador` del mismo tenant.
6. ✅ Ejecución exclusivamente por `service_role` (las RPC están revocadas para `anon`/`authenticated`).

---

## 10. Fases de ejecución propuestas (cuando se apruebe)

1. **Congelar** el tenant de negocio o elegir ventana sin actividad.
2. Backup + baseline (Gates 1–2).
3. Enriquecer `reason` y particionar lotes (Gate 3).
4. Dry-run + rollback ensayado en desechable (Gate 4).
5. Aplicar **Lote A** → re-auditar → validar stock sin cambio → registrar.
6. Repetir para **Lotes B y C**.
7. Postflight final: re-auditar (**objetivo: 0 brechas**), verificar `kardex_reconciliaciones`, comparar stock operativo (debe ser idéntico al pre-apply), documentar.

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Propuesta desactualizada (alguien movió stock entre la generación y el apply) | La RPC aborta atómicamente con `PROPUESTA_RECONCILIACION_DESACTUALIZADA`; se regenera el lote y se reintenta. |
| Un mal correctivo encadena brechas nuevas | El correctivo empalma ambos extremos (prev y ancla) por construcción; postflight re-audita a 0. |
| Reversión de un lote con actividad posterior | Guarda 3: `ROLLBACK_BLOQUEADO_MOVIMIENTOS_POSTERIORES`. |
| Confundir reconciliación con cambio de stock real | El correctivo **no toca `productos.stock_actual`**; el saldo operativo se compara antes/después y debe ser idéntico. |
| Double-count con el batch previo (`d350bea3`) | `UNIQUE(batch_key, ancla_key)` y revalidación por ancla evitan duplicados; las 66 propuestas se generaron contra el estado posterior a ese batch. |
| Colisión de timestamps en el correctivo | Verificado: 0 anclas comparten `creado_en` con su previo. |

---

## 12. Qué NO hacer

- ❌ No reescribir ni borrar movimientos originales (solo insertar compensatorios).
- ❌ No mutar `productos.stock_actual` durante la reconciliación.
- ❌ No mezclar con el backfill de `origen_tipo`/`origen_id`/`idempotency_key` de los 3.691 movimientos históricos (es otra fase).
- ❌ No aplicar los 66 de una sola vez sin dry-run y rollback ensayado.
- ❌ No ejecutar sin backup fresco y operador autorizado.

---

## 13. Criterios de done

- Re-audit post-apply: **0 continuity gaps**, 0 math errors.
- `kardex_reconciliaciones`: N filas `aplicado` con `batch_key`, `ancla_key`, delta, snapshot y `aplicado_por`.
- Stock operativo del catálogo **idéntico** antes/después.
- Rollback ensayado y evidenciado (aplicar → revertir → re-aplicar) en desechable.
- Evidencia de respaldo (dump + baseline + postflight) archivada.
- BITACORA actualizada con batch_key(s), rollback_key(s) y resultado.

---

**Artefactos de este plan (ya en disco, read-only):**

- `tmp/reconciliacion-66/evidencia-66-saltos.json`
- `tmp/reconciliacion-66/evidencia-66-saltos.csv`
- `tmp/reconciliacion-66/p_propuestas.json`
- `tmp/reconciliacion-66/propuestas-66.jsonb.json`

**Nada de esto fue ejecutado contra la base.** El siguiente paso natural es la revisión humana del CSV y el enriquecimiento del campo `reason` antes de armar los lotes.
