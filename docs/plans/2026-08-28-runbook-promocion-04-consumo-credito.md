# Runbook: Promoción al Principal — `consumo_credito` para Saldo a Favor + COD (release 04)

> **Estado:** LISTO PARA EJECUTAR cuando el dueño autorice. Nada de este documento se ha aplicado al principal.
> **Fecha:** 2026-08-28 · **Origen:** `docs/plans/2026-08-28-plan-fixes-comisiones-saldo-favor-cod.md` (Piezas 1–8)
> **Proyecto principal:** `oyfyuszgjwcepjpngclv` · Worker: `listo-pos-cotizaciones` · Frontend: `listo-pos-cotizaciones.vercel.app`

---

## 1. Objetivo y alcance

Desplegar en producción el fix que elimina el **doble descuento del Saldo a Favor en ventas COD/Crédito**:

- **DB:** nuevo tipo `consumo_credito` en `cuentas_por_cobrar` + triggers de recálculo que restan solo `saldo_a_favor` (no `saldo_pendiente`).
- **Worker:** registrar el consumo como `consumo_credito` (idempotente), reversión auditada con guard `CONSUMO_CONCILIADO`, edición profunda compatible.
- **Frontend:** historial del cliente muestra "Consumo saldo a favor" con signo/color propios.
- **Datos:** saneamiento **individual** del caso Rosa Sánchez (#2697) — el único legacy con doble descuento confirmado en producción.

**Fuera de alcance:** filtro de comisiones por fecha efectiva (decisión pendiente de negocio, ver §10), promoción del split de comisiones (release 03, runbook propio).

---

## 2. Estado actual verificado (preflight read-only ejecutado 2026-08-28)

| Ítem | Resultado |
|---|---|
| CHECK `cuentas_por_cobrar_tipo_check` | `cargo, abono, credito, devolucion_credito` — **sin** `consumo_credito` |
| `trg_recalcular_saldo_pendiente` | EXISTE (versión 179), sin `consumo_credito` |
| `trg_recalcular_saldo_pendiente_delete` | EXISTE (versión 179), sin `consumo_credito` |
| Cuerpos vivos capturados | `tmp/db-dump-principal/trg_recalcular_saldo_pendiente__vivo.sql` (1479 chars) y `_delete__vivo.sql` (1330 chars) |
| Tipos en datos | `abono=349, cargo=148, credito=41, devolucion_credito=5` — 0 filas `consumo_credito` |
| Casos legacy "Saldo a favor" | **14** totales; **1** con cargo COD en el mismo despacho |
| Caso Rosa #2697 | `abono_id=9a719bb0-8470-434f-9422-9f1ede324833` · `cliente_id=80a71d64-7975-4649-86e4-0dda45636da6` · `despacho_id=3a0a0bfb-2281-4c6c-aca3-2670cd6f01af` · abono $4.14 · cargo COD $60.43 · **saldo_pendiente=$56.29** (doble descuento vivo) · favor=$0.00 |
| Comisiones `creadoen NULL` / sin despacho | 0 / 0 (filtro no afectará visibilidad) |

**Validación en staging (ya ejecutada, todo verde):**
- Migración 258 aplicada en `spupqgkdsgohxxfoxydl` + smoke transaccional C1–C4 PASS.
- E2E general staging **111/111** ×2 corridas. Vitest staging **235/235**. Build staging PASS.
- Tests principales **283/283 PASS** (incluye fix del mock `despachosPartialAtomic`). Build principal PASS.

---

## 3. Criterios GO / NO-GO (antes de cada fase)

| Fase | GO exige | NO-GO si |
|---|---|---|
| Backup | `npm run backup:kardex:main` termina OK y el dump existe con tamaño > 2 MB | Falla el script o el dump es 0 bytes |
| SQL 04 | Preflight §2 vigente (CHECK 4 tipos, triggers 179) y backup verificado | Ya existe `consumo_credito` en el CHECK o en datos |
| Postflight | CHECK ampliado + ambos triggers con `consumo_credito` + smoke transaccional OK | Cualquier check falla → **ROLLBACK inmediato** |
| Saneamiento Rosa | Postflight OK + dry-run del script sin errores | El dry-run muestra montos distintos a los esperados |
| Worker | SQL aplicada y postflight OK | SQL no aplicada (el Worker nuevo insertaría `consumo_credito` y fallaría) |
| Frontend | Worker desplegado y verificado | Worker no responde |

---

## 4. Fase 0 — Backup del principal

```bash
cd "C:\Users\luigg\Desktop\CONSTRAUCERO COTIZACIONES\listo-pos-cotizaciones"
npm run backup:kardex:main
```

**Verificar:**
```bash
ls -la tmp/backups/*principal*.dump | tail -3
sha256sum $(ls -t tmp/backups/*principal*.dump | head -1)
```
- El dump debe pesar > 2 MB y el SHA debe quedar registrado en la bitácora (§11).
- **Sin backup verificado NO se continúa.**

---

## 5. Fase 1 — Reconstruir el rollback con cuerpos vivos del principal

El `04_consumo_credito_cxc_rollback.sql` actual es un template con guard. Antes de aplicar la 04, regenerar el rollback final insertando los cuerpos capturados en §2:

```bash
node -e "
const fs=require('fs');
const t1=fs.readFileSync('tmp/db-dump-principal/trg_recalcular_saldo_pendiente__vivo.sql','utf8');
const t2=fs.readFileSync('tmp/db-dump-principal/trg_recalcular_saldo_pendiente_delete__vivo.sql','utf8');
const rollback = [
'-- ROLLBACK FINAL 04 (cuerpos vivos del principal, capturados ' + new Date().toISOString() + ')',
'DO \$\$ BEGIN',
'  IF EXISTS (SELECT 1 FROM public.cuentas_por_cobrar WHERE tipo=\'consumo_credito\') THEN',
'    RAISE EXCEPTION \'ROLLBACK_BLOQUEADO: existen filas consumo_credito; preservar el CHECK ampliado o reconvertir datos con aprobación\';',
'  END IF;',
'END \$\$;',
'ALTER TABLE public.cuentas_por_cobrar DROP CONSTRAINT IF EXISTS cuentas_por_cobrar_tipo_check;',
'ALTER TABLE public.cuentas_por_cobrar ADD CONSTRAINT cuentas_por_cobrar_tipo_check CHECK (tipo IN (\'cargo\',\'abono\',\'credito\',\'devolucion_credito\'));',
t1, t2,
'NOTIFY pgrst, \'reload schema\';'
].join('\n');
fs.writeFileSync('supabase/release/principal/04_consumo_credito_cxc_rollback.sql', rollback);
console.log('rollback regenerado con cuerpos vivos');
"
```

**Verificar:** el archivo contiene `consumo_credito` solo en el guard y los cuerpos de los triggers sin esa rama.

---

## 6. Fase 2 — Aplicar SQL 04 en transacción

**Script de aplicación (crear `tmp/deploy-04-apply.mjs`):**

```javascript
// Aplica 04 al PRINCIPAL con guards: preflight -> transaccion -> postflight -> smoke.
import fs from 'node:fs'
import pg from 'pg'
function parse(f){const o={};fs.readFileSync(f,'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim()});return o}
const e=parse('.env')
const c=new pg.Client({host:'db.oyfyuszgjwcepjpngclv.supabase.co',port:5432,user:'postgres',password:e.DB_PASSWORD,database:'postgres',ssl:{rejectUnauthorized:false}})
await c.connect()
const sql=fs.readFileSync('supabase/release/principal/04_consumo_credito_cxc.sql','utf8')
// PREFLIGHT
const {rows:ck}=await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.cuentas_por_cobrar'::regclass AND conname='cuentas_por_cobrar_tipo_check'`)
if(ck[0]?.d?.includes('consumo_credito')){console.error('GUARD: ya aplicada');process.exit(1)}
const {rows:dup}=await c.query(`SELECT count(*)::int n FROM public.cuentas_por_cobrar WHERE tipo='consumo_credito'`)
if(dup[0].n>0){console.error('GUARD: datos consumo_credito');process.exit(1)}
console.log('PREFLIGHT OK')
// APLICAR
try{await c.query('BEGIN');await c.query(sql);await c.query('COMMIT');console.log('SQL 04 APLICADA')}
catch(err){await c.query('ROLLBACK');console.error('FALLO:',err.message);process.exit(1)}
// POSTFLIGHT
const {rows:ck2}=await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.cuentas_por_cobrar'::regclass AND conname='cuentas_por_cobrar_tipo_check'`)
console.log('CHECK ampliado:',ck2[0]?.d?.includes('consumo_credito'))
for(const fn of ['trg_recalcular_saldo_pendiente','trg_recalcular_saldo_pendiente_delete']){
  const {rows}=await c.query(`SELECT pg_get_functiondef(p.oid) d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1`,[fn])
  console.log(fn+':', /consumo_credito/.test(rows[0].d)?'OK':'FALLO')
}
await c.end()
```

```bash
node tmp/deploy-04-apply.mjs
```

**Verificar:** `SQL 04 APLICADA` + `CHECK ampliado: true` + ambos triggers `OK`.

---

## 7. Fase 3 — Postflight + smoke transaccional

Reutilizar el patrón del smoke de staging (transacción + ROLLBACK, sin residuos) contra el principal:

```javascript
// tmp/smoke-04-principal.mjs — cliente+operador existentes, INSERT credito/cargo/consumo,
// verifica deuda=base+60.43 y favor=base+95.86, DELETE repone, ROLLBACK.
```

**Verificación adicional (read-only):**
```bash
curl -s "https://oyfyuszgjwcepjpngclv.supabase.co/rest/v1/cuentas_por_cobrar?select=tipo&limit=1" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" -o /dev/null -w "%{http_code}\n"
```
- Esperado `200` (PostgREST recarga schema tras `NOTIFY pgrst`).

---

## 8. Fase 4 — Saneamiento individual Rosa Sánchez (#2697)

**Script `scripts/fix-despacho-2697-cxc.mjs` (dry-run por defecto; `--apply` para ejecutar):**

```javascript
// 1. Verificar el abono legacy: id=9a719bb0-8470-434f-9422-9f1ede324833, tipo='abono',
//    forma_pago_abono='Saldo a favor', monto=4.14, despacho_id=3a0a0bfb-2281-4c6c-aca3-2670cd6f01af.
//    Si no coincide -> ABORTAR (no asumir).
// 2. (dry-run) Mostrar el plan: DELETE abono -> INSERT consumo_credito (mismos campos,
//    saldo_usd=0.00, descripcion 'Pago con Saldo a Favor (CREDITO)').
// 3. (--apply) DELETE + re-INSERT en transaccion (dispara ambos triggers -> recalcula).
// 4. Verificar: saldo_pendiente=60.43 exacto, saldo_a_favor=0.00.
// 5. Auditoria: registrar en BITACORA el saneamiento con IDs.
```

```bash
node scripts/fix-despacho-2697-cxc.mjs          # dry-run
node scripts/fix-despacho-2697-cxc.mjs --apply  # ejecutar
```

**Resultado esperado:** `saldo_pendiente = 60.43` y `saldo_a_favor = 0.00`. La cajera podrá conciliar el COD de $60.43 sin el error `supera el saldo pendiente`.

**NO ejecutar saneamiento masivo** — es el único caso confirmado.

---

## 9. Fase 5 y 6 — Deploy Worker y Frontend

### Worker (orden: después de SQL, nunca antes)

```bash
export CLOUDFLARE_API_TOKEN=$(grep '^CF_API_TOKEN=' .env | cut -d= -f2)
npx wrangler deploy
```

**Verificar:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://listo-pos-cotizaciones.luigistorelogistics.workers.dev/api/ping   # 200
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS https://listo-pos-cotizaciones.luigistorelogistics.workers.dev/api/auth/switch-operator -H "Origin: https://listo-pos-cotizaciones.vercel.app" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-request-id"  # 200 con Access-Control-Allow-Headers
```

