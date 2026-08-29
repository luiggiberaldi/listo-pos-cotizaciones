# Plan corregido v2 — Comisión split por cliente ajeno en sábados

**Fecha:** 2026-08-29  
**Estado:** implementado y validado en staging; promoción a principal pendiente de autorización.  
**Alcance:** comisión por despacho entregado/despachado cuando el vendedor que realizó la venta es distinto del vendedor dueño del cliente.

## 1. Regla de negocio canónica

Cuando se cumplen todas las condiciones:

1. el despacho está en estado `despachada` o `entregada`;
2. el cliente tiene un vendedor dueño distinto del vendedor que realizó la venta;
3. ambos beneficiarios son comisionables;
4. el split está activo;
5. la fecha de aplicación pertenece a un día configurado;

se generan dos filas independientes:

| Beneficiario | Porcentaje predeterminado |
|---|---:|
| Vendedor que realizó la venta | 0.5% |
| Dueño del cliente | 1.5% |

Los porcentajes reemplazan la tasa normal para ese despacho; no se suman a ella. La base es la base comisionable calculada por la política 238b.

### Fecha oficial

La regla usa `notas_despacho.creado_en::date`, con PostgreSQL `extract(dow)`:

```text
0 domingo · 1 lunes · 2 martes · 3 miércoles · 4 jueves · 5 viernes · 6 sábado
```

El valor predeterminado es `comision_split_dias = '6'`. No se usará fecha de entrega salvo que negocio apruebe expresamente cambiar la política y los tests.

## 2. Configuración y límites

Campos de configuración por cuenta:

```text
comision_split_activo       boolean, default true en staging / OFF durante promoción
comision_split_pct_vendedor numeric, default 0.5
comision_split_pct_dueno    numeric, default 1.5
comision_split_dias         text, default '6'
```

Guardarraíles obligatorios:

- porcentajes numéricos entre 0 y 100;
- días únicamente `0`–`6`, separados por coma;
- configuración inválida rechazada por Worker;
- configuración ausente o inconsistente no activa el split;
- ningún split histórico se reconstruye automáticamente;
- la activación inicial en principal debe quedar en `false`.

## 3. Ocho piezas de implementación

### P1 — Modelo de datos

- Reemplazar unicidad `UNIQUE(despachoid)` por `UNIQUE(despachoid, vendedorid)`.
- Mantener filas históricas existentes sin dividirlas.
- Guardar evidencia en `calculo_evidencia`:
  - `split_cliente_ajeno`;
  - porcentajes aplicados;
  - IDs de vendedor y dueño;
  - día aplicado;
  - base y monto antes/después de pago.

### P2 — Funciones SQL

Aplicar `CREATE OR REPLACE` sobre las mismas firmas, nunca overloads:

- `calcularcomisiondespacho_238b(uuid)`;
- `recalcularcomisiondespacho_238b(uuid)`;
- `ajustar_finanzas_devolucion_atomica(uuid,numeric,numeric,uuid,text)`.

La lógica debe:

- crear una o dos filas;
- respetar CxC y retención 238b;
- hacer el recálculo idempotente;
- no tocar comisiones pagadas;
- escalar todas las filas en una devolución por el mismo factor;
- mantener grants restringidos a `service_role`;
- ejecutar `NOTIFY pgrst`.

### P3 — Guard de pagos 238b

Promover también el trigger y su función de guard que existen en staging. Debe impedir que una comisión retenida sea tratada como liberada incorrectamente por pagos incompatibles.

### P4 — Worker

Portar al principal:

- validación de configuración;
- derivación del tipo de fila `split_cliente_ajeno`;
- manejo de valores JSONB boolean/string;
- consultas y reportes que admitan múltiples filas por despacho;
- sin asumir que un despacho tiene una sola comisión.

### P5 — Frontend y reportes

Portar:

- configuración de porcentajes y días;
- toggle activo/inactivo;
- badge `Cliente ajeno`;
- beneficiario visible;
- porcentaje, estado, retenido y liberado;
- totales agrupables sin duplicar el valor del despacho;
- PDF y reportes revisados para sumar comisiones, no despachos.

### P6 — Compatibilidad histórica

- No recalcular comisiones históricas automáticamente.
- Las filas antiguas siguen siendo una fila por despacho.
- El split solo aplica cuando se calcula una comisión nueva después de la activación.
- Cualquier saneamiento histórico requiere script separado, dry-run, aprobación y auditoría.

### P7 — Pruebas

Staging debe mantener verdes:

- split 0.5% / 1.5%;
- cliente propio sin split;
- día no configurado sin split;
- switch apagado sin split;
- replay idempotente;
- devolución proporcional de ambas filas;
- pago independiente de cada beneficiario;
- CxC y política 238b;
- configuración inválida;
- reportes y PDF con dos filas;
- rollback transaccional;
- limpieza de fixtures.

Estado actual validado:

```text
E2E staging: 111/111 PASS en dos corridas
Vitest staging: 26 archivos / 235 tests PASS
Build staging: PASS
```

### P8 — Operación, monitoreo y auditoría

Registrar:

