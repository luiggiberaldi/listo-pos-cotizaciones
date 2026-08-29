# Construacero Carabobo — Staging

Este directorio es el entorno de validación aislado de Construacero. Apunta al proyecto Supabase de staging `spupqgkdsgohxxfoxydl`; no debe configurarse con credenciales de producción.

## Última validación registrada — 2026-08-17

- Worker local `:8789` y proxy Vite `:5174`: **HTTP 200** en `/api/ping`, ambos identificados como `spupqgkdsgohxxfoxydl`.
- Tests unitarios: **227/227** en **25 archivos**.
- Build del frontend: correcto; solo permanece el warning conocido de chunks grandes.
- Runner E2E CLI: **75/75 pasos** aprobados.
- Limpieza: **0 productos E2E residuales** y cliente E2E inactivo.
- Log: `../tmp/e2e-staging/tester-2026-08-17T23-46-18-229Z.log`.
- En staging quedaron aplicadas las políticas RLS de comisiones, la RPC de limpieza tenant-safe y la configuración E2E dedicada (`2%` Cabilla, `3%` otras categorías).
- No se modificó ni desplegó producción.

La evidencia corresponde al runner CLI `npm run test:e2e:staging`. La vista interactiva `TesterFlowView` mantiene una lista histórica independiente de 70 pasos; no fue la fuente del log de cierre.

## Tasas oficiales BCV — corrección 2026-08-18

La aplicación no debe tomar directamente `ve.dolarapi.com` como fuente primaria de USD/EUR: su publicación puede quedar un día atrás. El Worker consulta en este orden:

1. `https://www.bcv.org.ve/` con cabeceras de navegador y querystring anti-cache.
2. `https://rates.dolarvzla.com/bcv/current.json`, CDN público que publica `current.usd`, `current.eur` y `current.date` de la tasa BCV.
3. Google Script opcional mediante `BCV_GOOGLE_SCRIPT_URL`/`VITE_BCV_GOOGLE_SCRIPT_URL`.
4. DolarAPI solo como último recurso del servidor, conservando su fecha de publicación.

El proxy `/api/rates` responde con `Cache-Control: no-store`, cache interno máximo de 10 minutos y admite `?refresh=1` para forzar una consulta. El hook limpia una respuesta marcada `stale` o identificada como DolarAPI, en vez de mostrarla como tasa BCV vigente. USDT continúa usando Binance P2P sin cambios.

Evidencia del 2026-08-18: USD `773.3125`, EUR `896.02946062`, fecha oficial `2026-08-18`; el fallback CDN coincidió con la publicación BCV cuando el TLS directo no estuvo disponible en Wrangler local. No se desplegó producción durante esta corrección.

## Preparación y batería de checks

```bash
# Desde construacero-staging/
npm ci
cp .env.example .env
# El .env contiene el Supabase Access Token del proyecto staging.
npm run configure:local
npm run check:all
```

`npm run check:all` ejecuta las pruebas unitarias del núcleo, el build del frontend, las pruebas de nómina y su build. El check queda aprobado únicamente cuando todas las pruebas terminan en verde. En la validación del 2026-08-17, `npm test` terminó con **227/227 tests en 25 archivos** y el build de staging fue correcto.

Para levantar la aplicación y el Worker local:

```bash
npm run dev
```

El frontend queda en Vite y el Worker de staging en `http://localhost:8789`. Para nómina, usar `npm --prefix nomina-construacero run dev` (Worker en el puerto `8788`). Si había procesos anteriores de Wrangler en `8787`, detenlos con `Ctrl+C` antes de abrir staging; el frontend debe reiniciarse para cargar el proxy nuevo.

Comprobación segura de entorno, sin autenticar ni modificar datos:

```bash
curl -i http://localhost:8789/api/ping
# Debe incluir: X-Supabase-Project-Ref: spupqgkdsgohxxfoxydl
```

### E2E determinista automático (solo staging)

El runner crea una cuenta E2E aislada en staging, ejecuta los 75 pasos, guarda el log en `../tmp/e2e-staging/` y limpia sus fixtures aunque falle. La provisión usa únicamente `SUPABASE_SERVICE_KEY` de `.dev.vars`, valida el project-ref de staging y guarda la contraseña en `.env.e2e.local` (ignorado por Git); nunca reutiliza la sesión del navegador.