### Frontend (Vercel)

```bash
npx vercel --prod --yes
```

**Verificar:** el alias sirve el bundle nuevo:
```bash
curl -s https://listo-pos-cotizaciones.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1
```

---

## 10. Fase 7 — Verificación end-to-end en producción

1. **Conciliar COD Rosa #2697:** modal "Conciliar COD" → abono $60.43 → HTTP 200, despacho "cobrado", deuda $0.00.
2. **Historial del cliente:** el movimiento aparece como "Consumo saldo a favor" (púrpura, signo −, "Favor restante"), con botón de reversión solo para admin/jefe.
3. **Reversión protegida:** intentar revertir el consumo tras conciliar → error `CONSUMO_CONCILIADO`.
4. **Venta nueva con saldo a favor + COD:** crear despacho de prueba con pago mixto → cargo COD exacto (sin doble descuento), `consumo_credito` registrado.
5. **Filtro de comisiones (Módulo 1, decisión pendiente):** NO cambiar el filtro en esta promoción. El principal usa `despacho.creado_en`; staging usa fecha efectiva. Decidir con negocio antes de tocar (ver plan §7). Documentar en bitácora.
6. **Monitoreo:** revisar logs del Worker 24h (errores `consumo_credito` / `CXC`).

---

## 11. Rollback por fase

