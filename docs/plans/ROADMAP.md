# Roadmap: Adaptación al Flujo Real del Negocio

> Proveedor → Admin (inventario) → Vendedor (cotización) → Cliente paga → Admin (aprueba despacho) → Logística (entrega)

## Planes Futuros y Pendientes

- [ ] **[PLAN_EDICION_FECHA_ENTREGA_DESPACHOS.md](./PLAN_EDICION_FECHA_ENTREGA_DESPACHOS.md)**: Plan futuro para corregir la fecha efectiva de entrega sin modificar correlativos, montos ni historial financiero. La integración queda pendiente de preflight, migraciones 241/242 explícitas, hardening de permisos, auditoría append-only y aprobación DBA. Ver también `PLAN_FINAL_CAMBIO_FECHA_ENTREGA_DESPACHOS.md`.

- [ ] **[2026-08-28-plan-cortesia-absorbe-diferencia.md](./2026-08-28-plan-cortesia-absorbe-diferencia.md)**: Plan futuro de la cortesía "Empresa absorbe la diferencia" en devolución parcial: toggle solo admin/jefe que evita crear el cargo en CxC, threading aditivo `p_cortesia` por la cadena de RPCs (con lecciones 42725), auditoría dedicada, E2E con caso 403 y despliegue DB-primero con rollback.

- [x] **[2026-08-28-plan-comision-split-cliente-ajeno.md](./2026-08-28-plan-comision-split-cliente-ajeno.md)**: Comisión split por cliente ajeno los sábados (0.5% vendedor / 1.5% dueño, configurable): **implementado en staging** (migración 257, fila por beneficiario `UNIQUE(despachoid, vendedorid)`, funciones 238b multi-fila, Worker + UI, E2E 111/111 ×2). Pendiente: promoción al principal con release `03` + rollback ya preparados (sin aplicar).

- [ ] **[2026-08-28-plan-promocion-split-principal.md](./2026-08-28-plan-promocion-split-principal.md)**: Runbook completo de promoción del split a producción (10 fases): preflight del principal ya ejecutado con 4 hallazgos (trigger guard 238b ausente, rollback a reconstruir con cuerpos vivos, ports de Worker/frontend pendientes, bug latente de recálculo que el 03 corrige), activación controlada con `comision_split_activo=false` y rollback por fase.

---

