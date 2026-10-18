# Plan de Implementación: Solución Definitiva para Conciliación Atómica de Cobro a Destino (COD Release 14)

> **Fecha:** 2026-10-18  
> **Estado:** Aprobado con condiciones (incorporadas correcciones de auditoría 1–4)  
> **Objetivo:** Erradicar desfasajes entre Cuentas por Cobrar (CxC) y Notas de Despacho garantizando transacciones 100% atómicas en PostgreSQL.

**Resumen de Arquitectura:**
1. **PostgreSQL / Supabase:** Transacción atómica única (`registrar_pago_externo_cobro_idempotente`) con tabla de deduplicación (`cod_conciliacion_idempotencia`) y cálculo de balance en vivo (`resumen_financiero_despacho`).
2. **Worker API:** Endpoints `/api/despachos/resumen-financiero` y `/api/despachos/conciliar-cod` (`api/handlers/cod.js`).
3. **Frontend React:** `ConciliarCodModal.jsx` refactorizado para consumir la API atómica, eliminando llamadas directas a `/api/cxc/abono` y `/api/despachos/editar-pago`.

**Tech Stack:** PostgreSQL 17 (PL/pgSQL), Cloudflare Workers (JavaScript ESM), React 19, Supabase REST RPC.

**Método de Apply SQL:** Manual vía SQL Editor de Supabase o `psql` con rol `service_role`. **NO usar** `supabase db push`, `supabase db reset` ni `supabase migration repair` debido a deriva histórica en migraciones.

---

## 1. Contexto, Causa Raíz y Justificación del Negocio

### 1.1 El Problema Operativo e Incidente Despacho #3991
Durante la operación diaria, al intentar conciliar un despacho entregado bajo la modalidad **Cobro a Destino (COD)**, la cajera se encontró con un error recurrente en pantalla:
```text
POST https://listo-pos-cotizaciones.vercel.app/api/cxc/abono 400 (Bad Request)
```
**Lo que sucedió:**
1. Para el despacho **#3991** (Cliente: Rosa Sánchez, monto: **$147.00 Zelle**), el sistema procesó el dinero en el módulo de Cuentas por Cobrar (CxC), llevando la deuda del cliente a **$0.00**.
2. Sin embargo, la nota de despacho **nunca se enteró del pago** y continuó apareciendo con el botón rojo de cobro pendiente.
3. La comisión de venta correspondiente ($5.78 para Niki Ramírez) quedó **retenida y congelada**.
4. Al intentar conciliar nuevamente para destrabar el despacho, el sistema rechazó la acción con el error `400 Bad Request` indicando que *"el abono ($147.00) supera el saldo pendiente del cliente ($0.00)"*.

> ✅ **ESTADO DEL DESPACHO #3991: CONCILIADO Y REGULARIZADO (2026-10-18)**  
> Este despacho ya fue atendido y resuelto de forma segura antes de iniciar este plan estructural:
> - **Nota de despacho:** Marcada formalmente con `cobro_destino_pagado: true` y método `Zelle $147.00`.
> - **Comisión:** Generada y liberada para Niki Ramírez por **$5.78** (ID `913ca904-1048-4877-bee3-6bce6d570dfc`).
> - **Auditoría:** Registrada bajo la acción `CONCILIAR_COD_REGULARIZACION`.
> - **Saldo del cliente:** Rosa Sánchez quedó con Saldo Pendiente: **$0.00** y Saldo a Favor: **$2.70** (intacto).  
> **El caso #3991 está 100% cerrado y cuadrado.** Este plan se aplica para que **ningún despacho futuro** vuelva a sufrir este desfasaje.

### 1.2 Causa Raíz Arquitectónica (Flujo vulnerable de 2 pasos)
El frontend (`ConciliarCodModal.jsx` legacy) realizaba la conciliación mediante **dos peticiones HTTP separadas y desincronizadas desde el navegador del usuario**:

```text
[Navegador] --- (1) POST /api/cxc/abono ---> [CxC en BD: Saldo baja a $0.00] (ÉXITO)
[Navegador] --- (2) POST /api/despachos/editar-pago ---> [Worker: Bloqueado por guardas 400] (FALLO)
```

Al no ser una operación transaccional:
- Si el Paso 2 fallaba (por guardas de seguridad del backend, micro-cortes de red, o validaciones de despacho), el Paso 1 **ya había modificado el dinero y no se revertía**.
- El sistema quedaba asimétrico: el dinero ingresó contablemente, pero el despacho seguía considerándose moroso.