```bash
npm run provision:e2e:staging   # primera vez o para regenerar la cuenta aislada
npm run test:e2e:staging        # 75 pasos + limpieza tenant-safe
```

El contrato financiero esperado para una venta a crédito es: despacho pendiente sin egreso, aprobación con stock comprometido y CxC, entrega con egreso, comisión `cta_cobrar` retenida, liberación manual y pago. El runner verifica además descuentos, Kardex, reportes, venta rápida, reciclaje y guardas RLS. `--keep-data` solo debe usarse para diagnóstico manual y deja fixtures deliberadamente persistentes.

### E2E nocturno en GitHub Actions

El workflow `.github/workflows/staging-e2e-nightly.yml` ejecuta esta misma batería diariamente a las **05:00 UTC (01:00 Venezuela)** y también permite ejecución manual. Levanta Worker y Vite locales, valida el project-ref fijo de staging, provisiona la cuenta aislada, escribe un resumen en la ejecución, publica los logs como artefacto durante 14 días, detiene los procesos y borra la configuración efímera al terminar.

Configura en **Settings → Secrets and variables → Actions**:

| Secret | Uso |
|---|---|
| `STAGING_SUPABASE_URL` | Debe ser exactamente `https://spupqgkdsgohxxfoxydl.supabase.co` |
| `STAGING_SUPABASE_ANON_KEY` | Clave anon del proyecto staging |
| `STAGING_SUPABASE_SERVICE_KEY` | Provisionamiento de la cuenta E2E; nunca se imprime |
| `STAGING_DEV_SUPER_CODE` | Código maestro local del Worker staging |
| `STAGING_E2E_ALERT_WEBHOOK` | Opcional; webhook Slack/Discord compatible para alertar fallos |

Si no se configura el webhook, GitHub conserva igualmente el estado fallido, el resumen de ejecución y el artefacto de logs. El workflow nunca usa secrets de producción ni despliega.

### Clave administrativa del Worker local

El archivo `.env` alimenta el frontend y contiene el Access Token de Supabase. Ejecuta `npm run configure:local` para consultar la `service_role` key del proyecto staging y generar `.dev.vars` automáticamente; la clave no se imprime ni se guarda en Git. Si el `.env` no contiene el token, puedes crear `.dev.vars` desde `.dev.vars.example` y completar la clave staging manualmente.

No uses la clave de producción. Sin `SUPABASE_SERVICE_KEY`, `switch-operator` responde `503 Worker no configurado` en vez de intentar una llamada administrativa inválida.

En este staging el PIN maestro está configurado deliberadamente con ceros: usa `0000` para vendedores y `000000` para supervisor, administración, logística o jefe. La pantalla exige esas longitudes según el rol; no hace falta modificar `pin_hash` en la base de datos.

## Restauración y secuencias

Los restores que insertan números explícitos deben reparar los correlativos antes de volver a operar. La migración `240_sync_sequences_after_restore.sql` crea `public.sync_sequences_after_restore()`, que ajusta de forma idempotente las secuencias de configuración, cotizaciones, despachos, inventario y órdenes de compra al máximo restaurado. El endpoint JSON de restore la invoca automáticamente al terminar; para un restore SQL manual se puede ejecutar:

```sql
SELECT public.sync_sequences_after_restore();
```

La función no borra ni modifica filas. Si una tabla opcional no existe, la omite y continúa; el resultado devuelve únicamente el resumen de secuencias ajustadas.

## Estado de embeddings

Staging usa `public.vector(768)`, que coincide con `@cf/baai/bge-base-en-v1.5`. La regeneración se ejecutó mediante un Worker local con Workers AI remoto, usando el alcance global explícito restringido al rol `desarrollador`.

Verificación actual: **443/443 productos** tienen un embedding válido de 768 dimensiones, con 441 productos activos y 2 inactivos. El dump de producción tenía los 443 valores nulos, por lo que todos los vectores fueron generados de forma reproducible por el modelo; no se copiaron ni fabricaron valores.

## Paridad con el proyecto original

La carpeta `construacero-staging/supabase/migrations` contiene todos los archivos SQL de `supabase/migrations` del proyecto original con el mismo contenido. La comparación SHA-256 no detecta archivos faltantes ni modificados; staging agrega únicamente `227_roles_completos_staging.sql`, `229_despacho_items_snapshots.sql` y `230_despacho_items_origen.sql`. Las migraciones `231`, `232`, `233` y `234` también están en ambas copias. La `233` elimina overloads históricos de las RPCs de productos para que PostgREST no devuelva errores de resolución ambigua; la `234` hace tenant-safe la limpieza del Tester y elimina referencias financieras de despachos.

