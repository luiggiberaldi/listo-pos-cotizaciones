# Plan de fixeo E2E — Comisiones sin flujo de pago

**Fecha:** 22/08/2026  
**Estado:** PLANIFICADO — no ejecutado  
**Prioridad:** P0/P1  
**Alcance:** proyecto principal y promoción controlada a staging  
**Referencia:** auditoría E2E de la pantalla Reportes → Comisiones y del bundle publicado

## 1. Objetivo

Dejar el módulo de comisiones alineado con la regla de negocio vigente:

- Las comisiones se registran como **generadas**.
- Las operaciones CxC **no forman parte automática de la comisión**.
- El administrador puede colocar manualmente `Comisión CxC` y `Descuento Carro` en el reporte resumido.
- No existe flujo de pago, liberación CxC ni estados de comisión `pendiente`, `pagada` o `cta_cobrar` para operar desde la UI.
- El PDF resumido y la tabla en pantalla deben usar la misma fórmula:

```text
Total a pagar = Comisión del período + Comisión CxC manual - Descuento Carro manual
```

El plan corrige primero la inconsistencia de código desplegada y después habilita la aplicación segura de la migración SQL 238.

## 2. Hallazgos que bloquean

| ID | Severidad | Hallazgo | Impacto |
|---|---|---|---|
| F-01 | P0 | `ReportesView.jsx` contiene un cierre JSX `)}` sobrante alrededor de las tarjetas de vendedores. | Texto `)}` visible y estructura visual rota. |
| F-02 | P0 | Reportes todavía renderiza `Pagar Todo ($0.00)` en vendedores internos y externos. | La UI ofrece una acción que ya no existe en el Worker. |
| F-03 | P0 | `ComisionesView.jsx` conserva `Pagar Todo`, `Pagar Seleccionados`, `Liberar CxC` y modales de confirmación. | El usuario puede intentar llamar endpoints retirados y recibe 404. |
| F-04 | P1 | `ComisionesView.jsx` usa `marcar`, `liberar`, `onPagarTodo`, `marcando`, `onLiberarCxc` y `onMarcarPagada` sin contratos válidos. | Errores ESLint y posibles fallos de runtime. |
| F-05 | P1 | `TabLiquidacion.jsx` importa `useMarcarComisionPagada`, hook eliminado del módulo principal. | Contrato roto entre componente y hook. |
| F-06 | P1 | `TesterFlowView.jsx` todavía intenta `POST /api/comisiones/pagar`. | El E2E histórico prueba una capacidad retirada. |
| F-07 | P1 | Persisten filtros y KPIs de `pendiente`/`pagada`/`por pagar`. | La interfaz contradice la regla de negocio. |
| F-08 | P2 | `comisionesPDF.js`, `AuditoriaView`, `DashboardView` y reportes auxiliares conservan referencias legacy. | Datos y etiquetas inconsistentes entre módulos. |
| F-09 | P1 | La migración 238 aún no está aplicada en la base. | Las nuevas comisiones todavía pueden generarse con CxC incluida y estados legacy. |
| F-10 | P1 | La copia `construacero-staging` conserva una versión anterior del flujo de pago. | Puede reintroducir el defecto durante una promoción o prueba. |

## 3. Regla de alcance

### Se elimina únicamente del dominio de comisiones

- Pago de comisión individual y masivo.
- Liberación manual de CxC de comisión.
- Cambio manual de estado de comisión.
- Filtros y badges `pendiente`, `pagada`, `cta_cobrar` asociados a comisiones.
- Campos operativos de pago usados por el frontend: `montopagado`, `pagadaen`, `pagadapor`, `comision_liberada`, `comision_retenida`.
- Pruebas que intenten marcar una comisión como pagada.

### No se elimina

- `pendiente` de despachos.
- `saldo_pendiente` de clientes y cuentas por cobrar.
- `pendiente` de órdenes de compra, seguimiento operativo, recordatorios o cotizaciones.
- Auditoría histórica de pagos ya registrados.
- Columnas legacy de la base de datos en esta primera fase.

