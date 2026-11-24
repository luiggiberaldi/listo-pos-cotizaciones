# OP-2026-058 — Prueba final del plan de 30 fallas y reporte de cómo quedan los clientes

**Fecha:** 2026-11-24 · **Entorno de las pruebas:** staging (copia de pruebas) · **Producción:** solo se leyó para el reporte, sin cambios
**Cierra:** la fase 7 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md). Casos del plan: [OP-049](OP-2026-049_aviso-error-y-doble-clic-abonos-staging.md), [OP-050](OP-2026-050_abonos-un-solo-paso-y-auditoria-completa.md), [OP-051](OP-2026-051_saldo-favor-un-solo-paso-staging.md), [OP-052](OP-2026-052_reabrir-anular-sin-perder-pagos-staging.md), [OP-053](OP-2026-053_edicion-profunda-sin-perder-pagos-staging.md), [OP-054](OP-2026-054_devolucion-donado-sin-credito-staging.md), [OP-055](OP-2026-055_nada-se-borra-sin-rastro-staging.md), [OP-056](OP-2026-056_repaso-y-simulacion-n4-staging.md), [OP-057](OP-2026-057_acceso-y-consistencia-staging.md)

## En resumen

- **Las 30 fallas del registro quedaron atendidas en staging:**
  - 27 arregladas;
  - 2 que ya estaban resueltas en producción (N4 en el código y N7);
  - 1 que resultó no existir (I4).
  
  Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md).
- **Prueba final, todas juntas y en verde:**
  - 476 pruebas automáticas y la construcción de la app correcta;
  - 7 suites contra el servidor de staging (75 casos más la comparación de cifras);
  - 8 suites en navegador real (73 casos).
  
  Un caso viejo hubo que actualizarlo porque ahora "anular" exige motivo; se repitió y pasó.
- **Cómo quedan los clientes:** el código arreglado **no cambia ningún saldo guardado**. Lo que cambia es que ahora se ven los **$4.969,71 de "pagado de más" escondidos en 16 clientes**. Si además se aprueban las correcciones de datos ya estudiadas, ese escondido baja a $2.007,02, que dependen de lo que confirme caja.
- **Nada de esto está en producción.** Pasarlo necesita tu aprobación, en un caso propio: son 8 cambios de base de datos (migraciones 301 a 308) más el código.

## 1. Prueba final completa

Guion: `.tmp-op040/op058_prueba_final.sh`. Cada suite empieza con su escenario temporal recién creado; resultado en `.tmp-op040/op058_prueba_final.txt`.

### 1.1 Contra el servidor de staging

| Suite | Qué cubre | Resultado |
|---|---|---|
| `op047-abonos-api.mjs` | Abonos: montos, detalle, doble clic, huella, dos operadores a la vez, auditoría, anular | **20/20** (B3 actualizado para mandar el motivo) |
| `op051-saldo-favor-api.mjs` | Cargar, devolver y cruzar saldo a favor | **12/12** |
| `op052-reabrir-anular-api.mjs` | Reabrir y anular sin perder pagos; abono que no inventa deuda | **14/14** |
| `op053-edicion-profunda-api.mjs` | Edición profunda sin borrar créditos ni esconder pagos | **7/7** |
| `op054-devolucion-donacion-api.mjs` | Devolución de lo donado sin crédito | **8/8** |
| `op055-sin-rastro-api.mjs` | Anular con motivo, archivo de borrados, Cruce explicado | **10/10** |
| `op057-acceso-vendedor.mjs` | Lo que puede leer cada rol | **4/4** |
| `op057-comparacion-reparto.mjs` | Mismas cifras en pantalla, base y saldos (todos los clientes de staging) | **Sin diferencias** |

### 1.2 En navegador real (Chromium)

| Suite | Resultado |
|---|---|
| `op049-abonos-pantalla.mjs` (aviso de error, doble clic, "¿Es otro pago?") | **23/23** |
| `op051-saldo-favor-pantalla.mjs` | **12/12** |
| `op052-reabrir-anular-pantalla.mjs` | **6/6** |
| `op053-edicion-profunda-pantalla.mjs` | **4/4** |
| `op054-devolucion-donacion-pantalla.mjs` | **6/6** |
| `op055-sin-rastro-pantalla.mjs` | **5/5** |
| `op056-historial-pantalla.mjs` (historial completo) | **1/1** |
| `verify-op042-cxc-staging.mjs` (pagado de más visible, selector, Cruce, devolución de Encendo) | **16/16** |

