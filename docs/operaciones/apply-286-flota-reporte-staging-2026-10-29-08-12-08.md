# Aplicación 286 (reporte detallado de flota) en STAGING — 2026-10-29T08:12:08.775Z

Proyecto `spupqgkdsgohxxfoxydl`, script `construacero-staging/scripts/apply-286-flota-reporte-staging.mjs`.

**Resultado:** OK — 286 aplicada; reversa probada en simulacro; datos intactos.

### PRE: estado de las funciones
```json
{
  "reporte_existe": true,
  "detalle_existe": false,
  "reporte_ampliado": false,
  "abiertas_a_navegador": 0
}
```

### PRE: huella de despachos
```json
{
  "notas": 1326,
  "notas_md5": "4be73d9a880f75285603a9f6117f1f43"
}
```

### APPLY: 286_staging_flota_reporte_detallado.sql
```json
[]
```

### POST 1: esperado reporte ampliado, detalle existente, 0 abiertas al navegador
```json
{
  "reporte_existe": true,
  "detalle_existe": true,
  "reporte_ampliado": true,
  "abiertas_a_navegador": 0
}
```

### POST 2: el reporte responde con los campos nuevos (solo lectura)
```json
[
  {
    "resumen": {
      "vehiculos": 5,
      "claves_vehiculo": [
        "activo",
        "capacidad_kg",
        "codigo",
        "color_batea",
        "comision_choferes_usd",
        "desglose_choferes",
        "destinos_top",
        "dias_trabajados",
        "empresa_usd",
        "modelo",
        "nombre",
        "placa",
        "placa_batea",
        "promedio_flete_viaje_usd",
        "total_flete_usd",
        "total_mercancia_usd",
        "total_viajes",
        "ultimo_chofer_nombre",
        "ultimo_viaje_en",
        "vehiculo_id",
        "viajes_en_carabobo",
        "viajes_estimados",
        "viajes_fuera_carabobo"
      ],
      "viajes_sin_camion": {
        "viajes": 0,
        "flete_usd": 0
      }
    }
  }
]
```

### POST 3: el detalle responde (solo lectura)
```json
[
  {
    "viajes_con_camion": 2,
    "viajes_sin_camion": 0
  }
]
```

### SIMULACRO: dentro de la reversa (esperado detalle=false, ampliado=false)
```json
{
  "detalle": "f",
  "ampliado": "f"
}
```

### DESPUÉS del simulacro: la 286 sigue instalada
```json
{
  "reporte_existe": true,
  "detalle_existe": true,
  "reporte_ampliado": true,
  "abiertas_a_navegador": 0
}
```

### Huella de despachos (debe ser idéntica a PRE)
```json
{
  "notas": 1326,
  "notas_md5": "4be73d9a880f75285603a9f6117f1f43"
}
```
