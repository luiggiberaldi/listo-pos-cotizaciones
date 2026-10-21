# Cutover release 19 (COD mixto) en PRODUCCIÓN — 2026-10-21T10:22:06.423Z

- Proyecto: `oyfyuszgjwcepjpngclv` (principal) · Resultado: **PASS**
- Aplicado por: scripts/apply-release19-produccion.mjs (Management API HTTPS)
- Modo: apply19
- Pre-imágenes: `supabase/release/main/19_backup_cuerpos/*.live.sql` (0 cuerpos)
- Evidencia JSON: `tmp\release19-produccion-evidence-2026-10-21-10-22-15.json`

## Aserciones
- ✅ PRE: conexión a producción OK
- ✅ PRE: estado previo reconocido (release 14 / release 19 / baseline ausente)
- ✅ APPLY: release 19 aplicado sin errores
- ✅ POSTFLIGHT: ejecutado sin errores
- ✅ POSTFLIGHT: 11 comprobaciones presentes (llegaron 11)
- ✅ POSTFLIGHT: idempotency_intact
- ✅ POSTFLIGHT: new_guards_present
- ✅ POSTFLIGHT: cod_payments_tagged
- ✅ POSTFLIGHT: grants_service_only
- ✅ POSTFLIGHT: summary_stable_invoker
- ✅ POSTFLIGHT: contracts_are_release19
- ✅ POSTFLIGHT: attribution_present_both
- ✅ POSTFLIGHT: reconcile_volatile_definer
- ✅ POSTFLIGHT: cod_completion_requires_zero_debt
- ✅ POSTFLIGHT: cod_records_overpayment_explicitly
- ✅ POSTFLIGHT: cod_allows_maximum_one_cent_overpayment
- ✅ SMOKE: resumen financiero del despacho #4118 responde sin errores
- ✅ SMOKE: resumen financiero del despacho #4108 responde sin errores

## Etapas
### PRE 1: conexión (2026-10-21T10:22:07.342Z)
```
[{"db":"postgres","ts":"2026-10-21 10:22:06.722555+00"}]
```
### PRE 2: hoja 19_cod_preflight_readonly.sql (2026-10-21T10:22:08.189Z)
```
[{"cod_mixto_preflight":{"functions_present":true,"recalc_stub_present":true,"ledger_tables_present":true,"release19_markers_absent":true,"summary_contract_is_release14":true,"reconcile_contract_is_release14":true}}]
```
### APPLY: 19_cod_mixto_apply.sql (2026-10-21T10:22:10.644Z)
```
[]
```
### POSTFLIGHT: 19_cod_postflight_readonly.sql (2026-10-21T10:22:11.369Z)
```
[{"cod_mixto_postflight":{"idempotency_intact":true,"new_guards_present":true,"cod_payments_tagged":true,"grants_service_only":true,"summary_stable_invoker":true,"contracts_are_release19":true,"attribution_present_both":true,"reconcile_volatile_definer":true,"cod_completion_requires_zero_debt":true,"cod_records_overpayment_explicitly":true,"cod_allows_maximum_one_cent_overpayment":true}}]
```
### SMOKE: selección de despachos reales (2026-10-21T10:22:12.073Z)
```
[{"cuenta_id":"74dd6821-963d-406e-8621-47352e0df27e","id":"d3b29c83-1a60-45a2-a154-72e8c9aa89e0","numero":4118},{"cuenta_id":"74dd6821-963d-406e-8621-47352e0df27e","id":"9d4fc776-d72b-4b72-9389-5ef85232d49c","numero":4108}]
```
### SMOKE: resumen_financiero_despacho despacho #4118 (2026-10-21T10:22:14.214Z)
```
[{"resumen":{"cod":{"estado":"pendiente","revisar":false,"presente":true,"pago_mixto":false,"motivo_revision":null,"monto_nominal_usd":341.4,"flag_pagado_legacy":false,"conciliado_sin_abono_legacy":false},"fuente":"cuentas_por_cobrar","ledger":{"abono_usd":0,"cargo_usd":341.4,"deuda_usd":341.4,"cobrado_usd":0,"abono_cod_usd":0,"abono_cxc_usd":0,"cargo_cod_usd":341.4,"cargo_cxc_usd":0,"deuda_cod_usd":341.4,"deuda_cxc_usd":0,"compensado_usd":0,"abono_cod_marcado_usd":0,"desborde_sin_marca_usd":0,"saldo_a_favor_cliente_usd":0},"moneda":"USD","numero":4118,"cuenta_id":"74dd6821-963d-406e-8621-47352e0df27e","cliente_id":"e4c8e54b-6540-42fa-a702-408586752753","despacho_id":"d3b29c83-1a60-45a2-a154-72e8c9aa89e0","devoluciones":{"total_usd":0,"intercambios_usd":0},"solo_lectura":true}}]
```
### SMOKE: resumen_financiero_despacho despacho #4108 (2026-10-21T10:22:15.105Z)
```
[{"resumen":{"cod":{"estado":"pendiente","revisar":false,"presente":true,"pago_mixto":false,"motivo_revision":null,"monto_nominal_usd":7326,"flag_pagado_legacy":false,"conciliado_sin_abono_legacy":false},"fuente":"cuentas_por_cobrar","ledger":{"abono_usd":0,"cargo_usd":7326,"deuda_usd":7326,"cobrado_usd":0,"abono_cod_usd":0,"abono_cxc_usd":0,"cargo_cod_usd":7326,"cargo_cxc_usd":0,"deuda_cod_usd":7326,"deuda_cxc_usd":0,"compensado_usd":0,"abono_cod_marcado_usd":0,"desborde_sin_marca_usd":0,"saldo_a_favor_cliente_usd":0},"moneda":"USD","numero":4108,"cuenta_id":"74dd6821-963d-406e-8621-47352e0df27e","cliente_id":"381fc23e-974e-4216-beea-e76e9f02be19","despacho_id":"9d4fc776-d72b-4b72-9389-5ef85232d49c","devoluciones":{"total_usd":0,"intercambios_usd":0},"solo_lectura":true}}]
```

## Notas posteriores (2026-10-21)

- **Pre-imágenes (0 cuerpos):** el paso de respaldo físico no capturó los cuerpos previos
  porque la consulta comparaba los argumentos de identidad sin nombres (`uuid, uuid`) y este
  Postgres los devuelve con nombres (`p_cuenta_id uuid, …`). Sin consecuencias para la
  instalación: sus verificaciones no dependen de ese paso y el plan B
  (`19_cod_rollback_review.sql`) conserva los cuerpos release 14 byte-idénticos (verificados
  por huella SHA-256). El instalador quedó corregido (búsqueda por `to_regprocedure`,
  comprobada en vivo contra producción) y se capturaron post-imágenes del estado release 19
  en `supabase/release/main/19_backup_cuerpos/*.post19.live.sql` con SHA-256.
- **Prueba visual rápida** (recomendada en el plan): pendiente manual — abrir la app y
  comprobar que un despacho COD cualquiera muestra bien su resumen financiero.