| Fase | Rollback |
|---|---|
| SQL 04 | Ejecutar `supabase/release/principal/04_consumo_credito_cxc_rollback.sql` (regenerado en Fase 1 con cuerpos vivos). **Guard:** si existen filas `consumo_credito`, primero reconvertirlas a `abono`+'Saldo a favor' con aprobación o preservar el CHECK. |
| Saneamiento Rosa | Script inverso: DELETE del `consumo_credito` + re-INSERT del `abono` original (campos capturados en §8) + recálculo. |
| Worker | Redeploy de la versión anterior (`npx wrangler rollback` o redeploy del commit previo). |
| Frontend | Redeploy del bundle anterior (`npx vercel --prod` con el commit previo o rollback en el dashboard). |

**Invariante:** el rollback SQL **solo** si el backup de la Fase 0 está disponible y verificado.

---

## 12. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| INSERT `consumo_credito` rechazado si Worker se despliega antes que SQL | Baja | Alto | Orden estricto SQL → Worker; criterio GO de Fase 5 |
| Trigger viejo repondría el favor consumido | Baja | Alto | Triggers en la misma migración; postflight verifica ambos |
| Saneamiento Rosa con montos distintos a lo esperado | Baja | Medio | Script aborta si el abono no coincide exactamente; dry-run |
| Reversión de un consumo ya conciliado | Baja | Medio | Guard `CONSUMO_CONCILIADO` en el Worker |
| Drift entre staging y principal en funciones no capturadas | Media | Medio | Preflight §2 ya capturó los cuerpos vivos; rollback regenerado desde ellos |
| Filtro de comisiones: cambiar sin decisión de negocio | Media | Medio | **Fuera de alcance** de esta promoción (documentado) |