### 1.3 Automáticas y construcción

`npx vitest run`: **476/476** en 52 archivos. `npm run build`: correcta.

### 1.4 Casos reales repetidos con datos de prueba

| Caso real | Dónde se reprodujo | Resultado |
|---|---|---|
| Encendo (Cruce "NO PROCEDE") | `verify-op042` | La devolución ve el Cruce; confirmándolo, la deuda del despacho queda en $294 |
| Los Guayos #4211 / #4800 (lo donado) | `op054` D1 y D4 | $0 de crédito; se cobra el producto nuevo completo |
| Angel Pineda #4775 → #4841 (Zelle en despacho anulado) | `op052` A1 y A2 | Pide decisión; con "saldo a favor" el Zelle queda como saldo a favor |
| Carlos Escalona / A_40 / Adalberto (reabrir con pago suelto) | `op052` R1 a R4 | Pide decisión; ya no se esconde ni se borra el pago |
| REYKAR / Yhoel Sanchez (abono repetido) | `op047` A7 y A8, `op049` 4 y 5 | Un solo abono; aviso "¿Es otro pago?" |
| Yahveh (abono que no se guardó sin avisar) | `op049` 2 y 3 | Aviso rojo; lo escrito se conserva; reintento sin duplicar |

No se probó cada pantalla con los roles **jefe** y **vendedor** en el navegador. Los permisos de lectura del vendedor se probaron contra la base (`op057-acceso-vendedor`), y los de escritura los controla el servidor, con pruebas automáticas por rol.

## 2. Reporte de clientes (producción, solo lectura)

Script: `docs/operaciones/OP-2026-040_scripts/op058_reporte_clientes.py`. Detalle completo, cliente por cliente: [OP-2026-058_reporte_clientes.csv](OP-2026-058_reporte_clientes.csv) (61 clientes; se abre con Excel).

**Cómo leerlo:**
- **Hoy:** lo que muestra la pantalla de producción (deuda y saldo a favor) y lo que no muestra (el "pagado de más" escondido).
- **Con el código arreglado:** lo mismo, pero el pagado de más se ve. Ningún saldo guardado cambia.
- **Con correcciones simuladas:** si se aprueban la corrección N4 ([OP-056](OP-2026-056_repaso-y-simulacion-n4-staging.md)) y la anulación del Cruce "NO PROCEDE" de Encendo ([OP-041](OP-2026-041_casos-cxc-caso-por-caso.md)). Se calculó sin escribir nada.

### 2.1 Totales

| | Hoy | Con el código arreglado | Con correcciones simuladas |
|---|---|---|---|
| Deuda total (61 clientes) | $73.688,22 | $73.688,22 | $73.883,56 |
| Saldo a favor total | $674,15 | $674,15 | $674,15 |
| Pagado de más | $4.969,71 **escondido** (16 clientes) | $4.969,71 **visible** | $2.007,02 (A_40, Carlos Escalona, Adalberto Rojas y Beatriz Landadeta: deciden caja y administración) |
| Clientes cuyo saldo guardado no coincide con sus movimientos | 0 | 0 | — |

La deuda sube $195,34 con las correcciones: $195 de Encendo y $0,34 de El Gran Adonay.

### 2.2 Los 16 clientes con pagado de más escondido