### 1.3 Impacto en el Negocio si no se resuelve
- **Pérdida de tiempo y soporte recurrente:** Cada despacho con este problema requiere que un desarrollador o DBA ingrese a modificar registros SQL a mano.
- **Comisiones bloqueadas:** Los vendedores no reciben sus comisiones automáticas porque el despacho nunca transiciona a `cobro_destino_pagado: true`.
- **Riesgo de errores en cobranza:** El personal de caja o cobranza ve notas pendientes de cobro cuando el cliente ya pagó, generando roces con los clientes o intentos de doble facturación.
- **Falta de soporte robusto en Bolívares:** Los pagos en efectivo Bs carecían de snapshot inmutable de tasa de cambio, permitiendo desfases por redondeos o fluctuaciones de tasa.

### 1.4 Por qué se aplica esta solución (Release 14)
Este plan implementa la **solución definitiva (Release 14)** aprobada contable y técnicamente:
1. **Transacción Atómica Única ("Todo o Nada"):** Se traslada toda la lógica a un procedimiento almacenado en PostgreSQL (`registrar_pago_externo_cobro_idempotente`). El abono en CxC, el cambio de estado en el despacho, el cálculo de comisiones y la auditoría ocurren dentro de un solo bloque `BEGIN...COMMIT`. Si algo falla, se revierte todo al 100% sin dejar cabos sueltos.
2. **Protección Anti-Duplicados (Idempotencia):** Se añade una clave criptográfica única por operación. Si la cajera hace doble clic o la conexión titubea, el sistema no duplica cobros ni abonos.
3. **Lectura Directa del Balance Real:** El modal consulta el balance en vivo desde el libro mayor (`cuentas_por_cobrar`) antes de permitir cualquier cobro.
4. **Registro inmutable de tasas en Bs:** Fija monto en Bs, tasa y fuente al momento del pago para blindaje contable.

---

## 2. Estado actual (pre-ejecución)

| Componente | Estado |
|---|---|
| RPC `resumen_financiero_despacho` | ❌ No instalada en producción |
| RPC `registrar_pago_externo_cobro_idempotente` | ❌ No instalada en producción |
| Tabla `cod_conciliacion_idempotencia` | ❌ No instalada en producción |
| `api/handlers/cod.js` | ✅ Listo en proyecto activo |
| `src/utils/codCurrency.js` | ✅ Existe en proyecto activo |
| `ConciliarCodModal.jsx` (proyecto activo) | ❌ Versión legacy (dos pasos) |
| Despacho #3991 | ✅ Regularizado manualmente el 2026-10-18 |

---

## 3. Tareas de Implementación

---

### Tarea 1 — Verificación Preflight de Base de Datos (Solo Lectura)

**Objetivo:** Confirmar que la base de datos de producción cumple con todas las precondiciones necesarias antes de aplicar cualquier cambio estructural.

**Archivo de referencia:** `supabase/release/main/14_cod_preflight_readonly.sql` (ERP, solo lectura)

**Paso 1: Ejecutar verificación de catálogo**
Confirmar que existan:
- Tablas: `notas_despacho`, `cuentas_por_cobrar`, `clientes`, `usuarios`, `auditoria`, `despacho_devoluciones`, `despacho_devolucion_intercambios`.
- Procedimiento: `recalcularcomisiondespacho_238b(uuid)`.
- Columnas individuales de cada tabla (el preflight las verifica automáticamente).
- Compatibilidad: función `pg_input_is_valid(text, text)` disponible.

**Paso 2: Comprobar ausencia de colisiones**
El preflight confirma que `resumen_financiero_despacho` y `registrar_pago_externo_cobro_idempotente` **no existen** en la base. Si el preflight lanza `PRECONDICION_FUNCION_EXISTENTE`, detener y verificar si hay una versión previa instalada antes de continuar.

**Resultado esperado:** Todos los checks pasan sin excepción.

> **NO-GO** si cualquier check falla o si el resultado es ambiguo. Escalar al DBA antes de continuar.

---

### GATE — Backup Verificable (obligatorio antes de Tarea 2)

> ⚠️ **Este gate es obligatorio. Sin él, Tarea 2 no se ejecuta.**

- Tomar backup completo de la base de datos de producción (incluye datos financieros, `auditoria` e `idempotencia`).
- Realizar restore en un ambiente descartable y verificar que las tablas `notas_despacho`, `cuentas_por_cobrar` y `auditoria` son legibles.
- Registrar el hash o identificador del backup y guardar evidencia del restore exitoso.

---

### Tarea 2 — Instalación de las RPCs Atómicas en Supabase Producción

**Objetivo:** Crear la tabla de idempotencia y las dos funciones financieras atómicas en el esquema `public`.

**Archivo fuente:** `supabase/release/main/14_cod_financial_rpcs_review.sql` (ERP, solo lectura)

