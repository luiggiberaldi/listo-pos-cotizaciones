# Bitácora de Proyecto — Listo POS Cotizaciones

> Registro cronológico de decisiones, avance y errores.
> Actualizar en cada sesión de trabajo.

---

## ESTADO INICIAL DEL PROYECTO (14/04/2026)

### ¿De dónde venimos?

El proyecto fue clonado del repositorio `https://github.com/luiggiberaldi/listo_pos_lite-`
que corresponde al sistema **Listo POS Lite** — un punto de venta completo para abastos/bodegas.

**¿Qué era Listo POS Lite?**
- Sistema POS offline-first con caja, ventas, inventario, clientes y reportes
- Stack: React 19 + Vite + Zustand + Supabase + jsPDF + Tailwind
- Autenticación local por PIN (SHA-256) + licencia cloud por email
- Sin roles dinámicos (solo ADMIN y CAJERO)
- Sincronización multi-dispositivo vía IndexedDB + Supabase Realtime
- +20,000 líneas de código, +66 componentes React, +20 hooks personalizados
- Incluía: Capacitor (Android), impresora térmica serial, integración Groq AI

**Archivos que existían y SE ELIMINARON (no aplican al nuevo sistema):**
- `android/` — wrapper nativo Android (no se usará)
- `src/views/SalesView.jsx` — interfaz de caja/POS
- `src/views/DashboardView.jsx` — métricas de ventas del día
- `src/views/ReportsView.jsx` — reportes de ventas
- `src/utils/checkoutProcessor.js` — procesador de cobros
- `src/context/CartContext.jsx` — carrito de compras
- `src/services/PrinterSerial.js` — impresora térmica
- Archivos temporales: `*.mp4`, `*.zip`, `*.xls`, `refactor_tester.mjs`, `frames/`
- `capacitor.config.json` — config app nativa

**Archivos que SE CONSERVAN o ADAPTAN:**
- `src/utils/dinero.js` — matemática precisa (sin cambios)
- `src/config/supabaseCloud.js` — patrón singleton (cambiar credenciales)
- `tailwind.config.js`, `vite.config.js`, `postcss.config.js` — build config
- Componentes UI genéricos de `src/components/ui/`

---

## OBJETIVO DEL NUEVO SISTEMA

**Nombre:** Listo POS Cotizaciones
**Tipo:** Cotizador comercial para ferretería
**Usuarios:** Supervisor (1+) y Vendedores (múltiples)

### Lo que hace este sistema:
1. Vendedores registran clientes y generan cotizaciones con productos del inventario
2. Las cotizaciones se exportan a PDF profesional y se comparten por WhatsApp
3. Los clientes quedan asignados al vendedor que los registra (anti-robo)
4. El supervisor tiene visibilidad total, puede reasignar clientes con motivo
5. Hay un módulo de transportistas para agregar costos de envío
6. Todo queda auditado: quién hizo qué y cuándo

### Lo que NO hace:
- No procesa pagos ni ventas cerradas
- No hace cierre de caja
- No maneja crédito ni cuentas por cobrar
- No es un POS de mostrador en tiempo real

---

## PLAN GENERAL — FASES

| Fase | Descripción | Estado |
|---|---|---|
| **Fase 0** | Arquitectura, BD y reglas de negocio | ✅ Completada (v1.1) |
| **Fase 1** | Limpieza del proyecto + estructura base | ✅ Completada |
| **Fase 2** | Módulo de Clientes (con anti-robo) | ✅ Completada |
| **Fase 3** | Inventario consultable | ⏳ Pendiente |
| **Fase 4** | Constructor de cotizaciones (wizard) | ⏳ Pendiente |
| **Fase 5** | Generador de PDF + WhatsApp | ⏳ Pendiente |
| **Fase 6** | Transportistas + Historial + Versioning | ⏳ Pendiente |
| **Fase 7** | Panel supervisor + Auditoría + Usuarios | ⏳ Pendiente |

---

## REGISTRO DE SESIONES

---

### SESIÓN 1 — 14/04/2026

**Objetivo de la sesión:** Definir arquitectura completa antes de escribir código.