Las columnas históricas se conservan para no perder trazabilidad. La UI y el código nuevo dejarán de depender de ellas.

## 4. Orden de ejecución

### Fase 0 — Congelamiento y baseline local

**Acciones:**

1. Confirmar branch y estado del checkout.
2. Separar los cambios no relacionados que ya existen en el working tree.
3. Tomar baseline local de:
   - `npm test`.
   - `npm run build`.
   - ESLint de los módulos afectados.
   - búsqueda de referencias legacy.
   - hashes de bundles locales y publicados.
4. No ejecutar escrituras contra Supabase ni deploy.

**Gate:** se conserva la evidencia del estado previo y no se descartan cambios ajenos.

### Fase 1 — Fuente de verdad del dominio de comisiones

**Objetivo:** fijar los contratos antes de editar componentes.

**Decisiones:**

- Estado nuevo: `generada`.
- Base automática: `totalcomision` proveniente de la RPC vigente después de 238.
- Ajustes manuales solo en memoria de la pantalla y en la generación del PDF, salvo que exista una persistencia administrativa explícita ya aprobada.
- Fórmula única:

```js
const totalPagar = comisionPeriodo + comisionCxcManual - descuentoCarroManual
```

**Contrato de datos mínimo para la UI:**

```text
id
vendedor: { id, nombre, color, rol, es_externo, markup_pct }
totalcomision
comisioncabilla
comisionotros
creadoen
despacho/cotizacion para detalle
estado: generada
```

**Gate:** ningún cálculo de pantalla o PDF depende de `montopagado`, `comision_liberada` o `comision_retenida`.

### Fase 2 — Reparación de `ReportesView`

**Acciones:**

1. Eliminar ambos bloques `Pagar Todo` de las tarjetas de vendedores.
2. Eliminar el `)}` sobrante y reconstruir el cierre JSX de ambos mapas.
3. Retirar el mensaje que anuncia controles internos de pago.
4. Retirar el filtro visual de estados `Pendientes` y `Pagadas`; dejar únicamente `Todas` si el backend todavía acepta un filtro neutro.
5. Cambiar KPIs:
   - `Total Periodo` o `Comisión Generada`.
   - eliminar `Pendiente USD`.
   - eliminar `Total Pagado`.
6. Asegurar que las tarjetas muestran comisión generada, no saldo pendiente.
7. Mantener los campos manuales de CxC y Descuento Carro solo en el formato resumido.
8. Verificar que cada vendedor usa la misma cifra que alimenta `TablaLiquidacionInteractiva`.

**Gate visual:** cero botones o textos de pago en la pestaña Comisiones de Reportes y cero texto `)}`.

### Fase 3 — Reparación de `ComisionesView`

**Acciones:**

1. Retirar imports y usos de `useMarcarComisionPagada` y `useLiberarComisionCxc`.
2. Eliminar estados React de:
   - comisión seleccionada para pagar;
   - comisión a liberar;
   - pago masivo;
   - progreso de pago.
3. Eliminar props `onPagarTodo`, `onMarcarPagada`, `onLiberarCxc`, `marcando` y `liberando`.
4. Eliminar checkboxes de selección y acciones de la tabla.
5. Reemplazar `Saldo Pendiente`, `Pagado`, `Reg`, `CxC` y badges legacy por:
   - Comisión generada.
   - Comisión CxC manual, solo si la vista resumida lo requiere.
   - Detalle de operación.
6. Mantener exportación PDF y expansión de detalle.
7. Cambiar el filtro inicial de `pendiente` a filtro neutro.
8. Eliminar los tres `ConfirmModal` de pago/liberación.

**Gate de código:** el archivo compila sin identificadores undefined y no contiene acciones de pago.

### Fase 4 — Limpieza de consumidores secundarios

**Archivos prioritarios:**

