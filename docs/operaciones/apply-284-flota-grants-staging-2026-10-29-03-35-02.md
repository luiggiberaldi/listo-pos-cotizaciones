# Aplicación 284 (permisos de vehiculos) en STAGING — 2026-10-29T03:35:02.794Z

Proyecto `spupqgkdsgohxxfoxydl`, script `construacero-staging/scripts/apply-284-flota-grants-staging.mjs`.

**Resultado:** OK — permisos de vehiculos corregidos.

### PRE: privilegios actuales de public.vehiculos
```json
{
  "sr_select": false,
  "sr_insert": false,
  "sr_update": false,
  "sr_delete": false,
  "auth_select": false,
  "auth_insert": false,
  "anon_select": false,
  "rls_activa": true
}
```

### APPLY: 284_staging_flota_grants_vehiculos.sql
```json
[]
```

### POST: esperado service_role CRUD, authenticated solo SELECT, anon nada, RLS activa
```json
{
  "sr_select": true,
  "sr_insert": true,
  "sr_update": true,
  "sr_delete": true,
  "auth_select": true,
  "auth_insert": false,
  "anon_select": false,
  "rls_activa": true
}
```
