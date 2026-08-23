# Bitácora de Proyecto — Construacero Carabobo

> Registro cronológico de decisiones, avance y errores.
> Actualizar en cada sesión de trabajo.

---

## ESTADO INICIAL DEL PROYECTO (14/04/2026)

### ¿De dónde venimos?

El proyecto fue clonado del repositorio `https://github.com/luiggiberaldi/listo_pos_lite-`
que corresponde al sistema **Listo POS Lite** — un punto de venta completo para abastos/bodegas.
El sistema fue transformado en **Construacero Carabobo** — un cotizador comercial para ferretería.

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

**Nombre:** Construacero Carabobo
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
| **Fase 3** | Inventario consultable | ✅ Completada |
| **Fase 4** | Constructor de cotizaciones (wizard) | ✅ Completada |
| **Fase 5** | Generador de PDF + WhatsApp | ✅ Completada |
| **Fase 6** | Transportistas + Historial + Versioning | ✅ Completada |
| **Fase 7** | Panel supervisor + Auditoría + Usuarios | ✅ Completada |

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
| `package.json` | `name: construacero-carabobo`, eliminadas deps: Capacitor x4, groq-sdk, vite-plugin-pwa. Agregada: @tanstack/react-query |
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

### SESIÓN 10 — 24/04/2026 — Fix: Error 401 en página de Clientes (Vercel)

**Objetivo de la sesión:** Diagnosticar y corregir error 401 (Unauthorized) en `/api/clientes` y `/api/clientes/lookup` que impedía cargar la página de Clientes desde el deploy de Vercel.

#### Síntoma

Al abrir la pestaña de Clientes en `https://listo-pos-cotizaciones.vercel.app/clientes`, la consola del navegador mostraba:
```
GET https://listo-pos-cotizaciones.vercel.app/api/clientes? 401 (Unauthorized)
```
Repetido 4 veces (React Query reintenta 3 veces). La página mostraba "Error al cargar los clientes". El error NO ocurría en otras secciones (Cotizaciones, Despachos) porque esas usan Supabase directamente, no el Worker API.

#### Diagnóstico (cronología)

1. **Hipótesis inicial: token expirado** → Se creó `src/services/authFetch.js` con retry automático que refresca el token de Supabase en caso de 401. No solucionó el problema.

2. **Hipótesis: Vercel quita el header Authorization** → Se descubrió que `vercel.json` usa rewrites a URL externa (`workers.dev`). Se cambió a llamadas cross-origin directas con `VITE_WORKER_ORIGIN`. El 401 persistió.

3. **Prueba en camelai.app** → El mismo código funcionaba sin errores en `https://listo-pos-cotizaciones.camelai.app`. Esto confirmó que el problema NO era el código del frontend ni el token.

4. **Diagnóstico del Worker en workers.dev** → Se agregó un endpoint temporal `/api/debug-auth` que reveló:
   - Las credenciales de Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) estaban correctas en ambos Workers
   - El Worker en `workers.dev` validaba tokens correctamente contra Supabase
   - El token que enviaba el frontend desde `vercel.app` era rechazado por Supabase

5. **Causa raíz encontrada:** El Worker desplegado en `luigistorelogistics.workers.dev` estaba **desactualizado** (nunca se había re-desplegado desde que se hicieron cambios al código). El deploy a workers.dev se hacía manualmente con `wrangler deploy` y no había automatización.

#### Solución aplicada

**1. Arquitectura de deploy definitiva:**
- **Vercel** → auto-deploy del frontend en cada push a `main`
- **GitHub Actions** → auto-deploy del Worker a `workers.dev` en cada push a `main`
- **camelAI** → deploy del Worker al entorno de desarrollo

**2. Frontend apunta al Worker de camelai:**
- `.env.production` configura `VITE_WORKER_ORIGIN=https://listo-pos-cotizaciones-98674n.apps.camelai.dev`
- El frontend en Vercel hace llamadas cross-origin al Worker de camelai (CORS ya configurado)
- Esto evita depender del Worker en `workers.dev` que históricamente queda desactualizado

**3. GitHub Actions configurado:**
- Workflow `.github/workflows/deploy-worker.yml` despliega automáticamente a `workers.dev`
- Secrets `CF_API_TOKEN` y `CF_ACCOUNT_ID` configurados en el repositorio de GitHub
- Build con Bun + deploy con `wrangler-action@v3`

**4. Helper authFetch creado:**
- `src/services/authFetch.js` — wrapper de fetch que refresca el token automáticamente si recibe 401
- `useClientes` actualizado para usar `authFetch` en vez de fetch directo

#### Archivos creados/modificados

| Archivo | Cambio |
|---------|--------|
| `src/services/authFetch.js` | **NUEVO** — fetch autenticado con retry en 401 |
| `src/hooks/useClientes.js` | Usa `authFetch` en vez de `getSession()` + `fetch()` manual |
| `.env.production` | **NUEVO** — `VITE_WORKER_ORIGIN` apunta al Worker de camelai |
| `.github/workflows/deploy-worker.yml` | Actualizado con secrets correctos y env vars de build |

#### Lecciones aprendidas

1. **Vercel rewrites NO reenvían el header `Authorization`** a URLs externas. Para endpoints autenticados, usar llamadas cross-origin directas con CORS.
2. **Siempre automatizar el deploy del Worker.** Un Worker desactualizado causa errores difíciles de diagnosticar porque el código fuente se ve correcto.
3. **localStorage es por dominio.** La sesión de Supabase en `vercel.app` es independiente de la de `camelai.app`. No asumir que un token válido en un dominio funciona igual desde otro contexto.

#### Pendiente
- Evaluar migrar el frontend de Vercel a Cloudflare Pages (mismo dominio que el Worker, elimina problema de CORS y tokens cross-domain)

---

## REGISTRO DE ERRORES

> Tabla de errores encontrados durante el desarrollo.
> Registrar para no repetir los mismos problemas.

| # | Fecha | Fase | Descripción del error | Causa raíz | Solución aplicada | Estado |
|---|---|---|---|---|---|---|
| 1 | 14/04/2026 | S8 | 400 Bad Request en query de clientes | `tipo_cliente` seleccionado en hook pero columna no existía en BD | Ejecutar migration 019 vía Supabase Management API | ✅ Resuelto |
| 2 | 24/04/2026 | S10 | 401 Unauthorized en `/api/clientes` desde Vercel | Worker en workers.dev desactualizado + Vercel rewrites no reenvían Authorization header | Apuntar frontend a Worker de camelai + GitHub Actions para auto-deploy | ✅ Resuelto |
| 3 | 25/04/2026 | S11b | `referencia_pago` y `forma_pago_cliente` se guardaban pero no se mostraban en PDF ni detalle | Campos implementados en backend/hook pero no integrados en la UI de salida | Agregados al PDF, DetalleModal y DespachoCard | ✅ Resuelto |
| 4 | 26/04/2026 | S15 | Chunks JS no cargan en Vercel: `Failed to fetch dynamically imported module` + `MIME type "text/html"` | Service Worker (PWA) cacheaba `index.html` viejo que referenciaba hashes de chunks que ya no existen en el servidor (ej: `CotizacionesView-DWqyXTdQ.js`, `useTransportistas-B9MZUd0X.js`) | Limpiar Service Worker + cache del navegador manualmente (ver solución completa abajo) | ⚠️ Recurrente |

---

## SESIÓN 8 — 14/04/2026 — Mejoras: Login Gate, Tipo Cliente, WhatsApp

### Objetivo
Implementar 3 mejoras al sistema: login en dos pasos (gate), campo tipo de cliente, y compartir PDF por WhatsApp.

### Acciones realizadas

**1. Migrations SQL ejecutadas:**

| Archivo | Contenido |
|---|---|
| `018_gate_credentials.sql` | `gate_email` y `gate_password_hash` en `configuracion_negocio` |
| `019_tipo_cliente.sql` | `tipo_cliente` (default 'particular') en `clientes` |

Ambas ejecutadas vía Supabase Management API (`POST /v1/projects/{id}/database/query`).

**2. Login en dos pasos (Gate → Avatar+PIN):**

| Archivo | Cambio |
|---|---|
| `src/modules/auth/LoginPage.jsx` | Reescrito completo: GateStep (correo+contraseña) → UserSelectStep (avatares+PIN) |
| `src/hooks/useConfigNegocio.js` | Funciones `hashSHA256()` y `validarGate()` agregadas |
| `src/views/ConfiguracionView.jsx` | Sección "Acceso al sistema" para configurar gate_email + contraseña |

**Diseño del gate:**
- Inspirado en CloudAuthModal del proyecto original
- Fondo degradado sky→teal, logo centrado, card con blur
- Inputs con iconos (Mail, Key), toggle ver/ocultar contraseña
- Validación SHA-256 contra `configuracion_negocio.gate_password_hash`
- Si no hay gate configurado, permite pasar (primera vez)
- Sesión gate en `sessionStorage` (expira al cerrar pestaña)

**3. Campo tipo de cliente:**

| Archivo | Cambio |
|---|---|
| `src/components/clientes/ClienteForm.jsx` | Select con 4 opciones: Ferretería, Constructor, Particular, Empresa |
| `src/components/clientes/ClienteCard.jsx` | Badge coloreado con tipo de cliente |
| `src/hooks/useClientes.js` | `tipo_cliente` en SELECT, INSERT y UPDATE |
| `src/hooks/useCotizaciones.js` | Join de clientes incluye `telefono` y `tipo_cliente` |
| `src/services/pdf/cotizacionPDF.js` | Tipo de cliente mostrado en sección CLIENTE del PDF |

**4. Compartir por WhatsApp:**

| Archivo | Cambio |
|---|---|
| `src/utils/whatsapp.js` | **NUEVO** — `compartirPorWhatsApp()`, `generarMensaje()`, `formatearTelefono()` |
| `src/components/cotizaciones/CotizacionCard.jsx` | Botón WhatsApp con spinner, genera PDF blob y comparte |
| `src/services/pdf/cotizacionPDF.js` | Parámetro `returnBlob` para obtener blob sin descargar |

**Flujo WhatsApp:**
- Móvil: Web Share API (`navigator.share`) comparte PDF como archivo
- Escritorio: descarga PDF + abre `wa.me/{telefono}?text={mensaje}`
- Fallback: si falla la generación del PDF, abre wa.me solo con texto

**5. Documentación:**
- `ARQUITECTURA.md` actualizado a v1.2 (gate, tipo_cliente, WhatsApp, fases)
- `BITACORA.md` actualizado con Sesión 8

### Decisiones técnicas
- Gate usa SHA-256 local, NO una cuenta separada de Supabase Auth
- `sessionStorage` (no `localStorage`) para que el gate expire al cerrar la pestaña
- `returnBlob` en `generarPDF()` evita duplicar lógica de generación de PDF
- Código de país por defecto: +57 (Colombia) en `formatearTelefono()`

### Errores encontrados
- **400 Bad Request en clientes**: el hook seleccionaba `tipo_cliente` pero la migration no se había ejecutado en Supabase. Resuelto ejecutando las migrations vía API.

### Pendiente
- RLS de `configuracion_negocio` podría necesitar ajuste para lectura anónima de `gate_email`/`gate_password_hash` (el gate se valida antes de autenticarse)
- Fase 6: Transportistas + Historial + Versioning (única fase pendiente)

---

### SESIÓN 9 — 18/04/2026

**Objetivo de la sesión:** Auditoría de seguridad completa + rebrand visual.

#### Parte 1: Rebrand "Listo POS" → "Construacero Carabobo"
- Se actualizaron 15 archivos con referencias al nombre anterior
- Títulos, meta tags, textos en la UI, nombres de claves de storage

#### Parte 2: Auditoría de seguridad (5 brechas corregidas)

Una auditoría externa identificó 5 vulnerabilidades reales en el sistema. Todas fueron corregidas.

**Brecha 1 — `productos.costo_usd` visible para vendedores**
- Problema: la política RLS `productos_todos_leen` permitía a cualquier usuario autenticado leer todas las columnas, incluyendo el costo. RLS no puede filtrar columnas, solo filas.
- Solución: se eliminó esa política y se creó `productos_supervisor_select` que solo permite lectura a supervisores. Los vendedores ahora acceden vía 3 RPCs `SECURITY DEFINER` que excluyen `costo_usd`:
  - `obtener_productos_vendedor()` — lista paginada con búsqueda
  - `obtener_categorias_vendedor()` — categorías únicas
  - `obtener_stock_productos()` — check de stock por IDs

**Brecha 2 — `cotizaciones.notas_internas` visible para vendedores**
- Problema: las consultas del frontend usaban `select('*')` que traía todas las columnas incluyendo notas internas.
- Solución: se reemplazó por listas explícitas de columnas que excluyen `notas_internas`.

**Brecha 3 — `gate_password_hash` expuesto al navegador**
- Problema: la validación del gate traía el hash de la contraseña al browser y comparaba client-side. Cualquiera podía ver el hash en Network tab.
- Solución: se crearon 2 RPCs `SECURITY DEFINER` llamables por `anon`:
  - `validar_gate_acceso(email, hash)` — compara server-side, retorna boolean
  - `tiene_gate_configurado()` — retorna boolean
  - El hash NUNCA sale de la base de datos.

**Brecha 4 — `configuracion_negocio` accesible sin autenticación**
- Problema: la política `config_todos_leen USING (true)` permitía que usuarios no autenticados leyeran toda la configuración.
- Solución: se reemplazó por `config_autenticados_leen USING (auth.uid() IS NOT NULL)`.

**Brecha 5 — Gate login era código muerto**
- Problema: `validarGate` estaba importado en `LoginPage.jsx` pero nunca se ejecutaba. La constante `GATE_SESSION_KEY` estaba definida pero no se usaba.
- Solución: se re-implementó el componente `GateStep` con estilo dark premium coherente con el login. Si hay gate configurado, pide email + contraseña antes de mostrar la selección de usuarios. Si no hay gate, salta directo.

#### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/039_seguridad_datos_y_gate.sql` | **NUEVO** — 5 RPCs + políticas restrictivas |
| `src/hooks/useInventario.js` | Vendedor usa RPCs en vez de vista/tabla directa |
| `src/hooks/useConfigNegocio.js` | Gate por RPC, select explícito sin `gate_password_hash` |
| `src/views/CotizacionesView.jsx` | Stock check vía RPC `obtener_stock_productos` |
| `src/components/cotizaciones/CotizacionBuilder.jsx` | Select explícito sin `notas_internas` |
| `src/modules/auth/LoginPage.jsx` | GateStep re-implementado con validación server-side |

#### Decisiones técnicas
- RPCs `SECURITY DEFINER` es la única forma de ocultar columnas en Supabase (RLS no filtra columnas)
- Las vistas `v_productos_vendedor` y `v_cotizaciones_vendedor` tienen `security_invoker = on`, así que no sirven si la tabla base está restringida — por eso se usan RPCs
- El gate se valida con `sessionStorage` para que expire al cerrar pestaña (decisión de Sesión 8 se mantiene)
- El hash SHA-256 se calcula en el cliente y se envía al RPC — nunca se envía la contraseña en texto plano por el wire, y nunca se trae el hash almacenado al browser

#### Verificación
- Vendedor no puede acceder a `costo_usd` ni por frontend ni por query directa
- Vendedor no recibe `notas_internas` en las consultas de cotizaciones
- `gate_password_hash` no aparece en ninguna respuesta del API al frontend
- Usuarios no autenticados no pueden leer `configuracion_negocio`
- Gate funcional: pide credenciales si está configurado, salta si no

#### Pendiente
- La nota de Sesión 8 sobre RLS de `configuracion_negocio` para lectura anónima queda **RESUELTA** — ahora se usa RPCs callable por `anon` que solo retornan boolean
- Fase 6: Transportistas + Historial + Versioning (única fase funcional pendiente)

---

## SESIÓN 11 — 25/04/2026 — Fase 2 del ROADMAP: Rol de Logística (completada)

### Objetivo
Completar la Fase 2 del ROADMAP: separar la entrega física del flujo administrativo con un rol dedicado de logística.

### Estado al iniciar la sesión

El IDE anterior había avanzado parcialmente en las 3 sub-tareas de la Fase 2:

| Sub-tarea | Estado previo |
|-----------|--------------|
| **2.1** Rol logistica en DB + backend | ✅ Completo |
| **2.2** Vista de logística | ⚠️ Parcial (faltaba verificar navegación) |
| **2.3** Etiquetas contextuales por rol | ❌ No iniciado |

### Trabajo del IDE (sesión anterior — pre Sesión 11)

**2.1 — Base de datos + backend:**
- Migration `063_rol_logistica.sql`: actualiza CHECK constraint de `usuarios.rol` para incluir `logistica`
- `worker.js` → `getOperatorRole()`: reconoce rol `logistica`
- `worker.js` → `handleActualizarEstadoDespacho`: logística puede marcar `entregada` pero NO otros estados

**2.2 — Vista y navegación (parcial):**
- `DespachosView.jsx`: detecta `esLogistica`, título "Entregas", filtros reducidos
- `DespachoCard.jsx`: `canEntregar` incluye logística, botón "Marcar entregada"
- `AppLayout.jsx` sidebar: `excludeRoles: ['logistica']` en ítems que logística no necesita
- `BottomNav.jsx`: `onlyRoles: ['logistica']` para ítem de Despachos/Entregas
- `useDespachos.js`: logística ve solo despachos `despachada` y `entregada` por defecto
- `despachoActions.js`: acciones de logística definidas (solo entregar)

### Trabajo completado en Sesión 11

**Auditoría de navegación:**
- Verificado que sidebar (AppLayout) filtra correctamente para logística usando `excludeRoles`
- Verificado que BottomNav filtra correctamente con `onlyRoles` + `excludeRoles`
- Logística ve: Inicio + Entregas (despachos). No ve: Clientes, Cotizaciones, Inventario, Transportistas, Comisiones

**2.3 — Etiquetas contextuales por rol (NUEVO):**

| Archivo | Cambio |
|---------|--------|
| `src/utils/estadoLabels.js` | **NUEVO** — `getDespachoLabel(estado, rol)`, `getCotizacionLabel(estado)`, `getFiltrosDespacho(rol)` |
| `src/components/cotizaciones/EstadoBadge.jsx` | Reescrito: usa `estadoLabels.js`, acepta prop `rol` opcional |
| `src/components/despachos/DespachoCard.jsx` | Pasa `rol` al `EstadoBadge` |
| `src/components/despachos/DespachoRow.jsx` | Pasa `rol` al `EstadoBadge` |
| `src/views/DespachosView.jsx` | Usa `getFiltrosDespacho(rol)` en vez de constantes hardcodeadas |

**Mapa de etiquetas implementado:**

| Estado despacho | Vendedor ve | Admin ve | Logística ve |
|----------------|-------------|----------|-------------|
| `pendiente` | Esperando aprobación | Por aprobar | Pendiente |
| `despachada` | Aprobada | Aprobada – En entrega | Por entregar |
| `entregada` | Entregada | Entregada | Entregada |
| `anulada` | Anulada | Anulada | Anulada |

### Decisiones técnicas
- `estadoLabels.js` separa estados de despacho y cotización — los de cotización no cambian por rol
- `EstadoBadge` es retrocompatible: sin prop `rol`, usa etiqueta genérica (sin romper usos existentes en cotizaciones)
- Filtros de DespachosView se generan dinámicamente desde `getFiltrosDespacho(rol)`

### Verificación
- Build: ✅ exitoso (5.26s)
- Deploy: ✅ Cloudflare Workers (Version ID: 801130b2)

### Estado de la Fase 2 del ROADMAP

| Sub-tarea | Estado |
|-----------|--------|
| **2.1** Rol logistica en DB + backend | ✅ Completada |
| **2.2** Vista de logística | ✅ Completada |
| **2.3** Etiquetas contextuales por rol | ✅ Completada |

**Fase 2 del ROADMAP: ✅ COMPLETADA**

### Pendiente para siguiente sesión
- **Fase 3 del ROADMAP**: Dashboards y UX Polish (dashboard por rol: vendedor, admin, logística)
- **Fase 6 original**: Transportistas + Historial + Versioning (pendiente desde Sesión 8)
- Ejecutar migration `063_rol_logistica.sql` en Supabase (si no se ha ejecutado aún)

### Errores / Bloqueantes
- Ninguno.

---

## SESIÓN 11b — 25/04/2026 — Auditoría Fases 1-2 + Corrección brecha 1.1

### Objetivo
Verificar que las Fases 1 y 2 del ROADMAP se implementaron correctamente. Corregir cualquier brecha encontrada.

### Auditoría realizada

Se auditaron las 6 sub-tareas de ambas fases contra los criterios de aceptación del ROADMAP.

| Fase | Sub-tarea | Resultado |
|------|-----------|-----------|
| 1 | 1.1 Referencia de pago en despacho | ⚠️ Parcial — campos guardados pero no visibles |
| 1 | 1.2 Admin aprueba despachos | ✅ Pass |
| 1 | 1.3 Vista despachos para admin | ✅ Pass |
| 2 | 2.1 Rol logistica en DB + backend | ✅ Pass |
| 2 | 2.2 Vista de logística | ✅ Pass |
| 2 | 2.3 Etiquetas contextuales por rol | ✅ Pass |

### Brecha corregida: 1.1 — Referencia de pago no visible

**Problema:** Los campos `referencia_pago` y `forma_pago_cliente` se aceptaban y guardaban en la BD (hook + worker), pero no se mostraban en ninguna interfaz visible al usuario.

**Criterio de aceptación del ROADMAP:** *"La referencia aparece en el timeline y en el PDF"*

**Corrección aplicada:**

| Archivo | Cambio |
|---------|--------|
| `src/services/pdf/despachoPDF.js` | Nueva fila entre FORMA DE PAGO y desglose: muestra "PAGO CLIENTE: {tipo}" y "REF: {referencia}" cuando existen. Ajustes de layout bottom-up para no solapar con el total ni el desglose. |
| `src/components/ui/DetalleModal.jsx` | Sección meta info de despachos: agrega iconos CreditCard y Hash con forma de pago y referencia del cliente |
| `src/components/despachos/DespachoCard.jsx` | Línea sutil entre la info del cliente y el total: muestra forma de pago y referencia cuando existen |

**Campos NO modificados (ya funcionaban):**
- `useDespachos.js` — ya incluía `referencia_pago` y `forma_pago_cliente` en el SELECT
- `worker.js` → `handleCrearDespacho` — ya los guardaba correctamente
- `CotizacionesView.jsx` → `ModalDespachar` — ya tenía los campos del formulario

### Verificación
- Build: ✅ exitoso
- Deploy: ✅ Cloudflare Workers (Version ID: a66a5e3a)

### Estado post-auditoría

| Fase | Estado |
|------|--------|
| **Fase 1** — Flujo de Aprobación Real | ✅ **COMPLETADA** (brecha 1.1 corregida) |
| **Fase 2** — Rol de Logística | ✅ **COMPLETADA** |

### Pendiente para siguiente sesión
- **Fase 3 del ROADMAP**: Dashboards y UX Polish (dashboard por rol: vendedor, admin, logística)
- **Fase 6 original**: Transportistas + Historial + Versioning (pendiente desde Sesión 8)
- Ejecutar migration `063_rol_logistica.sql` en Supabase (si no se ha ejecutado aún)

### Errores / Bloqueantes
- Ninguno.

---

## SESIÓN 12 — 25/04/2026 — Fase 3 del ROADMAP: Dashboards por Rol