- `src/components/reportes/TabLiquidacion.jsx`
- `src/views/TesterFlowView.jsx`
- `src/views/AuditoriaView.jsx`
- `src/views/DashboardView.jsx`
- `src/views/ReporteVendedoresView.jsx`
- `src/hooks/useReporteVentas.js`
- `src/hooks/useReporteVendedores.js`
- `src/hooks/useReporteLiquidacion.js`
- `src/hooks/useDashboardMetrics.js`
- `src/services/pdf/comisionesPDF.js`
- `src/components/reportes/KpiCards.jsx`

**Acciones:**

1. `TabLiquidacion`: convertirlo a reporte histórico/generado o retirarlo de las rutas si está deprecated y no se consume.
2. `TesterFlowView`: eliminar los pasos de liberar/pagar comisión; reemplazarlos por asserts de creación con `estado='generada'` y `totalcomision` correcto.
3. `AuditoriaView`: conservar lectura histórica, pero marcar estados antiguos como históricos y no ofrecer acciones.
4. `DashboardView`: reemplazar métricas de pago por comisión generada, sin cambiar los pendientes operativos de despachos.
5. `ReporteVendedoresView` y `KpiCards`: eliminar etiquetas de comisión pagada/pendiente.
6. `comisionesPDF.js`: eliminar badges y cálculos legacy; usar estado informativo `GENERADA` cuando se muestre estado.

**Gate:** la búsqueda global del código principal no encuentra acciones de pago de comisiones, excepto documentación histórica y nombres explícitamente permitidos en auditoría legacy.

### Fase 5 — Contratos de API y Worker

**Acciones:**

1. Confirmar que el Worker no exporta ni enruta:
   - `/api/comisiones/pagar`;
   - `/api/comisiones/liberar-cxc`;
   - `/api/comisiones/estado`.
2. Confirmar que frontend no intenta llamar esas rutas.
3. Mantener únicamente endpoints read-only de lista y resumen.
4. Alinear las respuestas de lista/resumen con `generada`.
5. No borrar todavía handlers legacy en staging hasta que la copia de pruebas deje de referenciarlos; después se elimina de forma coordinada.

**Gate HTTP read-only:** las rutas retiradas responden 404 y lista/resumen responden 401 sin autenticación o 200 con sesión válida.

### Fase 6 — Migración SQL 238 en staging

**Precondiciones:**

- Backup de staging disponible y verificable.
- Baseline de conteos y suma de comisiones.
- Revisión de la migración por una persona responsable.
- Código de Fases 1–5 validado.

**Aplicación controlada:**

1. Aplicar 238 en staging.
2. Verificar existencia y firma de `calcularcomisiondespacho`.
3. Verificar constraint que acepta `generada`.
4. Crear un fixture de despacho con pago mixto que incluya CxC.
5. Confirmar que `totalcomision` solo usa el componente no-CxC.
6. Confirmar `estado='generada'`, `comision_retenida=0` y ausencia de liberación automática CxC.
7. Limpiar el fixture por Worker/RPC.
8. Comparar baseline post-prueba.

**Gate:** sin diferencias inesperadas en datos reales y todos los asserts del fixture en verde.

### Fase 7 — Tests y E2E

#### Tests unitarios/estáticos

Agregar o actualizar pruebas para:

- fórmula de total a pagar;
- ajustes CxC y Descuento Carro;
- vendedor sin ajustes;
- descuento mayor que comisión, según política definida;
- estado `generada`;
- ausencia de acciones de pago en componentes;
- ausencia de rutas de pago en llamadas frontend;
- contratos de lista/resumen.

#### Validación de build

Ejecutar en este orden:

```bash
npm test
npx eslint src/views/ReportesView.jsx src/views/ComisionesView.jsx src/hooks/useComisiones.js src/components/reportes/TabLiquidacion.jsx src/views/TesterFlowView.jsx
npm run build
```

El gate no se cierra si ESLint tiene errores, aunque Vite logre construir un bundle.

#### E2E autenticado en staging

1. Abrir Reportes → Comisiones.
2. Confirmar que no aparecen botones o filtros de pago.
3. Confirmar que no aparece `)}`.
4. Cambiar entre Detallado y Resumido.
5. Registrar Comisión CxC manual y Descuento Carro en al menos tres vendedores.
6. Comparar tabla y PDF:

