# Runbook: Promoción Fase 3 — Reembolso atómico y destino del balance en devoluciones CxC

**Fecha:** 2026-09-04 · **Commit frontend:** `940c77e` · **Commit backend:** ver BITACORA
**Patrón:** idéntico al runbook de `permitir_stock_negativo` (backup → preflight → apply → smoke → postflight).

---

## 1. Qué cambia en producción

| Objeto | Cambio | Riesgo |
|---|---|---|
| `ajustar_finanzas_devolucion_neta` (5 args) | Reemplazo IN-PLACE: lee GUC `app.devolucion_destino` / `app.devolucion_reembolso_pagos`. Sin GUC = comportamiento actual | Nulo fuera de devoluciones con reembolso |
| `registrar_devolucion_parcial_cobro_idempotente` | DROP de la firma de 14 + CREATE de 16 params (`p_destino_saldo`, `p_pagos_reembolso`, ambos con default). El Worker viejo (14 args nombrados) resuelve igual y obtiene el comportamiento histórico | Solo durante la ventana de apply (segundos) |
| Worker (`handleDevolucionParcialDespacho`) | Envía los 2 params nuevos; ya no hace INSERT REST de `devolucion_credito` ni PATCH de metadatos post-transacción | Requiere deploy después del SQL |

**Semántica nueva (solo operaciones nuevas con destino Reembolso):**
- Antes: `abono` reduce deuda + el Worker pagaba efectivo → doble beneficio.
- Ahora: deuda intacta, `credito` por el total y `devolucion_credito` en la misma transacción (saldo a favor neto ≈ 0).
- Destino Saldo a Favor / cobro de diferencia: byte-a-byte el comportamiento actual.

## 2. Precondiciones (preflight automático en el propio SQL)

- Columnas `destino_saldo, reembolso_metodo, reembolso_referencia, reembolso_monto` en `despacho_devoluciones` (migración 134) — si faltan, el script aborta.
- `registrar_devolucion_parcial_cobro_idempotente` de 14 args existe (release 02).
- `ajustar_finanzas_devolucion_neta` de 5 args existe (release/main/03).

## 3. Orden de ejecución

```
F0  Backup del principal (pg_dump + SHA-256)
F1  Preflight read-only: to_regprocedure de las 2 firmas + columnas 134
F2  Aplicar supabase/release/principal/05_devolucion_reembolso_atomico.sql
F3  Smoke con ROLLBACK:
      BEGIN;
      SELECT ajustar_finanzas_devolucion_neta('<despacho_entregado_test>', 1.90, 0, '<usuario>', 'Smoke');
        (sin GUC ⇒ debe comportarse como hoy: abono a deuda)
      SELECT set_config('app.devolucion_destino','reembolso',true);
      SELECT set_config('app.devolucion_reembolso_pagos','[{"metodo":"Efectivo $","monto":1.9,"referencia":null}]',true);
      SELECT ajustar_finanzas_devolucion_neta(...);  → credito + devolucion_credito, deuda intacta
      ROLLBACK;  -- cero residuos
F4  Postflight: firma de 16 args visible en schema cache (GET /rest/v1/ con OpenAPI)
F5  Deploy Worker (npx vercel --prod) — ANTES de esto, el Worker actual sigue
    funcionando con la RPC nueva (14 args nombrados, defaults activos)
F6  Smoke E2E real en staging (ya con 262 aplicada): venta CxC + devolución en ambos destinos
```

## 4. Rollback

```bash
# 1. Revertir RPC (el Worker nuevo NO rompe: los params extra que envía son
#    ignorados por PostgREST si no existen — devuelve PGRST203 solo en named-args
#    desconocidos; en ese caso redeploy inmediato del Worker anterior)
psql "$DATABASE_URL" -f supabase/release/principal/05_devolucion_reembolso_atomico_rollback.sql
```

La restauración devuelve la función de finanzas sin GUC y el wrapper de 14 args. Las filas `devolucion_credito` ya creadas son histórico válido y no se tocan.

## 5. Criterios de aceptación

- [ ] F2 aplica sin excepciones de precondición.
- [ ] F3: rama sin GUC produce `abono_monto > 0` con deuda pendiente; rama reembolso produce `credito_monto = devolucion_credito` y `saldo_pendiente` intacto.
- [ ] Tras ROLLBACK del smoke: 0 filas nuevas en `cuentas_por_cobrar` y `despacho_devoluciones`.
- [ ] Postflight: `/rest/v1/` lista la firma de 16 parámetros.
- [ ] Staging E2E: devolución Saldo a Favor en venta CxC reduce deuda; devolución Reembolso deja deuda intacta y registra egreso.

## 6. Fuera de alcance

- La ruta REST legacy post-RPC de staging (líneas 2795+, sin atomicidad) queda intacta — es código muerto alcanzable solo si la RPC falla antes; se limpia en un commit posterior si procede.
- Migraciones de `supabase/migrations/` numeradas: la release va por `supabase/release/principal/` siguiendo la convención de los últimos releases (02–04).
