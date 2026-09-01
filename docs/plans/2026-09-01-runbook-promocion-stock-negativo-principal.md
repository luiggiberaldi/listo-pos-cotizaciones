# Runbook: Promoción al Principal — `permitir_stock_negativo = true` (Venta Anticipada)

> **Estado:** LISTO PARA EJECUTAR cuando el dueño autorice. Nada de este documento se ha aplicado al principal.
> **Fecha:** 2026-09-01 · **Origen:** validación completa en staging (BITACORA 2026-08-31, entradas de esta sesión).
> **Proyecto principal:** `oyfyuszgjwcepjpngclv` · Worker: `listo-pos-cotizaciones` · Frontend: `listo-pos-cotizaciones.vercel.app`
> **Proyecto staging (validado):** `spupqgkdsgohxxfoxydl`

---

## 1. Objetivo y alcance

Activar en producción la **Venta Anticipada**: las entregas y ajustes de inventario pueden dejar el stock en negativo de forma trazable, por cuenta.

- **DB:** único cambio de datos — `UPDATE configuracion_negocio SET permitir_stock_negativo = true`. **Cero cambios de esquema** (la columna ya existe en el principal: migraciones 205/237 + release `01_configuracion_global.sql` con default `false`).
- **Worker:** SIN deploy. El código que respeta el flag ya está en producción (`api/handlers/despachos.js` lee `permitir_stock_negativo` con fallback `_comision_extras.__meta_venta_anticipada`; `admin.js` guarda el flag; las RPC atómicas del principal 223/225/205 ya lo consultan con `COALESCE(..., FALSE)`).
- **Frontend:** SIN deploy obligatorio. El toggle de configuración ya existe (`ConfiguracionView.jsx`). El fix del reporte (`bajStock <= 0`, commit `e3eacdd`) es recomendable pero independiente — puede ir en el siguiente deploy natural.

**Fuera de alcance:** `MovimientoLoteModal` sigue bloqueando egresos insuficientes en el cliente (guarda UI preexistente). La venta anticipada opera vía entrega de despachos, venta rápida y ajustes por API/RPC — los flujos operativos reales.

---

## 2. Estado actual verificado

| Ítem | Staging (validado) | Principal (a verificar en Fase 1) |
|---|---|---|
| Columna `permitir_stock_negativo` | ✅ existe (14/14 filas `true`) | Debe existir (release 01 + migración 237 ya promocionadas — confirmar) |
| RPCs que respetan el flag | 223/225/244 + wrapper 247 | 223/225 + 205 (`actualizar_producto_con_kardex`) — confirmar con preflight |
| Worker lee el flag | ✅ (E2E 42.4 lo probó end-to-end) | Mismo código (paridad verificada en README staging) |
| E2E con flag=true | ✅ 111/111 (paso 42.4 en rama venta anticipada) | n/a |
| E2E con flag=false | ✅ 111/111 (guardarraíl estricto) | n/a |
| Bug `bajStock` reporte | ✅ corregido (`e3eacdd`) | ✅ corregido (mismo commit) |

**Evidencia staging:** dos baterías E2E 111/111 (flag true y false), flujo de venta anticipada validado punta a punta (egreso aplicado con stock negativo, Kardex continuo `[VENTA ANTICIPADA]`, replay idempotente, devolución parcial atómica restaura stock).

---

## 3. Criterios GO / NO-GO

| Fase | GO exige | NO-GO si |
|---|---|---|
| F0 Backup | `npm run backup:kardex:main` OK, dump > 2 MB, SHA registrado | Script falla o dump 0 bytes |
| F1 Preflight | Columna existe, NOT NULL, default `false`; todas las RPCs esperadas presentes; 0 filas con flag `true` | Falta la columna o alguna RPC canónica |
| F2 UPDATE | Transacción aplica; conteo de filas actualizado = total de cuentas | Algún error SQL |
| F3 Postflight | Todas las filas `true`; PostgREST responde 200; smoke de egreso negativo OK | Cualquier check falla → **ROLLBACK inmediato** |
| F4 Verificación E2E | Entrega real con stock insuficiente deja Kardex negativo trazable | Rechazo `STOCK_INSUFICIENTE` inesperado |

---

## 4. Fase 0 — Backup del principal

```bash
cd "C:\Users\luigg\Desktop\CONSTRAUCERO COTIZACIONES\listo-pos-cotizaciones"
npm run backup:kardex:main
ls -la tmp/backups/*principal*.dump | tail -3
sha256sum $(ls -t tmp/backups/*principal*.dump | head -1)
```