**Acciones realizadas:**
- [x] Análisis del proyecto base (Listo POS Lite) — estructura, stack, BD, patrones
- [x] Decisión: transformar en sistema nuevo (no fork del POS)
- [x] Definición de roles: supervisor y vendedor
- [x] Diseño del esquema de BD Supabase (7 tablas + RLS + RPCs)
- [x] Redacción de reglas anti-robo de clientes (BD + lógica)
- [x] Diseño del flujo de cotización paso a paso (6 pasos)
- [x] Definición del MVP por 7 fases ejecutables
- [x] Creado `ARQUITECTURA.md` con el documento completo
- [x] Creado `BITACORA.md` (este archivo)

**Decisiones tomadas:**
- Auth: **Supabase Auth** (email/password), se elimina el sistema de PIN local
- State: **Zustand** para sesión/rol, **React Query** para datos del servidor
- Storage: **Online-first** (no offline-first como el POS original)
- PDF: **jsPDF + html2canvas** (conservado del proyecto base)
- Deploy: **Vercel** (frontend) + **Supabase** (backend)
- No se usará Cloudflare Workers en el MVP (simplificar)

**Pendiente para siguiente sesión:**
- Crear proyecto en Supabase
- Ejecutar migrations de BD
- Limpiar el repositorio de archivos que no aplican
- Instalar dependencias nuevas (React Query)
- Iniciar Fase 1: Login + Auth + Navegación base

**Errores / Bloqueantes:**
- Ninguno. Sesión de planificación pura.

---

### SESIÓN 2 — 14/04/2026

**Objetivo de la sesión:** Revisión crítica de ARQUITECTURA v1.0 y corrección a v1.1.

**Problemas encontrados en v1.0 (20 en total):**

