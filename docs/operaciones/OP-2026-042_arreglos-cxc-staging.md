# OP-2026-042 — Arreglos de Cuentas por Cobrar para que no se repita lo de Decoraciones Encendo (en staging)

**Fecha:** 23 de noviembre de 2026
**Tipo:** cambio de código y de base de datos, **solo en staging** (la copia de pruebas, proyecto `spupqgkdsgohxxfoxydl`). **Producción no se tocó.**
**Sigue de:** [OP-2026-038](OP-2026-038_auditoria-codigo-cxc.md) (fallas G1, G3 e I1) y [OP-2026-041](OP-2026-041_casos-cxc-caso-por-caso.md) (caso Decoraciones Encendo).
**Estado:** construido y verificado en staging. **Falta pasarlo a producción**, con la aprobación de luigi.

## En resumen

- **Ya no se puede repetir lo de Decoraciones Encendo en staging.** Una devolución ahora ve también los pagos sin enlace a su despacho (por ejemplo, un "Cruce" hecho a mano) y avisa: *"Lo que este despacho tenía a crédito ya fue cubierto por este abono. ¿Era por esta misma devolución?"*. Si el operador dice que sí, el sistema anula ese abono en la misma operación y guarda una copia en la auditoría.
- **Los pagos de más ya se ven.** La ficha del cliente muestra **"Pagado de más: $X"** con una explicación, y el reporte de Crédito tiene una sección **"Pagos de más sin deuda"**: hoy son **16 clientes y $4.969,71**, los mismos de OP-2026-037.
- **Al registrar un abono se puede elegir qué despacho paga.** Así los pagos quedan enlazados y las devoluciones y anulaciones los ven sin adivinar.
- **Regla del Cruce:** si un abono usa "Cruce", el sistema exige escribir **contra qué se cruzó** y recuerda que las devoluciones se hacen desde la pantalla de devoluciones.
- **Todo se probó con datos reales copiados y en un navegador real:** 380 pruebas automáticas en verde, la aplicación compila, 20 de 20 comprobaciones en el navegador, y el caso Encendo reproducido en la base con resultado correcto.

## Qué cambió para el usuario

| Pantalla | Antes | Ahora |
|---|---|---|
| **Ficha del cliente** (pestaña Cuenta) | Un cliente con pagos de más aparecía "Sin deuda" y nada más | Aviso **"Pagado de más: $X"** arriba y un recuadro que explica qué significa y qué hacer |
| **Registrar abono** | No se podía decir qué despacho se pagaba | Lista **"¿Qué despacho paga? (recomendado)"** con cada despacho pendiente y cuánto le falta. Si el abono supera lo pendiente, avisa que el resto va a los más antiguos |
| **Registrar abono con "Cruce"** | Se podía cruzar sin explicar nada | Exige escribir **contra qué se cruzó** y recuerda usar la pantalla de devoluciones si el cliente devolvió mercancía |
| **Reporte → Crédito** | Los pagos de más no aparecían en ningún lado | Sección desplegable **"Pagos de más sin deuda"** con cada cliente, su vendedor, sus deudas, sus pagos y el exceso |
| **Devolución parcial** | Calculaba lo pendiente del despacho mirando solo los pagos enlazados, y podía descontar dos veces | Usa el **mismo reparto que la pantalla de CxC**. Si un abono manual ya cubrió el crédito, **avisa y deja elegir** si era esta misma devolución. El "Resultado esperado" muestra el efecto real antes de guardar |

## Cómo se comprobó

### 1. Una sola fórmula en todo el sistema

- La regla de "qué despacho está pagado" (abonos enlazados primero, luego los sueltos del más viejo al más nuevo) quedó en **un solo lugar** para las pantallas (`src/utils/cxcReparto.js`) y en **una función de la base** para las devoluciones (`cxc_reparto_cliente`).
- Se compararon las dos con **todos los datos de staging**: **211 cargos, 0 diferencias**.
- El reporte de CxC tenía **dos copias** de esa regla (falla M4). Ahora usa la compartida.

### 2. El caso Encendo, reproducido con sus datos reales

