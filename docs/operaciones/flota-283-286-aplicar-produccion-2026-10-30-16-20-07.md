# Flota 283 + 286 — modo aplicar (produccion) — 2026-10-30T16:20:07.002Z

Proyecto `oyfyuszgjwcepjpngclv`, script `scripts/apply-283-286-flota-produccion.mjs`.

## En resumen

REVISAR — algún control posterior no dio lo esperado. NO unir el código todavía; evaluar la reversa.

> Datos personales (nombres, placas, identificadores) tapados: el repositorio es público.
> La versión completa está en el respaldo local `construacero-backups/pre-flota-283-286-2026-10-30-12-14-49/informes-completos/`.

## Evidencia

### PRE 1. Estado de los objetos que crea la 283
```
[
  {
    "tabla_vehiculos_existe": false,
    "columnas_nuevas_existentes": 0,
    "set_updated_at_existe": true,
    "funciones_283_existentes": 0
  }
]
```

### PRE 2. Columnas que la 283 necesita y que deben existir ya en producción
```
[
  {
    "columnas_requeridas_faltantes": 0,
    "faltantes": null
  }
]
```

### PRE 3. Qué hará la carga histórica (backfill) — por chofer local
```
[
  {
    "id": "(oculto)",
    "nombre": "Chofer 1",
    "sin_cuenta": false,
    "placa_que_se_usara": "Placa 1",
    "sin_placa": false,
    "viajes_que_quedaran_estimados": 5
  },
  {
    "id": "(oculto)",
    "nombre": "Chofer 2",
    "sin_cuenta": false,
    "placa_que_se_usara": "Placa 2",
    "sin_placa": false,
    "viajes_que_quedaran_estimados": 1
  },
  {
    "id": "(oculto)",
    "nombre": "Chofer 3",
    "sin_cuenta": false,
    "placa_que_se_usara": "Placa 3",
    "sin_placa": false,
    "viajes_que_quedaran_estimados": 147
  },
  {
    "id": "(oculto)",
    "nombre": "Chofer 4",
    "sin_cuenta": false,
    "placa_que_se_usara": "Placa 4",
    "sin_placa": false,
    "viajes_que_quedaran_estimados": 17
  },
  {
    "id": "(oculto)",
    "nombre": "Chofer 5",
    "sin_cuenta": false,
    "placa_que_se_usara": "Placa 1",
    "sin_placa": false,
    "viajes_que_quedaran_estimados": 17
  }
]
```

### PRE 4. Placas repetidas entre choferes de la misma cuenta (compartirán un solo vehículo)
```
[
  {
    "cuenta_id": "(oculto)",
    "placa": "Placa 1",
    "choferes": 2
  }
]
```

### PRE 5. Huella de datos que la 283 NO debe cambiar (comparar con el postflight)
```
[
  {
    "cotizaciones": 2782,
    "notas_despacho": 2470,
    "pagos_transportistas": 0,
    "transportistas": 518,
    "notas_financiero_md5": "dd292195e6fe6ede01f35656e62dd331"
  }
]
```

### APPLY 283
```
[]
```

### APPLY 286
```
[]
```

### POST 1. Estructura
```
[
  {
    "tabla_vehiculos_existe": true,
    "rls_vehiculos": true,
    "columnas_nuevas": 4,
    "funciones_283": 4,
    "trigger_despacho": 1
  }
]
```

### POST 2. Permisos (raíl R2)
```
[
  {
    "funciones_abiertas_a_navegador": 0,
    "escritura_directa_navegador": 0,
    "worker_puede_leer_y_escribir": true,
    "navegador_puede_leer": true,
    "navegador_puede_escribir_debe_ser_false": true
  }
]
```

### POST 3. Resultado de la carga histórica
```
[
  {
    "vehiculos_creados": 4,
    "choferes_con_camion_fijo": 5,
    "choferes_locales_sin_camion": 0,
    "viajes_estimados": 187,
    "externos_con_camion_propio_debe_ser_0": 0
  }
]
```

### POST 4. Huella de datos (debe ser IDÉNTICA a la del preflight)
```
[
  {
    "cotizaciones": 2782,
    "notas_despacho": 2470,
    "pagos_transportistas": 0,
    "transportistas": 518,
    "notas_financiero_md5": "dd292195e6fe6ede01f35656e62dd331"
  }
]
```

### Comparación de huella del dinero (PRE vs POST)
```
{
  "igual": true,
  "pre": [
    {
      "cotizaciones": 2782,
      "notas_despacho": 2470,
      "pagos_transportistas": 0,
      "transportistas": 518,
      "notas_financiero_md5": "dd292195e6fe6ede01f35656e62dd331"
    }
  ],
  "post": [
    {
      "cotizaciones": 2782,
      "notas_despacho": 2470,
      "pagos_transportistas": 0,
      "transportistas": 518,
      "notas_financiero_md5": "dd292195e6fe6ede01f35656e62dd331"
    }
  ]
}
```