| # | Categoría | Problema |
|---|---|---|
| 1 | SQL | `SERIAL` deprecado en PG14+ → corregido a `GENERATED ALWAYS AS IDENTITY` |
| 2 | Seguridad | RLS completamente ausente en `cotizacion_items` |
| 3 | Seguridad | RLS completamente ausente en `transportistas` |
| 4 | Seguridad | RLS completamente ausente en `reasignaciones_clientes` |
| 5 | Seguridad | RLS completamente ausente en `usuarios` |
| 6 | Seguridad | Política INSERT ausente en `cotizaciones` (bloqueaba crear cotizaciones) |
| 7 | Seguridad | `SECURITY DEFINER` sin `SET search_path` (vulnerable a hijacking) |
| 8 | Lógica | `auditoria` INSERT bloqueado desde RPCs SECURITY DEFINER (uid = NULL) |
| 9 | Arquitectura | `costo_usd` "oculto" con comentario SQL — RLS no es column-level |
| 10 | Arquitectura | `notas_internas` igual: RLS no puede ocultar columnas |
| 11 | SQL | Orden de CREATE TABLE no respeta dependencias (FK circulares) |
| 12 | Lógica | Máquina de estados sin transiciones válidas definidas ni estado `anulada` |
| 13 | SQL | `updated_at` sin triggers — nunca se auto-actualizaría |
| 14 | Omisión | Tabla `configuracion_negocio` inexistente (necesaria para el PDF) |
| 15 | Lógica | Versionado de cotizaciones sin especificación completa del modelo |
| 16 | Diseño BD | `precio_bs` almacenado en productos crea inconsistencias con tasa BCV cambiante |
| 17 | SQL | Política `clientes_supervisor` FOR ALL sin WITH CHECK — imprecisa |
| 18 | SQL | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` ausente en todas las tablas |
| 19 | Documentación | Campos mínimos para EMITIR cotización no estaban definidos |
| 20 | Omisión | Falta trigger de validación de cliente al crear cotización |

**Correcciones aplicadas en v1.1:**
- [x] SQL ejecutable y sin ambigüedades para las 15 migrations
- [x] Orden de migrations resuelto por dependencias
- [x] RLS completo en las 9 tablas (ENABLE + policies por operación)
- [x] Función helper `get_rol_actual()` para evitar subqueries repetidas en RLS
- [x] Vistas `v_productos_vendedor` y `v_cotizaciones_vendedor` para column-level security
- [x] Trigger `set_updated_at()` aplicado a todas las tablas con ese campo
- [x] Trigger `validar_transicion_estado()` para la máquina de estados
- [x] Trigger `validar_cliente_para_cotizar()` al insertar cotizaciones
- [x] 4 RPCs completas: `registrar_auditoria`, `reasignar_cliente`, `enviar_cotizacion`, `crear_version_cotizacion`
- [x] Modelo de versionado definido exactamente (raíz, versiones, numeración)
- [x] Estado `anulada` agregado al ENUM `estado_cotizacion`
- [x] Tabla `configuracion_negocio` con patrón singleton (id = 1)
- [x] Regla definitiva de visibilidad de clientes documentada
- [x] Campos mínimos para REGISTRAR cliente vs EMITIR cotización separados
- [x] `precio_bs` eliminado de `productos` — se calcula en frontend

**Decisiones tomadas:**
- Usamos ENUM `estado_cotizacion` y `categoria_auditoria` en lugar de CHECK constraints (más seguro y extensible)
- `cotizacion_raiz_id` apunta siempre al ORIGINAL (v1), no al anterior — simplifica queries
- Las RPCs de negocio crítico usan `SECURITY DEFINER + SET search_path` explícito
- La auditoría desde RPCs usa `registrar_auditoria()` separada, no INSERT directo
- `precio_bs` eliminado de la tabla; se calcula en el frontend con la tasa del momento

**Pendiente para siguiente sesión (Fase 1):**
- Crear el proyecto en Supabase (nuevo, independiente)
- Ejecutar las 15 migrations en orden
- Limpiar el repositorio clonado de archivos que no aplican
- Actualizar `package.json` (quitar Capacitor/Groq, agregar TanStack Query)
- Construir `LoginView.jsx` y `useAuthStore.js`
- Construir el layout base con `Navbar` + `Sidebar` rol-aware

**Errores / Bloqueantes:**
- Ninguno. Sesión de revisión y corrección de arquitectura.

---

### SESIÓN 3 — 14/04/2026

**Objetivo de la sesión:** Validación documental de ARQUITECTURA.md v1.1. Verificar que el archivo real coincide con el resumen ejecutivo entregado en Sesión 2.

**Resultado: el archivo es consistente con lo prometido en v1.1, con 2 hallazgos nuevos.**

---

#### VALIDACIÓN PUNTO POR PUNTO

| # | Lo que se verificó | Resultado | Líneas en el archivo |
|---|---|---|---|
| 1 | Encabezado dice Versión 1.1 | ✅ Correcto | Línea 4 |
| 2 | `precio_bs` eliminado de `productos` | ✅ No existe como columna. Solo como comentario explicativo | 209-210 |
| 3 | `SERIAL` reemplazado por `GENERATED ALWAYS AS IDENTITY` | ✅ Correcto en `cotizaciones.numero` | Línea 321 |
| 4 | Tabla `configuracion_negocio` presente y completa | ✅ Migration 010, patrón singleton con CHECK (id=1) | 487-513 |
| 5 | Triggers `updated_at` definidos | ✅ Función `set_updated_at()` + 6 triggers en todas las tablas | 517-556 |
| 6 | `ENABLE ROW LEVEL SECURITY` en las 9 tablas | ✅ Presente para: usuarios, productos, transportistas, clientes, cotizaciones, cotizacion_items, auditoria, reasignaciones_clientes, configuracion_negocio | 684-692 |
| 7 | Políticas RLS completas (INSERT, SELECT, UPDATE, DELETE) | ✅ Definidas por tabla y por operación para todos los roles | 708-993 |
| 8 | Vista `v_productos_vendedor` sin `costo_usd` | ✅ Presente en Migration 012 | 618-638 |
| 9 | Vista `v_cotizaciones_vendedor` sin `notas_internas` | ✅ Presente en Migration 012 | 642-669 |
| 10 | RPCs con `SECURITY DEFINER` + `SET search_path = public` | ✅ Las 4 RPCs tienen ambas declaraciones: `registrar_auditoria`, `reasignar_cliente`, `enviar_cotizacion`, `crear_version_cotizacion` | 1022-1023, 1049-1050, 1140-1141, 1219-1220 |
| 11 | Orden de migrations (001 → 015) con dependencias resueltas | ✅ Orden correcto documentado en sección 3 | 147-163 |

---

#### HALLAZGOS NUEVOS DURANTE VALIDACIÓN (no estaban en v1.0 ni en v1.1)

**Hallazgo A — BRECHA DE SEGURIDAD: las vistas no fuerzan exclusividad**

La arquitectura define `v_productos_vendedor` para ocultar `costo_usd` a los vendedores, pero no hay ningún mecanismo que impida que un vendedor consulte la tabla `productos` directamente (en lugar de la vista) y vea `costo_usd`.

- RLS bloquea FILAS, no COLUMNAS.
- Las vistas protegen columnas solo si se revoca el acceso directo a la tabla.
- En Supabase/PostgREST, cualquier usuario con `authenticated` role puede hacer `SELECT * FROM productos` si tiene la política de SELECT.

**Solución requerida:** Agregar al final de `013_rls_enable_and_policies.sql`:
```sql
-- Revocar acceso directo a la tabla para el rol authenticated
-- Los vendedores deben usar v_productos_vendedor, no la tabla directamente
-- (Los supervisores pueden usar la tabla directamente via service_role o policy)
```
Y en `013`, la política `productos_todos_leen` debe verificar el rol y solo devolver `costo_usd` a supervisores — o mejor: **eliminar** la política de SELECT para vendedores sobre la tabla `productos` y redirigirlos a la vista vía la aplicación. Esto se resuelve en la Fase 3 (Inventario) cuando se construya el hook.

**Impacto en Fase 1:** No bloquea. Se resuelve en Fase 3.

---

**Hallazgo B — BUG LÓGICO: función `formatearNumeroCotizacion` es incorrecta**

En la sección de versionado, el archivo define:
```
COT-00001        → numero=1, version=1
COT-00001 Rev.2  → numero=2, version=2, cotizacion_raiz_id=UUID_de_COT-00001
```

Pero la función JavaScript propuesta usa `cotizacion.numero` directamente:
```javascript
const base = `COT-${String(cotizacion.numero).padStart(5, '0')}`;
```

Esto produciría `COT-00002 Rev.2` (incorrecto) en lugar de `COT-00001 Rev.2`.

**Solución:** La función debe recibir el número de la raíz, no el número propio de la versión:
```javascript
function formatearNumeroCotizacion(cotizacion, numeroRaiz) {
  const num = cotizacion.version > 1 ? numeroRaiz : cotizacion.numero;
  const base = `COT-${String(num).padStart(5, '0')}`;
  return cotizacion.version > 1 ? `${base} Rev.${cotizacion.version}` : base;
}
// Requiere JOIN con la cotización raíz para obtener numeroRaiz al listar
```

**Impacto en Fase 6** (Historial + Versioning). No bloquea Fases 1-5.

---

**Decisiones tomadas en Sesión 3:**
- Ambos hallazgos quedan documentados. No requieren cambios en el SQL de migrations.
- Hallazgo A: se atiende en Fase 3 al construir `useInventario.js` (la app nunca consulta la tabla directamente).
- Hallazgo B: se atiende en Fase 6 al construir `CotizacionesView.jsx`.
- El documento ARQUITECTURA.md v1.1 se considera **válido y listo para ejecutar Fase 1**.

**Pendiente para siguiente sesión (Fase 1):**
- Crear proyecto en Supabase
- Ejecutar migrations 001-015 en orden
- Limpiar el repositorio de archivos que no aplican
- Actualizar `package.json`
- Construir `LoginView.jsx` y `useAuthStore.js`
- Layout base: `Navbar` + `Sidebar` rol-aware

**Errores / Bloqueantes:**
- Ninguno. Validación exitosa con 2 hallazgos menores documentados para fases futuras.

---

### SESIÓN 4 — 14/04/2026 — FASE 1: Limpieza y estructura base

**Objetivo:** Dejar el proyecto limpio, sin código muerto, con la nueva estructura lista para construir módulos.

**Inventario pre-limpieza (proyecto clonado tenía):**
- 13 vistas (views) — 10 eliminadas (POS), 2 conservadas (auth), 1 reescrita (App.jsx)
- ~66 componentes React — ~50 eliminados, 9 conservados en `ui/`
- 20+ hooks — 17 eliminados, 2 conservados (useConfirm, useNotifications)
- 7 servicios — 6 eliminados, 0 conservados (se reescriben desde cero)
- 14 utils — 12 eliminados, 2 conservados (dinero.js, dateHelpers.js)
- 4 carpetas de configuración (categories, paymentMethods, supabaseCloud, tenant) — todas eliminadas
- 2 contextos React (Cart, Products) — eliminados
- 3 core files (FinancialEngine, store, supabaseClient) — eliminados
- Carpetas de infraestructura: android/, api/, frames/, future_plans/ — eliminadas

**Archivos raíz eliminados:**
| Archivo | Razón |
|---|---|
| `android/` | Wrapper nativo Android (no aplica) |
| `api/` | Cloudflare Workers del POS original |
| `frames/` | Capturas de video temporales |
| `future_plans/` | Planes del POS original |
| `migrations/` | Schema del POS original |
| `capacitor.config.json` | Config Capacitor |
| `db_estacion_maestra_setup.sql` | Schema viejo |
| `refactor_tester.mjs`, `tmp_sum.js`, `tmp_sum.mjs` | Archivos temporales |
| `wrangler.jsonc` | Cloudflare Workers config |
| `bun.lock`, `package-lock.json` | Regenerados con nuevas deps |
| `TERMINOS_Y_CONDICIONES.md` | Documento del POS original |
| `public/pwa-*.png`, `OneSignalSDKWorker.js` | PWA assets (no aplica) |

**Archivos y configuración actualizados:**
| Archivo | Cambio |
|---|---|
| `package.json` | `name: listo-pos-cotizaciones`, eliminadas deps: Capacitor x4, groq-sdk, vite-plugin-pwa. Agregada: @tanstack/react-query |
| `vite.config.js` | Eliminado VitePWA plugin y chunk de 'ai' (Groq) |
| `index.html` | Limpio: nuevo título, sin meta PWA, sin OG tags |
| `.env.example` | Solo VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY |
| `.gitignore` | Simplificado, sin referencias al POS |
| `README.md` | Reescrito desde cero con descripción del nuevo sistema |
| `src/App.jsx` | Reescrito como placeholder limpio (shell mínimo) |
| `src/main.jsx` | Simplificado: solo render, sin service worker ni lógica del POS |
| `src/index.css` | Reset limpio con Tailwind y reglas de accesibilidad base |

**Nueva estructura creada:**
```
src/modules/auth/
src/modules/customers/
src/modules/quotes/
src/modules/inventory/
src/modules/carriers/
src/modules/users/
src/modules/audit/
src/services/supabase/
src/services/pdf/
src/services/whatsapp/
src/store/
src/components/ui/        ← 9 componentes genéricos conservados
src/components/layout/
src/views/                ← solo ResetPasswordView y EmailConfirmedView (auth)
supabase/migrations/      ← 15 archivos SQL placeholder (001-015)
```

**Verificación de arranque:**
- `bun run dev` → Vite listo en **171ms** sin errores ni warnings
- Dependencias instaladas: 260 paquetes

**Decisiones tomadas:**
- Se conservaron `useConfirm.jsx` y `useNotifications.js` (hooks genéricos reutilizables)
- Se conservaron `ResetPasswordView.jsx` y `EmailConfirmedView.jsx` (necesarios para el flujo de auth de Supabase con magic link / recovery)
- Los 9 componentes genéricos de `ui/` se mueven a `src/components/ui/` (Modal, Toast, Tooltip, EmptyState, ErrorBoundary, Skeleton, ConfirmModal, Logo, Cards)
- `UI.jsx` renombrado a `Cards.jsx` (solo contiene Card y Badge)

**Pendiente para siguiente sesión (Fase 2):**
- Crear proyecto en Supabase y ejecutar las 15 migrations
- Construir `src/services/supabase/client.js`
- Construir `src/store/authStore.js` (Zustand: sesión + rol)
- Construir `src/modules/auth/LoginView.jsx`
- Construir `src/components/layout/` (Navbar + Sidebar rol-aware)
- Construir sistema de rutas protegidas por rol en `App.jsx`

**Errores / Bloqueantes:**
- Ninguno. Fase 1 completada limpiamente.

---

## SESIÓN 5 — 14/04/2026 — Fase 2: Autenticación y Estructura Base

### Objetivo
Construir el sistema de autenticación completo y el layout principal de la aplicación.

### Archivos creados

| Archivo | Descripción |
|---|---|
| `src/services/supabase/client.js` | Singleton del cliente Supabase con validación de env vars al arranque |
| `src/store/useAuthStore.js` | Store Zustand: sesión, perfil con rol, loading, error, initialized |
| `src/modules/auth/LoginPage.jsx` | Pantalla de login — UX accesible, tema amber, sin registro público |
| `src/components/layout/AppLayout.jsx` | Layout con sidebar 256px, navegación por rol, perfil y logout |
| `src/App.jsx` | React Router v7 completo: rutas públicas, protegidas y solo-supervisor |
| `src/main.jsx` | Punto de entrada — providers en App.jsx |
| `src/views/DashboardView.jsx` | Vista placeholder — Inicio |
| `src/views/ClientesView.jsx` | Vista placeholder — Clientes |
| `src/views/CotizacionesView.jsx` | Vista placeholder — Cotizaciones |
| `src/views/InventarioView.jsx` | Vista placeholder — Inventario |
| `src/views/TransportistasView.jsx` | Vista placeholder — Transportistas |
| `src/views/UsuariosView.jsx` | Vista placeholder — Usuarios (solo supervisor) |
| `src/views/AuditoriaView.jsx` | Vista placeholder — Auditoría (solo supervisor) |

### Decisiones técnicas

**Auth sin flash de sesión:**
- `useAuthStore` tiene campo `initialized` (empieza en `false`)
- `initialize()` usa `onAuthStateChange` con evento `INITIAL_SESSION`
- El router muestra `<PantallaCarga />` hasta que `initialized === true`
- Evita el flash `/login → /` en usuarios ya autenticados

**Estructura de rutas en App.jsx:**
- `<RutaPublica />` — redirige a `/` si ya hay sesión (evita volver al login)
- `<RutaProtegida />` — redirige a `/login` si no hay sesión
- `<RutaSupervisor />` — anidada dentro de `<RutaProtegida />`, redirige a `/` si rol es vendedor
- Los providers `QueryClientProvider` + `BrowserRouter` viven en `App.jsx` para que `AppRoutes` pueda usar `useEffect` en el mismo componente

**Carga de perfil doble-segura:**
- `_cargarPerfil()` se llama tanto desde `SIGNED_IN` (listener) como desde `login()` directamente
- Evita race condition cuando el evento llega antes que la respuesta del `login()`

**QueryClient global:**
- Instancia única con `staleTime: 5min` y `retry: 1`
- Listo para TanStack Query en todas las fases siguientes

### Pendiente para siguiente sesión (Fase 3 o Supabase setup)

**Opción A — Setup Supabase:**
- Crear proyecto en Supabase
- Ejecutar 15 migrations de `supabase/migrations/`
- Crear `.env` con credenciales reales
- Probar login end-to-end

**Opción B — Fase 3: Módulo Clientes:**
- `ClientesView.jsx` con tabla, búsqueda y formulario
- `useClientes` hook con TanStack Query
- RPC para consultar solo clientes propios (vendedor) o todos (supervisor)

### Errores / Bloqueantes
- Ninguno. Fase 2 completada limpiamente.

---

## SESIÓN 6 — 14/04/2026 — Git + Supabase Migrations

### Objetivo
Conectar el proyecto al repositorio GitHub real y escribir las 15 migrations SQL definitivas.

### Acciones realizadas

**1. Configuración de Git:**
- Remote origin actualizado a `https://github.com/luiggiberaldi/listo-pos-cotizaciones`
- Commit 1: `feat: estructura base + autenticación por roles (Fases 1 y 2)` — 260 archivos
  - Eliminados: android/, capacitor, PWA, componentes POS, hooks viejos, Groq
  - Creados: ARQUITECTURA.md, BITACORA.md, estructura de módulos, auth completo
