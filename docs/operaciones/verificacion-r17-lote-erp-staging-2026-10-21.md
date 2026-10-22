# Verificación en staging — Release 17 + Lote ERP (2026-10-21)

**En resumen:**
- **Release 17** (el inventario se descuenta al aprobar el despacho): probado a fondo en la interfaz de staging. **SÍ está listo para subir a producción**, con dos observaciones menores que no bloquean.
- **Lote ERP** (la pestaña Crédito/CxC de Reportes): probado en la interfaz. **NO está listo**: la mitad de sus indicadores muestra **$0.00 aunque hay datos reales**. Falta conectar el cálculo nuevo al reporte. Es un arreglo de código, no un problema de datos.
- Además quedó **confirmado en la interfaz** el arreglo del motivo de reapertura de despachos (el motivo ya se guarda).

---

## 1. Release 17 — qué se probó y resultados

Pruebas hechas **por la interfaz real** (aplicación en staging, operador "TEST R17 JEFE") contra la base de staging, con el despacho de prueba DES-03184 (3 und de "TEST R17 BUFFY"):

| # | Acción en la interfaz | Resultado | Verificado en |
|---|---|---|---|
| 1 | **Aprobar** despacho (pendiente → aprobada) | ✅ Stock 100→97, kardex `egreso "Despacho #3184 aprobado"`, lote de egreso creado, operador registrado | UI + base |
| 2 | **Editar productos** en pendiente (3 → 200 und) | ✅ Ítem y total actualizados ($30→$2000), con marca de quién editó; **stock intacto (100)** — el bug viejo de "editar mueve stock fantasma" ya no ocurre | UI + base |
| 3 | **Aprobar con stock insuficiente** (200 und vs 100 en stock) | ✅ El diálogo **avisa** ("stock bajo o insuficiente… puede quedar en negativo. ¿Aprobar de todas formas?"), la venta **nunca se bloquea**, stock 100→−100, kardex marcado `[STOCK NEGATIVO]`, y la tarjeta muestra **"STOCK INSUFICIENTE EN 1 ÍTEM(S)"** con el detalle en `alerta_stock_items` | UI + base |
| 4 | **Marcar entregada** | ✅ **No** toca inventario (sigue en 97) — la semántica nueva (egreso al aprobar, no al entregar) funciona | UI + base |
| 5 | **Reabrir despacho entregado** con motivo ("Cliente ausente") | ✅ Reingresa 3 und (97→100) con kardex `ingreso`, limpia lote y fecha de entrega, y **el motivo sí queda guardado** (antes se perdía — era el bug encontrado el 21-oct) | UI + base |
| 6 | **Devolver a pendiente desde aprobada** ("No entregado / Devolver", motivo "Dirección incorrecta") | ✅ Reingresa 200 und (−100→100) con kardex `ingreso "Despacho #3184 devuelto a pendiente"`, y **el motivo queda guardado** | UI + base |
| 7 | Inventario general | ✅ El chip "N comprometidas" **ya no existe**; cada tarjeta muestra el stock físico real | UI |
| 8 | Consola del navegador durante toda la sesión | ✅ Sin errores | UI |