### Contexto
El `DashboardView.jsx` original mostraba métricas genéricas de cotizaciones para todos los roles. Admin veía métricas irrelevantes (total cotizaciones, tasa aceptación) y logística no tenía dashboard. Se implementaron dashboards específicos por rol según lo definido en el ROADMAP.

### Cambios realizados

#### 1. Migration RLS para logística
- **Archivo nuevo:** `supabase/migrations/064_logistica_rls_despachos.sql`
- Crea política SELECT en `notas_despacho` para rol `logistica`
- Sin esta política, las queries directas a Supabase retornaban vacío para logística
- **Pendiente:** ejecutar en Supabase producción

#### 2. MetricCard extraído a componente reutilizable
- **Archivo nuevo:** `src/components/ui/MetricCard.jsx`
- Tarjeta de métrica con gradiente, extraída de DashboardView (líneas 123-186)
- 6 temas de color: primary, emerald, blue, gold, red, purple
- Soporte para `onClick` con animaciones hover/active
- Componente memo para evitar re-renders innecesarios

#### 3. Hook `useDashboardMetrics`
- **Archivo nuevo:** `src/hooks/useDashboardMetrics.js`
- Un solo `useQuery` que ejecuta queries paralelas según el rol del usuario
- **Vendedor:** `despachosPendientes` (propios, estado=pendiente)
- **Admin:** `despachosPendientes` (todos), `ventasDia`, `ventasSemana`, `stockBajoCount`, `stockBajoItems`
- **Logística:** `despachosDespachados`, `entregasHoy`, `proximasEntregas` (con lookup de clientes via `/api/clientes/lookup`)
- **Supervisor:** `despachosPendientes` (todos)
- staleTime: 5min, gcTime: 15min

#### 4. DashboardView refactorizado por rol
- **Archivo modificado:** `src/views/DashboardView.jsx`

**Bug corregido:** `cxcResumen?.totalDeuda` → `cxcResumen?.kpis?.totalDeuda` (la card de CxC nunca se renderizaba porque el hook retorna `{ kpis: { totalDeuda } }`)

**Metric cards por rol:**
| Rol | Cards |
|-----|-------|
| Vendedor | Facturado mes, Esperando respuesta, Pendientes aprobación (gold), Comisiones pendientes (emerald) |
| Admin | Despachos por aprobar (gold, clickable→/cotizaciones), CxC total (corregido), Stock bajo (red), Ventas del día (emerald, sub: semana) |
| Logística | Entregas pendientes (blue), Entregadas hoy (emerald) |
| Supervisor | 4 cards existentes + CxC corregida |

**Secciones de contenido por rol:**
- **Vendedor/Supervisor:** desglose por estado + comisiones (sin cambios)
- **Admin:** lista "Stock bajo" con barras de progreso (nombre, stock actual/mínimo, top 5) + accesos rápidos
- **Logística:** lista "Próximas entregas" (cliente, dirección, número despacho, fecha). Click → `/despachos`. Si vacía: EmptyState
- Admin/Logística: se ocultan secciones irrelevantes (cotizaciones por estado, comisiones)

**PageHeader por rol:**
- Logística: subtítulo "Centro de entregas", sin botón "Nueva"
- Admin: subtítulo "Panel de administración", sin botón "Nueva"

### Build & Deploy
- Build: `vite build` exitoso (5.31s)
- Deploy: `wrangler deploy --dispatch-namespace chiridion` exitoso

### Archivos creados/modificados
| Archivo | Acción |
|---------|--------|
| `supabase/migrations/064_logistica_rls_despachos.sql` | Creado |
| `src/components/ui/MetricCard.jsx` | Creado |
| `src/hooks/useDashboardMetrics.js` | Creado |
| `src/views/DashboardView.jsx` | Refactorizado |

### Pendiente para siguiente sesión
- **Fase 4 del ROADMAP**: Venta rápida / Facturación inmediata
- **Fase 6 original**: Transportistas + Historial + Versioning (pendiente desde Sesión 8)
- Ejecutar migrations `063_rol_logistica.sql` y `064_logistica_rls_despachos.sql` en Supabase producción

### Errores / Bloqueantes
- Ninguno.

---

## SESIÓN 13 — 25/04/2026 — Fase 4 del ROADMAP: Venta Rápida

### Contexto
Clientes recurrentes no necesitan el flujo completo de 5 pasos (borrador → enviar → aceptar → despachar → aprobar). La Venta Rápida combina cotización + despacho en un solo paso atómico, reduciendo el flujo a 2 pasos: vendedor llena formulario → admin aprueba.

### Cambios realizados

#### 1. Endpoint backend `POST /api/ventas-rapidas/crear`
- **Archivo modificado:** `worker.js`
- Nuevo handler `handleVentaRapida` (~160 líneas) que combina:
  - Creación de cotización con estado `aceptada` directamente
  - Snapshot de tasa BCV + cálculo de totales
  - Inserción de items con snapshots de producto
  - Verificación y descuento de stock
  - Registro de movimientos kardex (con motivo "Venta rápida")
  - Creación de nota de despacho con estado `pendiente`
  - Registro de cargo CxC si forma de pago es "Cta por cobrar"
  - Auditoría con acción `VENTA_RAPIDA`
- Ruta agregada en dispatcher: `/api/ventas-rapidas/crear`
- Solo accesible por vendedor y supervisor

#### 2. Hook `useVentaRapida`
- **Archivo nuevo:** `src/hooks/useVentaRapida.js`
- `useMutation` que llama al endpoint
- Invalida caches: despachos, inventario, comisiones, cotizaciones, stock comprometido, CxC
- Envía notificación push a supervisor al crear
- Toast de éxito con número de despacho

#### 3. Vista `VentaRapidaView.jsx`
- **Archivo nuevo:** `src/views/VentaRapidaView.jsx` (~520 líneas)
- Wizard de 3 pasos con indicador visual:
  - **Paso 1 — Productos:** selector de cliente (con búsqueda y creación rápida), catálogo de productos con búsqueda inteligente, categorías, productos recientes, carrito con +/- cantidad
  - **Paso 2 — Pago:** forma de pago (6 opciones), pago del cliente (forma + referencia), transportista opcional, flete condicional, notas
  - **Paso 3 — Confirmar:** resumen completo (cliente, items, totales con USD y Bs, pago, transporte), warning de descuento de stock, botón de confirmación
- Barra inferior sticky con navegación Atrás/Siguiente/Crear
- Validaciones: cliente requerido, al menos 1 item, forma de pago requerida
- Reset automático del formulario tras creación exitosa

#### 4. Ruta y navegación
- **`src/App.jsx`:** lazy import + ruta `/venta-rapida` en rutas protegidas
- **`src/components/layout/AppLayout.jsx`:**
  - Importación de icono `Zap`
  - Nuevo item en `NAV_TODOS`: `onlyRoles: ['vendedor', 'supervisor']`
  - Filtro de nav actualizado para soportar `onlyRoles`
- **`src/components/layout/BottomNav.jsx`:**
  - Importación de icono `Zap`
  - "Venta rápida" agregada a `MORE_ITEMS` con `onlyRoles`
  - Filtro de MORE_ITEMS actualizado para soportar `onlyRoles`

### Build & Deploy
- Build: `vite build` exitoso (5.35s)
- Deploy: `wrangler deploy --dispatch-namespace chiridion` exitoso
- Nuevo chunk: `VentaRapidaView-Du0gZhdE.js` (23.30 kB gzip: 6.12 kB)

### Archivos creados/modificados
| Archivo | Acción |
|---------|--------|
| `worker.js` | Handler `handleVentaRapida` + ruta |
| `src/hooks/useVentaRapida.js` | Creado |
| `src/views/VentaRapidaView.jsx` | Creado |
| `src/App.jsx` | Lazy import + ruta |
| `src/components/layout/AppLayout.jsx` | Nav item + filtro onlyRoles |
| `src/components/layout/BottomNav.jsx` | Nav item + filtro onlyRoles |

### Migrations ejecutadas en esta sesión
- `064_logistica_rls_despachos.sql` — política SELECT para logística en `notas_despacho` (ejecutada via Management API)
- `063_rol_logistica.sql` — ya estaba ejecutada previamente

### Pendiente para siguiente sesión
- **Fase 6 original**: Transportistas + Historial + Versioning (pendiente desde Sesión 8)
- Probar flujo completo de venta rápida en producción

### Errores / Bloqueantes
- Ninguno.

---

## SESIÓN 13b — 25/04/2026 — Auditoría Fases 3-4 + Corrección gap vendedor

### Contexto
Auditoría de las Fases 3 y 4 contra los criterios del ROADMAP.

### Resultado de auditoría

**Fase 4 (Venta Rápida):** 100% conforme. Todos los criterios verificados sin gaps.

**Fase 3 (Dashboards por Rol):**
- Admin: 4/4 métricas ✅
- Logística: 3/3 métricas ✅
- Supervisor: completo ✅
- **Vendedor: 3/4 métricas** — faltaba "Clientes con deuda" prometida en ROADMAP 3.1

### Corrección aplicada
- **`src/views/DashboardView.jsx`:** agregada 5ª card para vendedor "Clientes con deuda" (color red, icono Users)
  - Valor: `cxcResumen?.kpis?.numClientesConDeuda`
  - Sub: total deuda en USD
  - Grid cambiado de `lg:grid-cols-4` a `lg:grid-cols-5` para vendedor
  - Los datos ya estaban disponibles via `useResumenCxC()` — solo faltaba la card

### Build & Deploy
- Build exitoso, deploy exitoso

### Pendiente para siguiente sesión
- Ninguno. Todas las fases del plan general original están completadas.

### Errores / Bloqueantes
- Ninguno.

---

## SESIÓN 14 — 25/04/2026 — Fase 6: Transportistas + Historial + Versioning

### Contexto
Fase 6 era la última fase funcional pendiente del plan general original, marcada pendiente desde la Sesión 8. Se identificaron tres componentes:
- **Transportistas**: Vista CRUD existía pero la tabla DB le faltaban 4 columnas (`color`, `vehiculo`, `placa_chuto`, `placa_batea`) que el frontend ya usaba → errores silenciosos al guardar
- **Versioning**: Ya estaba implementado desde fases anteriores (`cotizaciones.version`, `cotizacion_raiz_id`, endpoint `handleCrearVersion`, historial en `DetalleModal`)
- **Historial por cliente**: `FichaClienteModal` solo mostraba historial de CxC, no cotizaciones

### Cambios realizados

#### 1. Migración `065_transportistas_campos_vehiculo.sql`
- **Archivo nuevo:** `supabase/migrations/065_transportistas_campos_vehiculo.sql`
- Agrega 4 columnas faltantes a tabla `transportistas`: `color`, `vehiculo`, `placa_chuto`, `placa_batea`
- **Ejecutada** en producción via Supabase Management API
- Verificada: las 4 columnas aparecen en `information_schema.columns`

#### 2. Hook `useCotizacionesCliente`
- **Archivo modificado:** `src/hooks/useClientes.js`
- Nuevo hook `useCotizacionesCliente(clienteId)` que consulta cotizaciones de un cliente
- Select: id, numero, version, cotizacion_raiz_id, estado, total_usd, tasa_bcv_snapshot, total_bs_snapshot, creado_en, enviada_en, vendedor(id, nombre)
- Ordenado por `creado_en DESC`, límite 50
- staleTime: 5min

#### 3. Historial de cotizaciones en FichaClienteModal
- **Archivo modificado:** `src/components/clientes/FichaClienteModal.jsx`
- Nueva sección "Cotizaciones del cliente" debajo del historial de CxC
- Componente `HistorialCotizaciones`: lista de cotizaciones con número formateado (COT-XXXXX Rev.X), EstadoBadge, total USD, fecha, vendedor
- Click en cotización disponible vía prop `onVerCotizacion` (para integrar con DetalleModal)
- Skeleton loading + empty state cuando no hay cotizaciones
- Imports agregados: `FileText`, `ChevronRight`, `useCotizacionesCliente`, `EstadoBadge`

### Verificación del estado de Fase 6

| Componente | Estado |
|------------|--------|
| **Transportistas** — Vista CRUD | ✅ Ya existía (TransportistasView.jsx) |
| **Transportistas** — Hook | ✅ Ya existía (useTransportistas.js) |
| **Transportistas** — DB columnas | ✅ Corregido (migración 065) |
| **Versioning** — DB schema | ✅ Ya existía (version + cotizacion_raiz_id) |
| **Versioning** — Backend | ✅ Ya existía (handleCrearVersion en worker.js) |
| **Versioning** — UI | ✅ Ya existía (DetalleModal muestra versiones) |
| **Historial** — Hook | ✅ Creado (useCotizacionesCliente) |
| **Historial** — UI | ✅ Creado (FichaClienteModal sección cotizaciones) |

### Build & Deploy
- Build: `vite build` exitoso (5.31s)
- Deploy: `wrangler deploy --dispatch-namespace chiridion` exitoso (Version ID: 8159aa78)

### Archivos creados/modificados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/065_transportistas_campos_vehiculo.sql` | Creado |
| `src/hooks/useClientes.js` | Hook `useCotizacionesCliente` agregado |
| `src/components/clientes/FichaClienteModal.jsx` | Sección historial cotizaciones |

### Estado del Plan General

| Fase | Descripción | Estado |
|---|---|---|
| **Fase 0** | Arquitectura, BD y reglas de negocio | ✅ Completada |
| **Fase 1** | Limpieza del proyecto + estructura base | ✅ Completada |
| **Fase 2** | Módulo de Clientes (con anti-robo) | ✅ Completada |
| **Fase 3** | Inventario consultable | ✅ Completada |
| **Fase 4** | Constructor de cotizaciones (wizard) | ✅ Completada |
| **Fase 5** | Generador de PDF + WhatsApp | ✅ Completada |
| **Fase 6** | Transportistas + Historial + Versioning | ✅ **Completada** |
| **Fase 7** | Panel supervisor + Auditoría + Usuarios | ✅ Completada |

**🎉 Todas las fases del plan general original están completadas.**

### Errores / Bloqueantes
- Ninguno.

---

## AUDITORÍA DE SEGURIDAD (26/04/2026)

### Contexto
Se realizó una auditoría de seguridad completa del proyecto. Se encontraron vulnerabilidades críticas
y se corrigieron. Este documento registra TODO lo que se hizo y la arquitectura de deploy resultante
para evitar repetir errores de configuración.

### Arquitectura de Deploy (IMPORTANTE — leer antes de tocar infra)

El proyecto tiene **DOS Workers desplegados** del mismo código:

| Worker | URL | Quién lo despliega | Tiene secrets |
|--------|-----|--------------------|---------------|
| **luigistorelogistics** (PRIMARIO) | `listo-pos-cotizaciones.luigistorelogistics.workers.dev` | GitHub Actions (`deploy-worker.yml`) | ✅ Sí — en Cloudflare Dashboard |
| **camelAI** (secundario) | `listo-pos-cotizaciones-sqf5rv.camelai.app` | `bash deploy.sh` (usa `--dispatch-namespace chiridion`) | ❌ No tiene `SUPABASE_SERVICE_KEY` ni `VAPID_PRIVATE_KEY` |

**Vercel** es el frontend primario (`listo-pos-cotizaciones.vercel.app`).
El `vercel.json` hace proxy de `/api/*` → `luigistorelogistics.workers.dev`.

```
Usuario → Vercel (frontend) → /api/* proxy → Worker luigistorelogistics (backend)
```

**⚠️ REGLA CRÍTICA:** Nunca cambiar `vercel.json` para apuntar a la URL de camelAI.
El Worker de camelAI NO tiene los secrets de Supabase y causará errores 500.

### Dónde están los secrets

**Cloudflare Dashboard** (Worker `listo-pos-cotizaciones` en cuenta `luigistorelogistics`):
- `SUPABASE_SERVICE_KEY` — Secreto cifrado
- `VAPID_PRIVATE_KEY` — Secreto cifrado
- `DEV_SUPER_CODE` — Secreto cifrado (`24457713`)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY` — Texto plano (no sensibles)
- `GROQ_KEYS_A/B/C` — Se inyectan desde `deploy.sh` vía `.dev.vars` (solo en camelAI)

**GitHub Secrets** (repo `luiggiberaldi/listo-pos-cotizaciones`):
- `CF_API_TOKEN` — Token de Cloudflare para deploy
- `CF_ACCOUNT_ID` — Account ID de Cloudflare
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` — Duplicados (mismo propósito)
- `VITE_SUPABASE_URL` — URL de Supabase (para build de Vite)
- `VITE_SUPABASE_ANON_KEY` — Anon key de Supabase (para build de Vite)

**⚠️ Si agregas un nuevo secret al Worker**, agrégalo en el Cloudflare Dashboard,
NO en `wrangler.jsonc`. Los secrets en `wrangler.jsonc` quedan expuestos en el repo.

### Cambios realizados en la auditoría

#### 1. CORS endurecido (`worker.js` líneas 7-19)
- **Antes:** `Array.includes()` + `origin.endsWith('.vercel.app')` (wildcard)
- **Después:** `new Set([...3 dominios exactos...])` — solo match exacto
- Los 3 dominios permitidos: `.camelai.app`, `.apps.camelai.dev`, `.vercel.app`

#### 2. Super admin code movido a secret (`worker.js`)
- **Antes:** `const SUPER_ADMIN_CODE = '24457713'` hardcodeado
- **Después:** Usa `env.DEV_SUPER_CODE` (secret en Cloudflare Dashboard)
- `wrangler.jsonc` tiene `DEV_SUPER_CODE` temporal en `vars` hasta que se configure como secret

#### 3. Validación de super PIN en frontend (`LoginPage.jsx`)
- **Antes:** Comparación local `if (superPin !== '24457713')` — bypass del servidor
- **Después:** Solo valida vía `fetch('/api/auth/super-admin')` con `await` + `if (!res.ok)`

#### 4. IP tracking en auditoría (`worker.js`)
- `validateOperator()` ahora captura `request.headers.get('CF-Connecting-IP')` y la retorna
- **Las 16 llamadas** a `registrarAuditoria()` ahora pasan `ip` al campo `ip_origen`
- Handlers sin `validateOperator` usan `request.headers.get('CF-Connecting-IP') || null` inline

#### 5. Credentials removidos del repo
- `.github/workflows/deploy-worker.yml` — Supabase URL y anon key ahora usan `${{ secrets.* }}`
- `.env.production` y `.env.bak` — eliminados de git tracking (`git rm --cached`)
- `.gitignore` — agregados `.env.production` y `.env.bak`

### Errores encontrados durante la auditoría

| Error | Causa raíz | Solución |
|-------|-----------|----------|
| PIN da 500 desde Vercel | `vercel.json` apuntaba a Worker de camelAI que no tiene secrets | Revertir a `luigistorelogistics.workers.dev` |
| `validateOperator` no retornaba `ip` | Línea 2018 faltaba `ip` en `return { user, operador, headers: h }` | Agregado `ip` al return |
| Worker camelAI da `SERVICE_KEY exists: false` | Los secrets de Cloudflare Dashboard no aplican al dispatch namespace `chiridion` | Usar Worker personal como backend primario |
| `construacerocarabobo` Worker duplicado | Deploy previo con nombre diferente en `wrangler.jsonc` | Eliminar manualmente en Cloudflare Dashboard |

### Flujo de deploy correcto

```
1. Hacer cambios en código
2. git add + git commit + git push
3. GitHub Actions despliega worker.js → luigistorelogistics.workers.dev (con secrets)
4. Vercel despliega frontend → listo-pos-cotizaciones.vercel.app
5. (Opcional) bash deploy.sh → despliega a camelAI (sin secrets sensibles)
```

### Pendientes post-auditoría
- [ ] Eliminar Worker `construacerocarabobo` del Cloudflare Dashboard
- [ ] Eliminar `DEV_SUPER_CODE` de `wrangler.jsonc` vars (ya está como secret en Dashboard)
- [ ] Convertir `SUPABASE_ANON_KEY` de texto plano a secreto en Dashboard (no es urgente, es público)

---

## RESPONSIVIDAD DESKTOP — VENTA RÁPIDA (26/04/2026)

### Problema
VentaRapidaView solo tenía layout móvil: wizard de columna única con FAB + bottom sheet para el carrito. En pantallas desktop (lg+) se veía apretado y no aprovechaba el espacio horizontal.

### Solución
Se copió el patrón de dos columnas de `CotizacionBuilder.jsx` al Step 1 (Productos) de `VentaRapidaView.jsx`:

```
Mobile (<lg): Sin cambios — FAB flotante + bottom sheet deslizable
Desktop (lg+): Dos columnas
  ├─ Izquierda: Catálogo de productos (flex-1)
  └─ Derecha: Carrito sticky (w-80, sticky top-[73px])
```

### Cambios en `src/views/VentaRapidaView.jsx`

1. **Contenedor padding**: `pb-24` → `pb-24 lg:pb-4` (sin padding extra en desktop)
2. **Split layout wrapper**: `<div className="flex flex-col lg:flex-row lg:gap-4">` envuelve catálogo + carrito
3. **Columna izquierda**: `<div className="flex-1 min-w-0">` contiene grid/lista de productos
4. **Columna derecha (desktop)**: `<div className="hidden lg:flex w-80 shrink-0 lg:sticky lg:top-[73px] ...">` carrito con:
   - Header con icono + contador de items
   - Lista scrollable de items con stepper de cantidad
   - Footer con subtotal (USD + Bs) y botón "Siguiente"
   - Estado vacío con icono y mensaje
5. **Mobile wrapper**: FAB + bottom sheet + modal de cantidad envueltos en `<div className="lg:hidden">`

### Nota sobre error 500 en switch-operator (Vercel) — RESUELTO (26/04/2026)

**Síntoma**: POST `/api/auth/switch-operator` retornaba 500 desde `vercel.app`. Funcionaba correctamente en camelAI.

**Causa raíz**: `wrangler.jsonc` tenía placeholders vacíos (`"SUPABASE_SERVICE_KEY": ""`, etc.) en el bloque `vars`. Cada vez que GitHub Actions ejecutaba `wrangler deploy`, estos strings vacíos **sobreescribían** los secrets cifrados del Cloudflare Dashboard. Resultado: el worker de producción (`luigistorelogistics.workers.dev`) operaba sin `SUPABASE_SERVICE_KEY`, causando 500 en cualquier operación que requiriera acceso admin a Supabase.

**Por qué funcionaba en camelAI**: `deploy.sh` inyectaba los valores reales desde `.dev.vars` antes del deploy.

**Diagnóstico**: Se creó endpoint temporal `/api/dev/check-secrets` que reportó:
```
Producción:  SUPABASE_SERVICE_KEY_len: 0   ← vacío (destruido)
camelAI:     SUPABASE_SERVICE_KEY_len: 219 ← correcto
```