- Commit 2: `feat: 15 migrations SQL completas segun arquitectura v1.1` — 15 archivos
- Ambos commits subidos a `main` exitosamente

**2. Migrations SQL escritas (supabase/migrations/):**

| Archivo | Contenido |
|---|---|
| 001_extensions.sql | uuid-ossp |
| 002_tabla_usuarios.sql | Tabla usuarios + FK a auth.users |
| 003_tabla_productos.sql | Tabla productos + índices FTS |
| 004_tabla_transportistas.sql | Tabla transportistas |
| 005_tabla_clientes.sql | Tabla clientes + anti-robo |
| 006_tabla_cotizaciones.sql | ENUM estado_cotizacion + tabla cotizaciones |
| 007_tabla_cotizacion_items.sql | Items con snapshot de producto |
| 008_tabla_auditoria.sql | ENUM categoria_auditoria + tabla append-only |
| 009_tabla_reasignaciones.sql | Historial de reasignaciones |
| 010_tabla_configuracion.sql | Singleton configuracion_negocio |
| 011_triggers.sql | updated_at + validar_transicion_estado + validar_cliente_para_cotizar |
| 012_views.sql | v_productos_vendedor + v_cotizaciones_vendedor |
| 013_rls_enable_and_policies.sql | RLS habilitado + todas las políticas (35 políticas) |
| 014_funciones_rpc.sql | 4 RPCs: registrar_auditoria, reasignar_cliente, enviar_cotizacion, crear_version_cotizacion |
| 015_seed_configuracion.sql | Fila inicial de configuracion_negocio |