- [ ] **[2026-08-28-plan-fixes-comisiones-saldo-favor-cod.md](./2026-08-28-plan-fixes-comisiones-saldo-favor-cod.md)**: Plan corregido (v2, auditado) de dos fixes financieros: filtro de comisiones por `creadoen` y tipo contable `consumo_credito` para el saldo a favor en ventas COD (elimina el doble descuento que bloquea la conciliación). 8 piezas: migración 258 staging / release 04 principal (CHECK + triggers), Worker (cxcUtils, despachos, cxc), frontend, script de saneamiento Rosa Sánchez (#2697), E2E C1–C7. Incluye 10 riesgos con mitigaciones y rollback de 2 niveles. **Staging validado** (E2E 111/111 ×2, smoke C1–C4, vitest 235/235, preflight del principal ejecutado: 1 solo caso legacy = Rosa #2697). Pendiente de promoción.
- [ ] **[2026-08-28-runbook-promocion-04-consumo-credito.md](./2026-08-28-runbook-promocion-04-consumo-credito.md)**: Runbook listo para ejecutar la promoción del release 04 al principal cuando autorice: 8 fases (backup → rollback con cuerpos vivos → SQL en transacción → postflight/smoke → saneamiento Rosa #2697 → Worker → frontend → verificación E2E), criterios GO/NO-GO por fase, rollback por fase y bitácora de ejecución.

## Bitácora de cambios

### 2026-04-25 — Fase 4 completada

**Venta Rápida (cotización + despacho atómico)**
- Endpoint `POST /api/ventas-rapidas/crear` en worker.js: crea cotización (estado `aceptada`) + despacho (estado `pendiente`) en un solo paso
- Hook `useVentaRapida.js`: mutation con invalidación de caches + push notification
- Vista `VentaRapidaView.jsx`: wizard 3 pasos (productos → pago → confirmar)
- Ruta `/venta-rapida` visible solo para vendedor y supervisor
- Navegación: sidebar + BottomNav con icono Zap, filtro `onlyRoles`

### 2026-04-25 — Fase 3 completada

**3.1 Dashboard de vendedor**
- MetricCard extraído a `src/components/ui/MetricCard.jsx` (6 temas de color, soporte onClick)
- Cards: Facturado mes, Esperando respuesta, Pendientes aprobación (gold), Comisiones pendientes (emerald)
- Secciones: desglose por estado + comisiones (sin cambios)

**3.2 Dashboard de administración**
- Cards: Despachos por aprobar (gold, clickable→/cotizaciones), CxC total (bug corregido), Stock bajo (red), Ventas del día (emerald, sub: semana)
- Sección: lista "Stock bajo" con barras de progreso + accesos rápidos
- Bug fix: `cxcResumen?.totalDeuda` → `cxcResumen?.kpis?.totalDeuda`

**3.3 Dashboard de logística**
- Migration `064_logistica_rls_despachos.sql`: política SELECT para logística en `notas_despacho`
- Hook `useDashboardMetrics.js`: queries paralelas por rol con staleTime 5min
- Cards: Entregas pendientes (blue), Entregadas hoy (emerald)
- Sección: "Próximas entregas" con datos de cliente (via `/api/clientes/lookup`)
- PageHeader: subtítulo "Centro de entregas", sin botón "Nueva"

### 2026-04-25 — Fase 2 completada

**2.1 Rol logística en DB + backend**
- Migración `063_rol_logistica.sql`: `logistica` agregado al CHECK constraint de `usuarios.rol`
- `worker.js` → `getOperatorRole()`: reconoce logística; `handleActualizarEstadoDespacho`: logística solo puede marcar `entregada`
- Navegación (sidebar + BottomNav): logística ve solo Inicio + Entregas

**2.2 Vista de logística**
- `DespachosView.jsx`: título "Entregas", filtros reducidos (Por entregar, Entregadas)
- `DespachoCard.jsx`: `canEntregar` incluye logística, botón "Marcar entregada"
- `useDespachos.js`: logística ve solo despachos `despachada` y `entregada`
- `despachoActions.js`: acciones de logística (solo entregar)

**2.3 Etiquetas contextuales por rol**
- `src/utils/estadoLabels.js` — `getDespachoLabel(estado, rol)`, `getFiltrosDespacho(rol)`
- `EstadoBadge.jsx` reescrito: acepta `rol` y muestra etiquetas contextuales
- DespachoCard, DespachoRow: pasan `rol` al EstadoBadge
- DespachosView: usa `getFiltrosDespacho()` dinámico

### 2026-04-25 — Fase 1 completada

**1.1 Campo de referencia de pago en despacho**
- Migración `062_despacho_referencia_pago.sql` ejecutada: columnas `referencia_pago` y `forma_pago_cliente` en `notas_despacho`
- `worker.js` → `handleCrearDespacho`: acepta y guarda `referenciaPago` y `formaPagoCliente`
- `useDespachos.js` → `useCrearDespacho`: pasa los nuevos campos al worker
- `CotizacionesView.jsx` → `ModalDespachar`: nuevos campos "Forma de pago del cliente" (select) y "Referencia / comprobante" (input)

**1.2 Admin aprueba despachos**
- `worker.js` → `handleActualizarEstadoDespacho`: cambiado de `requireSupervisor: true` a `requirePrivileged: true` (supervisor + admin pueden cambiar estado)
- `useCotizaciones.js`: admin ahora accede a tabla `cotizaciones` directamente (como supervisor) en vez de vista restringida

**1.3 Vista de despachos para admin**
- `AppLayout.jsx` y `BottomNav.jsx`: cotizaciones visible para admin con label "Despachos" via `labelByRole`
- `CotizacionesView.jsx`: título "Despachos" para admin, filtros por estado de despacho (Por aprobar, Aprobados, Entregados, Anulados), oculta botón "Nueva", solo muestra cotizaciones con despacho
- `CotizacionCard.jsx`: nuevo prop `onCambiarEstadoDespacho`, admin ve botones "Aprobar despacho" (→ despachada), "Marcar entregada" (→ entregada), "Anular" (→ anulada). Oculta acciones de cotización para admin. Muestra vendedor para admin.

---

## Fase 1 — Flujo de Aprobación Real (Alta prioridad) [COMPLETADA]

**Objetivo:** Que administración apruebe despachos y se registre la referencia de pago del cliente.

### 1.1 Campo de referencia de pago en despacho

**Por qué:** El cliente paga antes del despacho. Se necesita registrar comprobante/referencia.

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/062_despacho_referencia_pago.sql` | `ALTER TABLE despachos ADD COLUMN referencia_pago TEXT, ADD COLUMN forma_pago_cliente TEXT;` |
| `worker.js` → `handleCrearDespacho` | Aceptar `referencia_pago` y `forma_pago_cliente` en el body, guardarlos en INSERT |
| `src/components/cotizaciones/DespachoModal.jsx` | Agregar campos: forma de pago (select) y referencia (input) al formulario de crear despacho |
| `src/components/cotizaciones/DespachoTimeline.jsx` | Mostrar referencia de pago si existe |
| `src/components/pdf/despachoPDF.js` | Incluir referencia de pago en la Nota de Entrega |

**Criterio de aceptación:**
- Al crear despacho, el vendedor puede registrar forma de pago y referencia del cliente
- La referencia aparece en el timeline y en el PDF

### 1.2 Administración aprueba despachos (estado `despachada`)

**Por qué:** En el flujo real, administración revisa el pago y autoriza el despacho. Actualmente solo supervisor puede marcar `despachada`.

| Archivo | Cambio |
|---------|--------|
| `worker.js` → `handleActualizarEstadoDespacho` | Cambiar validación: `despachada` puede ser marcada por `supervisor` O `administracion` |
| `worker.js` → `handleActualizarEstadoDespacho` | `entregada` puede ser marcada por `supervisor`, `administracion` o futuro rol `logistica` |
| `src/views/CotizacionesView.jsx` | Ya está oculta para admin — **revertir**: admin necesita ver despachos pendientes para aprobarlos |
| `src/components/cotizaciones/CotizacionCard.jsx` | Admin ve botón "Aprobar despacho" (marcar despachada) en despachos `pendiente` |
| `src/components/cotizaciones/DespachoTimeline.jsx` | Admin ve botón para cambiar estado a `despachada` |

**Criterio de aceptación:**
- Admin ve cotizaciones con despacho pendiente
- Admin puede marcar `despachada` (genera comisión)
- Admin puede marcar `entregada`
- Vendedor NO puede cambiar estados del despacho (solo crear)

### 1.3 Vista de despachos para administración

**Por qué:** Admin necesita una forma rápida de ver qué despachos están pendientes de aprobación.

| Archivo | Cambio |
|---------|--------|
| `src/views/CotizacionesView.jsx` | Habilitar para admin con filtro por defecto: "Con despacho pendiente" |
| `src/components/cotizaciones/CotizacionCard.jsx` | Para admin: ocultar acciones de cotización (enviar, editar), mostrar solo acciones de despacho |
| Sidebar/navegación | Admin ve "Despachos" en vez de "Cotizaciones" como label del menú |

**Criterio de aceptación:**
- Admin entra a la sección y ve despachos pendientes de aprobación
- Puede filtrar por estado del despacho
- Puede aprobar (marcar despachada) directamente desde la lista

---

## Fase 2 — Rol de Logística (Media prioridad) [COMPLETADA]

**Objetivo:** Separar la entrega física del flujo administrativo.

### 2.1 Crear rol `logistica` en la base de datos

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/063_rol_logistica.sql` | `ALTER TABLE operadores ADD CONSTRAINT ... CHECK (rol IN ('vendedor','supervisor','administracion','logistica'));` o actualizar el CHECK existente |
| `worker.js` → `validateOperator` | Agregar `logistica` como rol válido |
| `worker.js` → rutas | Definir qué puede hacer logística: ver despachos despachados, marcar entregada |
| `src/store/useAuthStore.js` | Reconocer rol `logistica` |

### 2.2 Vista de logística

| Archivo | Cambio |
|---------|--------|
| `src/views/LogisticaView.jsx` (nuevo) | Lista de despachos `despachada` asignados/todos, con botón "Marcar entregada" |
| `src/components/layout/Sidebar.jsx` | Mostrar "Entregas" para rol logística |
| `src/App.jsx` o router | Ruta `/logistica` protegida por rol |

**Contenido de la vista:**
- Lista de despachos con estado `despachada` (listos para entregar)
- Cada item muestra: cliente, dirección, productos, referencia de pago
- Botón "Marcar entregada" → cambia estado a `entregada`
- Acceso al PDF de Nota de Entrega
- Filtro por fecha

### 2.3 Etiquetas de estado contextuales por rol

**Por qué:** "Pendiente" no significa lo mismo para todos. Para el vendedor es "esperando aprobación", para admin es "por aprobar", para logística es irrelevante.

| Archivo | Cambio |
|---------|--------|
| `src/utils/estadoLabels.js` (nuevo) | Mapa de etiquetas por estado × rol |
| Componentes que muestran estado | Usar `getEstadoLabel(estado, rol)` en vez de string directo |

Mapa propuesto:

| Estado despacho | Vendedor ve | Admin ve | Logística ve |
|----------------|-------------|----------|-------------|
| `pendiente` | Esperando aprobación | Por aprobar | — |
| `despachada` | Aprobada | Aprobada - En entrega | Por entregar |
| `entregada` | Entregada | Entregada | Entregada |
| `anulada` | Anulada | Anulada | Anulada |

**Criterio de aceptación:**
- Cada rol ve etiquetas que reflejan SU responsabilidad
- Los colores se mantienen consistentes (pendiente=amarillo, despachada=azul, entregada=verde, anulada=rojo)

---

## Fase 3 — Dashboards y UX Polish (Prioridad normal) [COMPLETADA]

**Objetivo:** Que cada rol tenga una vista inicial útil con métricas relevantes.

### 3.1 Dashboard de vendedor

| Métrica | Fuente |
|---------|--------|
| Cotizaciones enviadas (pendientes de pago) | `cotizaciones WHERE estado = 'enviada'` |
| Despachos pendientes de aprobación | `despachos WHERE estado = 'pendiente'` |
| Comisiones del mes | `comisiones WHERE mes actual` |
| Clientes con deuda | `clientes WHERE saldo_pendiente > 0` |

### 3.2 Dashboard de administración

| Métrica | Fuente |
|---------|--------|
| Despachos por aprobar | `despachos WHERE estado = 'pendiente'` (acción requerida) |
| Total CxC | `SUM(saldo_pendiente)` |
| Inventario bajo stock | `productos WHERE stock < stock_minimo` |
| Ventas del día/semana | `despachos WHERE estado IN ('despachada','entregada')` |

### 3.3 Dashboard de logística

| Métrica | Fuente |
|---------|--------|
| Entregas pendientes | `despachos WHERE estado = 'despachada'` |
| Entregas del día | `despachos WHERE estado = 'entregada' AND hoy` |
| Próximas entregas | Lista ordenada por fecha |

### 3.4 Implementación

| Archivo | Cambio |
|---------|--------|
| `src/views/DashboardView.jsx` (nuevo) | Componente que renderiza dashboard según rol |
| `src/components/dashboard/` (nuevo dir) | Widgets reutilizables: StatCard, PendingList, ChartWidget |
| `src/hooks/useDashboard.js` (nuevo) | Hook con queries específicas por rol |
| `worker.js` | Endpoint `/api/dashboard?rol=X` con datos agregados |
| Router + Sidebar | Dashboard como vista por defecto al iniciar sesión |

---

## Fase 4 (Opcional) — Venta Rápida [COMPLETADA]

**Objetivo:** Para clientes recurrentes que no necesitan cotización formal.

### Flujo propuesto:
1. Vendedor selecciona cliente → "Venta rápida"
2. Selecciona productos y cantidades (mismo UI del carrito de cotización)
3. Registra pago del cliente (forma + referencia)
4. Se crea cotización + despacho en un solo paso (estado: `pendiente`)
5. Admin aprueba → flujo normal

### Implementación:
| Archivo | Cambio |
|---------|--------|
| `worker.js` | Nuevo endpoint `POST /api/venta-rapida` que crea cotización (enviada→aceptada) + despacho (pendiente) atómicamente |
| `src/views/VentaRapidaView.jsx` (nuevo) | Wizard: cliente → productos → pago → confirmar |
| Sidebar | Botón "Venta rápida" visible para vendedores |

---

## Resumen de migraciones SQL

| # | Migración | Fase |
|---|-----------|------|
| 062 | `referencia_pago` y `forma_pago_cliente` en despachos | 1 |
| 063 | Rol `logistica` en operadores | 2 |
| 064 | Tabla `dashboard_cache` (opcional, para métricas precalculadas) | 3 |

## Orden de ejecución recomendado

```
Fase 1 (1-2 días)
├── 1.1 Campo referencia de pago
├── 1.2 Admin aprueba despachos
└── 1.3 Vista despachos para admin

Fase 2 (2-3 días)
├── 2.1 Rol logística en DB + backend
├── 2.2 Vista de logística
└── 2.3 Etiquetas contextuales

Fase 3 (2-3 días)
├── 3.1 Dashboard vendedor
├── 3.2 Dashboard admin
├── 3.3 Dashboard logística
└── 3.4 Integración

Fase 4 (1-2 días, opcional)
└── Venta rápida
```

## Principios

- **Zero deuda técnica**: cada fase se completa con tests, migración limpia y deploy antes de pasar a la siguiente
- **Incremental**: cada fase es funcional por sí sola, no deja el sistema en estado inconsistente
- **Rol-first**: toda UI se diseña pensando en qué necesita VER y HACER cada rol
- **Mobile-first**: todas las vistas deben funcionar bien en móvil (los vendedores usan teléfono)
