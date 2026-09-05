# Runbook: Promoción release 06 — Reversión consciente de devoluciones

**Fecha:** 2026-09-05 · **Commits:** `3ddd4fa` (backend) · `72da4e2` (UX + espejo staging)
**Patrón:** idéntico al runbook del release 05 (backup → preflight → apply → smoke con ROLLBACK → postflight → deploy).

---

## 1. Qué cambia en producción

| Objeto | Cambio | Riesgo |
|---|---|---|
| `revertir_entrega_finanzas_atomica` (5 args) | Reemplazo IN-PLACE (misma identidad, sin overloads — lección 42725): guarda relajada (solo cobros reales bloquean; `Devolución`/`Saldo a favor` se anulan en la transacción), 2 guardas nuevas (`REEMBOLSO_EFECTIVO_REGISTRADO`, `CREDITO_YA_CONSUMIDO`), respuesta enriquecida | Medio — es la RPC de reversión financiera |
| Guardarraíl Worker (`/api/despachos/estado`) | Alineado con la RPC: fetch de abonos completo + filtro en JS (antes: `neq.Saldo a favor` en la URL) | Bajo |
| Frontend | Panel resumen 100% devuelto, confirmación inteligente de "Reabrir despacho", toast con efecto CxC | Mínimo |
| Datos | **Sin migración de datos.** Solo definición de función | — |

**Compatibilidad:** el wrapper `revertir_entrega_finanzas_idempotente` (release 04) delega en esta función sin cambiar; los triggers 179 recalculan los saldos del cliente en cada DELETE dentro de la transacción. El comportamiento sin devoluciones previas es byte-a-byte el mismo (no hay abonos `Devolución` → la guarda relajada se comporta igual que la vieja).

## 2. Precondiciones (F1 preflight las valida)

1. `to_regprocedure('public.revertir_entrega_finanzas_atomica(UUID,TEXT,UUID,TEXT,TEXT)')` existe.
2. La definición vigente contiene `CXC_CON_ABONOS` con `COALESCE(forma_pago_abono,'') <> 'Saldo a favor'` (versión 232 original).
3. Cantidad de despachos afectables: abonos `Devolución` presentes en CxC (informativo, no bloquea).

## 3. Ejecución

```bash
# F0 — Backup (obligatorio)
pg_dump "$SUPABASE_DB_URL" -Fc -f "tmp/kardex-principal-pre-release06-$(date -u +%Y-%m-%dT%H-%M-%S-%3NZ).dump"
sha256sum tmp/kardex-principal-pre-release06-*.dump

# F1 — Preflight (psql): firma + versión 232 vigente
psql "$SUPABASE_DB_URL" -c "SELECT to_regprocedure('public.revertir_entrega_finanzas_atomica(UUID,TEXT,UUID,TEXT,TEXT)');"
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM cuentas_por_cobrar WHERE tipo='abono' AND forma_pago_abono='Devolución';"

# F2 — Apply
psql "$SUPABASE_DB_URL" -f supabase/release/principal/06_reversion_con_devoluciones.sql

# F3 — Smoke OBLIGATORIO con ROLLBACK (transacción, 0 residuos)
#   Escenario: despacho entregado con cargo + abono 'Devolución'.
#   a) Versión 232 vieja (rollback file): revertir → espera EXCEPCIÓN CXC_CON_ABONOS
#   b) Versión 06: revertir → OK, sin filas CxC, saldos del cliente restaurados
#   c) ROLLBACK — verificar 0 residuos (CxC, kardex, estado del despacho)
#   (reutilizar el esqueleto del smoke del release 05; script tmp/smoke-release06.mjs)

# F4 — Postflight: la RPC sigue ejecutable por service_role y bloqueada para anónimos
psql "$SUPABASE_DB_URL" -c "SELECT has_function_privilege('anon', 'public.revertir_entrega_finanzas_atomica(UUID,TEXT,UUID,TEXT,TEXT)', 'execute');"
# Esperado: false

# F5 — Deploy (frontend + Worker)
npx vercel --prod
```

## 4. Rollback

```bash
psql "$SUPABASE_DB_URL" -f supabase/release/principal/06_reversion_con_devoluciones_rollback.sql
```

Restaura la definición 232 original. Las reversiones ya ejecutadas bajo la versión 06 son histórico válido y no se tocan.

## 5. Casos borde que la versión 06 BLOQUEA (por diseño)

| Caso | Excepción | Salida operativa |
|---|---|---|
| Reembolso en efectivo ya pagado (`devolucion_credito` del despacho) | `REEMBOLSO_EFECTIVO_REGISTRADO` | Anular el egreso primero (CxC → revertir transacción) |
| Saldo a favor del despacho ya consumido por el cliente | `CREDITO_YA_CONSUMIDO` | Reponer el saldo o anular manualmente |
| Cobros reales (`Efectivo`, `Pago Móvil`, …) | `CXC_CON_ABONOS` | Anular los cobros primero (sin cambio) |
| Comisión pagada / flete liquidado | `COMISION_YA_PAGADA` / `FLETE_YA_PAGADO` | Sin cambio |

## 6. Staging

Espejo `264_staging_reversion_con_devoluciones.sql` (+ rollback). Aplicar a la BD de staging **antes** de producción y correr el E2E `scripts/test-e2e-staging.mjs` (sección devolución/reversión).

## 7. Checklist de cierre

- [ ] F0 backup con SHA-256 registrado en BITACORA
- [ ] F1 preflight PASS
- [ ] F2 apply sin excepciones
- [ ] F3 smoke con ROLLBACK y 0 residuos (ramas: abono Devolución OK / abono real bloqueado)
- [ ] F4 postflight PASS (privilegios correctos)
- [ ] F5 deploy Vercel Ready + URL 200
- [ ] BITACORA actualizada con resultados y lecciones
