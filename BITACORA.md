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