---

## 13. Checklist de ejecución (llenar al ejecutar)

- [ ] **F0** Backup `npm run backup:kardex:main` → dump > 2MB, SHA registrado
- [ ] **F1** Rollback regenerado con cuerpos vivos (`tmp/db-dump-principal/*__vivo.sql`)
- [ ] **F2** `node tmp/deploy-04-apply.mjs` → `SQL 04 APLICADA` + postflight OK
- [ ] **F3** Smoke transaccional principal PASS (ROLLBACK, sin residuos)
- [ ] **F4** `node scripts/fix-despacho-2697-cxc.mjs` dry-run OK → `--apply` → saldo 60.43 / favor 0.00
- [ ] **F5** `npx wrangler deploy` + ping 200 + preflight CORS OK
- [ ] **F6** `npx vercel --prod --yes` + bundle nuevo servido
- [ ] **F7** Conciliar COD Rosa $60.43 → 200 + historial correcto + reversión bloqueada
- [ ] Bitácora §14 completada

---

## 14. Bitácora de ejecución

| Fecha/Hora | Fase | Resultado | SHA/ID | Ejecutor |
|---|---|---|---|---|
|  | F0 |  |  |  |
|  | F1 |  |  |  |
|  | F2 |  |  |  |
|  | F3 |  |  |  |
|  | F4 |  |  |  |
|  | F5 |  |  |  |
|  | F6 |  |  |  |
|  | F7 |  |  |  |