- quién activó/desactivó la regla;
- configuración anterior y nueva;
- request ID de operaciones relevantes;
- filas creadas por despacho;
- errores PostgREST, Worker y Supabase;
- primer piloto de sábado;
- resultado de conciliación y reportes.

## 4. Promoción segura al principal

### Fase A — Preflight read-only

Confirmar:

- ref correcta del proyecto;
- índice único viejo presente y nuevo ausente;
- cero colisiones por `(despachoid, vendedorid)`;
- firmas y cuerpos vivos de funciones;
- trigger 238b presente/ausente y diferencia documentada;
- grants actuales;
- columnas requeridas;
- configuración actual;
- cero comisiones históricas que se dividirán accidentalmente.

Criterio: cero hallazgos bloqueantes.

### Fase B — Backup

Crear y verificar:

- backup completo;
- dump específico de `comisiones`;
- dump de `configuracion_negocio`;
- SHA-256, tamaño, fecha y ubicación.

Sin backup verificable no se continúa.

### Fase C — Ensayo de rollback en staging

Ejecutar en transacción:

```text
aplicar P3 + P1/P2 → validar → aplicar rollback → validar → ROLLBACK
```

El rollback se regenera desde cuerpos vivos del principal, no desde staging.

### Fase D — Aplicación SQL principal

En una transacción:

1. aplicar guard 238b;
2. aplicar columnas e índice;
3. aplicar funciones;
4. aplicar grants y `NOTIFY`;
5. establecer `comision_split_activo = false`;
6. ejecutar postflight.

### Fase E — Worker y frontend

Solo después del postflight SQL:

1. desplegar Worker;
2. verificar ping, CORS y endpoints autenticados;
3. desplegar frontend;
4. verificar bundle y Service Worker;
5. confirmar que el frontend muestra el toggle OFF.

### Fase F — Activación y piloto

Cuando negocio lo autorice:

1. configurar porcentajes y días;
2. activar toggle;
3. crear/identificar una venta piloto de sábado;
4. confirmar dos filas exactas;
5. revisar reportes y PDF;
6. mantener monitoreo reforzado durante la jornada.

## 5. Rollback

### Nivel 1 — Regla de negocio

Desactivar inmediatamente:

```text
comision_split_activo = false
```

Esto evita nuevos splits sin borrar información.

### Nivel 2 — Código

- redeploy del Worker anterior;
- redeploy del frontend anterior;
- invalidación controlada del Service Worker si es necesario.

### Nivel 3 — Base de datos

Ejecutar únicamente el rollback regenerado y ensayado:

- bloquear si existe cualquier fila split pagada o parcialmente pagada;
- eliminar filas split no pagadas solo si el procedimiento lo autoriza;
- restaurar índice original;
- restaurar cuerpos vivos pre-release;
- eliminar columnas de configuración solo si no existen dependencias;
- verificar hashes, grants y funciones.

Nunca hacer rollback destructivo automático sobre comisiones pagadas.

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Reportes que asumen una fila por despacho | Auditoría de consumidores, tests de dos filas y agrupación correcta |
| Doble comisión por replay | `UNIQUE(despachoid, vendedorid)` + E2E de idempotencia |
| Porcentajes inválidos | Validación Worker + límites SQL/operativos |
| Aplicación en día incorrecto | `comision_split_dias`, `extract(dow)` y tests T4/T5 |
| Fecha de negocio mal interpretada | Decisión explícita: `creado_en`; cambio requiere aprobación |
| Comisión pagada recalculada | Guard que bloquea recálculo si alguna fila está pagada |
| Rollback con drift | Regenerar cuerpos desde principal vivo y probarlos en staging |
| Activación accidental | Deploy con `activo=false` verificado en postflight |
| JSONB boolean llega como string | Normalización y asserts explícitos |
| Worker/frontend desalineados | DB primero, smoke, deploy secuencial y verificación de versiones |
| Service Worker antiguo | Validar hash, `Last-Modified`, estado `waiting/activated` y bundle |
| Saneamiento histórico indebido | Política forward-only; scripts históricos separados y dry-run |
| Falla de schema cache PostgREST | `NOTIFY pgrst`, espera con backoff y smoke de resolución |

## 7. Criterios GO / NO-GO

### GO a promoción

- staging verde dos veces;
- preflight principal sin bloqueantes;
- backup verificable;
- rollback ensayado;
- SQL aplicado con `activo=false`;
- postflight correcto;
- Worker y frontend alineados;
- CORS y Service Worker verificados;
- aprobación explícita de negocio para activar.

### NO-GO

- colisiones de unicidad;
- funciones con firmas incompatibles;
- rollback no reproducible;
- grants incorrectos;
- configuración activa accidentalmente;
- reportes que sumen duplicado;
- errores nuevos 400/401/500;
- Service Worker sirviendo bundle incompatible;
- comisión split pagada que requiera rollback destructivo.

## 8. Estado y próximos pasos

Estado actual:

```text
Staging: listo y validado
Principal: release preparado, no activar aún
```

Próximo paso operativo recomendado:

1. revisar este documento con negocio;
2. confirmar que la fecha oficial es `creado_en`;
3. ejecutar preflight final y backup;
4. promover con switch OFF;
5. activar solo durante una ventana controlada de sábado.