La nómina también conserva sus 12 migraciones originales sin diferencias: `nomina-construacero/supabase/migrations` y `construacero-staging/nomina-construacero/supabase/migrations` son idénticas.

La única diferencia intencional fuera de las migraciones es `supabase/config.toml`: `project_id` apunta al proyecto staging `spupqgkdsgohxxfoxydl`.

La paridad del código ejecutable también fue verificada: `src/` (264 archivos), `api/` (28 archivos) y el módulo de nómina (`src/`, `api/` y migraciones) no tienen diferencias de contenido respecto al proyecto local. `worker.js`, `api/lib/utils.js` y `OfflineBanner.jsx` fueron sincronizados. Las diferencias restantes son deliberadas: credenciales y `project-ref`, configuración Wrangler/Vite de staging, nombre y scripts de `package.json`, documentación, herramientas de configuración local y las migraciones exclusivas de staging.

## Base de datos staging

1. Crear o clonar una base cuyo nombre contenga `stage`, `staging`, `test` o `qa`.
2. Aplicar todos los archivos SQL del módulo principal y las 12 migraciones de `nomina-construacero` en el mismo orden que el proyecto original. Para el módulo principal, staging agrega `227`, `229` y `230`; las migraciones `231`, `232`, `233` y `234` están sincronizadas en ambas copias.
3. Ejecutar el ensayo E2E reversible con una URL administrativa de staging. En un proyecto Supabase la base suele llamarse `postgres`, por eso hay que confirmar explícitamente el entorno:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SET app.construacero_staging = 'CONFIRM_STAGING_ONLY';
-- Opcional en clones multi-tenant:
-- SET app.construacero_cuenta_id = 'UUID-DE-LA-CUENTA-STAGING';
\\i supabase/staging/228_e2e_devolucion_staging.sql
SQL
```

El SQL aborta si detecta una base de producción, valida inventario/Kardex, devolución parcial, CxC, comisión, transportista local, pago FIFO, idempotencia y reversa, y termina con `ROLLBACK`; debe devolver `PASS — ensayo staging ejecutado y revertido; no persistieron fixtures`. No almacenar `SUPABASE_SERVICE_KEY` en el frontend ni en el repositorio.

Sistema de cotizaciones comerciales para ferretería. Permite a los vendedores registrar clientes, construir cotizaciones con el inventario disponible y generar PDFs profesionales para compartir por WhatsApp.

El plan maestro de validación y salida se encuentra en `docs/plans/PLAN_SALIDA_PRODUCCION.md`.

## Stack

- **React 19** + **Vite** — Frontend
- **Tailwind CSS** — Estilos
- **Zustand** — Estado global (sesión y rol)
- **TanStack Query** — Estado del servidor (queries a Supabase)
- **Supabase** — Auth, base de datos Postgres, RLS
- **jsPDF + html2canvas** — Generación de PDFs

## Roles

| Rol | Capacidades |
|---|---|
| `supervisor` | Acceso total: clientes, cotizaciones, inventario, auditoría, usuarios, reasignaciones |
| `vendedor` | Sus propios clientes y cotizaciones. Solo lectura de inventario |

## Estructura del proyecto

```
src/
├── modules/
│   ├── auth/          # Login, sesión, protección de rutas
│   ├── customers/     # Clientes + reglas anti-robo
│   ├── quotes/        # Constructor de cotizaciones + versioning
│   ├── inventory/     # Consulta de productos (solo lectura para vendedor)
│   ├── carriers/      # Transportistas
│   ├── users/         # Gestión de usuarios (solo supervisor)
│   └── audit/         # Log de acciones (solo supervisor)
├── services/
│   ├── supabase/      # Cliente Supabase + tipos
│   ├── pdf/           # Generador de PDF
│   └── whatsapp/      # Helper de compartir por WhatsApp
├── store/             # Zustand stores
├── components/
│   ├── ui/            # Componentes genéricos reutilizables
│   └── layout/        # Navbar, Sidebar
├── views/             # Páginas completas
└── utils/
    ├── dinero.js      # Matemática financiera precisa
    └── dateHelpers.js # Formateo de fechas