```text
PDF.totalPagar === pantalla.comisionPeriodo + cxcManual - descuentoManual
```

7. Verificar vendedor interno, externo y vendedor sin movimientos.
8. Abrir ComisionesView y verificar detalle.
9. Ejecutar TesterFlowView sin pasos de pago.
10. Revisar consola y red: cero 404 de `/api/comisiones/pagar` y cero errores React.
11. Verificar limpieza de fixtures y baseline de datos.

**Gate E2E:** cero errores de consola, cero botones de pago, fórmula coincidente y cero fixtures residuales.

### Fase 8 — Deploy y promoción

1. Crear commit enfocado solo en este fix.
2. Construir el bundle final.
3. Desplegar Worker + frontend a staging.
4. Repetir smoke E2E autenticado.
5. Obtener aprobación del resultado.
6. Aplicar migración 238 en principal con backup previo.
7. Desplegar exactamente el artefacto validado.
8. Ejecutar smoke test post-deploy.
9. Registrar hashes de bundles, versión Worker, migración aplicada y conteos post-migración.

## 5. Rollback

### Código

- No promover si falla cualquier gate.
- Revertir únicamente el commit de este fix si el deploy rompe la UI.
- Mantener fuera del rollback los cambios no relacionados ya presentes en el checkout.
- Conservar el bundle/version ID anterior para restauración rápida.

### Base de datos

- La migración 238 debe aplicarse primero en staging.
- En principal requiere backup fresco y registro de hora.
- No borrar columnas legacy.
- Si la función nueva falla, restaurar la definición anterior de la RPC desde el backup/versionado SQL y validar nuevamente.
- No recalcular comisiones históricas automáticamente.

### Datos históricos

- No modificar comisiones ya existentes en esta fase.
- No convertir estados históricos automáticamente sin un plan separado.
- Las correcciones históricas de CxC quedan fuera de este paquete.

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Eliminar `pendiente` globalmente rompe despachos o CxC de clientes. | Limitar cambios a `comisiones.estado` y nombres de pago de comisión. |
| Reporte resumido y PDF usan fuentes distintas. | Crear helper o contrato único y test de igualdad por vendedor. |
| La copia staging reintroduce código legacy. | Comparar referencias antes de promover y usar el mismo commit validado. |
| Build pasa con errores de lint o bundle viejo. | Ejecutar ESLint y verificar hashes de `dist` antes del deploy. |
| Migración 238 calcula mal el pago mixto. | Fixture controlado con monto no-CxC y CxC, asserts matemáticos y rollback. |
| Usuarios ven una SPA cacheada. | `index.html` no-cache, assets versionados y refresh controlado en smoke. |
| Se pierden datos históricos al limpiar columnas. | No dropear columnas ni reescribir históricos en esta fase. |

## 7. Criterios de cierre

El fix se considera terminado únicamente cuando:

- [ ] No aparece `Pagar Todo`, `Pagar Seleccionados` ni `Liberar CxC` en el módulo de comisiones.
- [ ] No aparece `)}` ni errores React en Reportes.
- [ ] No existen identificadores undefined en ESLint de los módulos afectados.
- [ ] El frontend no llama endpoints de pago retirados.
- [ ] `TabLiquidacion` y `TesterFlowView` no dependen del flujo de pago.
- [ ] El PDF resumido coincide con la tabla para todos los vendedores probados.
- [ ] `npm test` pasa completamente.
- [ ] ESLint pasa sin errores.
- [ ] `npm run build` pasa desde el código actual.
- [ ] Staging valida `estado='generada'` y excluye CxC automática.
- [ ] Existe backup previo antes de principal.
- [ ] Smoke post-deploy pasa y queda documentado.

## 8. Siguiente paso operativo

El siguiente paso es ejecutar **Fase 0 y Fase 1 en el checkout**, corregir primero los contratos y la UI en el proyecto principal, sin tocar la base ni desplegar. Después se validará el conjunto completo antes de aplicar la migración 238 en staging.