**Observaciones menores (no bloquean):**
- **O1 · Fecha de aprobación:** al reaprobar un despacho devuelto, `despachada_en` conserva la fecha de la **primera** aprobación (el SQL usa `COALESCE(despachada_en, now())`), así que la tarjeta muestra una hora vieja. Criterio a decidir: ¿fecha primera o última aprobación?
- **O2 · Pago sin validación:** el modal "Editar despacho" aceptó un pago de **$200 para un despacho de $30** y lo guardó sin reclamar (la ficha quedó mostrando "Efectivo $ $200,00" con total $30). Falta validar que el pago no supere el total. *(Esto fue lo que ocurrió al tocar el formulario durante la prueba; el dato quedó así en el fixture de prueba #3184.)*

## 2. Lote ERP (Reportes → Crédito/CxC) — qué se probó y resultados

**Lo que SÍ funciona (UI):**
- La pestaña **Crédito** abre y renderiza: KPIs, antigüedad de deuda por tramos (0-30/31-60/61-90/90+), pestañas Resumen / Alertas / Clientes / Movimientos / Proveedores, botones de PDF (Resumen y Detallado).
- El **selector de rangos** funciona bien: Hoy → 21 oct, Sábado → 17 oct, Corte viernes–jueves → 09-15 oct, más Ayer / Esta semana / Este mes / Mes pasado / Personalizado.
- KPIs que sí tienen datos correctos: "Cobros en dinero" $337.55, "CxC al cierre" $30.00 (1 cliente con deuda), "Saldo a favor actual".
- Consola sin errores.

**Lo que NO funciona (hallazgo principal):**
- **KPIs "Saldo inicial (deuda)", "Cargos del período" y "Abonos aplicados" muestran $0.00** mientras que el libro real de cuentas por cobrar tiene **11 movimientos en octubre: cargos $367.55 y abonos $337.55**.
- El bloque **"Cuadre de movimientos"** muestra todo en $0.00 y remata con la etiqueta "Cuadre matemático; ledger no validado".
- La pestaña **"Movimientos (0)"** dice "Actividad CxC del período: 0" con 11 movimientos reales en el rango.
- En la tabla de Clientes, la fila muestra "CARGOS PERÍODO $367.55" pero "ABONOS PERÍODO $0.00", y sus columnas no cierran horizontalmente (367.55 − 0 ≠ 30.00 de saldo al cierre). El pie de la misma tabla dice "Cargos: $0.00 | Abonos: $0.00" contradiciendo la fila.

**Causa raíz (evidencia de código):** la nueva pantalla espera campos del resumen (`saldoInicial`, `saldoInicialNeto`, `saldoFinalNeto`, `totalCargos`, `totalAbonos`, `totalAbonosAjuste`, `totalAbonosSinClasificar`, `movimientosDelPeriodo`, `revisionesSaldoActual`…) que el hook del repositorio (`src/hooks/useCuentasCobrar.js` → `useResumenCxC`) **no produce** — entrega solo `totalDeuda`, `totalOtorgado`, `totalCobrado`, `totalSaldoFavorClientes`, `numClientesConDeuda`, `aging` y `alertasVencimiento`. Los campos faltantes caen en el respaldo `|| 0` y la pantalla muestra ceros falsos.

El cálculo correcto **ya existe y está probado** en el módulo puro `src/utils/cxcPeriodReport.js` (con sus 22+ pruebas en verde), **pero nada lo invoca**: `construirReportePeriodoCxC` no está conectado a la pantalla. Esto era exactamente el "riesgo 2" del plan de promoción, y la contingencia prevista (conectar el módulo sin tocar el hook viejo) **no se terminó de implementar**.

## 3. Otros hallazgos de menor cuantía
- **Fixture sucio:** el despacho #3180 de staging está insertado directamente como "despachada" sin lote de egreso (`egreso_lote_id` vacío) — es residuo de pruebas, no un bug (nunca pasó por la aprobación). Conviene limpiarlo antes del E2E de staging para que el invariante "toda despachada/entregada tiene lote" se cumpla.
- **Credencial de prueba:** para entrar a la interfaz se fijó un PIN de prueba al operador "TEST R17 JEFE" en la base de staging (es un fixture; no afecta a producción).
- El E2E completo de staging (123 pasos) sigue **bloqueado por credenciales** (faltan `STAGING_E2E_ANON_KEY` / service key de staging en el runner), según el runbook de cutover.

## 4. Veredicto para producción

| Bloque | ¿Listo? | Condiciones |
|---|---|---|
| **Release 17** (egreso al aprobar) | ✅ **SÍ** | Seguir el runbook ya documentado: backup verificable + restore probado, apply SQL con protocolo md5, backfill con operador real, **desplegar Worker + frontend juntos**, y smoke post-deploy. Las observaciones O1 y O2 pueden ir aparte. |
| **Lote ERP** (Reportes Crédito/CxC) | ❌ **NO** | Hay que conectar `construirReportePeriodoCxC` al resumen de CxC (o extender el hook para entregar esos campos) y volver a verificar que los KPIs y el Cuadre muestren cifras reales. Luego: pruebas en verde, build, y smoke visual. |
| Arreglo del motivo de reapertura | ✅ Confirmado en interfaz | Viaja junto al deploy del Worker. |

**Recomendación:** se puede planear la ventana de producción de **Release 17**. El **Lote ERP no debería subir en esa misma ventana** hasta cerrar el cableado del reporte; es un cambio separado y de bajo riesgo una vez arreglado.

## 5. Evidencia
- `evidencia-r17/01-inventario-sin-chip.png` — inventario sin el chip "comprometidas".
- `evidencia-r17/02-alerta-stock-negativo.png` — tarjeta con "STOCK INSUFICIENTE EN 1 ÍTEM(S)".
- `evidencia-r17/03-reporte-cxc-credito.png` — pestaña Crédito/CxC con los KPIs en cero.
- Detalle numérico del ledger de staging (octubre): 11 movimientos, cargos $367.55, abonos $337.55, saldo al cierre $30.00.

---

## 6. ACTUALIZACIÓN — El reporte Crédito/CxC quedó ARREGLADO y re-verificado (2026-10-21, tarde)

**En resumen:** el "enchufe" faltante ya está conectado. La pestaña Crédito/CxC muestra cifras
reales, el cuadre cierra y la tabla de clientes cuadra horizontalmente. El **Lote ERP pasa a
estado LISTO** — el veredicto del §4 queda desactualizado.

**Qué se hizo:** se creó el gancho `src/hooks/useReportePeriodoCxC.js` que trae los datos crudos
(clientes y el libro de cuentas por cobrar) y los pasa por el módulo probado
`src/utils/cxcPeriodReport.js`; la pestaña Crédito de `src/views/ReportesView.jsx` ahora consume
ese gancho. No se tocó el cálculo (que ya tenía 22+ pruebas) ni el gancho antiguo
`useCuentasCobrar.js` (la contingencia del plan de promoción se respetó).

**Re-verificación por la interfaz real** (`scripts/test-cxc-reporte-ui.mjs`: crea una cuenta y
datos de prueba con montos conocidos en staging, entra por la interfaz como un operador real y lo
limpia todo al salir) — 18 comprobaciones en verde:

| Qué se miró en pantalla | Resultado esperado (datos de prueba) | ¿Se vio? |
|---|---|---|
| KPI Saldo inicial (deuda) / Neto | $30.00 (cargo sep $40 − abono sep $10) | ✅ |
| KPI Cargos del período | $150.00 ($100 + $50 en octubre) | ✅ |
| KPI Abonos aplicados | $30.00 | ✅ |
| Cuadre de movimientos | 30 + 150 − 30 = 150, con "Saldo actual coincide" | ✅ |
| Pestaña Movimientos | 3 movimientos con +$100.00 / +$50.00 / −$30.00 | ✅ |
| Pestaña Clientes | fila con Saldo inicial $30 · Cargos $150 · Abonos $30 · Cierre $150 (¡ya cierra!) | ✅ |
| Consola del navegador | sin errores | ✅ |

Además: 673/673 pruebas en verde, compilación OK, ESLint sin errores.

**Hallazgos menores detectados durante la verificación (staging, no bloquean):**
1. La tabla `configuracion_negocio` de staging tiene la secuencia de IDs desincronizada (el ID 1
   existe pero la secuencia empieza en 1): cualquier alta directa de un usuario nuevo falla con
   "duplicate key". Hay que repararla (`setval`) en staging; el script de smoke lo esquiva
   creando primero la fila de configuración.
2. La base exige una **sesión de operador válida** (con PIN) para devolver datos: sin ella, las
   consultas responden vacías (0 filas) sin error. Es el diseño vigente (migración de sesiones de
   operador); conviene tenerlo presente al probar con cuentas nuevas.

**Estado actualizado del veredicto (§4):**

| Bloque | ¿Listo? | Condiciones |
|---|---|---|
| **Release 17** (egreso al aprobar) | ✅ **SÍ** | Igual que el §4 original. |
| **Lote ERP** (Reportes Crédito/CxC) | ✅ **SÍ** | Arreglado y re-verificado por interfaz el 21-oct. Viaja solo con la interfaz. |
| Arreglo del motivo de reapertura | ✅ Confirmado en interfaz | Viaja junto al deploy del Worker. |

**Plan de paso a producción de ambos bloques:**
`docs/plans/2026-10-21-plan-produccion-release17-lote-erp.md`.