> ⚠️ **IMPORTANTE — Gate REVIEW_ONLY:** El archivo fuente contiene un bloque de seguridad en las líneas 15–19 que lanza `RAISE EXCEPTION 'REVIEW_ONLY...'` e impide la ejecución directa. Antes de aplicar en producción, crear una **copia de trabajo** del SQL y eliminar únicamente ese bloque (`DO $review_gate$ ... $review_gate$`). No modificar el archivo fuente del ERP.

**Paso 1: Crear tabla de idempotencia**
```sql
CREATE TABLE IF NOT EXISTS public.cod_conciliacion_idempotencia (
  cuenta_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  despacho_id UUID NOT NULL REFERENCES public.notas_despacho(id) ON DELETE RESTRICT,
  payload_hash TEXT NOT NULL,
  resultado JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cuenta_id, idempotency_key)
);
ALTER TABLE public.cod_conciliacion_idempotencia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cod_conciliacion_idempotencia FROM PUBLIC, anon, authenticated, service_role;
```

> **Nota de rollback:** Esta tabla es **append-only** y evidencia financiera permanente. En caso de reversión, se retiran únicamente las funciones. **La tabla NO se elimina**, incluso si no hubo tráfico real.

**Paso 2: Instalar función de lectura `resumen_financiero_despacho`**
- Firma: `(p_cuenta_id UUID, p_despacho_id UUID) RETURNS JSONB`
- Seguridad: `STABLE SECURITY INVOKER`, `search_path = public`.
- Permisos: `REVOKE ALL` de `PUBLIC/anon/authenticated`; `GRANT EXECUTE` solo a `service_role`.

**Paso 3: Instalar función atómica `registrar_pago_externo_cobro_idempotente`**
Ejecuta en una sola transacción `BEGIN…COMMIT`:
1. Advisory lock por `cuenta_id + idempotency_key`.
2. Bloqueo `FOR UPDATE` del despacho y del cliente.
3. Validación: estado del despacho (`despachada` o `entregada`), rol del operador, deuda COD > 0.
4. Check de idempotencia (replay seguro si la clave ya existe con el mismo payload).
5. Inserción de abonos en `cuentas_por_cobrar`.
6. Actualización de `forma_pago` y `forma_pago_cliente` con `cobro_destino_pagado: true`.
7. Ejecución de `recalcularcomisiondespacho_238b` si la deuda queda en cero.
8. Registro en `auditoria` y en `cod_conciliacion_idempotencia`.
- Seguridad: `VOLATILE SECURITY DEFINER`, `search_path = public`.
- Permisos: `REVOKE ALL`; `GRANT EXECUTE` solo a `service_role`.

---

### Tarea 3 — Verificación Postflight de Base de Datos

**Objetivo:** Confirmar que los objetos fueron creados correctamente con sus permisos y restricciones de seguridad.

**Archivo de referencia:** `supabase/release/main/14_cod_postflight_readonly.sql` (ERP, solo lectura)

**Verificar:**
- `public.resumen_financiero_despacho(UUID, UUID)` → existe, `STABLE SECURITY INVOKER`, `search_path=public`.
- `public.registrar_pago_externo_cobro_idempotente(...)` → existe, `VOLATILE SECURITY DEFINER`, `search_path=public`.
- Permisos efectivos: solo `service_role` tiene `EXECUTE`. `anon` y `authenticated` bloqueados.
- `cod_conciliacion_idempotencia` → existe con PK `(cuenta_id, idempotency_key)` y RLS habilitado.

> **NO-GO** si algún permiso es incorrecto o las firmas no coinciden. No improvisar correcciones en vivo.

---

### Tarea 4 — Sincronización del Frontend (`ConciliarCodModal.jsx`)

**Objetivo:** Reemplazar el componente vulnerable de dos pasos por la versión definitiva conectada a las RPCs atómicas.

> ⚠️ **Esta tarea requiere que las RPCs de la Tarea 2 ya estén instaladas.** El nuevo modal falla con 503 si las RPCs no existen. No desplegar el Frontend antes de completar las Tareas 2 y 3.

**Archivos:**
- **Origen (solo lectura):** `ERP/listo-pos-cotizaciones/src/components/despachos/ConciliarCodModal.jsx`
- **Destino (proyecto activo):** `src/components/despachos/ConciliarCodModal.jsx`
- **Dependencia ya presente:** `src/utils/codCurrency.js` ✅ (no requiere acción)

**Paso 1: Reemplazar `ConciliarCodModal.jsx`**

La versión nueva:
- Al abrir: llama a `POST /api/despachos/resumen-financiero` → obtiene saldo real del ledger CxC.
- Al confirmar: llama a `POST /api/despachos/conciliar-cod` con `{ despachoId, idempotencyKey, pagos, evidencia }`.
- Genera un `idempotencyKey` único (`crypto.randomUUID()`) por cada apertura del modal.
- Soporta `Efectivo Bs` con snapshot de tasa (fuente, fecha, equivalente USD fijo).
- Elimina: `useRegistrarAbono`, `supabase` directo, `/api/cxc/abono`, `/api/despachos/editar-pago`.