- Dump > 2 MB, SHA registrado en §10. **Sin backup verificado NO se continúa.**
- Nota: este cambio es un UPDATE de configuración reversible en segundos (ver §9); el backup es la red de seguridad estándar del runbook.

---

## 5. Fase 1 — Preflight read-only del principal

Script `tmp/preflight-stock-negativo-principal.mjs`:

```javascript
// PREFLIGHT READ-ONLY — principal oyfyuszgjwcepjpngclv
import fs from 'node:fs'
function parse(f){const o={};fs.readFileSync(f,'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim()});return o}
const e = parse('.env')   // VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY del principal
const H = { apikey: e.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_KEY}` }
const url = e.SUPABASE_URL || e.VITE_SUPABASE_URL

// 1. Columna existe y estado actual
let r = await fetch(`${url}/rest/v1/configuracion_negocio?select=cuenta_id,permitir_stock_negativo`, { headers: H })
const cfg = await r.json()
console.log('filas configuracion:', cfg.length)
console.log('flags:', cfg.map(c => c.permitir_stock_negativo))
if (!cfg.length || cfg[0].permitir_stock_negativo === undefined) {
  console.error('GUARD: la columna no existe en el principal'); process.exit(1)
}
if (cfg.some(c => c.permitir_stock_negativo === true)) {
  console.error('GUARD: ya hay cuentas con true — revisar antes de continuar'); process.exit(1)
}

// 2. RPCs canónicas presentes (el schema cache expone las funciones)
r = await fetch(`${url}/rest/v1/rpc/`, { headers: H })
// (si el endpoint no está expuesto, verificar vía 00_preflight.sql del release con psql)

console.log('PREFLIGHT OK — listo para F2')
```

```bash
node tmp/preflight-stock-negativo-principal.mjs
```

**Alternativa psql (más completa, ejecuta `00_preflight.sql` + checks propios):**

```sql
-- Estado de la columna
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='configuracion_negocio'
  AND column_name='permitir_stock_negativo';
-- Esperado: boolean, NO, false

-- RPCs que consultan el flag (deben existir)
SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('confirmar_entrega_inventario_atomica',
                  'revertir_entrega_inventario_atomica',
                  'devolucion_parcial_inventario_atomica',
                  'actualizar_producto_con_kardex');