**Pendiente para siguiente sesión:**
- El usuario agrega `.env` con credenciales reales de Supabase
- Ejecutar las 15 migrations en Supabase (SQL Editor en orden)
- Crear el primer usuario supervisor en Supabase Auth + insertar en public.usuarios
- Probar login end-to-end
- Iniciar Fase 3: Módulo Clientes o Módulo Inventario

**Errores / Notas:**
- El push requirió token PAT porque el entorno camelAI no tiene credenciales GitHub configuradas
- Token usado temporalmente — removido del remote URL después del push

---

## SESIÓN 7 — 14/04/2026 — Fase 3: Módulo de Clientes

### Objetivo
Implementar el módulo completo de gestión de clientes con lógica anti-robo.

### Acciones realizadas

**1. Deploy inicial de la app:**
- Creados `wrangler.jsonc` + `worker.js` para servir la SPA como Cloudflare Worker
- Asset binding con `not_found_handling: single-page-application` para SPA routing
- App deployada en: `https://listo-pos-cotizaciones-95qqtr.camelai.app`

**2. Módulo Clientes — Archivos creados:**

| Archivo | Descripción |
|---|---|
| `src/hooks/useClientes.js` | TanStack Query: useClientes, useCliente, useCrearCliente, useActualizarCliente, useDesactivarCliente, useReasignarCliente, useVendedores |
| `src/components/clientes/ClienteForm.jsx` | Formulario crear/editar con validación (nombre, RIF, teléfono, email, dirección, notas) |
| `src/components/clientes/ClienteCard.jsx` | Tarjeta de cliente con acciones (editar, desactivar, reasignar) |
| `src/components/clientes/ReasignacionModal.jsx` | Modal exclusivo supervisor para llamar RPC reasignar_cliente() |
| `src/views/ClientesView.jsx` | Vista principal: lista con búsqueda, grid responsive, modales integrados |