supabase/
└── migrations/        # Copia exacta de las migraciones originales + extensiones staging 227/229/230
```

## Despliegue (Producción)

La aplicación usa una arquitectura de dos capas:

| Capa | Servicio | URL |
|------|----------|-----|
| **Frontend** | Vercel | `https://listo-pos-cotizaciones.vercel.app` |
| **API Backend** | Cloudflare Worker | `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev` |

### Cómo funciona

1. **Vercel** sirve el frontend (React + Vite build estático).
2. Las llamadas a `/api/*` se redirigen al **Cloudflare Worker** mediante `vercel.json` rewrites.
3. El Worker maneja autenticación JWT (Supabase), operaciones de BD con `service_role`, y lógica de negocio.

### Variables de entorno en Vercel

| Variable | Valor | Notas |
|----------|-------|-------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Clave anon pública |
| `VITE_WORKER_ORIGIN` | *(vacío o no definir)* | **Dejar vacío** para usar el proxy de `vercel.json` |

> **Importante sobre `VITE_WORKER_ORIGIN`:**
> - Si se deja **vacío o sin definir**, el frontend usa rutas relativas (`/api/...`) y Vercel las proxea al Worker automáticamente. Esta es la configuración recomendada.
> - Si se define (ej: `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev`), el frontend llama al Worker directamente (cross-origin). El Worker ya tiene CORS configurado para `*.vercel.app`.

### Flujo de deploy

```bash
# Frontend → Vercel (auto-deploy al hacer push a GitHub)
git push origin main

# API → Cloudflare Worker (manual)
wrangler deploy --dispatch-namespace chiridion
```

### vercel.json

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://listo-pos-cotizaciones.luigistorelogistics.workers.dev/api/:path*" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

La primera regla proxea todas las llamadas API al Worker. La segunda es el fallback SPA para React Router.

## Configuración local

```bash
# 1. Instalar dependencias
bun install

# 2. Variables de entorno
cp .env.example .env
# Editar .env con las credenciales del proyecto Supabase

# 3. Ejecutar migrations en Supabase
# SQL Editor → ejecutar todas las migraciones de supabase/migrations en orden

# 4. Iniciar dev server
bun run dev
```

En desarrollo local, el Worker de staging corre en `localhost:8789` (via `wrangler dev`) y el frontend usa Vite proxy o `VITE_WORKER_ORIGIN=http://localhost:8789`.

## Tester E2E automático de staging

El runner reproduce el flujo determinista de 75 pasos sin reutilizar cookies/JWT del navegador. Usa una cuenta de prueba de Supabase staging, activa el desarrollador virtual con `DEV_SUPER_CODE` y llama al mismo proxy `http://localhost:5174/api` que usa la aplicación. Todos los fixtures usan los marcadores `TEST-DET-*` y el RIF de prueba; por defecto se limpian incluso cuando un paso falla.

1. Copia `.env.e2e.example` a un archivo local (por ejemplo `.env.e2e.local`) y configura `STAGING_E2E_EMAIL` y `STAGING_E2E_PASSWORD` de una cuenta **exclusiva de staging**.
2. Exporta esas dos variables en la terminal o copia sus valores temporalmente a `.env` local. No las agregues a Git ni las uses en producción.
3. Levanta staging y confirma ambos proyectos:

```bash
npm run dev
curl -i http://127.0.0.1:8789/api/ping
curl -i http://localhost:5174/api/ping
```

4. Ejecuta:

```bash
npm run test:e2e:staging
```

El log queda en `tmp/e2e-staging/tester-<fecha>.log`, no incluye tokens, contraseñas ni hashes y el proceso devuelve código distinto de cero si falla. `--keep-data` existe únicamente para diagnóstico manual y deja fixtures explícitamente; no debe usarse como corrida normal.

Guardas obligatorias: el runner rechaza cualquier Supabase distinto de `spupqgkdsgohxxfoxydl`, cualquier frontend distinto de `localhost:5174` o Worker distinto de `localhost:8789`. No usa `SUPABASE_SERVICE_KEY`; el Worker local es quien conserva la clave administrativa.

## Documentación interna

- **`ARQUITECTURA.md`** — Esquema de BD, RLS, RPCs, reglas de negocio (v1.1)
- **`BITACORA.md`** — Registro cronológico de decisiones y sesiones de trabajo