| Cliente | Hoy (escondido) | Con correcciones simuladas | Qué falta |
|---|---|---|---|
| Decoraciones Encendo | $1.949,00 | $0; **debe $195** y conserva $4,30 a favor | Administración: anular el Cruce "NO PROCEDE" ($2.144) |
| ADALBERTO ROJAS | $1.051,00 | $1.051,00 | Caja: origen de los pagos |
| Ferrechuros 2025 | $810,00 | $0 | Aprobar N4 |
| A_40, C.A | $600,00 | $600,00 | Caja |
| CARLOS ESCALONA | $356,00 | $356,00 ($0 si se anula el abono duplicado) | Caja |
| JONNY Espinoza | $66,25 | $0 | Aprobar N4 |
| Jesus Daniel Chirinos Camacho | $37,50 | $0 | Aprobar N4 |
| Ernesto Daniel Castilla Alastre | $31,50 | $0 | Aprobar N4 |
| Georgina Gomez | $24,38 | $0 | Aprobar N4 |
| Leidy Contreras | $15,75 | $0 | Aprobar N4 |
| Héctor Jordan | $9,57 | $0 | Aprobar N4 |
| FERRETERIA EL GRAN ADONAY | $7,76 | $0; **debe $0,34** | Aprobar N4 |
| Dayimar Mercado | $5,50 | $0 | Aprobar N4 |
| Manuel Veliz | $3,38 | $0 | Aprobar N4 |
| Anthony Ruiz | $2,10 | $0 | Aprobar N4 |
| Beatriz Landadeta | $0,02 | $0,02 ($0 si se anulan los 2 abonos de prueba) | Administración |

### 2.3 Clientes cuya deuda depende de una decisión de caja o administración

| Cliente | Debe hoy | Si se confirma | Caso |
|---|---|---|---|
| INVERSIONES SOLIDERE | $34.188,00 | $34.266 si el Zelle de $78 era de REYKAR | OP-043 |
| Juan Carlos Medrano | $5.851,75 | Entre $1.715,69 y $8.851,75 (USDT del #3401 y posible doble conteo de $3.000) | OP-044 |
| Angel Pineda | $4.002,10 | $449,60 si llegó el Zelle de $3.557,50 | OP-044 |
| CONSTRUACERO LOS GUAYOS | $1.345,50 (y $450 a favor) | $1.700,50 y $0 a favor si lo donado no da crédito | OP-046 |
| REYKAR | $748,46 | Hasta $1.748,46 si uno de los dos $1.000 es repetido; ±$78 por el Zelle compartido | OP-044 |
| INVERSIONES Y SUMINISTRO YAHVEH | $313,43 | $0 si llegó el abono de $313,43 por Binance | OP-047 |
| YHOEL SANCHEZ | $0 | +$500 si uno de los dos abonos de $500 es repetido | OP-044 |
| CARLOS ESCALONA / ADALBERTO ROJAS | $0 | Ver 2.2 | OP-041 |

## 3. Limpieza

- Escenarios temporales (`escenario047`, `escenario042`): borrados, **0 restos**.
- Vendedor temporal de OP-057: borrado.
- Operador temporal "OP042 Admin Prueba": **desactivado y con sus sesiones cerradas, no borrado**. Tiene a su nombre 2 movimientos de inventario del intercambio de prueba de OP-054 y sus anotaciones de auditoría, que son historial y no deben borrarse. Si se vuelve a usar `op042-operador-prueba.mjs crear`, quizá haya que cambiar el nombre del operador.
- En el inventario de staging quedaron 10 unidades menos de "ALAMBRE GALVANIZADO CALIBRE 18" por ese intercambio de prueba.
- Servidores locales de staging: apagados.

## 4. Qué falta (decisiones tuyas)

1. **Pasar a producción** todo lo de OP-049 a OP-057. Necesita:
   - un caso propio;
   - aplicar en producción las migraciones 301 a 308 (en orden, con sus reversas listas);
   - publicar el código (solicitud de cambio en GitHub) y probar después de publicar.
2. **Correcciones de datos** (cada una con su aprobación):
   - N4: guion listo, `op056_n4_correccion.sql`;
   - Encendo: anular el Cruce "NO PROCEDE";
   - Los Guayos: decidir si lo donado da crédito;
   - y los casos de caja de la tabla 2.3.
3. Revisar con administración los **378 despachos anulados con pagos anotados** ([OP-052](OP-2026-052_reabrir-anular-sin-perder-pagos-staging.md)).
4. Borrar en supabase.com la llave de producción `sbp_…` que se pegó en el chat.

Sin publicar en GitHub: no hay solicitud de cambio ni commit.