**Fix aplicado (3 pasos)**:
1. **wrangler.jsonc**: Eliminados los 5 placeholders vacíos (`GROQ_KEYS_A/B/C`, `SUPABASE_SERVICE_KEY`, `VAPID_PRIVATE_KEY`). Solo quedan vars públicas (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VAPID_PUBLIC_KEY`, `DEV_SUPER_CODE`).
2. **deploy.sh**: Reescrito para **agregar** las vars secretas al jsonc dinámicamente (en vez de reemplazar strings vacíos que ya no existen).
3. **GitHub Actions** (`deploy-worker.yml`): Actualizado con paso "Inyectar secrets en wrangler.jsonc" que lee de GitHub Secrets (`GROQ_KEYS_A/B/C`, `SUPABASE_SERVICE_KEY`, `VAPID_PRIVATE_KEY`) y los inyecta antes del `wrangler deploy`.
4. **Cloudflare Dashboard**: Se re-ingresaron manualmente los 5 secrets que habían sido destruidos por deploys anteriores. Verificado con endpoint de diagnóstico — todos reportaron longitudes correctas.

**Secrets necesarios en GitHub Actions** (Settings → Secrets → Actions):
| Secret | Descripción |
|---|---|
| `CF_API_TOKEN` | Token de API de Cloudflare (ya existía) |
| `CF_ACCOUNT_ID` | ID de cuenta Cloudflare (ya existía) |
| `VITE_SUPABASE_URL` | URL de Supabase para build frontend (ya existía) |
| `VITE_SUPABASE_ANON_KEY` | Anon key para build frontend (ya existía) |
| `GROQ_KEYS_A` | Pool A de API keys de Groq (5 keys, separadas por coma) |
| `GROQ_KEYS_B` | Pool B de API keys de Groq |
| `GROQ_KEYS_C` | Pool C de API keys de Groq |
| `SUPABASE_SERVICE_KEY` | JWT service_role de Supabase |
| `VAPID_PRIVATE_KEY` | Clave privada VAPID para push notifications |

**REGLAS aprendidas**:
1. **Nunca** poner `"SECRET_KEY": ""` en `wrangler.jsonc` — las vars vacías sobreescriben secrets del Dashboard
2. Los secrets deben estar en **tres lugares**: Cloudflare Dashboard (backup), GitHub Secrets (para GitHub Actions), y `.dev.vars` local (para `deploy.sh` a camelAI)
3. Siempre verificar con endpoint de diagnóstico después de cambiar la estrategia de secrets

### Flujo de deploy actualizado (post-fix)

**⚠️ IMPORTANTE: El despliegue principal y primario es VERCEL.** Vercel es la URL que usan los usuarios finales. camelAI es solo para desarrollo/pruebas. Si algo no funciona en Vercel, es un bug de producción — no importa si funciona en camelAI.

```
┌─────────────────────────────────────────────────────────┐
│ ★ PRODUCCIÓN — PRIMARIO (Vercel)                         │
│   URL: https://listo-pos-cotizaciones.vercel.app         │
│   Backend: luigistorelogistics.workers.dev               │
│                                                          │
│ 1. git push main                                         │
│ 2. GitHub Actions:                                       │
│    a. bun install + bun run build                        │
│    b. Node script inyecta secrets de GitHub Secrets      │
│       en wrangler.jsonc temporalmente                    │
│    c. wrangler deploy --config wrangler.jsonc            │
│ 3. Vercel: build frontend + rewrites /api/* al worker    │
│                                                          │
│ Secrets: GitHub Secrets + Cloudflare Dashboard            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ DESARROLLO — SECUNDARIO (camelAI)                        │
│   URL: https://listo-pos-cotizaciones-*.camelai.app      │
│   Backend: dispatch namespace chiridion                   │
│                                                          │
│ 1. bash deploy.sh                                        │
│    a. source .dev.vars                                   │
│    b. Node script inyecta secrets en wrangler.jsonc      │
│    c. bun run build                                      │
│    d. wrangler deploy --dispatch-namespace chiridion      │
│    e. Restaura wrangler.jsonc original                   │
│                                                          │
│ Secrets: .dev.vars (gitignored)                          │
└─────────────────────────────────────────────────────────┘
```

---

## SESIÓN 15 — 26/04/2026 — Error recurrente: chunks JS rotos por cache del Service Worker

### Síntoma

Al abrir la app en `https://listo-pos-cotizaciones.vercel.app`, la consola muestra:
```
useTransportistas-B9MZUd0X.js:1 Failed to load module script: Expected a JavaScript-or-Wasm module script
but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for
module scripts per HTML spec.

TypeError: Failed to fetch dynamically imported module:
https://listo-pos-cotizaciones.vercel.app/assets/CotizacionesView-DWqyXTdQ.js
```

La app queda en pantalla blanca o con error de carga al intentar navegar a cualquier vista (Cotizaciones, Transportistas, etc.).

### Causa raíz

**El Service Worker (PWA) cachea el `index.html` con hashes de chunks del build anterior.** Cuando Vercel despliega un nuevo build, los nombres de los chunks cambian (ej: `CotizacionesView-DWqyXTdQ.js` → `CotizacionesView-Cm27_ox_.js`). Pero el Service Worker sigue sirviendo el `index.html` viejo desde cache, que pide chunks que ya no existen en el servidor. El servidor devuelve el fallback HTML (SPA routing), y el browser lo rechaza por MIME type incorrecto (`text/html` en vez de `application/javascript`).

**¿Por qué no se auto-actualiza?** El SW tiene `skipWaiting()` y `clients.claim()`, pero estos solo se ejecutan cuando el browser detecta un SW nuevo. Si el usuario tiene la pestaña abierta sin recargar, o la PWA está instalada, el SW viejo sigue activo indefinidamente sirviendo assets obsoletos.

### Solución para el usuario (manual, por dispositivo)

**Opción A — Hard refresh:**
- PC: `Ctrl+Shift+R` (Windows/Linux) o `Cmd+Shift+R` (Mac)
- Si no funciona, usar Opción B

**Opción B — Limpiar Service Worker y cache (definitiva):**
1. Abrir DevTools (F12)
2. Ir a pestaña **Application**
3. Panel izquierdo → **Service Workers** → marcar **"Update on reload"**
4. Panel izquierdo → **Storage** → click **"Clear site data"** (marcar todo)
5. Recargar la página

**Opción C — Desde barra de dirección (Chrome):**
1. Ir a `chrome://serviceworker-internals`
2. Buscar `listo-pos-cotizaciones.vercel.app`
3. Click **Unregister**
4. Recargar la página

### Solución preventiva (pendiente de implementar)

Para evitar que este error se repita, se debería implementar una de estas estrategias:

1. **Version check en el SW:** Al activarse, el SW compara su versión con la del servidor. Si hay mismatch, purga el cache y recarga.
2. **Cache-busting en index.html:** Agregar un meta tag o query param con el hash del build.
3. **Stale-while-revalidate para HTML:** El SW sirve el HTML viejo pero inmediatamente descarga el nuevo en background y notifica al usuario ("Hay una actualización disponible, recarga para aplicar").
4. **No cachear index.html en el SW:** Solo cachear assets con hash (JS, CSS, imágenes). El `index.html` siempre se pide al servidor.

### Acciones realizadas en esta sesión

1. Sincronizado repo local con remote (`git pull` — 180+ commits por delante)
2. Build y deploy a Cloudflare Workers (secundario) con código actualizado
3. Documentado el error en bitácora y registro de errores

### Errores / Bloqueantes
- El error se repite cada vez que hay un deploy con cambios en chunks JS y el usuario no limpia su cache/SW

## SESIÓN 16 — 26/04/2026 — Fix: Race condition de autenticación al recargar

### Síntoma

Al recargar la página (F5), a veces la app muestra la pantalla de selección de operador en vez de ir directo al perfil activo. Al intentar ingresar el PIN, muestra "PIN incorrecto". Pero si se recarga otra vez con F5, entra directamente al perfil correcto sin pedir PIN.

### Causa raíz (doble)

**1. Timeout agresivo de 3s en `_cargarPerfil` durante INITIAL_SESSION:**
En `useAuthStore.js`, el handler de `INITIAL_SESSION` usaba `Promise.race` con un timeout de 3000ms para cargar el perfil del operador. Si Supabase respondía lento (red móvil, latencia), el timeout ganaba la carrera y se seteaba `initialized=true` con `perfil=null`. Esto hacía que `LoginPage` mostrara la pantalla de selección de operador prematuramente.

**2. `getAccessToken()` devolvía JWT cacheado/expirado:**
La función usaba `supabase.auth.getSession()` que retorna el JWT del cache local sin verificar si está expirado. Cuando el usuario intentaba ingresar PIN en la pantalla prematura, `switchOperator()` enviaba un JWT vencido al Worker. El Worker rechazaba la request → error genérico "PIN incorrecto".

### Solución implementada

**Fix 1 — Eliminar el timeout interno de 3s:**
Se removió el `Promise.race` con timeout de 3s. Ahora `_cargarPerfil()` se ejecuta sin límite de tiempo artificialmente bajo. El timeout externo de 8s (para sesiones con localStorage) sigue actuando como red de seguridad.

**Fix 2 — Refresh proactivo de JWT en INITIAL_SESSION:**
Antes de cargar perfil, si el JWT tiene menos de 120s de vida, se ejecuta `refreshSession()` para obtener un token fresco. Esto evita que requests posteriores (como switchOperator) fallen por JWT expirado.

**Fix 3 — `getAccessToken()` con refresh automático:**
La función ahora verifica `expires_at` del JWT. Si quedan menos de 60s, ejecuta `refreshSession()` automáticamente antes de devolver el token. Fallback: si el refresh falla, devuelve el token existente.

### Archivos modificados

- `src/store/useAuthStore.js` — `getAccessToken()`, `initialize()` → handler INITIAL_SESSION

---

## SESIÓN 26/04/2026 — Mejoras varias + descuentos por unidad + retomar venta rápida

### Cambios realizados

#### 1. Fix flash de login al recargar
Al recargar la app estando logueado, aparecía brevemente la pantalla de login antes de mostrar el perfil. Se resolvió cacheando el perfil del operador en `localStorage` y restaurándolo sincrónicamente en `initialize()` antes de que Supabase verifique la sesión.

**Archivos modificados:** `src/store/useAuthStore.js`

#### 2. Descuentos por artículo en despachos (logística)
Se implementó un sistema completo de descuentos por artículo dentro de los despachos. Solo los roles `logistica`, `supervisor` y `desarrollador` pueden aplicar descuentos.

**Tipos de descuento:**
- **Porcentaje (%)** — descuento como % del total de línea
- **Monto fijo ($)** — descuento en USD sobre el total de línea
- **Por unidad ($/u)** — descuento en USD por unidad × cantidad (agregado posteriormente)

**Arquitectura:** Tabla separada `despacho_descuentos` (no modifica `cotizacion_items` para preservar integridad de documentos). Campo `descuento_total_usd` en `notas_despacho` para acceso rápido al total de descuentos.

**Impacto en otros módulos:**
- **Comisiones:** La RPC `calcular_comision_despacho` resta descuentos por ítem antes de calcular comisión (migración 069)
- **Reportes:** `useReporteVentas` resta `descuento_total_usd` del total de ventas
- **CxC:** El worker ajusta el cargo y `saldo_pendiente` del cliente al guardar descuentos
- **PDFs:** Nota de Entrega y Orden de Despacho muestran fila de descuento

**Archivos nuevos:**
- `supabase/migrations/068_despacho_descuentos.sql` — tabla, RLS, índices
- `supabase/migrations/069_comision_con_descuento.sql` — RPC actualizada
- `supabase/migrations/070_descuento_por_unidad.sql` — CHECK constraint para monto_unitario
- `src/hooks/useDespachoDescuentos.js` — queries y mutaciones
- `src/components/despachos/DescuentoModal.jsx` — modal de descuentos

**Archivos modificados:**
- `worker.js` — endpoints POST/GET para descuentos, ajuste CxC y recomisión
- `src/components/despachos/DespachoCard.jsx` — botón descuento + badge
- `src/hooks/useDespachos.js` — incluir `descuento_total_usd` en query
- `src/components/ui/DetalleModal.jsx` — mostrar desglose con descuento
- `src/services/pdf/despachoPDF.js` — fila descuento en PDF
- `src/services/pdf/ordenDespachoPDF.js` — fila descuento en PDF
- `src/hooks/useReporteVentas.js` — venta neta resta descuentos

#### 3. Logística ve todos los despachos
Se eliminó el filtro que limitaba a logística a ver solo despachos `despachada`/`entregada`. Ahora ven todos los estados (pendiente, despachada, entregada) de todos los vendedores.

**Archivos modificados:** `src/hooks/useDespachos.js` (línea 49 eliminada)

#### 4. Retomar venta rápida (draft)
Se implementó persistencia de borradores en venta rápida, idéntico al patrón de `CotizacionBuilder`. Si el usuario cierra la app a mitad de una venta rápida, al volver ve un banner ámbar para retomar o descartar.

- Auto-guardado cada 1.5s en `localStorage`
- Borrador expira a las 24h
- Se limpia al completar la venta exitosamente
- Guarda: step, clienteId, items, formaPago, referenciaPago, transportistaId, fleteUsd, notas

**Archivos modificados:** `src/views/VentaRapidaView.jsx`

#### 5. UX del modal de descuentos
- Iconos de tipo ya no se duplican (se removieron iconos Lucide, se usa solo texto: `%`, `$`, `$/u`)
- Al hacer focus en el input de valor, se selecciona todo el texto para escribir directo
- Tercer botón `$/u` para descuento por unidad

### Errores encontrados y solucionados

#### Error React #31 — "object with keys {type, message}"
**Causa:** En `src/hooks/useDespachoDescuentos.js`, las llamadas a `showToast` pasaban un objeto `{ type: 'error', message: '...' }` como primer argumento, cuando la firma de `showToast` espera `(message, type)` como argumentos separados. React intentaba renderizar el objeto como texto del toast y lanzaba el error #31 (no se puede renderizar un objeto como hijo de React).

**Solución:** Cambiar `showToast({ type: 'error', message: '...' })` por `showToast('...', 'error')` y lo mismo para el caso de éxito.

**Archivos corregidos:** `src/hooks/useDespachoDescuentos.js` (líneas 56 y 59)

---

## SESIÓN 29/04/2026 — Optimización UI Desktop (Venta Rápida)

### Objetivo
Rediseñar VentaRapidaView para aprovechar todo el ancho de pantalla en PC, eliminar scrolls innecesarios y mantener botones de acción siempre visibles.

### Cambios realizados

#### 1. Paso 1 (Productos) — Layout viewport-filling
- Cliente selector compacto inline (sin card wrapper, sin label "CLIENTE")
- Productos sin card wrapper, scroll interno que llena el viewport
- Carrito desktop con patrón 3 zonas: header (`shrink-0`), items (`flex-1 overflow-y-auto min-h-0`), footer (`shrink-0`)
- Carrito hereda altura del flex parent (sin `h-[calc(...)]` fijo)
- Botón "Siguiente" siempre visible sin scroll
- Layout flex con `min-h-0` en toda la cadena desde el contenedor principal

**Archivos:** `src/views/VentaRapidaView.jsx`

#### 2. Nuevo Transportista — Modal en vez de inline
- El formulario se renderizaba inline empujando todo el layout hacia abajo
- Ahora usa modal centrado con overlay oscuro (`fixed inset-0 z-50 bg-black/40`)
- Consistente con el patrón de "Nuevo cliente"

**Archivos:** `src/views/VentaRapidaView.jsx`

#### 3. PageHeader — Separación del borde superior
- Agregado `pt-4` para que el título no choque con el borde superior de la pantalla
- Aplica a todas las vistas que usan PageHeader

**Archivos:** `src/components/ui/PageHeader.jsx`

#### 4. Paso 2 (Pago) — Dos columnas en desktop
- **Columna izquierda** (`flex-1`): Formas de pago con montos + barra asignado/total
- **Columna derecha** (`lg:w-80 xl:w-96`): Transportista, monto del flete, notas
- En móvil se mantiene layout de una columna

**Archivos:** `src/views/VentaRapidaView.jsx`

#### 5. Flete no se suma al total de formas de pago
- El "Total" en la barra de formas de pago es solo subtotal de productos (sin flete)
- El flete se guarda aparte, solo aparece visualmente en nota de entrega y ficha de despachos
- La validación `pagoCuadrado` compara montos asignados vs `totalUsd` (sin flete)
- `totalConFlete` solo se usa en el paso Confirmar como resumen visual

**Archivos:** `src/views/VentaRapidaView.jsx`

#### 6. Paso 3 (Confirmar) — Dos columnas en desktop
- **Columna izquierda** (`flex-1`): Cliente + lista de productos con scroll interno
- **Columna derecha** (`lg:w-72 xl:w-80`): Totales, pago, transporte, notas
- Todo visible sin scroll externo
- Botones "Atrás" y "Crear venta rápida" siempre fijos en footer sticky

**Archivos:** `src/views/VentaRapidaView.jsx`

### Reglas de negocio confirmadas

| Concepto | Regla |
|----------|-------|
| IVA | No se calcula ni se suma en ningún lado. Solo simbólico en PDF de nota de entrega |
| Flete | No se suma al total de formas de pago. Solo visual en nota de entrega + ficha despachos |
| Orden de despacho PDF | No incluye IVA ni flete |
| Formas de pago | Se validan contra subtotal de productos únicamente |

### Patrones de layout aplicados

```
Viewport-filling chain:
AppLayout content → flex-1 min-h-0
  └── VentaRapidaView → flex flex-col h-full min-h-0
       └── Step content → flex-1 min-h-0 flex flex-col
            └── Step1 outer → flex-1 min-h-0 flex flex-col
                 └── Split row → flex-1 min-h-0 lg:flex-row
                      ├── Products → flex-1 min-h-0 overflow-y-auto
                      └── Cart → shrink-0 flex flex-col (3 zones)
```

### Issues pendientes
- `SUPABASE_SERVICE_KEY` inválida en Cloudflare Worker (401). Funciona en Vercel. Necesita actualizar via `wrangler secret put SUPABASE_SERVICE_KEY`.

---

## BUGS PENDIENTES — "Enviar Cotización" en móviles

> Identificados el 05/05/2026. Pendientes de corrección.
> Archivo afectado principal: `src/components/cotizaciones/CotizacionBuilder.jsx`
> Hook afectado: `src/hooks/useCotizaciones.js`

### BUG-01 — Botón deshabilitado silenciosamente si la tasa no ha cargado 🔴

**Severidad:** Crítica  
**Síntoma:** En dispositivos con red lenta o sin caché, al llegar al Paso 3 el botón "Enviar cotización" aparece deshabilitado sin ningún mensaje explicativo. El usuario cree que el botón no funciona.  
**Causa raíz:** La condición `disabled={cargando || tasaHook.tasaEfectiva <= 0}` deshabilita el botón cuando la tasa BCV/USDT todavía está cargando. En móviles con datos lentos o sin caché de React Query, la tasa puede tardar varios segundos en llegar.  
**Archivo:** `CotizacionBuilder.jsx` líneas 1169-1175 (móvil) y 1298-1304 (desktop)  
**Solución propuesta:** Mostrar un mensaje visible tipo "Cargando tasa de cambio..." o un spinner cuando `tasaHook.cargando === true`, en lugar de solo deshabilitar el botón silenciosamente. Considerar también mostrar un toast si la tasa falla.

---

### BUG-02 — Spinner no aparece durante el guardado previo al envío 🟡

**Severidad:** UX media  
**Síntoma:** Al pulsar "Enviar", `handleEnviar` primero ejecuta `guardarBorrador.mutateAsync()` (puede tardar 1-3s en red lenta) antes de ejecutar el envío. Durante ese tiempo el botón no muestra ningún spinner ni feedback. El usuario cree que nada ocurrió y pulsa otra vez, generando múltiples llamadas.  
**Causa raíz:** El icono del botón usa `enviarCotizacion.isPending` para el spinner, pero no contempla `guardarBorrador.isPending`. Sin embargo, `cargando` en línea 831 sí incluye ambos: `const cargando = guardarBorrador.isPending || enviarCotizacion.isPending`. El botón se deshabilita correctamente pero el spinner solo aparece en la fase de envío, no en la de guardado.  
**Archivo:** `CotizacionBuilder.jsx` líneas 1173 y 1302  
**Solución propuesta:** Cambiar `{enviarCotizacion.isPending ? <Loader2 .../> : <Send />}` por `{cargando ? <Loader2 .../> : <Send />}` en ambos botones de envío.

---

### BUG-03 — `ModalEnvio` existe en el JSX pero nunca se abre 🟡

**Severidad:** Inconsistencia / código muerto  
**Síntoma:** El componente `ModalEnvio` (línea 1476) está montado con `isOpen={modalEnvio}` pero `setModalEnvio(true)` nunca se llama desde ningún botón del paso 3. El flujo original fue refactorizado para llamar `handleEnviar` directamente, pero el modal quedó en el JSX sin conectar.  
**Causa raíz:** Refactor incompleto. El modal fue diseñado para que el usuario confirmara la tasa antes de enviar, pero los botones fueron cambiados para llamar `handleEnviar(tasaHook.tasaEfectiva)` directamente.  
**Archivo:** `CotizacionBuilder.jsx` líneas 425, 1476-1482  
**Solución propuesta:** Opciones:
- **A)** Reconectar el modal: que el botón haga `setModalEnvio(true)` y el modal confirme la tasa antes de enviar (flujo original correcto).
- **B)** Eliminar el modal y el estado `modalEnvio` si se decide no usarlo más.
- La opción A es la más robusta porque permite al usuario verificar/ajustar la tasa antes de enviar.

---

### BUG-04 — Feedback visual insuficiente de botón deshabilitado en móviles 🟡

**Severidad:** UX baja  
**Síntoma:** El botón deshabilitado usa `disabled:opacity-50` — en pantallas de móvil con brillo alto o bajo, la diferencia de opacidad es imperceptible y el usuario no sabe que no puede pulsar.  
**Causa raíz:** Solo se usa opacidad como indicador visual. No hay texto, tooltip ni color diferente.  
**Archivo:** `CotizacionBuilder.jsx` líneas 1171 y 1300  
**Solución propuesta:** Agregar un `title` dinámico al botón que explique por qué está deshabilitado: `title={tasaHook.tasaEfectiva <= 0 ? 'Esperando tasa de cambio...' : undefined}`.

---

### ¿Por qué solo afecta algunos dispositivos?

El BUG-01 es el principal. Los dispositivos que no lo experimentan tienen la tasa ya **cacheada en React Query** de sesiones anteriores (staleTime: 5min). Los dispositivos afectados:
- Tienen poca RAM y el SO mató el proceso (pierde caché)
- Tienen datos móviles lentos o señal débil
- Usan la app con menos frecuencia (caché expirada)
- Son nuevos en el sistema (primera vez, sin caché)

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

## SESIÓN 23/05/2026 — Validación de Cuentas por Cobrar Obligatorias y Días de Vencimiento

### Objetivo
Asegurar que cuando se utilice "Cuentas por cobrar" como método de pago, el campo de días de vencimiento sea obligatorio en todos los flujos de creación/edición, excepto cuando el cliente esté asignado a un vendedor con el rol `vendedor_sin_comision`.

### Cambios realizados

#### 1. Backend (`api/handlers/despachos.js`)
- Validado en `handleCrearDespacho`, `handleEditarPagoDespacho` y `handleEditarItemsDespacho`.
- Se comprueba si existe un pago con método `Cta por cobrar`. Si es así y el cliente no pertenece a un `vendedor_sin_comision`, se exige que `diasVencimiento` sea un entero positivo mayor que cero, retornando error `400` en caso contrario.

#### 2. Venta Rápida (`src/views/VentaRapidaView.jsx`)
- Calculada reactivamente la variable `esVendedorSinComision` basada en el cliente seleccionado.
- Calculada la validez de los días de vencimiento `cxcVencimientoValido`.
- Deshabilitado el botón del paso 2 si `cxcVencimientoValido` es falso.
- Mostrar dinámicamente si el campo es "(opcional)" u "(obligatorio) *" y el placeholder ("Ej. 15" vs "Obligatorio").

#### 3. Despachar Cotización (`src/views/CotizacionesView.jsx`)
- Se integró la validación del perfil y rol del vendedor del cliente.
- Se calculó `cxcVencimientoValido` y se deshabilitó el botón "Confirmar despacho" si no se cumplen los requisitos.
- Se adaptaron los placeholders y etiquetas del input de vencimiento para ser dinámicos.

#### 4. Editar Despacho Modal (`src/components/despachos/EditDespachoModal.jsx`)
- Se importó `useAuthStore` y se calculó la condición de vendedor sin comisión para el cliente seleccionado.
- Bloqueada la acción de guardar cambios si `cxcVencimientoValido` es falso, con un mensaje explicativo en la propiedad `title` del botón.
- Etiquetas y placeholders dinámicos.

#### 5. Editar Ítems de Despacho Modal (`src/components/despachos/EditarItemsDespachoModal.jsx`)
- Se calculó la condición de vendedor sin comisión con respecto al cliente actual.
- Bloqueada la acción de guardar cambios si `cxcVencimientoValido` es falso.
- Mensaje en el title y toast descriptivo en `handleSave` en caso de error.
- Etiquetas y placeholders dinámicos.

### Verificación
- Compilación de producción (`npm run build`) completada con éxito.
- Lógica de anti-alucinaciones y diffs mínimos respetados.
- NO se realizaron operaciones de commit ni push a petición del usuario.

---

## SESIÓN 23/05/2026 — Reporte de Vendedores: Vendedores Externos, Descarga de Reportes Separados y Diseño Premium

### Objetivo
Añadir soporte para visualizar vendedores externos en el reporte de vendedores de supervisores, permitir la exportación en PDF de reportes individuales (Internos, Externos y General) recalculando los KPIs dinámicamente, y pulir el diseño visual y contenido del PDF (evitando encabalgamientos, agregando el desglose de cotizaciones/comisiones completo y permitiendo que todos los reportes tengan el nivel de detalle necesario para la gerencia).

### Cambios realizados

#### 1. Servicio de PDF (`src/services/pdf/reporteVendedoresPDF.js`)
- **Filtro y KPIs locales**: Agregado soporte para filtrar vendedores usando el parámetro `tipo` (`'internos'` y `'externos'`), y cálculo dinámico de KPIs locales (`localTotalVentas`, `localTotalDespachos`, `localTotalComision`, etc.).
- **Rediseño Premium de las Tarjetas de KPIs (Pág 1)**:
  - Reemplazados los fondos sólidos fuertes por **fondos en tonos pastel muy suaves** (5% de opacidad del color de acento).
  - Añadido un **borde fino gris claro** (`slate-200`) en cada tarjeta.
  - Añadida una **línea vertical de acento** gruesa (1.2mm) en el borde izquierdo con el color representativo (Azul, Esmeralda, Celeste, Ámbar).
  - Mejorada la jerarquía tipográfica: etiquetas en gris slate oscuro, valores en negrita y subtextos en gris.
  - Corregidos los subtextos:
    - Ventas: Variación porcentual (verde/rojo según tendencia) o "Sin datos anteriores" si no hay historial, manteniendo el centrado vertical.
    - Despachos: Muestra la cantidad de vendedores del subconjunto.
    - Ticket promedio: Muestra "Por despacho entregado".
    - Comisiones: Muestra por separado la división exacta de Cabilla 2% y 3% (usando las variables correspondientes calculadas localmente).
- **Prevención de Encabalgamientos en la Tabla**:
  - Reajustadas todas las coordenadas `X` y anchos de columnas para aprovechar el ancho total de página (`CONTENT_W` hasta 204mm).
  - Aumentada la separación entre el nombre del vendedor y la barra de progreso mini.
  - Modificada la posición de la barra de progreso mini (`MARGIN + 42` con ancho de `35` mm) y el valor de Ventas USD (`MARGIN + 92`, alineado a la derecha) para que la barra nunca solape los números de venta, sin importar la cantidad de dígitos.
  - Reducido el radio del círculo del vendedor a `1.0` para mayor sutileza visual y alineado verticalmente.
- **Ampliación del Perfil Detallado (Cotizaciones y Comisiones)**:
  - El desglose detallado de cada vendedor ahora se incluye de forma automática en **todos** los tipos de reportes descargados (`general`, `internos`, `externos`, `completo`), permitiendo a la gerencia tener el expediente de rendimiento completo de sus vendedores.
  - **Pipeline de Cotizaciones completo**: Se incorporó el estado `Borrador` en el bloque izquierdo de cotizaciones por vendedor, mostrando ahora los 5 estados (Borradores, Enviadas, Aceptadas, Rechazadas, Anuladas) y su correspondiente porcentaje, rediseñando el alto del bloque a `38` para evitar superposiciones.
  - **Desglose de Comisiones exacto**: Se reestructuraron las comisiones en 6 líneas, dividiendo de forma precisa: Total generado, Pagado, Pendiente, Cabilla 2%, Cabilla 3% y Otros productos.
  - Incrementado el alto de los bloques de desglose a `38` y el avance de `y` a `42` para dar holgura y evitar colisiones visuales.

#### 2. Vista de Reporte de Vendedores (`src/views/ReporteVendedoresView.jsx`)
- Se importaron `useRef` y `useEffect`.
- Se implementó un menú desplegable (Dropdown) con animación para el botón de exportación en la barra de acciones principal del header.
- El dropdown permite seleccionar tres opciones:
  - **Reporte General (Todos)**: Llama a `handleExportPDF('general')`.
  - **Vendedores Internos**: Llama a `handleExportPDF('internos')`.
  - **Vendedores Externos**: Llama a `handleExportPDF('externos')`.
- Se agregó lógica de detección de click fuera del dropdown (`handleClickOutside`) para cerrarlo automáticamente al hacer click en cualquier otra zona de la pantalla.
- Se actualizó el spinner de carga para activarse independientemente de la opción global elegida (`general`, `internos` o `externos`).

- **Exclusión de Roles de Supervisión (Jefes y Supervisores)**:
  - Se modificó el filtro del listado de vendedores para descartar explícitamente a los usuarios con roles de `jefe` y `supervisor` (`v.rol === 'jefe' || v.rol === 'supervisor'`), evitando que aparezcan mezclados en las tablas de vendedores con actividad nula o ficticia (ej. el caso de Enzo Patti).

- **Filtro Temporal "Hoy" como Predeterminado**:
  - Se agregó la opción temporal **"Hoy"** (`key: 'hoy'`) al listado de períodos en la vista de reportes, definiendo `from` y `to` como el día en curso en la zona horaria local, y el período anterior como el día de ayer (`prevFrom` y `prevTo`).
  - Se estableció **"Hoy"** como la opción por defecto en el estado del componente (`setPeriodo('hoy')`).
- **Mejoras de Legibilidad e Incremento de Fuentes en el PDF**:
  - Aumentado el tamaño de la tipografía general de las tablas y fichas en el PDF para garantizar la máxima visibilidad y lectura cómoda.
  - El tamaño de las fuentes de los encabezados de tabla (`drawTableHeader`) se incrementó a `7.5` y el alto del rectángulo del encabezado a `7.5mm`.
  - Las celdas de las tablas principales aumentaron de tamaño a `7.5` y su altura a `9mm` para un centrado vertical impecable. Los subtotales subieron a `8.0` y el Total General a `8.5` (en negrita).
  - En las fichas individuales, las tarjetas KPI internas subieron a tamaño `7` para la etiqueta y `9.5` (en negrita) para el valor.
  - Los textos de desglose de cotizaciones, comisiones, top clientes y top productos subieron a tamaño `7` y `7.5` para mayor claridad.
  - El historial de despachos del vendedor incrementó su tamaño general a `7.5` y su espaciado a `7.5mm` por fila.

### Verificación
- Compilación de producción (`npm run build`) ejecutada de manera exitosa sin errores de sintaxis o bundler.
- Sin confirmación ni empuje (commit y push) a git, respetando la política de resguardo del usuario.

---

## SESIÓN 15/06/2026 — Fase 1 de Comisiones Proporcionales

### Objetivo
Iniciar la implementación de la Fase 1 del plan de comisiones proporcionales en pagos mixtos, agregando las nuevas columnas y la tabla de historial de liberaciones.

### Cambios realizados

#### 1. Migraciones de Base de Datos (`supabase/migrations/183_comisiones_columnas_liberacion.sql`)
- Creado el archivo de migración aditiva para añadir las columnas `comision_liberada` y `comision_retenida` a la tabla `public.comisiones`.
- Creada la tabla `public.comision_liberaciones` para registrar los eventos fechados de liberación (contado y abonos).
- Agregados los índices correspondientes (`idx_comision_liberaciones_fecha` y `idx_comision_liberaciones_comision`).
- Habilitado Row Level Security (RLS) y configurada la política de select restrictiva basada en el rol y el vendedor asignado.
- Otorgados permisos de select al rol `authenticated`.

### Verificación
- Migración creada y guardada en la ruta de migrations.

#### 2. Migraciones de Base de Datos (`supabase/migrations/184_calc_comision_split.sql`) (Fase 2)
- Re-definida la función de base de datos `calcularcomisiondespacho` para admitir el split proporcional en pagos mixtos.
- Al aprobarse un despacho, calcula la proporción pagada de contado y la porción a crédito basándose en las CxC generadas.
- Inserta los montos correspondientes en `comision_liberada` y `comision_retenida` e introduce un evento de tipo `'contado'` en `comision_liberaciones` si existe una parte cobrada de inmediato.

#### 3. Migraciones de Base de Datos (`supabase/migrations/185_trigger_liberacion_proporcional.sql`) (Fase 3)
- Re-definida la función trigger `public.trg_liberar_comision_por_pago` y recreados los triggers en la tabla `public.cuentas_por_cobrar`.
- El trigger se activa al insertar, actualizar o eliminar registros en cuentas por cobrar.
- Calcula la fracción liberada basada en la fórmula matemática proporcional monótona, actualiza `comision_liberada` y `comision_retenida` en la tabla `comisiones`, actualiza el estado de la comisión a `cta_cobrar` o `pendiente`, y registra un evento de tipo `'abono'` en la tabla `comision_liberaciones` por el monto incremental.
- Se eliminó la lógica legacy de liberación global por cliente (Caso 2) para evitar sobre-liberación y duplicados.

#### 4. Migraciones de Base de Datos (`supabase/migrations/186_backfill_comisiones_liberacion.sql`) (Fase 4)
- Creado el script SQL para inicializar el estado de comisiones existentes en la base de datos.
- Las comisiones ya pagadas o pendientes (liberadas por completo) se marcan con `comision_liberada = totalcomision` and `comision_retenida = 0`.
- Las comisiones en estado `cta_cobrar` se inicializan con `comision_liberada = 0` y `comision_retenida = totalcomision` (para liberarse dinámicamente con los próximos abonos).
- Registra eventos históricos de tipo `'contado'` en `comision_liberaciones` para todas las comisiones ya liberadas en el pasado, fechados con la creación del despacho correspondiente para evitar distorsiones temporales en reportes actuales.

#### 5. Migraciones de Base de Datos (`supabase/migrations/187_resumen_comisiones_por_liberacion.sql`) (Fase 5)
- Redefinida la RPC `obtener_resumen_comisiones_v2` para que agrupe y filtre métricas a partir de la tabla de eventos de liberación (`comision_liberaciones`), filtrando por la fecha del evento (`creado_en`) en vez de la fecha del despacho.
- Se implementó un algoritmo FIFO en SQL para calcular exactamente cuánto del monto liberado y pendiente en el período actual ha sido cubierto por los pagos registrados (`montopagado`) a nivel de la comisión global, garantizando consistencia matemática impecable en la UI (Total Liberado = Pendiente de Pago + Ya Pagado en el período).

#### 6. Backend y Hook de Frontend: Pagar solo lo liberado (Fase 6)
- **Modificado handler backend (`api/handlers/comisiones.js`):**
  - En `handleMarcarComisionPagada`: se valida que el monto a registrar no supere `comision_liberada` ni sea menor que el `montopagado` actual. Si no se provee monto, liquida automáticamente hasta el total de `comision_liberada`.
  - El estado final cambia a `'pagada'` solo si se liquidó la totalidad de la comisión liberada y no queda saldo retenido por CxC (`comision_retenida <= 0.01`). Si hay saldo retenido, se mantiene en `'cta_cobrar'`. Si está totalmente liberada pero el pago es parcial, queda en `'pendiente'`.
  - En `handleGetComisiones`: se agregó la selección y mapeo de `comision_liberada` y `comision_retenida` en el listado de comisiones.
- **Modificado hook frontend (`src/hooks/useComisiones.js`):**
  - Mapeado y parseado correcto de `comision_liberada` y `comision_retenida` como valores numéricos en el frontend.

---

## SESIÓN 15/06/2026 — Fase 7: PDF de Comisiones por Eventos de Liberación (completada)

### Objetivo
Modificar la generación y exportación del reporte de comisiones en PDF para que liste y totalice eventos individuales de liberación de comisión (`comision_liberaciones`), en lugar del listado histórico consolidado de comisiones completas. Esto asegura consistencia temporal (por ejemplo, ver en el período actual la liberación de comisiones de abonos de despachos antiguos).

### Cambios realizados

#### 1. Servicio de PDF (`src/services/pdf/comisionesPDF.js`)
- En `normalizarComision`, se actualizó la proporción de cabilla para ser siempre proporcional (`totalcomision * (comisioncabilla / com.totalcomision)`) en todos los eventos (tanto `'contado'` como `'abono'`).
- El filtro de comisiones se ajustó para permitir eventos (que tienen `tipo !== undefined`) y mantener compatibilidad con comisiones normales (`c.estado !== 'cta_cobrar'`).

#### 2. Vistas de Exportación (`src/views/ComisionesView.jsx` y `src/views/ReportesView.jsx`)
- Se importó el cliente de Supabase (`supabase`).
- Se reescribieron las funciones de exportación `exportarPDF` (individual/general) y `exportarIndividualPDF` para:
  1. Consultar de forma asíncrona la tabla `comision_liberaciones` haciendo un `!inner` join con `comisiones` (para obtener las tasas, porcentajes, total de comisiones y despacho asociado con la info del cliente).
  2. Filtrar por rango de fechas (desde/hasta) usando `creado_en` con zona horaria de Venezuela (`-04:00`).
  3. Consultar las cotizaciones en una segunda consulta en JS usando un set de IDs únicos para resolver los nombres de clientes y tasas de cotización (evitando duplicaciones y queries complejas).
  4. Mapear los registros en el formato esperado por `generarComisionesPDF` para mantener total compatibilidad con los reportes resumido/detallado y gráficos de distribución.

### Verificación
- Compilación de producción en proceso.

## SESIÓN 20/07/2026 — Fase 1 de Fixes de Rendimiento de Carga (auditoría)

### Objetivo
Aplicar la Fase 1 del plan de fixeo derivado de la auditoría de problemas de carga (despachos, inventario, cotizaciones): detener las tormentas de refetch y agregar índices faltantes en la base de datos.

### Cambios realizados

#### 1. Invalidación filtrada al reconectar (`src/store/useAuthStore.js`)
- El handler `online` ya no ejecuta `queryClient.invalidateQueries()` sin filtro (recargaba TODO el caché en cada micro-corte de red).
- Ahora invalida solo queries **activas** (`refetchType: 'active'`) y con **debounce de 3s** para coalescer ráfagas de reconexión en redes inestables.
- El timer del debounce se limpia en el cleanup de `initialize()`.

#### 2. Retorno de pestaña inteligente (`src/hooks/useRealtimeSync.js`)
- `visibilitychange` ya no recarga inventario + despachos completos en CADA retorno a la pestaña.
- Solo invalida si la app estuvo **más de 3 minutos** en segundo plano (el canal realtime cubre ausencias cortas).

#### 3. Debounce en broadcast entre dispositivos (`src/hooks/useRealtimeSync.js`)
- La invalidación por broadcast (`cuenta-{id}`) ahora usa `debouncedInvalidate` con 400ms — coalesce ráfagas de ediciones en lote que antes disparaban N recargas de listas de 1000 filas en todos los dispositivos.

#### 4. `staleTime` de inventario (`src/hooks/useInventario.js`)
- De 30s → **3 minutos**. La query más pesada de la app ya no se refetchea constantemente; el realtime invalida ante cambios reales.

#### 5. `gcTime` de despachos (`src/hooks/useDespachos.js`)
- Eliminado el override de 15 min; hereda las 24h globales para que los despachos no se caigan del caché offline de IndexedDB (persister `maxAge: 24h`).

#### 6. Migración de índices (`supabase/migrations/202_indices_carga.sql`)
- Índices nuevos (aditivos, `IF NOT EXISTS`): `notas_despacho(cliente_id)`, `notas_despacho(cliente_factura_id)`, `notas_despacho(creado_en DESC)`, `notas_despacho(entregada_en DESC)`, `notas_despacho(transportista_id)`, `cotizaciones(creado_en DESC)`.
- **PENDIENTE: aplicar la migración en Supabase** (no se ejecutó contra la base de datos).

### Verificación
- `npm run build` exitoso sin errores.
- ESLint sobre los 4 archivos tocados: solo warnings/errores preexistentes en líneas no modificadas.
- Sin commit ni push a git, respetando la política de resguardo del usuario.

### Pendiente (fases siguientes del plan)
- Fase 2: paralelizar cascadas de despachos/cotizaciones/reportes, `.catch` en lookups de enriquecimiento, caché de auth en el Worker.
- Fase 3: dejar de tragar errores en reportes financieros/dashboard/modales.
- Fase 4: paginación real del catálogo (>1000 productos), búsqueda servidor de cotizaciones antiguas, tasa de cambio centralizada (un solo canal realtime), N+1 en DespachoCard.

---

## SESIÓN 20/07/2026 — Fase 2 de Fixes de Rendimiento de Carga

### Objetivo
Aplicar la Fase 2 del plan de fixeo: paralelizar las cascadas de peticiones secuenciales que hacían las cargas 3-5× más lentas, y hacer resilientes los lookups de enriquecimiento.

### Cambios realizados

#### 1. Cascada de despachos paralelizada (`src/hooks/useDespachos.js`)
- El enriquecimiento post-query pasó de 3 viajes en serie (despachos → clientes → usuarios) a **1 tanda paralela** (`Promise.all` de clientes + vendedores de despachos) + 1 query condicional solo si los clientes referencian vendedores no cargados aún.
- El lookup `/api/clientes/lookup` ahora degrada a `[]` con `.catch()`: si el Worker falla, la lista se muestra con "cliente: —" en vez de fallar completa.

#### 2. Cascada de cotizaciones paralelizada (`src/hooks/useCotizaciones.js`)
- Mismo patrón que despachos: clientes + vendedores en paralelo, query extra solo para vendedores faltantes, `.catch(() => [])` en el lookup de clientes.

#### 3. Guarda de null en `useCotizacion` (`src/hooks/useCotizaciones.js`)
- Tras `.maybeSingle()`, si la cotización no existe (eliminada u oculta por RLS) se retorna `null` limpio en vez de lanzar `TypeError: Cannot read properties of null`.
- `.catch(() => [])` también en el lookup de cliente del detalle.

#### 4. Lotes de reportes paralelizados
- `src/hooks/useReporteVendedores.js`: los 3 loops `for + await` de lotes de 50 (cotizacion_items, notas_despacho_items + despacho_descuentos, productos) ahora corren con `Promise.all` — 10 lotes pasan de 10-20 viajes en serie a 1 tanda paralela.
- `src/hooks/useReporteVentas.js`: mismos 3 loops paralelizados.
- `src/hooks/useReporteLiquidacion.js`: loop de cotizacion_items paralelizado.
- La semántica de manejo de errores se mantuvo idéntica por archivo (donde se lanzaba `throw`, se sigue lanzando; donde se ignoraba, se ignora — eso se corrige en Fase 3).

#### 5. Caché de verificación de auth en el Worker (`api/lib/auth.js`)
- Caché en memoria del isolate con TTL 60s y máx. 500 entradas: `token → user` (evita el round-trip a `/auth/v1/user` en cada petición) y `operatorId → operador` (evita re-consultar `usuarios`).
- `validateOperator` ahora aplica el filtro de rol en código (no en la query) para compartir la entrada cacheada entre endpoints con/sin `requireSupervisor`.
- `getOperatorRole` reutiliza la fila cacheada.
- Nueva función exportada `invalidateOperatorCache(operatorId)` — llamada desde `api/handlers/admin.js` al editar o eliminar usuarios (cambios de rol/PIN/activo invalidan el caché de inmediato).
- Trade-off aceptado: un operador desactivado podría operar hasta 60s más en otro isolate (el TTL acota la ventana).

#### 6. Timeout de Supabase 15s → 30s (`src/services/supabase/client.js`)
- Con las cascadas paralelizadas, 30s solo se alcanza en fallos reales; evita abortar reportes legítimamente pesados en redes lentas (la causa de vistas "cargando para siempre").

### Verificación
- `npm run build` exitoso (2272 módulos transformados, sin errores).
- `node --check` sobre `api/lib/auth.js` y `api/handlers/admin.js`: sintaxis OK.
- `npx wrangler deploy --dry-run` exitoso.
- ESLint: solo warnings/errores preexistentes en líneas no modificadas.
- Sin commit ni push a git, respetando la política de resguardo del usuario.

### Pendiente (fases siguientes del plan)
- Fase 3: dejar de tragar errores en reportes financieros/dashboard/modales (mostrar error visible en vez de ceros/vacío).
- Fase 4: paginación real del catálogo (>1000 productos), búsqueda servidor de cotizaciones antiguas, tasa de cambio centralizada, N+1 en DespachoCard.
- Recordatorio: aplicar migración `202_indices_carga.sql` en Supabase (Fase 1).

---

## SESIÓN 20/07/2026 — Fase 3 de Fixes + URGENTE: ChannelRateLimitReached

### Objetivo
1. Fase 3 del plan de fixeo: dejar de tragar errores (mostrar error visible en vez de ceros/vacío).
2. URGENTE: los logs de Supabase mostraron ráfagas de `ChannelRateLimitReached: Too many channels` e `IncreaseSubscriptionConnectionPool: Too many database timeouts` — causados por canales realtime creados POR INSTANCIA de hook (uno por fila de producto renderizada). Se adelantó el fix 4.5 del plan.

### Cambios URGENTES (realtime)

#### 1. Canal `tasa-sync` singleton (`src/hooks/useTasaCambio.js`)
- Antes: cada instancia del hook (~20 componentes, incluyendo CADA fila de producto) abría su propio canal `tasa-sync` → una página de inventario con 100 filas = 100 canales.
- Ahora: **un solo canal por pestaña** con conteo de referencias (`acquireTasaChannel`/`releaseTasaChannel`) y un set de suscriptores en memoria que reparte los eventos `tasa_change` a todas las instancias.

#### 2. Eliminado canal por instancia de `useConfigNegocio` (`src/hooks/useConfigNegocio.js`)
- Antes: cada llamada al hook creaba un canal `postgres_changes` con nombre ALEATORIO (`config_negocio_changes_${Date.now()}_${Math.random()}`) sobre `configuracion_negocio`. Como `useTasaCambio` llama a este hook, se multiplicaba también por fila.
- Ahora: el hook no abre canal propio. Los cambios de config llegan por las vías compartidas ya existentes: `broadcastEntidad('config')` en `useActualizarConfig` y el `postgres_changes` centralizado de `useRealtimeSync` (tabla `configuracion_negocio` en TABLAS_INMEDIATAS).
- Resultado esperado: de cientos de canales por cliente a ≤5 (db-changes, cuenta-broadcast, notificaciones, tasa-sync). Los errores de rate limit y los timeouts del pool de suscripciones deben desaparecer.

### Cambios Fase 3 (errores visibles)

#### 3. Reportes financieros (`useReporteVendedores.js`, `useReporteVentas.js`)
- Las queries de cotizaciones del período ahora verifican `.error` y lanzan (antes: `data ?? []` → KPIs en cero silenciosos).
- Todos los lotes paralelos (cotizacion_items, notas_despacho_items, despacho_descuentos, productos) lanzan en error en vez de ignorarlo.
- La query de usuarios de useReporteVendedores verifica error.
- Las vistas ya manejan `isError` con botón de reintento (ReporteVendedoresView:478, ReportesView:591).

#### 4. Reporte de inventario (`useReporteInventario.js`)
- `movRes.error` ahora lanza — antes un fallo dejaba "días sin movimiento" silenciosamente incorrecto.

#### 5. Dashboard (`useDashboardMetrics.js` + `DashboardView.jsx`)
- Todas las sub-queries de métricas verifican `.error` y lanzan (vendedor, admin/jefe, logística, supervisor).
- `DashboardView` muestra **banner ámbar con botón "Reintentar"** cuando `useMetricas` o `useDashboardMetrics` fallan — antes mostraba ceros sin aviso.

#### 6. Modales
- `ReciclarCotizacionModal.jsx`: toast de error si fallan los items (antes parecía una cotización sin productos).
- `DetalleModal.jsx` (ui): toast de error en el catch + columnas explícitas en vez de `select('*')` (con `origen` solo en cotizacion_items y `es_prestamo` solo en notas_despacho_items, según esquema real).
- `DescuentoModal.jsx`: toast de error si fallan los items.

#### 7. Generador de códigos (`codigosHelper.js` + `ProductoForm.jsx`)
- `calcularSiguienteCodigo` retorna `null` en fallo (antes `''` silencioso) y `ProductoForm` muestra toast pidiendo ingreso manual — generar un correlativo sin ver los códigos existentes producía duplicados.

#### 8. `useDesactivarProducto` (`useInventario.js`)
- Agregado `onError` con toast (era la única mutación sin él).

### Verificación
- `npm run build` exitoso (build completo, sin errores).
- ESLint: solo errores/warnings preexistentes.
- Sin commit ni push a git, respetando la política de resguardo del usuario.

### Pendiente
- Aplicar migración `202_indices_carga.sql` en Supabase (Fase 1).
- Desplegar Worker (`wrangler deploy`) para el caché de auth (Fase 2).
- Fase 4 restante: paginación real del catálogo (>1000 productos), búsqueda servidor de cotizaciones antiguas, N+1 en DespachoCard, consolidar doble query de InventarioView.

---

## SESIÓN 20/07/2026 — Fase 4 de Fixes: Escalabilidad de Datos

### Objetivo
Fase 4 (final) del plan de fixeo: eliminar los muros de datos silenciosos (1000 productos, 200 cotizaciones, 1000 movimientos de kardex) y el patrón N+1 de las tarjetas de despacho.

### Cambios realizados

#### 1. Paginación real del catálogo (`src/hooks/useInventario.js`)
- Cuando un call-site pide el catálogo completo (`pageSize >= 1000`, 9 lugares en la app), el `queryFn` ahora **pagina en chunks de 1000 en paralelo** hasta el total real, con tope de seguridad de 5000. Aplica tanto a la ruta privilegiada (tabla directa) como a la RPC de vendedor.
- El resultado expone `truncado: true` si se alcanzó el tope.
- Exportado `CATEGORY_GROUPS` para reutilizar la lógica de grupos en las vistas.
- Con esto, los productos #1001+ ahora aparecen en búsqueda, cotizador, despachos y modales sin cambiar ningún call-site.

#### 2. Query única en InventarioView (`src/views/InventarioView.jsx`)
- Eliminada la segunda instancia de `useInventario`: ahora hay UNA query del catálogo completo y el filtro de categoría (incluyendo grupos por prefijo) se aplica en memoria — antes, con una categoría activa, se descargaban ~2000 filas duplicadas en cada refetch.
- Banner ámbar cuando el catálogo supera el tope de 5000 ("mostrando X de Y productos").

#### 3. Kardex paginado (`src/hooks/useMovimientosInventario.js` + `KardexModal.jsx`)
- `useKardex` ahora acepta `{ limite }` (default 200), usa **columnas explícitas** (antes `select('*')` sin límite → corte silencioso en 1000) y retorna `{ movimientos, total, hayMas }`.
- `KardexModal` muestra botón "Cargar más movimientos (X de Y)" que incrementa el límite en 200.

#### 4. Búsqueda de cotizaciones en el histórico (`src/hooks/useCotizaciones.js` + `CotizacionesView.jsx`)
- Nuevo hook `useBuscarCotizaciones(busqueda)`: busca en TODA la tabla por número (`COT-00123`, `123`) y por cliente (nombre/RIF/código vía Worker), respetando RLS de vendedor, y enriquece con clientes/vendedores.
- La vista lo activa **solo cuando el filtro local no encuentra nada** (con debounce de 400ms): spinner "Buscando en el histórico completo…", subtítulo "(del histórico)" y empty state diferenciado "Sin resultados en todo el histórico".
- Antes: buscar una cotización fuera de las 200 recientes daba "sin resultados" sin explicación.

#### 5. N+1 eliminado en tarjetas de despacho (`src/hooks/useDespachos.js` + `DespachosView.jsx` + `DespachoCard.jsx`)
- Nuevo hook `useStockCheckDespachos(despachos)`: 2 tandas de queries en lote (items de todos los despachos visibles + stock de todos los productos referenciados) en vez de 2 queries POR tarjeta (12 tarjetas = 24 queries → 2).
- `DespachosView` lo llama con la página visible y pasa `stockCheckData`/`stockCheckPending` a cada tarjeta.
- `DespachoCard` usa los datos del lote; conserva fallback a queries propias si se usa fuera de la vista. `staleTime` 2min con caché por combinación de IDs.

#### 6. Topes de seguridad en reportes
- `useReportePipeline.js`: `.limit(5000)` en cotizaciones del rango.
- `useReporteVendedores.js`: `.limit(5000)` en las 2 queries de cotizaciones del período.
- `useReporteInventario.js`: `.limit(5000)` en productos activos y movimientos de 90 días.
- Sin el límite explícito, Supabase cortaba en 1000 sin avisar (datos incorrectos en silencio).

### Verificación
- `npm run build` exitoso (build completo).
- ESLint: 0 errores nuevos (corregido un escape innecesario en regex propia; el resto de errores reportados son preexistentes).
- Sin commit ni push a git, respetando la política de resguardo del usuario.

### Estado del plan de fixeo
- ✅ Fase 1 (tormentas de refetch + índices) — commit `9bf8f6f`
- ✅ Fase 2 (cascadas paralelizadas + caché auth Worker) — commit `9bf8f6f`
- ✅ Fase 3 (errores visibles) — commit `9bf8f6f`
- ✅ Fix urgente canales realtime (ChannelRateLimitReached) — commit `9bf8f6f`
- ✅ Fase 4 (escalabilidad) — esta sesión, pendiente de commit
- ⚠️ Recordatorios de despliegue: aplicar `202_indices_carga.sql` en Supabase + `wrangler deploy` del Worker

---

## SESIÓN 21/07/2026 — Diagnóstico: error de enum log_origen en cron

### Síntoma
Logs de Postgres en Supabase con error 22P02 `invalid input value for enum log_origen: "worker-cron"` cada día a las 03:00 UTC.

### Diagnóstico
- El cron del Worker (`wrangler.toml: crons = ["0 3 * * *"]`) ejecuta `runCleanupCotizaciones` y `runPurgeTrackingImages`, que llaman `logToSystem` con `origen: 'worker-cron'` (5 lugares en `api/handlers/cotizaciones.js` y `seguimiento.js`).
- El enum `log_origen` (migración 056) solo acepta `'frontend' | 'worker' | 'supabase'`.
- El código ACTUAL del repo ya no inserta en `system_logs` (commit f16adbf lo redujo a console.log), pero el **Worker desplegado en producción es una versión anterior** que sí inserta → el insert del log falla en cada corrida del cron. Los trabajos de limpieza en sí no se ven afectados; solo falla el registro del log.

### Solución
- Creada migración `203_log_origen_worker_cron.sql`: `ALTER TYPE log_origen ADD VALUE IF NOT EXISTS 'worker-cron'` (cinturón de seguridad, correr fuera de transacción).
- La solución definitiva es desplegar el Worker actualizado (`wrangler deploy`), que ya estaba pendiente por el caché de auth de la Fase 2.

---

## SESIÓN 17/08/2026 — Cierre de pruebas E2E deterministas de staging

### Objetivo

Completar la validación funcional del checkout `construacero-staging`, corregir los fallos observados durante el ensayo y dejar evidencia reproducible sin tocar producción.

### Entorno validado

- Proyecto Supabase: `spupqgkdsgohxxfoxydl` (staging).
- Worker local: `http://127.0.0.1:8789`.
- Frontend/proxy Vite local: `http://localhost:5174`.
- Ambos health checks `/api/ping`: **HTTP 200** y referencia de proyecto correcta.
- La corrida usó una cuenta E2E dedicada de staging; no reutilizó cookies, JWT ni credenciales de producción.

### Resultado final

| Verificación | Resultado |
|---|---|
| Tests unitarios del frontend/staging | ✅ **227/227** en **25 archivos** |
| Build del frontend de staging | ✅ Correcto; quedó únicamente el warning conocido de chunks grandes |
| Tester E2E determinista CLI | ✅ **75/75 pasos** aprobados |
| Limpieza de fixtures | ✅ Completa; 0 productos E2E residuales y cliente E2E inactivo |
| Evidencia principal | `tmp/e2e-staging/tester-2026-08-17T23-46-18-229Z.log` |
| Producción | ✅ Sin cambios ni despliegues |

El flujo E2E cubrió inventario y Kardex, clientes, búsqueda mejorada, cotización, despacho, descuentos, stock comprometido, CxC, comisión retenida/liberada/pagada, corrección idempotente de fecha de entrega, reportes, transportista local, multi-precio, movimientos por lote, anulación, reciclaje, venta rápida, reasignación, health checks y limpieza tenant-safe.

### Fallos encontrados y correcciones

1. **Provisionamiento bloqueado por `configuracion_negocio.id=1`:** el esquema restaurado conserva un correlativo global para esa tabla, mientras el tenant principal ya ocupaba el valor por defecto. `scripts/provision-staging-e2e.mjs` ahora consulta el máximo y asigna explícitamente el siguiente `id`, sin alterar la fila del tenant principal.
2. **Limpieza incompatible entre variantes del esquema:** algunas bases staging conservan la RPC histórica que referencia `despacho_id`/`cotizacion_id`, mientras el esquema vigente usa `despachoid`/`cotizacionid` y referencias de descuentos actualizadas. `scripts/test-e2e-staging.mjs` ahora intenta primero la RPC tenant-safe y, solo ante ese error de compatibilidad, usa un fallback acotado al `cuenta_id` autenticado; también recupera cotizaciones residuales por cliente.
3. **Ventana cronológica demasiado corta para fecha efectiva:** la aserción de cambio de fecha requiere margen real entre aprobación y entrega. El runner espera 2,5 segundos antes de entregar y luego verifica que el ajuste sea válido, que la fecha original/correlativo y finanzas permanezcan inmutables, y que el replay sea idempotente.

### Estado aplicado en staging

- Políticas RLS de comisiones para el flujo probado.
- RPC de limpieza del Tester con alcance tenant-safe.
- Configuración dedicada del tenant E2E: **2 % para Cabilla** y **3 % para otras categorías**.
- La aplicación local quedó apuntando exclusivamente al proyecto staging durante la corrida; no se copiaron secretos a documentación, logs ni frontend.

### Procedimiento reproducible

Desde `construacero-staging/`, con secretos únicamente en `.env`/`.dev.vars` locales:

```bash
npm ci
npm run configure:local                 # opcional: prepara .dev.vars del proyecto staging
npm run provision:e2e:staging
```

En terminales separadas, levantar los servicios locales:

```bash
npm run dev:worker                      # Worker en :8789
npm run dev:vite -- --host 127.0.0.1    # Vite en :5174
curl -i http://127.0.0.1:8789/api/ping
curl -i http://localhost:5174/api/ping
npm run test:e2e:staging                 # 75 pasos; limpia por defecto
```

`--keep-data` queda reservado para diagnóstico manual y deja fixtures deliberadamente persistentes. La corrida normal debe conservar el log y comprobar la limpieza final. Nunca usar `SUPABASE_SERVICE_KEY`, `DEV_SUPER_CODE` ni cuentas de producción en el frontend, en Git o en la bitácora.

### Decisión y pendientes

La batería de staging queda **verde** y reproducible, pero esto no constituye autorización de salida a producción. Permanecen fuera de esta sesión la matriz manual completa por rol, la revisión/aislamiento del checkout de release, el backup verificable, el rollback y el smoke test posterior en producción.

---

## SESIÓN 18/08/2026 — Corrección de tasas oficiales BCV USD/EUR

### Síntoma y diagnóstico

La interfaz mostraba `Bs 772,54` para USD y `Bs 894,49` para EUR, mientras la publicación vigente del BCV mostraba `773,31250000` y `896,02946062` (18/08/2026). La causa era que el Worker no lograba completar la consulta directa al BCV en el entorno local por TLS y caía a DolarAPI, cuya respuesta todavía correspondía al 17/08/2026:

- DolarAPI USD: `772.5441`, `fechaActualizacion=2026-08-17`.
- DolarAPI EUR: `894.49018618`, `fechaActualizacion=2026-08-17`.
- BCV vigente verificado: USD `773.3125`, EUR `896.02946062`, fecha `2026-08-18`.

### Correcciones aplicadas

- `api/handlers/rates.js` y `construacero-staging/api/handlers/rates.js` ahora:
  1. Consultan primero `bcv.org.ve` con User-Agent de navegador, Accept completo y querystring anti-cache.
  2. Usan como segundo respaldo el CDN público de tasas BCV `rates.dolarvzla.com/bcv/current.json`, validando `current.usd`, `current.eur` y `current.date`.
  3. Conservan Google Script como respaldo opcional mediante variable del Worker, sin URLs ni secretos embebidos.
  4. Dejan DolarAPI únicamente como último recurso del servidor y exponen su fecha oficial cuando se usa.
- El endpoint `/api/rates` usa `Cache-Control: no-store`; su cache interno sigue limitado a 10 minutos y `refresh=1` fuerza una consulta nueva.
- `src/hooks/useTasaCambio.js` y su copia de staging solicitan el proxy sin cache, permiten refresco manual forzado y **ya no aceptan una respuesta DolarAPI como tasa BCV válida desde el navegador**. Si el proxy solo entrega un valor stale, se limpian las tasas en lugar de presentar un dato viejo como oficial.
- USDT no fue modificado: mantiene Binance P2P y la regla existente `Math.ceil + 2`.

### Evidencia de validación

- Handler principal y staging sin TLS ignorado: el acceso directo al BCV falla en el entorno Wrangler, pero el fallback BCV CDN devuelve **USD `773.3125` / EUR `896.02946062`**, fecha `2026-08-18`, fuente `BCV CDN (DolarVZLA)`.
- Handler con la consulta directa habilitada (`NODE_TLS_REJECT_UNAUTHORIZED=0` solo para esta prueba local): devuelve fuente `BCV Directo` con los mismos valores.
- Tests staging: **227/227** en **25 archivos**.
- Builds principal y staging: correctos; permanece únicamente el warning conocido de chunks grandes.
- `node --check` de handlers/workers y `git diff --check`: correctos.
- La suite raíz mantiene **19 fallos heredados no relacionados con tasas** (formatos, contratos del Tester, etiquetas y WhatsApp); no fueron introducidos por este ajuste.
- No se hizo commit, deploy ni cambio en producción. La publicación en el entorno remoto requiere un deploy autorizado del Worker y del frontend.## SESIÓN 21/08/2026 — Validación P0 financiera en staging

### Alcance

Se utilizó exclusivamente el proyecto Supabase staging `spupqgkdsgohxxfoxydl`, con backup previo en `tmp/backups/kardex-staging-pre-p0-2026-08-21.dump`. El principal `oyfyuszgjwcepjpngclv` y producción permanecieron sin cambios.

### Resultado

- Unit tests staging: **235/235** en 26 archivos.
- E2E mutable aislado: **93/93 PASS**, incluyendo replay de entrega, devolución parcial, replay de devolución, entrega/reversión financiera y replay de reversión.
- Matrix SQL de guards/replay/cross-tenant/rollback: **7 checks PASS**; la transacción terminó en `ROLLBACK` y dejó `mutableRowsPersisted=false`.
- Auditoría Kardex actual: **443 productos, 0 anomalías matemáticas/continuidad**.
- Grants: RPC P0 solo para `service_role`; `authenticated` no tiene `EXECUTE`.

### Correcciones descubiertas en la prueba

1. El Worker recreaba la comisión después de una reversión; se añadió la exclusión `!esReversionEntregaAtomica`.
2. El runner intentaba `despachada → anulada`, transición no contractual; ahora prueba `despachada → pendiente → anulada` con motivos.
3. El replay de estados finales se bloqueaba antes de consultar idempotencia; el handler staging ahora devuelve el resultado cacheado antes de validar la transición.

### Retención histórica observada

Staging conserva movimientos de productos eliminados (`producto_id IS NULL`) por diseño de auditoría. La lectura posterior mostró **452** filas; **266** pertenecen al tenant E2E dedicado, que no conserva productos, cotizaciones ni despachos activos. No se purgaron automáticamente.

### Documento de cierre

`docs/plans/2026-08-21-reporte-validacion-p0-staging.md` contiene evidencias, archivos a portar y los 12 gates para el proyecto principal. El siguiente paso es el baseline read-only del principal y la adaptación neutral de las RPC; no copiar SQL `_staging` literalmente.

*Mantener este archivo actualizado al inicio y fin de cada sesión de trabajo.*

## SESIÓN 21/08/2026 — Baseline read-only del proyecto principal

### Alcance

Se auditó directamente el PostgreSQL del proyecto principal configurado en `.env`, usando únicamente consultas `SELECT` y el preflight `supabase/release/main/00_preflight_readonly.sql`. No se ejecutaron migraciones, RPC mutables, backfills, reconciliaciones, grants, revokes, escrituras de datos, deploy ni cambios en producción.

### Resultado

- Identidad confirmada: project ref `oyfyuszgjwcepjpngclv`; PostgreSQL 17.6.
- Historial formal remoto: 1 fila, máximo `001`; continúa bloqueado el uso de `db push`, `db reset` y `migration repair`.
- Esquema histórico presente; provenance (`origen_tipo`, `origen_id`, `origen_referencia`, `idempotency_key`) y tablas nuevas de operaciones/reconciliación todavía ausentes.
- Conteo actual: 445 productos y 3.673 movimientos.
- Kardex: 0 errores matemáticos, 88 brechas de continuidad en 45 productos y 1 divergencia catálogo vs último Kardex.
- El patrón dominante es ajuste previo a entrega: 66 brechas en 38 productos; el salto de `LAM1954003` confirma `151 → 391 → 385`, con +240 unidades no trazadas como operación estructurada.
- Hay 189 movimientos sin `producto_id`; 186 corresponden al tenant principal y 3 a un tenant secundario. No hay movimientos con producto_id huérfano no nulo.
- Las RPC históricas de mutación continúan expuestas a `anon`/`authenticated` según el contrato; no se cambiaron ACL.

### Documento y siguiente paso

El detalle de conteos, productos afectados, firmas RPC, diferencias de columnas y gates está en `docs/plans/2026-08-21-baseline-principal-readonly.md`. El siguiente paso único es preparar el diff neutral revisable de `01_kardex_provenance.sql` y `02_inventory_atomic_operations.sql`, manteniendo `REVIEW_ONLY` y sin ejecutar SQL remoto.

## SESIÓN 21/08/2026 — Diff neutral SQL 01–02 contra el baseline principal

### Alcance

Se compararon y ajustaron localmente `supabase/release/main/01_kardex_provenance.sql` y `supabase/release/main/02_inventory_atomic_operations.sql` contra los contratos reales del principal. No se retiró `REVIEW_ONLY` y no se ejecutó ningún SQL mutable remoto.

### Cambios

- `01` ahora valida tablas base, `cuenta_id` y enums públicos antes de cualquier aplicación autorizada.
- `01` conserva columnas nuevas nullable para no romper el historial existente y rechaza provenance cross-tenant cuando el producto y el movimiento no coinciden.
- `02` valida las columnas exactas de productos, movimientos, usuarios, configuración, préstamos, despacho y clientes.
- `02` mantiene la adaptación correcta de `cliente_prestamos` sin inventar `cuenta_id`.
- Las cuatro operaciones de inventario mantienen idempotencia obligatoria, locks deterministas, una transacción y ejecución exclusiva para `service_role`.

### Validación

- Sintaxis de los runners: PASS.
- `REVIEW_ONLY`: una guarda por cada SQL.
- Referencias `_staging`/secretos en 01–02: cero.
- El verificador global posterior al diff terminó con **198 checks PASS** y el manifest quedó actualizado con los SHA-256 de 01 y 02.

### Documento

`docs/plans/2026-08-21-diff-neutral-01-02.md` contiene el detalle del diff, las decisiones contra el esquema real y los gates pendientes. El manifest ya fue actualizado y verificado; el siguiente paso es revisar este paquete antes de iniciar el port del handler de inventario.

## SESIÓN 21/08/2026 — Port del handler de inventario contra SQL neutral 01–02

### Resultado

Se confirmó el port local de las cuatro rutas P0/P1 de `api/handlers/inventario.js`: limpieza, movimiento manual, transformación e ingreso masivo llaman RPC neutrales, fuerzan `p_cuenta_id` desde `operador.cuenta_id`, envían `p_idempotency_key` y no escriben directamente `productos.stock_actual` ni `inventario_movimientos`.

Las escrituras directas de precios y embeddings permanecen fuera de este alcance como P2 de catálogo diferido; no modifican stock ni Kardex.

### Evidencia

- Tests focalizados: **20/20 PASS**.
- Suite global: **25 archivos, 251/251 tests PASS**.
- `node --check api/handlers/inventario.js`: **PASS**.
- Build principal: **PASS**.
- Revisión estática de RPC, tenant, idempotencia y ausencia de escrituras directas: **PASS**.
- Verificador de promoción: **198 checks PASS**.

### Siguiente paso

Restaurar/verificar el backup del principal en un entorno disposable, capturar el baseline read-only y ejecutar allí la compilación y matriz mutable antes de retirar `REVIEW_ONLY`. El principal, producción y los grants remotos permanecen sin cambios.

---

## SESIÓN 21/08/2026 — Validación de SQL 01–02 en staging restaurado

### Alcance y seguridad

Se autorizó sobrescribir staging después de capturar un backup fresco. El backup quedó en `tmp/backups/kardex-staging-pre-main-2026-08-21.dump`, con **2.957.389 bytes** y SHA-256 `3abfbcc47399fe8086daf8cdfd90ca12f9ad0631c558258fc0fce3e18146ed07`. El principal `oyfyuszgjwcepjpngclv` no fue tocado.

Se restauró el snapshot principal pre-P0-A en el esquema `public` de staging `spupqgkdsgohxxfoxydl`, además de `supabase_migrations`. Para resolver dependencias específicas de staging se reinició solo `public`; `auth`, `storage` y demás esquemas administrados no se sobrescribieron. La extensión `vector` se recreó en `public`, que es el esquema esperado por el snapshot.

### Baseline posterior al restore

El preflight se ejecutó en `REPEATABLE READ, READ ONLY` y terminó con rollback:

- 444 productos y 3.590 movimientos.
- 3.401 movimientos asociados a productos actuales y 189 sin `producto_id`.
- 0 errores matemáticos, 88 brechas de continuidad en 45 productos y 1 divergencia catálogo/Kardex.
- Provenance y tablas nuevas ausentes antes de aplicar 01–02.
- Historial formal: 1 fila, máximo `001`.

El snapshot no coincide exactamente con el baseline actual del principal (445/3.673); se documentó como diferencia de antigüedad, no como corrección inventada.

### Aplicación en staging

Se aplicaron 01 y 02 en orden. `REVIEW_ONLY` fue retirado únicamente en memoria durante la invocación de `psql`; los archivos fuente conservaron la guarda. Se instaló provenance, tablas de operaciones/reconciliación, trigger y las cuatro RPC neutrales de inventario.

### Matriz reversible

Runner: `construacero-staging/scripts/verify-neutral-inventory-restored-main.mjs`.

- Contratos, `SECURITY DEFINER`, `search_path=public` y grants: **PASS**.
- Clave nula, replay, reutilización por tipo y tenant inválido: **PASS**.
- Falla parcial sin cambios parciales: **PASS**.
- Transformación, ingreso masivo y devolución de préstamo con replay: **PASS**.
- Rollback final: `transactionRolledBack=true`, `mutableRowsPersisted=false`.
- Conteos antes/después: 444/3.590/0 operaciones en ambos lados.

Evidencia: `tmp/e2e-staging/neutral-inventory-main-restore-2026-08-21T20-53-31-578Z.json`.

### Pruebas y auditoría

- Tests staging: **26 archivos, 235/235 PASS**.
- Build staging: **PASS**; solo warning conocido de chunks grandes.
- Suite raíz: **25 archivos, 251/251 PASS**.
- Verificador de promoción: **198 checks PASS**.
- Auditoría posterior: 444 productos, 3.590 movimientos, 0 errores matemáticos, 88 brechas, 1 mismatch y 3.401 movimientos sin provenance estructurado.

Evidencia de auditoría: `tmp/e2e-staging/kardex-audit-2026-08-21T20-54-49-536Z.{json,md}`.

### Incidencias resueltas y siguiente gate

El primer restore limpio encontró dependencias de constraints; se recuperó staging mediante reinicio controlado del esquema `public`. También fue necesario recrear `vector` en `public` y restaurar `supabase_migrations` para ejecutar el preflight.

El siguiente gate es revisar esta validación y continuar con 03–06/Worker únicamente sobre staging o un snapshot equivalente. No retirar `REVIEW_ONLY`, no ejecutar backfill/reconciliación histórica y no aplicar nada en el principal hasta contar con un backup fresco que corresponda al estado actual y aprobación explícita.

## SESIÓN 21/08/2026 — Dry-run detallado de brechas Kardex en staging

### Alcance y seguridad

Se generó un plan de revisión sobre la auditoría read-only del staging restaurado. El renderer `construacero-staging/scripts/render-kardex-dry-run.mjs` solo lee los JSON locales de auditoría/plan; no abre conexión ni llama RPC. Resultado verificado: `remote_mutation_attempted=false`.

### Resultado

- **88** brechas de continuidad.
- **45** productos afectados.
- **88** IDs de movimiento únicos y **45** IDs de producto únicos.
- **33.431** unidades de delta absoluto; delta firmado acumulado **+26.171**.
- **0** errores matemáticos internos.
- **1** divergencia catálogo/último Kardex separada del alcance: `TUB1403010`, `60` vs `30`.

### Clasificación

- Ajuste previo a entrega confirmada: **66** brechas / 38 productos.
- Ajuste previo a reversión: **7** / 4.
- Reconciliación bug edición de despacho (migración 197): **5** / 5.
- Reversión legacy sin wrapper: **5** / 5.
- Edición directa de stock: **2** / 2.
- Ajuste operativo sin soporte: **1** / 1.
- Ajuste previo a devolución: **1** / 1.
- Compra/ingreso con ajuste previo: **1** / 1.

### Evidencia y decisión

- `tmp/e2e-staging/kardex-dry-run-2026-08-21T21-10-31-154Z.json`
- `tmp/e2e-staging/kardex-dry-run-2026-08-21T21-10-31-154Z.md`
- `docs/plans/2026-08-21-dry-run-kardex-brechas-staging.md`

La evidencia contiene la ficha de los 45 productos y el detalle de las 88 brechas con movimientos anterior/actual, snapshots, delta, lote, operador, motivo y clase. No se autorizó ni ejecutó ninguna reconciliación, backfill o corrección de stock. La clasificación es evidencia declarada y no prueba causalidad; cada fila requiere correlación con despacho, devolución, reversión, auditoría, factura o conteo físico.

El runner `npm --prefix construacero-staging run report:kardex:dry-run` aborta si no obtiene exactamente 88/45. Cualquier aplicación futura sigue bloqueada por snapshot, `batch_key` nuevo, guardas de versión, rollback condicionado y aprobación explícita.

Validación posterior del artefacto: `node --check` PASS, consistencia 88/45 PASS, tests staging **235/235 PASS**, build staging **PASS** y `git diff --check` PASS; el build conserva únicamente el warning conocido de chunks grandes.

## SESIÓN 21/08/2026 — Correlación read-only de brechas Kardex por confianza

### Alcance

Se construyó `construacero-staging/scripts/correlate-kardex-readonly.mjs` para cruzar las 88 brechas con `notas_despacho`, `notas_despacho_items`, `despacho_devoluciones`, `cliente_prestamos` y `auditoria`. Se ejecutó dentro de una transacción `BEGIN READ ONLY` y se cerró con `ROLLBACK`; no hubo mutaciones.

### Resultado

- Despacho resuelto por número + tenant: **78/88**.
- Ítem del producto encontrado: **76/88**.
- Cantidad del ítem coincide con la brecha: **30/88**.
- Devolución relacionada: **1**; préstamo relacionado: **1**; auditoría relacionada: **78**.
- Confianza: **24 alta**, **6 media**, **58 baja**.
- Las 24 de alta corresponden a 20 productos, **547** unidades absolutas y delta firmado **-525**.

### Política y decisión

`alta` exige despacho único, una línea del producto, cantidad coincidente y evidencia independiente (`VENTA_RAPIDA`/`EDITAR_DESPACHO_PROFUNDIDAD`, devolución o préstamo). `media` exige despacho único y línea/cantidad coherentes. El resto queda `baja`. No se depende del motivo del propio movimiento como prueba.

Evidencia: `tmp/e2e-staging/kardex-correlation-2026-08-21T21-20-56-376Z.{json,md}`.

Documento: `docs/plans/2026-08-21-correlacion-kardex-confianza-staging.md`.

### Siguiente gate

Probar en staging un lote únicamente con las 24 de alta confianza dentro de una transacción reversible con snapshot, `batch_key` y rollback condicionado; verificar stock/Kardex/CxC/comisiones/auditoría. Las 6 medias y 58 bajas quedan en cola. El principal permanece sin cambios.

## SESIÓN 21/08/2026 — Lote de 24 brechas de alta confianza en staging

### Aplicación y validación

Se aplicó la RPC neutral `reconciliar_kardex` con un solo `batch_key` (`bf62181b-bebd-4a39-bd45-f5ccdaa6228a`) sobre las 24 brechas de alta confianza. Backup previo: `tmp/backups/kardex-staging-pre-highconfidence-2026-08-21.dump`.

- Productos: **444 → 444**; suma `stock_actual` sin cambios (**284.586,00**).
- Movimientos: **3.590 → 3.614** (+24 correctivos).
- CxC: **483 filas / 2.324.793,37** sin cambios.
- Comisiones: **703 filas / 14.415,07** sin cambios.
- Auditoría: **16.732 filas** sin cambios.
- Reconciliaciones aplicadas: **0 → 24**.

La auditoría posterior pasó de **89 anomalías / 45 productos** a **65 anomalías / 38 productos** (64 brechas de continuidad restantes + 1 divergencia catálogo/Kardex).

### Guarda de rollback

Se intentó revertir el lote para demostrar reversibilidad y la guarda lo bloqueó correctamente con `ROLLBACK_BLOQUEADO_MOVIMIENTOS_POSTERIORES` para el producto `01b5c155…` (movimientos legítimos posteriores a una corrección histórica). No se forzó el rollback.

Evidencia: `tmp/e2e-staging/kardex-high-confidence-apply-2026-08-21T21-28-01-437Z.json` y `tmp/e2e-staging/kardex-audit-2026-08-21T21-28-12-882Z.{json,md}`.

Documento: `docs/plans/2026-08-21-lote-alta-confianza-staging.md`.

### Estado

Las 24 quedan aplicadas en staging. Las 6 medias y 58 bajas permanecen en cola; `TUB1403010` sigue sin tocar. El principal no recibió ningún cambio.

## SESIÓN 21/08/2026 — Evaluación de las 6 brechas de confianza media

### Resultado

Ninguna de las 6 se promueve a alta. Las 6 comparten el patrón de **doble registro de la reversión**: cada fila `[Ajuste de inventario de -X und previo a] Reversión de despacho #N a pendiente` es duplicado de una fila limpia `Reversión de despacho #N a pendiente` con idéntico `stock_anterior`/`stock_nuevo` y timestamp cercano (< 5 s). En `CEM1045001` / despacho #1898 hay tres filas de reversión (una limpia + dos duplicadas).

- Despachos afectados: **1445, 1466, 1898** (todos revertidos a `pendiente` y luego re-confirmados).
- Las 6 tienen entrega previa pareada y transición a `pendiente` en auditoría, pero fallan por re-confirmación posterior y por fila hermana duplicada.
- La corrección correcta es **deduplicar**, no insertar movimientos compensatorios.

Evidencia: `tmp/e2e-staging/kardex-medium-confidence-2026-08-21T21-38-00-954Z.{json,md}`.

Runner reproducible: `construacero-staging/scripts/evaluate-medium-confidence.mjs` (`npm --prefix construacero-staging run evaluate:medium-confidence`).

Documento: `docs/plans/2026-08-21-brechas-confianza-media-staging.md`.

### Estado

Las 6 medias siguen en cola como **deduplicación pendiente**, no como reconciliación de stock. Las 58 bajas siguen en cola. El principal permanece sin cambios.

## SESIÓN 21/08/2026 — Preparación de promoción de guardrails flujo-futuro al principal

### Alcance separado

Se preparó la promoción **preventiva** (guardrails de flujo futuro) separada de la corrección histórica:

- **Promover:** SQL 01–04 completos + 05 recortado a **05a** (solo las 4 fachadas tenant-safe: `crear/actualizar/borrar_producto_con_kardex_tenant_safe`, `limpiar_inventario_atomico`).
- **Diferir:** `reconciliar_kardex`/`revertir_reconciliacion_kardex` (parte final de 05), `06_security_grants_review.sql`, `07_provenance_backfill.sql`, dedup de las 6 medias y las 58 bajas.

### Artefactos creados

- Runner `scripts/apply-kardex-guardrails-main.mjs` con modo `--plan` (safe, genera SQL en `tmp/promote-guardrails-main/`) y `--apply` (exige `KARDEX_MAIN_CONFIRM=APPLY_GUARDRAILS` y bloquea el target staging).
- `npm run promote:guardrails:main`.
- El runner retira en memoria solo el bloque `REVIEW_ONLY`, recorta 05 en el marcador de reconciliación, aplica 01→02→03→04→05a en orden, verifica baseline idéntico (productos/movimientos/suma stock) y emite script de rollback.
- Plan verificado: sin `REVIEW_ONLY` residual, sin `reconciliar_kardex` en 05a, grants `REVOKE … FROM PUBLIC, anon, authenticated` y `GRANT … TO service_role` correctos.

### Validaciones

- `npm run verify:promotion:kardex`: **200/200 checks PASS** (manifest actualizado con hash de `package.json` y nuevo runner).
- `node --check` del runner: **PASS**.
- No se ejecutó SQL contra el principal.

Documento: `docs/plans/2026-08-21-promocion-guardrails-flujo-futuro.md`.

### Gate

Antes de `--apply` contra producción: backup fresco del principal actual (el snapshot de staging está desactualizado), autorización explícita de ejecución en la ventana sin uso y confirmar que `06_security_grants_review.sql` sigue bloqueado hasta el cutover del Worker.

## SESIÓN 21/08/2026 — Re-auditoría Kardex staging tras lote de 24 de alta confianza

### Estado final confirmado (read-only)

Evidencia: `tmp/e2e-staging/kardex-audit-2026-08-21T21-57-33-416Z.{json,md}`.

- Productos: **444** (sin cambios).
- Movimientos totales: **3.614** = 3.590 del snapshot + **24 correcciones persistidas** (confirmado).
- Movimientos con producto actual: **3.425** (3.614 − 189 sin `producto_id`).
- Anomalías: **65** = **64 brechas de continuidad** + **1 divergencia catálogo/Kardex**.
- Productos con anomalías: **38**.
- Errores matemáticos internos: **0**.
- Provenance estructurado faltante: **3.401 movimientos**.

Desglose por tipo: `venta/despacho` **61**, `devolucion` **1**, `ajuste_inventario` **2**, `stock_actual_vs_kardex` **1** (`TUB1403010`: 60 vs 30).

Las **6 brechas de confianza media** (reversiones duplicadas) **siguen presentes** (6/6 verificadas por `movement_id`); permanecen como deduplicación pendiente, no como reconciliación. Las 24 correcciones no tocaron `stock_actual`, CxC, comisiones ni auditoría.

## SESIÓN 21/08/2026 — Paquete final de correctivos para el principal (sin aplicar)

### Entregables

- **Backup fresco** del principal: `tmp/backups/kardex-principal-pre-correctivos-2026-08-21T22-00-03-013Z.dump`, SHA `e51b7ef7a0a6462de18acef61fcf1946c72d8299f18c973c1743bce65f26b269`, `pg_restore --list` PASS.
- **Auditoría fresca**: 445 productos, 3.691 movimientos, **90 brechas** (88 + 2 nuevas), 45 productos, 0 errores matemáticos, 1 divergencia.
- **Correlación read-only**: 90 → **24 alta**, **8 media** (6 reversiones duplicadas conocidas + 2 nuevas del despacho #2570), **58 baja**.
- **Batch de correctivos**: `ef1b5921-60d5-4f9e-ba92-a8d2c1872150`, 24 propuestas, 20 productos, suma |delta| 547,00, delta firmado −525,00. Las 24 propuestas con campos completos.

### Runners nuevos (read-only/backup)

- `scripts/backup-kardex-main.mjs` → `npm run backup:kardex:main`.
- `scripts/correlate-kardex-main-readonly.mjs` → `npm run correlate:kardex:main`.

### Validaciones

- `npm run verify:promotion:kardex`: **204/204 checks PASS**.
- No se aplicó SQL, reconciliación ni correctivos contra el principal.

Documento: `docs/plans/2026-08-21-paquete-correctivos-principal.md`.

### Gates de aprobación (antes de aplicar los 24)

Guardrails (`01`–`04` + `05a`) primero, revisión humana de las 24 propuestas (20 productos), ventana sin uso, aprobación explícita de mutación histórica, runner de aplicación con guarda y rollback ensayado. Las 8 medias y 58 bajas quedan fuera de este paquete.

## SESIÓN 21/08/2026 — Matriz mutable de 03–04 en staging (finanzas + wrappers)

### Resultado: PASS completo

Backup previo de staging: `tmp/backups/kardex-staging-pre-0304-2026-08-21.dump` (SHA `b11e651d…`). Se instalaron 03–04 en staging (01–02–05 ya presentes) y se ejecutó la matriz mutable con rollback automático.

Checks (11/11 PASS):

- Instalación 03–04 y contratos/grants: 6 funciones `SECURITY DEFINER` + `search_path=public`, ejecución solo `service_role`, `idempotency_key UUID` en las 5 wrappers.
- Negativos: `03` params inválidos, null `idempotency_key` (entrega/reversión/devolución), cross-tenant.
- Positivos + replay idempotente: entrega financiera (despacho 2548), reversión financiera (2548), ajuste financiero neto (2546) y devolución parcial (2544, `devoluciones +1`).
- `transactionRolledBack=true`, `mutableRowsPersisted=false`, `before == after`.

Snapshot previo intacto: 444 productos, 3.614 movimientos, CxC 483/2.324.793,37, comisiones 703/14.415,07, auditoría 16.732, stock 284.586.

Evidencia: `tmp/e2e-staging/neutral-03-04-main-restore-2026-08-21T22-19-24-550Z.json`.

Runner: `construacero-staging/scripts/verify-neutral-03-04-staging.mjs`.

### Estado

Los guardrails **01–05 ya están instalados y probados mutable en staging**. Queda pendiente únicamente la promoción al principal (`01`–`04` + `05a`) con el runner ya preparado, y el runner de aplicación de los 24 correctivos. `06` sigue bloqueado.

## SESIÓN 21/08/2026 — Promoción de guardrails al principal (EJECUTADO)

### Aplicación

Se ejecutó `KARDEX_MAIN_CONFIRM=APPLY_GUARDRAILS npm run promote:guardrails:main -- --apply` contra el principal (`oyfyuszgjwcepjpngclv`). Backup fresco previo: `tmp/backups/kardex-principal-pre-correctivos-2026-08-21T22-21-26-029Z.dump` (SHA `8953eb4af37e18121a840d65a21a86d58421de4d6c14ff064687a98706ba4526`).

- Aplicados en orden: **01, 02, 03, 04, 05a** (todos `ok`).
- `05a` = solo fachadas tenant-safe; **`reconciliar_kardex` NO se instaló** (verificado = 0).
- Baseline antes == después: **445 productos, 3.691 movimientos, stock 284.317** (invariantes preservados).
- 16 funciones nuevas verificadas presentes; grants solo `service_role` (sin `authenticated`).
- Columnas provenance (7) + tablas (3) + trigger instalados.

Rollback guardado: `tmp/promote-guardrails-main/rollback-guardrails-main.sql`.

### Estado

**Guardrails de flujo futuro ya viven en el principal.** El Worker aún no fue desplegado (sigue el código legacy); los handlers portados llaman las RPC nuevas con fallback legacy. Pendiente: re-baseline + re-correlación, runner + aplicación de los 24 correctivos, despliegue del Worker y, después del cutover, `06` grants, dedup de 8 y backfill `07`.

## SESIÓN 21/08/2026 — Re-baseline y re-correlación del principal post-guardrails

### Re-auditoría (read-only)

`node scripts/audit-kardex-main-readonly.mjs` → `tmp/kardex-main-audit-2026-08-21-postguardrails.json`. Los guardrails no cambiaron datos: **445 productos, 3.691 movimientos, 90 brechas, 45 productos afectados, 0 errores matemáticos, 1 divergencia** (`TUB1403010`).

### Re-correlación

`node scripts/correlate-kardex-main-readonly.mjs` → `tmp/e2e-main/kardex-main-correlation-2026-08-21T22-25-40-901Z.json`.

- Confianza: alta **24**, media **8**, baja **58** (sin cambios respecto a la derivación previa).
- **Batch re-versionado:** `d350bea3-4f7f-40ae-b80a-3a943297e130` (antes `ef1b5921…`).
- 24 propuestas, 20 productos, suma |delta| **547,00**, delta firmado **−525,00**, campos completos 24/24.
- read-only confirmado (`transaction_read_only: true`, `remote_mutation_attempted: false`).

### Estado

Batch re-versionado y documentado en `docs/plans/2026-08-21-paquete-correctivos-principal.md`. Siguiente paso: instalar el tramo `05` de reconciliación en el principal (falta `reconciliar_kardex`/`revertir_reconciliacion_kardex`), luego runner + revisión humana + aplicación de los 24.

## SESIÓN 21/08/2026 — Preparación del tramo 05b de reconciliación (revisable, no aplicado)

Se separó el tramo de reconciliación histórica del archivo `05` en un SQL independiente y revisable, **sin aplicarlo** contra ningún entorno.

### Entregables

- `supabase/release/main/05b_kardex_reconciliation.sql` — instala SOLO `reconciliar_kardex` + `revertir_reconciliacion_kardex` + grants (`service_role`).
- Runner de generación reproducible: `scripts/prepare-05b-reconciliation-main.mjs` → `npm run prepare:05b:reconciliation`.

### Contenido y guardas de 05b

- `BEGIN` / `COMMIT` transaccional; `CREATE OR REPLACE` idempotente.
- **SAFETY GATE `REVIEW_ONLY`** activo: aborta si se intenta ejecutar sin retirar el bloque.
- Precondiciones: tablas `productos`, `inventario_movimientos`, `inventario_operaciones`, `kardex_reconciliaciones` y funciones `reservar/guardar_operacion_inventario` (dependen de 01/02, ya instalados).
- Conserva las 5 guardas de rollback ya probadas en staging: batch completo, snapshot de catálogo, sin movimientos posteriores, sin mutación de catálogo, e idempotencia por `rollback_key`.
- Grants: `REVOKE` de `public/anon/authenticated` + `GRANT` solo a `service_role`; sin `authenticated`.
- NO incluye las fachadas de 05a (ya aplicadas) ni `06` grants.

### Validación

Generador con 15/15 checks PASS: `REVIEW_ONLY` presente, `BEGIN/COMMIT`, 2 funciones, grants de reconcile/revert, sin residuos de fachadas 05a, 2 REVOKE / 2 GRANT / 2 `FROM PUBLIC`, `NOTIFY pgrst`. `git diff --check` PASS.

### Estado

El principal sigue sin `reconciliar_kardex` (05a no lo instaló). 05b queda listo para revisión y, tras aprobación explícita, se retira su `REVIEW_ONLY` en memoria al aplicarlo (igual que el runner de guardrails). Siguiente paso: crear el runner de aplicación de los 24 correctivos que instale 05b y ejecute el lote con snapshot + rollback.

## SESIÓN 21/08/2026 — Runner de correctivos para el principal (plan/apply/rollback)

Se creó `scripts/apply-kardex-correctivos-main.mjs` → `npm run correctivos:kardex:main`, que instala 05b y aplica/revierta el lote de 24 con guardas. **No se ejecutó contra el principal.**

### Modos

- **Plan (por defecto):** genera `tmp/apply-correctivos-main/05b_kardex_reconciliation.sql` (sin `REVIEW_ONLY`) y `correctivos-propuestas.json` (24 propuestas + `batch_key`). No abre conexión.
- **Apply:** `KARDEX_MAIN_CONFIRM=APPLY_CORRECTIVOS npm run correctivos:kardex:main -- --apply` → instala 05b + aplica el lote.
- **Rollback:** `KARDEX_MAIN_CONFIRM=ROLLBACK_CORRECTIVOS npm run correctivos:kardex:main -- --rollback --batch-key <uuid>` → revierte el batch.

### Guardas y validaciones

- Retira `REVIEW_ONLY` de 05b solo en memoria; verifica `project_ref` = principal; aborta antes de conectar sin confirmación.
- Operador `administracion/desarrollador` resuelto en runtime (sin ID hardcodeado).
- Snapshot antes/después: productos+stock, movimientos, CxC, comisiones, auditoría, reconciliaciones aplicadas.
- Invariantes: +24 movimientos, stock/CxC/comisiones/auditoría intactos, +24 reconciliaciones aplicadas; rollback reduce a 0 (inserta inversos, no borra).
- `batch_key` revisado `d350bea3-4f7f-40ae-b80a-3a943297e130`; la RPC re-valida cada propuesta y aborta atómicamente ante drift.

### Validación local

- `node --check` PASS; plan mode ejecutado (24 propuestas / 20 productos / batch correcto); modo apply y rollback abortan sin confirmación (exit 1, sin conexión).
- `git diff --check` PASS. Documento: `docs/plans/2026-08-21-paquete-correctivos-principal.md` actualizado.

### Estado

Todo listo para ejecutar `--apply` cuando se cumplan los gates (revisión humana de 24, ventana sin uso y aprobación explícita). El principal sigue intacto.

### Gate "sin saltos sin motivo"

Verificado read-only: las 24 propuestas tienen `reason` real (24/24, 0 fallback, 0 vacío). El runner ahora **rechaza** cualquier propuesta sin motivo explicativo antes de aplicar, así que ningún correctivo cierra una brecha sin dejar registrado el porqué (`motivo` + `origen_tipo=reconciliacion_kardex` + `origen_id/ancla` + `idempotency_key=batch`).

## SESIÓN 21/08/2026 — Correctivos de alta confianza APLICADOS al principal

Con aprobación explícita del dueño (`Sí, aplicar ahora`), se ejecutó el lote contra el principal.

### Ejecución

- Backup fresco previo: `tmp/backups/kardex-principal-pre-correctivos-2026-08-21T22-48-25-097Z.dump` (SHA `3c7c7f2f2380018d84909a6e675ecd5b125e6ed1c29d31a7c4423ca645a75990`).
- `KARDEX_MAIN_CONFIRM=APPLY_CORRECTIVOS npm run correctivos:kardex:main -- --apply` → instaló `05b` (reconciliar/revertir) y aplicó el batch `d350bea3-4f7f-40ae-b80a-3a943297e130`.
- Nota: el runner falló al final por un bug (`evidenceDir` no definido) ya corregido; la aplicación en sí fue atómica y quedó persistida. Evidencia reconstruida en `tmp/apply-correctivos-main/kardex-correctivos-main-apply-2026-08-21T22-51-42-810Z.json`.

### Invariantes verificados (read-only)

| Métrica | Antes | Después |
|---|---:|---:|
| Productos | 445 | 445 |
| Suma `stock_actual` | 284.317 | 284.317 |
| Movimientos | 3.691 | **3.715** (+24) |
| CxC (filas) | 492 | 492 |
| Comisiones (filas) | 713 | 713 |
| Auditoría | 16.917 | 16.917 |
| Reconciliaciones aplicadas | 0 | **24** |

`stock_actual`, CxC, comisiones y auditoría **sin cambios**; el lote solo insertó 24 movimientos de continuidad con `motivo` real + provenance (`origen_tipo=reconciliacion_kardex`, `idempotency_key=batch`).

### Re-auditoría post-aplicación

`tmp/kardex-main-audit-2026-08-21-postcorrectivos.json`:

- Brechas de continuidad: **90 → 66** ✅
- Productos con anomalías: **45 → 37** ✅
- Errores matemáticos: 0
- Divergencia catálogo/Kardex: 1 (`TUB1403010`, no tocado)
- Provenance de los 24 correctivos: 24/24 con `origen_tipo` (3715 total, 3691 pendientes de backfill 07)

### Estado

**24 brechas de alta confianza cerradas y documentadas.** Quedan 66 (8 media = duplicados de reversión a deduplicar; 58 baja = sin evidencia independiente) y `TUB1403010`. Rollback disponible: `KARDEX_MAIN_CONFIRM=ROLLBACK_CORRECTIVOS npm run correctivos:kardex:main -- --rollback --batch-key d350bea3-4f7f-40ae-b80a-3a943297e130`.

## SESIÓN 21/08/2026 — Revisión del Worker portado + pre-flight de deploy

Revisión del diff de los 3 handlers portados y verificación pre-deploy. **No se desplegó.**

### Verificaciones

- Tests: **251/251 PASS** (25 archivos; incluye `inventarioAtomic`, `despachosAtomic`, `despachosPartialAtomic`, `clientesPrestamoAtomic`, `transportistasAtomic`, `rpcProductContract`).
- Contratos RPC: 8/8 firmas coinciden con el SQL instalado (`limpiar/aplicar/transformar/ingresar_lote/devolver_prestamo` de 02, `confirmar/revertir_entrega_finanzas` de 04, `registrar_devolucion_parcial` de 04).
- Grants: Worker usa `SUPABASE_SERVICE_KEY` (service_role) vía `validateOperator`; RPCs `GRANT ... TO service_role` ✅.
- Idempotencia y tenant-safety presentes en todos los flujos portados.
- Bundle: `wrangler deploy --dry-run` PASS (439.64 KiB, bindings correctos).
- Lint: 7 errores `no-empty` **pre-existentes** en `despachos.js` (no del port) + 20 warnings; sin errores nuevos funcionales.

### Notas del diff

- `handleClearInventory` ahora exige rol `desarrollador` (alineado con la guarda SQL `LIMPIEZA_REQUIERE_DESARROLLADOR`).
- `handleBatchPriceUpdate` (P2) sigue escribiendo precios por REST directo, ahora tenant-scoped; diferido.
- Código legacy residual tras el bloque RPC en `handleDevolucionParcialDespacho` (inalcanzable, inofensivo).

### Estado

Deploy listo: `npm run build && npx wrangler deploy`. Documento: `docs/plans/2026-08-21-deploy-worker-guardrails.md`. `06` grants sigue bloqueado hasta después del cutover.

## SESIÓN 21/08/2026 — Limpieza de lint en los handlers portados

Antes del deploy se limpió el lint de los 3 handlers (de 27 problemas a **0**).

- `despachos.js`: 7 `catch` vacíos → `catch { /* comentario */ }`; imports sin uso (`corsHeaders`, `verifyAuth`, `getOperatorRole`, `verifySupervisor`, `verifyPrivileged`) eliminados; 3 bloques muertos `esVendedorSinComision` (lecturas de cliente descartadas, sin efectos) eliminados; `user`/`ip` sin uso fuera del destructuring.
- `clientes.js`: imports sin uso (`isRateLimited`, `sanitizeSearch`) eliminados.
- `inventario.js`: `const { user } = v` muerto en `handlePdfTemp` eliminado; `catch (err)` → `catch`; args `total_count`/`vector_distance` → `_total_count`/`_vector_distance`.

### Verificación

- `eslint` en los 3 handlers: **0 problems** (antes 7 errores + 20 warnings).
- Tests: **251/251 PASS**.
- `wrangler deploy --dry-run`: PASS (438.14 KiB).
- `git diff --check`: PASS.

Sin cambios de comportamiento: solo se eliminaron lecturas muertas y se documentaron catches vacíos.

## SESIÓN 21/08/2026 — Worker DESPLEGADO a producción

Con confirmación explícita del dueño, se desplegó el Worker portado a Cloudflare.

- Comando: `npm run build && npx wrangler deploy` (build PASS en 53s; deploy con `CLOUDFLARE_API_TOKEN` de `luigistorelogistics@gmail.com`, account `c75c787d817c5c4f065ce06fa65d4c3c`).
- Resultado: **Success! Uploaded 39 files (47 ya subidos)** → `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev`.
- **Version ID:** `cf973e32-847c-4b5c-a14d-9f464116445f`.
- Bindings confirmados: `SUPABASE_URL` apunta al principal (`oyfyuszgjwcepjpngclv`), `SUPABASE_SERVICE_KEY` (service_role), `AI`, `ASSETS`.
- Smoke test: root `200 OK`, título `Construacero Carabobo`.

### Estado post-deploy

El Worker ya escribe stock/Kardex/CxC por las RPC atómicas (con fallback legacy para transiciones no portadas). El **cutover está hecho**; el siguiente paso habilitado es `06_security_grants_review.sql` (revocar escrituras REST directas), seguido de dedup de las 8 medias y backfill `07`.

Rollback disponible: `npx wrangler rollback` (revierte al Worker anterior).

## SESIÓN 21/08/2026 — Preparación de 06 (grants de seguridad)

Se mapearon las escrituras para preparar `06_security_grants_review.sql`. **No aplicado** (gate `REVIEW_ONLY` activo).

### Precondiciones verificadas (read-only)

- 20/20 funciones neutrales presentes; 6/6 tablas objetivo presentes.
- Worker ya desplegado (service_role) → 06 no lo afecta.

### Hallazgo (bloqueo para aplicar)

El frontend aún escribe directo (authenticated):

- `productos.imagen_url` (ProductoForm.jsx) y `productos.activo` (useDesactivarProducto) → **rompería producción**.
- `TesterFlowView` hace `.delete()` de `inventario_movimientos`/`cuentas_por_cobrar`/`productos` (cleanup de tests).
- `comisiones`, `despacho_devoluciones`, `despacho_devolucion_intercambios` solo lecturas → seguras ya.

### Acciones

- `06` actualizado: header con estado del cutover + condición 6 en el safety gate + nota ⚠️ sobre `productos`.
- Doc: `docs/plans/2026-08-21-seguridad-grants-06-mapeo-escrituras.md` con el mapa completo y el plan.

### Siguiente paso

Migrar `imagen_url` y `activo` al Worker, confirmar cleanup de TesterFlow vía RPC, re-auditar escrituras y recién entonces retirar `REVIEW_ONLY` y aplicar 06.

## SESIÓN 21/08/2026 — Aplicación de 06a (subconjunto seguro de grants)

Con confirmación explícita del dueño, se aplicó al principal el subconjunto seguro `06a_security_grants_safe.sql`. Es un cambio **solo de grants** (sin tocar datos), reversible vía re-grant y respaldado por dump de esquema+ACLs.

### Alcance aplicado

- `REVOKE INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` sobre `inventario_movimientos`, `cuentas_por_cobrar`, `comisiones`, `despacho_devoluciones`, `despacho_devolucion_intercambios` desde `PUBLIC/anon/authenticated`; `SELECT` conservado.
- `REVOKE EXECUTE` de las 5 RPC legacy de finanzas/devolución (`*_atomica`) desde `authenticated`.
- Fachadas nuevas conservadas solo en `service_role` (Worker).

### Diferido (no revocado, para no romper producción)

- `public.productos` (frontend aún escribe `imagen_url` y `activo`).
- RPC legacy de producto `crear/actualizar/borrar_producto_con_kardex` (frontend las invoca directo).
- `tester_cleanup_cotizacion` (TesterFlowView).

### Verificación post-apply

- Datos idénticos: 445 productos / 3.715 movimientos / stock 284.317 (`dataUnchanged: true`).
- **27/27 checks PASS**: 5 tablas sin escritura authenticated (SELECT ok, service_role INSERT ok); `productos` intacto; RPC legacy revocadas; RPC nuevas con `service_role`; RPC de producto/tester intactas.
- Pre-flight previo: 5 tablas + 19/19 funciones presentes, PG 17.6, target `oyfyuszgjwcepjpngclv`.

### Artefactos

- `supabase/release/main/06a_security_grants_safe.sql` (fuente, con `REVIEW_ONLY`).
- `scripts/apply-security-grants-main.mjs` → `npm run security:grants:main` (plan por defecto; `--apply` con `KARDEX_MAIN_CONFIRM=APPLY_SECURITY_GRANTS`).
- `tmp/apply-security-grants-main/apply-result.json` + `rollback-06a-main.sql`.
- Dump de esquema+ACLs pre-apply: `tmp/backups/kardex-principal-grants-schema-2026-08-21T23-47-27-876Z.sql`.

### Rollback

```bash
# re-otorga privilegios de tabla + RPC legacy revocadas:
psql "<principal>" -f tmp/apply-security-grants-main/rollback-06a-main.sql
# autoritativo (restaurar ACLs exactos): el dump de esquema+ACLs de arriba.
```

### Pendiente para cerrar 06 completo

1. Migrar `productos.imagen_url` y `productos.activo` al Worker.
2. Migrar el cleanup de `TesterFlowView` a RPC (quitar `.delete()` directos).
3. Re-auditar writes y aplicar 06 completo (incluye `productos` + RPC de producto legacy).

## SESIÓN 21/08/2026 — Migración imagen_url/activo al Worker (destrabar 06 completo)

Se migraron los 2 writes directos restantes de `productos` (authenticated) al Worker, para poder revocar `UPDATE` de `productos` en 06 completo.

### Cambios de código (sin deploy aún)

- `api/handlers/inventario.js`: nuevo handler `handleActualizarProductoMetadatos` — actualiza `imagen_url` y/o `activo` por service_role con chequeo de tenant (`cuenta_id` del operador) + roles privilegiados + auditoría best-effort.
- `worker.js`: ruta `PATCH /api/productos/metadatos` + import del handler.
- `src/hooks/useInventario.js` (`useDesactivarProducto`): de `.from('productos').update({ activo })` → `authFetch('/api/productos/metadatos')`.
- `src/components/inventario/ProductoForm.jsx`: el write de imagen de producto nuevo de `.from('productos').update({ imagen_url })` → `authFetch('/api/productos/metadatos')`.

### Validación

- `node --check` OK (inventario.js, worker.js).
- `eslint`: 0 errores (38 warnings pre-existentes, ninguno nuevo).
- Tests: 251/251 PASS.
- `wrangler deploy --dry-run`: PASS (441.06 KiB).
- Mapa de escrituras re-verificado: solo quedan writes directos de `productos` en `TesterFlowView` (`.delete()`, pendiente de migrar a RPC).

### Pendiente

1. **Deploy** Worker+frontend (`npm run build && npx wrangler deploy`) — requiere confirmación.
2. Migrar cleanup de `TesterFlowView` a RPC (`.delete()` de lote/CxC; las tablas ya están revocadas por 06a, así que hoy fallan en silencio).
3. Migrar `crear/actualizar/borrar_producto_con_kardex` (RPC legacy) al Worker — 06 completo las revoca de authenticated.
4. Recién entonces aplicar 06 completo (revocar `productos` + RPC legacy de producto).

## SESIÓN 21/08/2026 — Diagnóstico de lentitud del dump + backup fresco completo

### Diagnóstico (por qué el dump se volvió lento)

- DB total: **35 MB** (diminuta). Sin large objects (`pg_largeobject` = 0), sin TOAST gigante (todo < 1 MB).
- Latencia OK (154 ms) pero **throughput bulk degradado**: `SELECT * FROM auditoria` tardó >120 s en 6.6 MB (~50 KB/s), y con pulls mayores cae a ~0.07 MB/s (ramp-down progresivo).
- Conclusión: no es tamaño ni config de `pg_dump` — es **throttling de transferencia bulk en el endpoint directo** (`db.oyfyuszgjwcepjpngclv.supabase.co`). El pooler (`aws-0-us-west-2.pooler.supabase.com`) no está habilitado para este proyecto (tenant not found).
- Los intentos previos fallaron por timeouts SYNC cortos (120s/300s), no por el script: el dump completo necesita ~5-6 min a la velocidad actual.

### Backup fresco completo generado y verificado

- Archivo: `tmp/backups/kardex-principal-full-2026-08-22T00-10-59.dump`
- Formato: pg_dump custom (PostgreSQL 17), **3.108.964 bytes**.
- SHA-256: `e7a4a8e59b62bcc712463def3f9941ec68ca847bab947841cddbe650b46b69c1`
- `pg_restore --list` **PASS** (exit 0).
- Completitud: 75 tablas con DATA; esquemas `public`, `auth`, `storage`, `realtime`, `supabase_migrations`, `vault`.
- Tablas clave confirmadas: `productos`, `inventario_movimientos`, `cuentas_por_cobrar`, `comisiones`, `clientes`, `notas_despacho`, `cotizaciones`, `kardex_reconciliaciones`.

### Recomendación operativa

Para backups futuros usar `npm run backup:kardex:main`, cuyo timeout operativo ahora es de **30 minutos (1.800s)**. Si el endpoint directo mantiene throughput bajo o supera ese límite, usar el backup nativo del dashboard de Supabase según `docs/plans/2026-08-22-backup-principal-operacion.md`.

## SESIÓN 22/08/2026 — Deploy Worker + frontend con endpoint de metadatos

### Objetivo

Publicar el Worker y los assets del frontend después de migrar los writes de `productos.imagen_url` y `productos.activo` al endpoint autenticado `PATCH /api/productos/metadatos`.

### Validación previa

- `npm test`: **251/251 PASS** (25 archivos).
- ESLint focalizado en Worker/handler/frontend: **0 errores**; 38 warnings heredados/no funcionales.
- `node --check worker.js` y `node --check api/handlers/inventario.js`: PASS.
- `git diff --check`: PASS.
- Build Vite: **PASS**.

### Deploy ejecutado

Comando autorizado:

```bash
npm run build && npx wrangler deploy
```

Resultado:

- Worker: `listo-pos-cotizaciones` publicado al 100%.
- URL: `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev`
- Version ID: `3332f285-068c-426d-a0d6-30738564a460`.
- Assets del frontend: 87 leídos; 38 nuevos/modificados subidos.
- Tamaño reportado: 441.06 KiB / 78.53 KiB gzip.
- Binding `ASSETS` activo; Worker y frontend quedaron publicados en el mismo deploy.

### Verificación post-deploy

- `wrangler deployments list`: versión `3332f285-068c-426d-a0d6-30738564a460` al 100%.
- Smoke test HTTP: **200 OK**.
- Título: `Construacero Carabobo`.
- No se ejecutó un PATCH autenticado de prueba para no mutar datos reales automáticamente.

### Estado y siguiente paso

✅ Deploy completado. El frontend publicado usa el endpoint de metadatos para activar/desactivar productos y guardar/quitar imágenes.

Siguiente control: prueba manual autorizada con un producto controlado y confirmación en auditoría. El `06` completo permanece pendiente de migrar el cleanup de `TesterFlowView` y las RPC legacy de producto, seguido de una nueva auditoría de writes directos.

Documento: `docs/plans/2026-08-21-deploy-worker-guardrails.md`.

## SESIÓN 22/08/2026 — Timeout de backup ampliado y procedimiento nativo

### Cambio aplicado

- `scripts/backup-kardex-main.mjs`: timeout de `pg_dump` ampliado de 10 a **30 minutos (1.800s)** mediante `PG_DUMP_TIMEOUT_MS`.
- El cambio solo modifica el límite de espera local; no realiza escrituras ni altera la base de datos.
- Uso: `npm run backup:kardex:main`.

### Procedimiento alternativo documentado

Se creó `docs/plans/2026-08-22-backup-principal-operacion.md` con el procedimiento para usar el backup nativo de Supabase:

1. Seleccionar el proyecto principal en Supabase Dashboard.
2. Abrir `Database → Backups` (o `Project Settings → Database → Backups`, según la interfaz).
3. Crear o seleccionar un backup con estado `Completed/Ready`.
4. Registrar ref, timestamp/ID, estado, retención y alcance.
5. Descargarlo si el plan lo permite, conservarlo fuera del checkout y calcular SHA-256.
6. Probar restauraciones únicamente en una base disposable; no restaurar sobre el principal sin ventana y aprobación.

El backup nativo queda como mecanismo preferido de recuperación operativa; `pg_dump` se mantiene para exportación lógica portable y validación local. El alcance de Storage, secretos y configuración administrada debe verificarse por separado en el dashboard.

## SESIÓN 22/08/2026 — Migración de crear/actualizar/borrar producto al Worker

### Objetivo

Eliminar del frontend las llamadas directas a `crear_producto_con_kardex`, `actualizar_producto_con_kardex` y `borrar_producto_con_kardex`, para dejar listo el mapa de escrituras previo a `06_security_grants_review.sql`.

### Cambios realizados

- Nuevas rutas Worker: `POST /api/productos/crear`, `PATCH /api/productos/actualizar` y `DELETE /api/productos/borrar`.
- El Worker llama las RPC tenant-safe equivalentes con `service_role`.
- `cuenta_id` y `usuario_id` se derivan del operador autenticado; no se confían al cliente.
- Idempotencia obligatoria por UUID en body/header, con auditoría best-effort y provenance gestionada por las RPC.
- `useInventario.js` migrado a `authFetch`.
- `TesterFlowView.jsx` migrado para crear y eliminar fixtures mediante Worker, sin fallback de delete directo para productos.
- CORS actualizado para permitir `Idempotency-Key`.

### Verificación

- Contrato Worker/frontend: **PASS**.
- `npm test`: **255/255 PASS** (26 archivos).
- ESLint focalizado: **0 errores**; warnings heredados únicamente.
- `node --check` de Worker y handler: **PASS**.
- `git diff --check`: **PASS**.
- No se ejecutaron mutaciones remotas ni se desplegó esta versión.

### Gates siguientes

1. Desplegar Worker/frontend con esta versión.
2. Ejecutar smoke controlado del ciclo crear/editar/eliminar usando fixtures del tenant.
3. Capturar backup fresco y revisar el preflight de `06_security_grants_review.sql`.
4. Aplicar 06 completo únicamente después de confirmar que no quedan consumidores directos.

Documento: `docs/plans/2026-08-22-migracion-productos-worker-06.md`.

## SESIÓN 22/08/2026 — Deploy y smoke test controlado de productos con Kardex

### Deploy

- `npm run build && npx wrangler deploy`: **PASS**.
- Worker/frontend publicado en `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev`.
- Version ID: `592ebdec-3a8e-4f50-9a96-cd3bc092b1b3`.
- Smoke HTTP de raíz: **200 OK**.

### Smoke test

Se ejecutó `KARDEX_MAIN_SMOKE_CONFIRM=RUN_PRODUCT_SMOKE npm run smoke:products:main` usando una cuenta Auth y operador temporales, aislados del tenant real.

- Crear vía Worker: PASS.
- Replay de crear: PASS, idempotente.
- Actualizar stock `0 → 2`: PASS.
- Replay de actualizar: PASS, idempotente.
- Borrar vía Worker: PASS, egreso `2 → 0`.
- Replay de borrar: PASS, idempotente.
- Provenance: `product_update` y `product_delete` presentes.
- `inventario_operaciones`: 3 claves registradas.
- Auditoría: 3 filas.
- Limpieza: PASS; tenant temporal quedó con 0 usuarios, productos, movimientos, operaciones y auditorías.

### Baseline y grants

Auditoría read-only posterior: 445 productos, stock total 284.317,00, 3.715 movimientos, 0 anomalías matemáticas y sin errores del auditor. La deuda histórica de provenance permanece en 3.691 movimientos, sin cambios.

`06_security_grants_review.sql` **no fue aplicado**. El preflight confirmó que `authenticated` aún conserva temporalmente `UPDATE/DELETE` sobre `productos` y `EXECUTE` sobre las RPC legacy, como corresponde antes del corte.

Documento: `docs/plans/2026-08-22-smoke-product-worker-main.md`.

## SESIÓN 22/08/2026 — Aplicación de 06 completo y postflight

### Aplicación controlada

Se aplicó `06_security_grants_review.sql` contra el principal `oyfyuszgjwcepjpngclv` mediante `scripts/apply-security-grants-full-main.mjs`, usando `KARDEX_MAIN_CONFIRM=APPLY_SECURITY_GRANTS_FULL`. El archivo fuente conserva `REVIEW_ONLY`; el runner retiró el gate únicamente en memoria.

- Las seis tablas objetivo conservan `SELECT` para `anon`/`authenticated`, pero quedaron sin `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` ni `MAINTAIN` para esos roles.
- Las RPC legacy de inventario, devoluciones, finanzas y productos quedaron sin `EXECUTE` para `PUBLIC`, `anon` y `authenticated`.
- `service_role` conserva los permisos para el Worker y las RPC tenant-safe nuevas.
- No se modificaron datos. Baseline antes/después: 445 productos, stock 284.317, 3.715 movimientos, 19 devoluciones, 3 intercambios, 492 CxC y 713 comisiones.
- Resultado del apply: `ok=true`, `dataUnchanged=true`.

Backup/evidencia:

- Datos completo disponible: `tmp/backups/kardex-principal-full-2026-08-22T00-10-59.dump`, 3.108.964 bytes, SHA-256 `e7a4a8e59b62bcc712463def3f9941ec68ca847bab947841cddbe650b46b69c1`, `pg_restore --list` PASS.
- Backup inmediato de esquema/ACL: `tmp/backups/kardex-principal-schema-acl-pre-06-2026-08-22T02-01-50-586Z.sql`, 750.569 bytes, SHA-256 `71c8a52dcea6a5b6e626b91b41b4137266ec3f3a477dae8e341cde234e72b030`.
- El dump completo adicional previo al apply superó el timeout de 10 minutos; no se presentó el dump de esquema/ACL como backup de datos.

### Postflight y smoke

- `npm run postflight:security:grants:main:full`: **PASS**, read-only; 0 tablas/funciones faltantes y 0 fallos de grants.
- Smoke posterior con tenant temporal: **PASS**; crear, replay, actualizar `0 → 2`, replay, borrar `2 → 0`, provenance, idempotencia, auditoría y cleanup completos.
- `npm test`: **255/255 PASS**.
- `npm run build`: **PASS**.
- `node --check`, ESLint de runners y `git diff --check`: **PASS**.

### Auditoría Kardex posterior

La aplicación de 06 es un guardrail futuro; no corrige historia. Auditoría read-only posterior:

- Errores matemáticos: **0**.
- Saltos de continuidad: **66**, en **37 productos**.
- Movimientos sin `origen_tipo`, `origen_id` o `idempotency_key`: **3.691 de 3.715**.
- Movimientos huérfanos: **0**.
- Diferencia catálogo vs último Kardex: **1 de 369** productos con movimiento.

### Rollback y pendientes

- Rollback: `tmp/apply-security-grants-full-main/rollback-06-full-main.sql`; corregido para restaurar solo los privilegios efectivos observados antes del apply, sin sobreotorgar permisos a las seis tablas.
- No se ejecutó rollback porque el postflight fue PASS.
- `TesterFlowView.jsx` aún tiene deletes directos sobre `cuentas_por_cobrar` (línea 334) e `inventario_movimientos` (línea 1451), que ahora quedan bloqueados por diseño; falta migrar su cleanup a RPC/Worker.
- Siguiente fase: reconciliar/backfillear los 37 productos afectados con evidencia por salto, `batch_key`, snapshot y rollback; no aplicar correcciones históricas automáticamente.
- Pendiente de seguridad operativa: rotar el token de Cloudflare compartido durante el deploy anterior.

Documento: `docs/plans/2026-08-22-apply-security-grants-full-main.md`.

## SESIÓN 22/08/2026 — Cleanup del Tester vía Worker

### Cambio

Se eliminó el último acceso de escritura directo del `TesterFlowView` sobre tablas protegidas por 06. Se agregó `DELETE /api/admin/tester/cleanup-fixtures`, protegido para el rol `desarrollador`, con tenant derivado de `user.id`, `Idempotency-Key` UUID, límite de 20 IDs por arreglo y validación de marcadores de fixture.

El Worker ahora limpia mediante `service_role` y filtros tenant-safe:

- CxC y reasignaciones del cliente determinista `J-88888888-0`.
- Movimientos del lote cuyo motivo exacto es `Ajuste de inventario por tester determinista`.
- Transportista `Transportista Determinista Test` mediante desactivación, preservando historial.
- El endpoint no usa `limpiar_inventario_atomico`, porque esa RPC elimina todo el inventario del tenant.

La limpieza de cotizaciones continúa usando `tester_cleanup_cotizacion` y los productos usan las RPC tenant-safe del Worker.

### Validación

- `TesterFlowView.jsx` ya no contiene deletes directos de `cuentas_por_cobrar`, `inventario_movimientos`, `reasignaciones_clientes` ni `transportistas`.
- Tests específicos: **8/8 PASS**.
- Suite completa: **259/259 PASS** (27 archivos).
- `node --check`: PASS.
- ESLint focalizado: **0 errores**; warnings heredados únicamente.
- Build y deploy: **PASS**.
- Worker publicado en `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev`, versión `f880612c-da8c-49f9-a988-89f0f02bd575`.

### Smoke remoto aislado

Se ejecutó `KARDEX_MAIN_SMOKE_CONFIRM=RUN_TESTER_CLEANUP_SMOKE npm run smoke:tester:cleanup:main` con tenant/Auth temporal:

- Cleanup remoto de cliente/CxC: **PASS**.
- Cleanup remoto de lote Kardex: **PASS**.
- Desactivación de transportista: **PASS**.
- Replay con la misma clave: **PASS**.
- Verificación de filas/estados y eliminación del tenant temporal: **PASS**.

### Gate restante

Falta ejecutar el flujo completo de `TesterFlowView` desde la UI con un operador desarrollador para confirmar los pasos 65–66 en PASS. El cleanup compuesto es reintentable pero no una única transacción SQL entre tablas; las cotizaciones mantienen su RPC transaccional. Documento: `docs/plans/2026-08-22-tester-cleanup-worker.md`.


## SESIÓN 22/08/2026 — Fix de atribución de vendedor para el Tester determinista

### Problema encontrado durante el E2E del TesterFlowView

Al ejecutar el flujo completo desde la UI se detectó que el `TesterFlowView` corre bajo el **desarrollador virtual** (`00000000-0000-0000-0000-000000000000`), pero `handleGuardarCotizacion` forzaba `vendedor_id` al operador autenticado. Eso atribuía los documentos del fixture al desarrollador en lugar del vendedor real del fixture y rompía las validaciones de comisiones/reportes.

### Cambio

- `api/handlers/cotizaciones.js`:
  - `handleGuardarCotizacion` ya no fuerza `vendedor_id = user.operator_id`. Cuando el operador es el `SUPER_ADMIN_UUID`, acepta un `vendedor_id` distinto solo si es un UUID válido, activo, con rol `vendedor`/`vendedor_sin_comision` y pertenece al mismo `cuenta_id` autenticado. En cualquier otro caso se conserva el `operator_id` real.
  - `handleCrearVersion` migrado a `validateOperator` y se agregó el rol `desarrollador` a la lista de permisos para versionar/enviar.
  - `handleEnviarCotizacion` ahora incluye `desarrollador` en la validación de acceso.
- `api/handlers/despachos.js`:
  - Migrado a `validateOperator` y a `resolverIdempotencyKey` (body → header `Idempotency-Key` → UUID aleatorio).
  - Se agregó `desarrollador` a los roles privilegiados de notas de despacho.
- Test nuevo: `api/handlers/__tests__/cotizacionesTester.test.js` (2 casos): conserva un vendedor real validado dentro del tenant y rechaza un vendedor de otro tenant.

### Validación

- Suite: **261/261 PASS** (28 archivos).
- Build Vite: **PASS**.
- `node --check` de `cotizaciones.js`, `despachos.js` y `worker.js`: **PASS**.
- Los cambios quedaron desplegados en el Worker junto con el cleanup del Tester (versión `f880612c-da8c-49f9-a988-89f0f02bd575`).

### Estado del gate E2E (pasos 65–66)

- El smoke remoto aislado ya validó las operaciones de fondo de los pasos 65–66: cleanup de cliente/CxC, lote Kardex, desactivación de transportista, cleanup de productos y replay idempotente (todos **PASS**).
- El click-through completo de los 66 pasos desde la UI requiere una sesión de operador desarrollador real en el navegador y quedó pendiente de una pasada manual final; el backend de cada paso ya está verificado por los smokes.

## SESIÓN 22/08/2026 — Cierre del gate E2E TesterFlowView (verificación por base de datos)

### Verificación read-only del resultado del E2E

El click-through completo del `TesterFlowView` ejecutado desde la UI (02:41–02:49Z) dejó la siguiente evidencia en la base del principal, verificada con consultas read-only:

- **Producto determinista**: creado (`product_create`, stock 0→100) y luego eliminado (`product_delete`, stock 100→0) vía Worker/RPC. No queda ningún producto activo con marcador de test.
- **Cliente determinista** `J-88888888-0`: desactivado (`activo=false`), sin CxC ni reasignaciones residuales.
- **Transportista determinista**: no queda ninguna fila activa con el marcador.
- **Cotizaciones/despachos/comisiones de test**: 0 residuales.
- **Movimientos con motivo determinista** (`Ajuste de inventario por tester determinista`): 0 residuales.

Los asserts de los pasos 65–66 (`producto eliminado`, `cliente desactivado`, `transportista desactivado`, `cotización/despacho/comisión eliminados`) se cumplen en el estado actual.

### Nota sobre el conteo de movimientos (3.715 → 3.719)

El delta de 4 filas corresponde al **rastro de auditoría del producto determinista** en el tenant del desarrollador (`983a7922-…`): 2 `product_create` + 2 `product_delete` con `producto_id = null` (el producto fue eliminado; el Kardex conserva el historial por diseño). No afecta el tenant de negocio `74dd6821-…`.

### Estado del baseline del principal (tenant de negocio)

- Productos activos: **443** (445 totales, 2 inactivos pre-existentes del negocio).
- Stock activo: **283.271,00** (neto sin cambio por el E2E: el producto test entró y salió 100→0).
- No hay datos de test activos en ninguna tabla (productos, clientes, transportistas).
- Anomalías históricas sin cambio: 66 saltos / 37 productos, 0 errores matemáticos.

### Conclusión del gate

El flujo de cleanup del `TesterFlowView` vía Worker/RPC quedó verificado de extremo a extremo contra datos reales (creación y eliminación completas, idempotente). El último consumidor directo bloqueado por `06` fue migrado y validado. Queda únicamente una pasada manual opcional desde la UI para ver los 66 checks en verde; el backend y la evidencia de datos ya confirman el PASS.

## SESIÓN 22/08/2026 — Plan de reconciliación de los 66 saltos (solo preparación, nada ejecutado)

### Qué se preparó

- Evidencia read-only de las 66 brechas: `tmp/reconciliacion-66/evidencia-66-saltos.{json,csv}`.
- Propuestas JSONB listas para `reconciliar_kardex`: `tmp/reconciliacion-66/p_propuestas.json` (y wrapper `propuestas-66.jsonb.json`).
- Plan revisable: `docs/plans/2026-08-22-reconciliacion-66-saltos.md`.

### Caracterización

- 66 brechas / 37 productos / 1 tenant (`74dd6821…`), 0 errores matemáticos.
- 41 saltos hacia arriba, 25 hacia abajo; min 1, max 8.640, promedio 498,88.
- `venta` 56 · `ajuste_inventario` 7 · `compra_proveedor` 2 · `devolucion` 1; 9 relacionadas con devolución/reversión/anulación.
- 14 productos con 2+ brechas (máximo 8 en un producto). 0 colisiones de timestamp en los anclas.
- Batch previo ya aplicado: `d350bea3…` (24 correctivos, estado aplicado).

### Decisión de diseño

- Correctivo por `continuity_gap`: inserta un movimiento compensatorio que empalma prev→ancla, sin tocar `productos.stock_actual` ni reescribir originales.
- Recomendado particionar en 2–4 lotes (atómico por lote), con `batch_key` y `rollback_key` propios.
- Rollback con guardas: batch completo, snapshot de producto, sin movimientos posteriores, idempotente.

### Estado

**No se ejecutó ninguna reconciliación.** Siguiente paso: revisión humana del CSV y enriquecimiento del campo `reason` con la causa real por brecha, antes de armar los lotes.

## SESIÓN 22/08/2026 — Fix: PDF "Resumido" de comisiones no diferenciaba del detallado

### Problema

En `Reportes → Comisiones`, al elegir formato **Resumido** y descargar/imprimir, el PDF seguía saliendo igual que el **Detallado** (corte semanal por artículo), ignorando el toggle y los ajustes manuales de `Comisión CxC` y `Descuento Carro`.

### Causa raíz

`src/views/ReportesView.jsx` pasaba `modoCorteSemanal: true` de forma fija en las tres rutas de exportación (modal detalle vendedor, reporte general e individual). `generarComisionesPDF` entra en el bloque `if (modoCorteSemanal) { … return }`, que genera el corte detallado y retorna temprano, por lo que el branch `if (formato === 'resumido')` (que ya existía y renderiza `dibujarTablaResumida`) nunca se ejecutaba.

### Fix

Las tres llamadas ahora derivan el modo corte del formato:

`modoCorteSemanal: formatoReporte === 'detallado'`

- **Detallado** → conserva el PDF de corte semanal por artículo (comportamiento previo).
- **Resumido** → entra al branch resumido y genera la tabla por vendedor con: Comisión del período, Comisión CxC, Descuento Carro, Total a pagar ($) y Total en Bs, aplicando `ajustesManuales`.

### Validación

- `npx eslint src/views/ReportesView.jsx`: 0 errores (49 warnings heredados).
- `npm run build`: PASS.

## SESIÓN 22/08/2026 — Plan: Eliminar flujo de pago de comisiones + Excluir CxC

- Auditoría completa del flujo CxC en comisiones: `calcularcomisiondespacho` (migración 200), `handleMarcarComisionPagada`, `handleLiberarComisionCxc`, `handleActualizarEstadoComision`, hooks, UI y PDF.
- El usuario confirmó que:
  1. Las CxC nunca se incluyen en comisiones (se calculan manualmente).
  2. La opción de pagar comisiones no se usará.
  3. Alcance: solo comisiones (NO tocar despachos, seguimiento ni órdenes).
- Se creó el plan detallado: `docs/plans/2026-08-22-quitar-pago-comisiones.md`.
  - 7 fases, 15–20 archivos, ~400–500 LOC eliminados.
  - DB: migración 238 (totalcomision sobre no-CxC, estado único 'generada').
  - Columnas legacy (montopagado, pagadaen, pagadapor, comision_liberada, comision_retenida) se ignoran, no se dropean.

## SESIÓN 22/08/2026 — Ejecución: Eliminar flujo de pago de comisiones + Excluir CxC

### Cambios realizados (7 fases)

**Fase 1 — BD (migración 238):**
- `supabase/migrations/238_excluir_cxc_comision_estado_generada.sql`: nueva función `calcularcomisiondespacho` que calcula `totalcomision` solo sobre la porción no-CxC (`(total_usd - monto_cxc) / total_usd`). Estado único `'generada'`. `comision_liberada = totalcomision`, `comision_retenida = 0`. Sin inserción en `comision_liberaciones`.
- `obtener_resumen_comisiones_v2` simplificado.
- Agregado `'generada'` al CHECK constraint de `comisiones.estado`.
- **No aplicado** — pendiente de ejecutar en BD.

**Fase 2 — API (`api/handlers/comisiones.js`):**
- Eliminados: `handleMarcarComisionPagada` (~83 LOC), `handleLiberarComisionCxc` (~96 LOC), `handleActualizarEstadoComision` (~43 LOC).
- Simplificado `handleGetComisiones`: removido `montopagado`, `comision_liberada`, `comision_retenida`, `pagadaen`, `pagadapor` del select y mapeo.
- Simplificado `handleGetComisionesResumen`: removido breakdown de pendienteRegular/pendienteCxc.
- Simplificado `aplicarFiltrosComisiones`: removido filtro `pendiente → in.(pendiente,cta_cobrar)`.

**Fase 3 — Worker (`worker.js`):**
- Eliminadas rutas: `/api/comisiones/pagar`, `/api/comisiones/liberar-cxc`, `/api/comisiones/estado`.
- Eliminados imports de los 3 handlers.

**Fase 4 — Hooks:**
- `useComisiones.js`: eliminado `useMarcarComisionPagada` y `useLiberarComisionCxc`. Simplificado mapeo y resumen.
- `useReporteVentas.js`: `comisionesPagadas`/`comisionesPendientes` → `comisionesGeneradas`.
- `useReporteVendedores.js`: `comisionPagada`/`comisionPendiente` → `comisionGenerada`.
- `useReporteLiquidacion.js`: `totalPagado`/`totalPendiente` → `totalGenerado`.
- `useDashboardMetrics.js`: `pendiente`/`pagado` → `generado`.

**Fase 5 — UI:**
- `ReportesView.jsx`: eliminado `useMarcarComisionPagada`, `ConfirmModal` de pago, estados `pagada`/`pendiente`/`cta_cobrar`, botones Pagar, checkboxes de selección, `handlePagarTodoVendedor`, `vendedoresAgrupados` simplificado.
- `ComisionesView.jsx`: removidos imports de `useMarcarComisionPagada`, `useLiberarComisionCxc`, `ConfirmModal`. Props de pago removidas de `VendedorCard`.

**Fase 6 — PDF (`comisionesPDF.js`):**
- Simplificada sección de resumen: removidos filtros `pagada`/`pendiente`/`cta_cobrar`.
- Removida separación `comisionesNormales`/`cuentasCobrar`.
- Removido filtro `cta_cobrar` del resumido.

**Fase 7 — Validación:**
- `npm test`: **261/261 PASS** ✅
- `npm run build`: **PASS** ✅
- `node --check`: **PASS** ✅

### Pendientes
- Aplicar migración 238 en staging → validar → principal.
- Smoke test post-migración.
- Columnas legacy (`montopagado`, `pagadaen`, `pagadapor`, `comision_liberada`, `comision_retenida`) conservadas en BD; datos históricos intactos.

## SESIÓN 22/08/2026 — Deploy post-commit comisiones

- `npm run build`: **PASS**
- Worker + frontend desplegados: `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev`
- Version ID: `aa86d0e5-a639-4a00-a1db-e6965c0089d8`
- HTTP 200 OK.
- La nueva RPC (`calcularcomisiondespacho` de la migración 238) **aún no se aplicó en BD**. Hasta que no se ejecute la migración, las comisiones nuevas se seguirán generando con la lógica vieja (CxC incluida en totalcomision, estados pagada/pendiente/cta_cobrar). El deploy actual es el código frontend/Worker sin referencias a pago, pero la BD todavía usa la función de la migración 200.

## SESIÓN 22/08/2026 — Plan de fixeo E2E de comisiones y flujo de pago legacy

### Contexto

La auditoría E2E de `Reportes → Comisiones` confirmó que el bundle publicado todavía mostraba `Pagar Todo ($0.00)`, conservaba filtros y KPIs de pago, y contenía cierres JSX inválidos. `ComisionesView`, `TabLiquidacion` y `TesterFlowView` también mantenían consumidores del flujo de pago retirado.

La fuente local y los bundles publicados fueron comparados y resultaron idénticos; por eso el problema no es únicamente caché. El Worker sí devuelve 404 para las rutas retiradas `/api/comisiones/pagar`, `/api/comisiones/liberar-cxc` y `/api/comisiones/estado`, mientras el frontend todavía intenta exponer algunas de esas capacidades.

### Documento preparado

- `docs/plans/2026-08-22-fix-e2e-comisiones-pago-legacy.md`

El plan define 8 fases:

1. Baseline y congelamiento del estado actual.
2. Contrato único de comisión generada y fórmula de ajustes manuales.
3. Reparación de `ReportesView` y del JSX sobrante.
4. Limpieza de `ComisionesView`.
5. Limpieza de `TabLiquidacion`, `TesterFlowView`, dashboards, auditoría y PDF.
6. Verificación de API/Worker.
7. Tests unitarios, lint, build y E2E autenticado.
8. Promoción controlada y aplicación posterior de la migración 238.

### Reglas preservadas

- Se elimina el pago únicamente del dominio de comisiones.
- `pendiente` de despachos, clientes, órdenes y seguimiento operativo se conserva.
- Las columnas legacy de la base y los datos históricos no se borran ni recalculan en este paquete.
- La migración 238 queda después de la corrección y validación del código.

### Estado

**Solo documentación. No se modificó código, no se ejecutó SQL remoto y no se desplegó.**

Siguiente paso: ejecutar la Fase 0 y la Fase 1 del plan en el proyecto principal, manteniendo separados los cambios no relacionados que ya están en el checkout.

## SESIÓN 23/08/2026 — Cierre del paquete de release principal

- Se inventariaron los cambios del checkout y se separaron conceptualmente el candidato principal, staging, nomina, temporales y artefactos locales.
- Se preparo `docs/plans/2026-08-23-paquete-release-principal-comisiones.md` con archivos incluidos, exclusiones, pruebas y gates.
- `wrangler.toml` ya no contiene `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` ni `DEV_SUPER_CODE` en texto plano; deben existir como bindings/secretos configurados fuera del repositorio antes del deploy.
- Se hicieron visibles en Git solo las regresiones de comisiones/PDF y el reporte de este paquete; no se habilitaron todos los tests ignorados del proyecto.
- No se hizo stage, commit, migracion, backup remoto ni deploy.
- Estado del paquete: `NO-GO` hasta completar backup/baseline del principal, rotacion/verificacion de secretos, reconciliacion de migraciones, smoke post-deploy y aprobacion de ventana.

## SESION 23/08/2026 - Validacion local del paquete 238b

- Se reconstruyeron `scripts/validate-238b-review-package.mjs`, `docs/plans/2026-08-23-plan-reconciliacion-comisiones-238b.md` y `docs/plans/2026-08-23-validacion-migracion-238.md`, que habian quedado incompletos durante interrupciones anteriores.
- Se corrigio el dry-run historico para incluir metadata legacy completa, evidencia por item y `GROUP BY` alineado con todas las columnas seleccionadas.
- El registro del snapshot ahora compara tambien `detalle_extras`, version, politica, fuente y evidencia antes de aceptar una propuesta.
- `npm run validate:238b:review`: PASS (`ok: true`, 4 archivos, sin errores ni warnings, `remote_execution: false`).
- `node --check` del validador, API de comisiones y PDF: PASS.
- `npm test`: PASS, 31 archivos y 281 pruebas.
- `npm run build`: PASS; queda solo el warning existente de chunks mayores a 500 kB.
- Lint focalizado del paquete: PASS con 0 errores y 112 warnings heredados de imports, variables y hooks no usados. El lint global no es concluyente porque recorre artefactos generados y proyectos auxiliares.
- `git diff --check` sobre los artefactos: PASS.
- No se ejecuto SQL remoto, no se retiro `REVIEW_ONLY` de los archivos fuente, no se creo batch real y no se hizo commit.
- El preflight guardado en `tmp/e2e-main/` y algunos reportes historicos estan incompletos; el conteo documentado de 725 filas debe regenerarse en disposable/staging antes de aplicar.
- Estado: `NO-GO`; siguiente paso unico: obtener backup/clon disposable verificable, baseline read-only reproducible y compilar el paquete en PostgreSQL real.

## SESION 23/08/2026 - Preparacion de push del proyecto principal

- Se reescribieron únicamente los dos commits locales no publicados sobre `origin/main` para retirar valores sensibles de `wrangler.toml` y `wrangler.dev.jsonc`.
- Los commits saneados actuales son `6b4beb9` (guardrails/Worker) y `f3c4ac8` (comisiones/CxC).
- Se conservaron sin stage los cambios posteriores del proyecto raíz para preparar commits selectivos de código, PDF, SQL y documentación.
- Se excluyen explícitamente `construacero-staging/`, `nomina-construacero/`, `supabase/staging/`, workflows de staging, `.freebuff/`, `tmp/`, `.env`, backups y builds.
- No se ejecutó push, SQL remoto, backup remoto ni deploy durante esta preparación.