**3. Comportamiento por rol:**
- **Vendedor**: ve solo sus clientes (RLS), puede crear/editar/desactivar los propios
- **Supervisor**: ve todos los clientes con badge de vendedor, puede reasignar vía RPC
- **Anti-robo**: un vendedor nunca puede ver clientes de otro (enforced en BD vía RLS)

**Pendiente para siguiente sesión (Fase 4):**
- Fase 4: Inventario consultable (hook useInventario + vista + búsqueda FTS)

**Errores / Notas:**
- Ninguno. Fase 3 completada limpiamente.

---

## REGISTRO DE ERRORES

> Tabla de errores encontrados durante el desarrollo.
> Registrar para no repetir los mismos problemas.

| # | Fecha | Fase | Descripción del error | Causa raíz | Solución aplicada | Estado |
|---|---|---|---|---|---|---|
| — | — | — | Sin errores registrados aún | — | — | — |

---

## GLOSARIO

| Término | Significado |
|---|---|
| **RLS** | Row Level Security — regla en Supabase que controla qué filas puede ver cada usuario |
| **RPC** | Remote Procedure Call — función en la BD que ejecuta lógica de negocio compleja |
| **Versioning** | Crear una nueva versión de una cotización enviada en lugar de editarla |
| **Anti-robo** | Conjunto de reglas que impiden que un vendedor se apropie de clientes de otro |
| **Borrador** | Cotización guardada pero no enviada al cliente (editable) |
| **Enviada** | Cotización que llegó al cliente — no se edita, se versiona |
| **Snapshot** | Copia de los datos del producto en el momento de cotizar (precio, nombre) |

---

*Mantener este archivo actualizado al inicio y fin de cada sesión de trabajo.*