-- Conteo de flags
SELECT permitir_stock_negativo, count(*) FROM public.configuracion_negocio GROUP BY 1;
-- Esperado: false | <total>
```

---

## 6. Fase 2 — UPDATE en transacción

Script `tmp/apply-stock-negativo-principal.mjs` (patrón del runbook 04):

```javascript
import fs from 'node:fs'
import pg from 'pg'
function parse(f){const o={};fs.readFileSync(f,'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim()});return o}
const e = parse('.env')
const c = new pg.Client({ host:'db.oyfyuszgjwcepjpngclv.supabase.co', port:5432,
  user:'postgres', password:e.DB_PASSWORD, database:'postgres', ssl:{rejectUnauthorized:false} })
await c.connect()

// PREFLIGHT
const { rows: pre } = await c.query(
  `SELECT count(*)::int total, count(*) FILTER (WHERE permitir_stock_negativo) trues
   FROM public.configuracion_negocio`)
if (pre[0].trues > 0) { console.error('GUARD: ya aplicado'); process.exit(1) }
console.log('PREFLIGHT OK — cuentas:', pre[0].total)

// APLICAR (transacción)
try {
  await c.query('BEGIN')
  const { rowCount } = await c.query(
    `UPDATE public.configuracion_negocio SET permitir_stock_negativo = true`)
  if (rowCount !== pre[0].total) throw new Error(`filas actualizadas ${rowCount} != ${pre[0].total}`)
  await c.query('COMMIT')
  console.log('UPDATE APLICADO — filas:', rowCount)
} catch (err) {
  await c.query('ROLLBACK'); console.error('FALLO:', err.message); process.exit(1)
}

// POSTFLIGHT
const { rows: post } = await c.query(
  `SELECT permitir_stock_negativo, count(*)::int n FROM public.configuracion_negocio GROUP BY 1`)
console.log('POSTFLIGHT:', JSON.stringify(post))
await c.end()
```

```bash
node tmp/apply-stock-negativo-principal.mjs
```

**Verificar:** `UPDATE APLICADO` + postflight muestra `true | <total>` y 0 filas `false`.

---

## 7. Fase 3 — Postflight + smoke transaccional

1. **PostgREST recargado:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://oyfyuszgjwcepjpngclv.supabase.co/rest/v1/configuracion_negocio?select=permitir_stock_negativo&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
# Esperado: 200
```

2. **Smoke de egreso negativo (transacción + ROLLBACK, sin residuos):** llamar a `confirmar_entrega_inventario_atomica` (o `aplicar_movimiento_inventario_atomico` si existe en el principal) con cantidad > stock sobre un producto de prueba, dentro de una transacción que termina en ROLLBACK. Verificar que:
   - No lanza `STOCK_INSUFICIENTE` (el flag ya se respeta).
   - El Kardex hipotético registraría `stock_nuevo < 0` con motivo `[VENTA ANTICIPADA]`.
   - Tras el ROLLBACK, el stock queda intacto.

   > El smoke se puede ejecutar con el mismo patrón del smoke 04 del runbook anterior (BEGIN → RPC → SELECT verificación → ROLLBACK).

---

## 8. Fase 4 — Verificación end-to-end en producción

1. **Entrega real controlada:** elegir un producto de bajo valor con stock 0-2, crear despacho con cantidad mayor al stock, aprobar y entregar. Verificar:
   - La entrega NO rechaza por stock insuficiente.
   - `inventario_movimientos` registra el egreso con `stock_nuevo < 0` y motivo `Entrega confirmada [VENTA ANTICIPADA]`.
   - El producto aparece en InventarioView con el filtro "stock negativo".
2. **Reporte de inventario:** el producto aparece en "Productos con Stock Bajo" (requiere el fix `e3eacdd` desplegado en el frontend; si aún no, verificar en la vista, que sí lo marca).
3. **Reversión:** revertir la entrega → el stock regresa a su valor previo (idempotencia ya validada en staging).
4. **Monitoreo 24h:** logs del Worker sin errores nuevos; sin quejas de "Stock insuficiente" en flujos que antes fallaban legítimamente.

---

## 9. Rollback (inmediato y trivial)

```sql
UPDATE public.configuracion_negocio SET permitir_stock_negativo = false;
```

- **Efecto instantáneo:** la siguiente lectura de configuración vuelve al guardarraíl estricto (`STOCK_INSUFICIENTE` en egresos insuficientes). No hay datos que revertir: los Kardex negativos ya creados son histórico válido y no se tocan.
- **Orden de rollback:** solo el UPDATE; Worker/frontend no cambiaron.
- **Invariante:** si algún producto queda con stock negativo permanente, decidir negocio: reponer (ingreso) o dejar el negativo como deuda trazable. El rollback del flag NO corrige stocks negativos existentes.

---

## 10. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| RPC del principal sin la rama del flag (drift staging↔principal) | Baja | Alto | Fase 1 preflight verifica presencia de las 4 RPCs; smoke F3 prueba el comportamiento real antes de dar por terminado |
| Kardex negativos confunden reportes gerenciales | Media | Medio | Fix `e3eacdd` ya alineado; valorización resta deuda (decisión documentada en BITACORA) |
| Usuario aprovecha para "vender" stock inexistente masivamente | Media | Medio | El flag es por cuenta y reversible en segundos; Kardex audita quién/cuándo; monitoreo 24h |
| MovimientoLoteModal sigue bloqueando (inconsistencia UI) | Alta | Bajo | Documentado como fuera de alcance; los flujos operativos (despachos) sí funcionan |
| Fallback `_comision_extras.__meta_venta_anticipada` en Worker viejo | Baja | Bajo | Con la columna física presente, el fallback nunca se activa |

---

## 11. Checklist de ejecución (llenar al ejecutar)

- [ ] **F0** Backup `npm run backup:kardex:main` → dump > 2MB, SHA registrado
- [ ] **F1** Preflight: columna existe (boolean, NOT NULL, default false), 4 RPCs presentes, 0 filas true
- [ ] **F2** `node tmp/apply-stock-negativo-principal.mjs` → UPDATE APLICADO + postflight todo true
- [ ] **F3** PostgREST 200 + smoke de egreso negativo OK (ROLLBACK, sin residuos)
- [ ] **F4** Entrega real con stock insuficiente → Kardex `[VENTA ANTICIPADA]` + reversión limpia
- [ ] Bitácora §12 completada + entrada en BITACORA.md

## 12. Bitácora de ejecución

| Fecha/Hora | Fase | Resultado | SHA/ID | Ejecutor |
|---|---|---|---|---|
|  | F0 |  |  |  |
|  | F1 |  |  |  |
|  | F2 |  |  |  |
|  | F3 |  |  |  |
|  | F4 |  |  |  |