En la base de staging se volvió al momento justo antes de la devolución del 27-jul (cargo #1863 + "Cruce – NO PROCEDE") y se corrió la nueva lógica dentro de una operación que se deshace sola:

| | Lo que pasó en producción (lógica vieja) | Lógica nueva, sin confirmar | Lógica nueva, confirmando que el Cruce era la devolución |
|---|---|---|---|
| Debe | $0 (los $195 reales escondidos) | **$195** | **$195** |
| Saldo a favor | $4,30 | $2.148,30 (visible, administración lo nota) | **$4,30** (correcto) |
| Escondido (pagado de más) | **$1.949** | $0 | $0 |

### 3. Prueba de punta a punta en el navegador (Chromium)

- Se usó el programa [`verify-op042-cxc-staging.mjs`](../../construacero-staging/scripts/verify-op042-cxc-staging.mjs), con la aplicación corriendo en la PC conectada a staging y un operador temporal de administración.
- Para la devolución se creó un **escenario temporal** con un cliente "PRUEBA OP042 DEVOLUCION". Era un despacho a crédito de $634 con un "Cruce" suelto que lo cubría, copiado del despacho de prueba #3501, con artículos que no mueven inventario.

| Comprobación | Resultado |
|---|---|
| Encendo: "Pagado de más: $1949.00" y aviso explicativo | ✅ |
| Ferrechuros: "Pagado de más: $810.00" | ✅ |
| REYKAR: sin aviso; selector con "#3576 · pendiente $748.46 de $43850.00" | ✅ |
| Cruce: exige "contra qué se cruzó" y no deja confirmar sin eso | ✅ |
| Reporte: "Pagos de más sin deuda" con 16 clientes y $4.969,71 | ✅ |
| Devolución: aparece el aviso "ya fue cubierto por este abono" | ✅ |
| Sin confirmar: el resultado esperado manda los $340 a saldo a favor | ✅ |
| Confirmando el Cruce: deuda del despacho $634 → $294 y saldo a favor $0 | ✅ |
| Devolución registrada de verdad; el cliente de prueba debe **$294** y no hay pago de más | ✅ |
| La base quedó con: cargo $634 + abono por devolución $340, Cruce anulado y auditoría `ANULAR_ABONO_POR_DEVOLUCION` con copia completa del Cruce | ✅ |
| Sin errores de JavaScript | ✅ |

- Las capturas están en `tmp/op042/`, en la PC. No se suben a GitHub porque muestran clientes reales.
- **Limpieza:** se borraron el escenario temporal y el operador de prueba. Los 41 clientes copiados siguen **idénticos a producción** (0 diferencias, cartera $73.688,22).

### 4. Pruebas automáticas y compilación

- `npm --prefix construacero-staging test`: **44 archivos, 380/380 en verde** (19 nuevas: 13 de la fórmula compartida y 6 del servidor).
- `npm --prefix construacero-staging run build`: **OK**.

## Archivos

**Base de datos (staging):**
- [`supabase/migrations/300_staging_cxc_reparto_devoluciones.sql`](../../construacero-staging/supabase/migrations/300_staging_cxc_reparto_devoluciones.sql) (aplicada) y su [vuelta atrás](../../construacero-staging/supabase/migrations/300_staging_cxc_reparto_devoluciones_rollback.sql), que contiene los cuerpos anteriores copiados de la base.
- Contiene las funciones nuevas `cxc_reparto_cliente` y `cxc_pendiente_despacho`, la vista `v_cxc_pagado_de_mas` (respeta las reglas de acceso de quien consulta), los cambios en `ajustar_finanzas_devolucion_atomica` y el parámetro opcional `p_anular_abono_id` en `registrar_devolucion_parcial_cobro_staging` / `_idempotente`.

**Código (`construacero-staging/`):**
- `src/utils/cxcReparto.js` *(nuevo)* y `src/utils/__tests__/cxcReparto.test.js` *(nuevo)*
- `src/hooks/useCuentasCobrar.js`: `useResumenCuentaCliente`, reparto compartido y pagos de más en el reporte.
- `src/components/clientes/FichaClienteModal.jsx`: aviso de pago de más, selector de despacho y regla del Cruce.
- `src/views/ReportesView.jsx`: sección "Pagos de más sin deuda".
- `src/components/despachos/DevolucionParcialModal.jsx` y `src/hooks/useDespachos.js`: vista previa del servidor, aviso y anulación.
- `api/handlers/despachos.js`: nueva ruta `GET /api/despachos/devolucion-preview-cxc`, parámetro `anularAbonoId` y auditoría.
- `api/handlers/cxc.js`: el despacho elegido debe ser del cliente y de la cuenta.
- `worker.js`: ruta nueva.
- `api/handlers/__tests__/cxcReparto042.test.js` *(nuevo)*, `scripts/verify-op042-cxc-staging.mjs` *(nuevo)* y `scripts/op042-operador-prueba.mjs` *(nuevo)*.
- `README.md` de staging: apartado de estas pantallas.

**Programas de apoyo:** en [`OP-2026-040_scripts/`](OP-2026-040_scripts/): `gen_mig300.py`, `reparto.sql`, `prueba_g1.py` y `escenario042.py`.

## La regla de trabajo para administración (sin programar)

> Cuando un cliente devuelve mercancía, se usa **solo la pantalla de devoluciones del despacho**. Nunca un "Cruce" a mano para anular la deuda. El Cruce es para compensar algo real (por ejemplo, una deuda nuestra con el cliente) y siempre se escribe **contra qué** se cruzó.

La pantalla ya lo recuerda cada vez que se elige "Cruce".

## Pendiente / sin verificar

- **Pasar a producción:** aplicar el equivalente de la migración 300 al principal (allí las funciones tienen nombres y cuerpos distintos, así que hay que adaptarla) y copiar el código a la carpeta principal. Requiere la aprobación de luigi y su propio caso.
- **Hallazgo aparte (ya existía antes):** el registro de auditoría `DEVOLUCION_PARCIAL` **nunca se ha guardado**, ni en staging ni en producción (0 filas). El nuevo `ANULAR_ABONO_POR_DEVOLUCION` sí se guarda. Hay que revisar por qué falla el primero.
- **Fuera de este caso:** los demás pasos de OP-2026-038 (anulaciones G2, duplicados G4, registro atómico I2, revertir sin borrar I3 y regla de lectura por vendedor I4).
- **Los pagos de más que ya existen** (16 clientes) se ven, pero **no se corrigieron**. Eso depende de las decisiones de OP-2026-041.
- En la vista previa de la devolución, cuando se elige anular un abono, la cifra de "deuda del despacho" es una estimación (lo pendiente más lo que ese abono cubría). El cálculo final lo hace la base al guardar.
- Guardado en GitHub: pendiente.
