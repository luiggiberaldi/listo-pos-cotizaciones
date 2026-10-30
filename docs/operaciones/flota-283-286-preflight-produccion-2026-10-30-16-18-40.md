# Flota 283 + 286 — modo preflight (produccion) — 2026-10-30T16:18:40.670Z

Proyecto `oyfyuszgjwcepjpngclv`, script `scripts/apply-283-286-flota-produccion.mjs`.

## En resumen

Preflight de solo lectura completado. Revisar a mano la lista de choferes locales (los "sin_placa" quedarán sin camión).

> Datos personales (nombres, placas, identificadores) tapados: el repositorio es público.
> La versión completa está en el respaldo local `construacero-backups/pre-flota-283-286-2026-10-30-12-14-49/informes-completos/`.

## Evidencia

### PREFLIGHT 1. Estado de los objetos que crea la 283
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

### PREFLIGHT 2. Columnas que la 283 necesita y que deben existir ya en producción
```
[
  {
    "columnas_requeridas_faltantes": 0,
    "faltantes": null
  }
]
```

### PREFLIGHT 3. Qué hará la carga histórica (backfill) — por chofer local
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

### PREFLIGHT 4. Placas repetidas entre choferes de la misma cuenta (compartirán un solo vehículo)
```
[
  {
    "cuenta_id": "(oculto)",
    "placa": "Placa 1",
    "choferes": 2
  }
]
```

### PREFLIGHT 5. Huella de datos que la 283 NO debe cambiar (comparar con el postflight)
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
