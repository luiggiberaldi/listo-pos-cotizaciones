# Aplicación 285 (modelo y placa batea de vehiculos) en STAGING — 2026-10-29T08:03:52.170Z

Proyecto `spupqgkdsgohxxfoxydl`, script `construacero-staging/scripts/apply-285-flota-modelo-batea-staging.mjs`.

**Resultado:** OK — modelo y placa_batea agregados.

### PRE: estado de public.vehiculos
```json
{
  "columnas_nuevas": 0,
  "vehiculos": 5,
  "worker_puede_editar": true,
  "navegador_lectura": true
}
```

### APPLY: 285_staging_flota_vehiculos_modelo_batea.sql
```json
[]
```

### POST: esperado 2 columnas nuevas, mismos vehículos y permisos intactos
```json
{
  "columnas_nuevas": 2,
  "vehiculos": 5,
  "worker_puede_editar": true,
  "navegador_lectura": true
}
```