**Advertencia `Efectivo Bs`:** El Worker valida que `monto_bs / tasa_snapshot = monto` con exactitud de dos decimales. Si la tasa no está disponible al momento de ejecutar el smoke test, usar `Zelle` o `Efectivo $` como método de prueba alternativo.

**Paso 2: Pruebas y build**
```bash
npx vitest run        # → 100% PASS requerido
npm run build         # → sin errores requerido
```

---

### Tarea 5 — Despliegue y Verificación Operativa (Smoke Test)

**Objetivo:** Poner en producción los cambios y realizar una verificación en caliente.

**Orden de deployment obligatorio:**
1. ✅ Tarea 2 completada (RPCs instaladas y postflight OK)
2. Deploy del **Worker** en Cloudflare (aunque ya tiene el código, confirmar versión activa)
3. Deploy del **Frontend** en Vercel

> El Frontend nuevo puede desplegarse antes o simultáneamente al Worker, siempre que las RPCs SQL ya estén instaladas. El Frontend viejo seguirá dando error 400 hasta que Vercel complete el deploy.

**Smoke Test en Producción:**
1. Abrir un despacho con Cobro a Destino pendiente (estado `pendiente` o `parcial` en el ledger).
2. Comprobar que el modal abre, llama a `/api/despachos/resumen-financiero` y muestra el saldo exacto del ledger.
3. Confirmar que el campo de evidencia exige mínimo 4 caracteres.
4. Registrar el pago y verificar que tanto `cuentas_por_cobrar` como `notas_despacho` se actualizan en la misma transacción.
5. Reintentar el mismo pago con la misma `idempotencyKey` → debe retornar el mismo resultado sin duplicar abonos.

---

## 4. Checklist de ejecución ordenada

```
[ ] T1:    Ejecutar preflight readonly en Supabase SQL Editor
[ ] GATE:  Backup tomado y restore probado en ambiente descartable
[ ] T2a:   Crear copia de trabajo del SQL
[ ] T2b:   Eliminar bloque REVIEW_ONLY (líneas 15–19 del SQL fuente)
[ ] T2c:   Ejecutar SQL en producción (SQL Editor / psql, NO supabase db push)
[ ] T3:    Ejecutar postflight readonly; verificar firmas y permisos
[ ] T4a:   Copiar ConciliarCodModal.jsx (ERP → proyecto activo)
[ ] T4b:   npx vitest run → 100% PASS
[ ] T4c:   npm run build → sin errores
[ ] T5a:   Deploy Worker (Cloudflare)
[ ] T5b:   Deploy Frontend (Vercel)
[ ] T5c:   Smoke test: abrir modal en despacho COD pendiente real
[ ] T5d:   Smoke test: verificar atomicidad (CxC + despacho sincronizados)
[ ] T5e:   Smoke test: replay con misma idempotencyKey → sin duplicados
```

---

## 5. Rollback

Si cualquier verificación falla después del apply SQL:

1. **Sin tráfico real:** El owner puede aprobar la eliminación de las dos funciones (`DROP FUNCTION`) restaurando los cuerpos previos del backup. La tabla `cod_conciliacion_idempotencia` **no se elimina**.
2. **Con tráfico real:** Evaluar compatibilidad del Worker y filas creadas antes de cualquier acción. Coordinar rollback de Worker y DB de forma compatible. Escalar a reconciliación financiera si hay abonos reales en la tabla.
3. **En todos los casos:** No improvisar cambios en vivo. Seguir el runbook `docs/runbooks/cutover-cod-release-14.md` (Fase 6).

---

## 6. Referencias

| Archivo | Ubicación | Propósito |
|---|---|---|
| SQL principal | `ERP/supabase/release/main/14_cod_financial_rpcs_review.sql` | Fuente de la Tarea 2 (solo lectura) |
| Preflight | `ERP/supabase/release/main/14_cod_preflight_readonly.sql` | Tarea 1 |
| Postflight | `ERP/supabase/release/main/14_cod_postflight_readonly.sql` | Tarea 3 |
| Runbook cutover | `ERP/docs/runbooks/cutover-cod-release-14.md` | Referencia de gates y rollback |
| Worker handler | `api/handlers/cod.js` | Ya en proyecto activo |
| Frontend nuevo | `ERP/src/components/despachos/ConciliarCodModal.jsx` | Fuente de la Tarea 4 (solo lectura) |
| Utilidad Bs | `src/utils/codCurrency.js` | Ya en proyecto activo |
