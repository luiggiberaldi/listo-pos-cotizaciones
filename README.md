# Construacero Carabobo

Sistema de gestión para la empresa: cotizaciones, despachos (salidas de mercancía), inventario, cuentas por cobrar, comisiones, transportistas y auditoría. Permite a cada persona ver y hacer solo lo que le corresponde según su rol.

**¿Por dónde empiezo?**
1. **[Registro maestro de casos](docs/operaciones/REGISTRO.md)**: lista numerada de todo lo que se ha hecho, arreglado o revisado. Si buscas algo, empieza aquí.
2. **[Mapa del negocio](docs/operaciones/OP-2026-015_mapa-de-negocio.md)**: quién hace qué, desde la compra hasta la entrega, en lenguaje simple.

## Stack

- **React 19** + **Vite**: pantalla (frontend)
- **Tailwind CSS**: estilos
- **Zustand**: memoria de la sesión (quién entró y con qué rol)
- **TanStack Query**: consultas al servidor
- **Supabase**: base de datos (PostgreSQL), inicio de sesión y permisos por fila
- **Cloudflare Worker**: servidor que hace la lógica de negocio (carpeta `api/`)
- **jsPDF**: generación de PDFs (notas de entrega, órdenes de despacho)

## Roles

Cada persona entra con un rol. El rol define qué puede ver y hacer. La lista oficial está en `src/utils/dashboardAccess.js`.

| Rol (nombre en el sistema) | Qué puede hacer, en general |
|---|---|
| `jefe` | Ve toda la empresa: ventas, comisiones, equipo y auditoría |
| `administracion` | Aprueba despachos, maneja cobros, cuentas por cobrar e inventario |
| `supervisor` | Ve sus propias ventas y las de su equipo |
| `vendedor` | Sus propios clientes y cotizaciones; gana comisión |
| `vendedor_sin_comision` | Ventas de empresa, sin comisión |
| `logistica` | Ve los despachos por entregar y registra las entregas |
| `desarrollador` | Acceso técnico |

## Estructura del proyecto

```
src/
├── views/        # Pantallas completas (Ventas, Despachos, Auditoría, Reportes…)
├── components/   # Piezas reutilizables de pantalla (tarjetas, ventanas, botones)
├── hooks/        # Consultas y lógica que usan las pantallas
├── services/
│   └── pdf/      # Generación de PDFs (nota de entrega, orden de despacho)
├── utils/        # Funciones de cálculo y reglas (dinero, fechas, cobranza, permisos)
├── constants/    # Valores fijos del sistema
├── store/        # Memoria de la sesión
├── lib/          # Conexiones (por ejemplo, a Supabase)
└── modules/      # Piezas por área (auth, clientes, cotizaciones, usuarios)

api/
├── handlers/     # Respuestas del servidor (Worker) por tipo de consulta
└── lib/          # Utilidades del servidor

supabase/
└── migrations/   # Cambios de la base de datos, numerados y en orden
                  # (lista y explicación en docs/operaciones/matriz-migraciones.md)

docs/
├── operaciones/  # Casos, auditorías, informes (ver REGISTRO.md)
├── plans/        # Planes de trabajo
├── runbooks/     # Pasos para desplegar y revertir
├── decisiones/   # Decisiones de diseño (ADR)
└── incidentes/   # Fallos graves y sus causas (INC)
```

## Despliegue (Producción)

La aplicación usa dos servicios:

| Capa | Servicio | URL |
|------|----------|-----|
| **Frontend** | Vercel | `https://listo-pos-cotizaciones.vercel.app` |
| **Servidor (API)** | Cloudflare Worker | `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev` |

### Cómo funciona

1. **Vercel** sirve la pantalla de la aplicación.
2. Las llamadas a `/api/*` se redirigen al **Worker** mediante las reglas de `vercel.json`.
3. El Worker verifica quién entra (Supabase), consulta la base de datos y aplica las reglas del negocio.

### Variables de entorno en Vercel

| Variable | Valor | Notas |
|----------|-------|-------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Clave pública de Supabase |
| `VITE_WORKER_ORIGIN` | *(vacío o sin definir)* | **Dejar vacío** para usar las rutas de `vercel.json` |

> **Importante sobre `VITE_WORKER_ORIGIN`:** si se deja vacío, la pantalla llama a `/api/...` y Vercel lo envía al Worker. Esta es la configuración recomendada. Si se define, la pantalla llama al Worker directamente, y el Worker ya acepta las llamadas desde `*.vercel.app`.

### Cómo se publica un cambio

```bash
# Pantalla → Vercel (se publica al subir cambios a GitHub)
git push origin main

# Servidor → Cloudflare Worker (GitHub Actions, al subir cambios a main)
# Ver .github/workflows/deploy-worker.yml y docs/runbooks/deploy-produccion.md
```

Antes de publicar en producción hay que probar primero en **staging** (una copia de pruebas). Ver `docs/runbooks/deploy-staging.md`.

### vercel.json

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://listo-pos-cotizaciones.luigistorelogistics.workers.dev/api/:path*" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

La primera regla envía todas las llamadas de `/api/` al Worker. La segunda hace que las rutas de la pantalla funcionen al recargar.

## Configuración local

Estos pasos son para una computadora de desarrollo. **Nunca** conectar una copia local a la base de datos de producción.

```bash
# 1. Instalar dependencias
npm install

# 2. Variables de entorno
cp .env.example .env
# Editar .env con las credenciales del proyecto de PRUEBAS (staging)

# 3. Base de datos de pruebas
# Las migraciones (supabase/migrations) se aplican en orden, de la 001 en adelante.
# Ver docs/operaciones/matriz-migraciones.md antes de aplicar cualquiera.

# 4. Iniciar la pantalla y el servidor local
npm run dev
```

El servidor local (Worker) corre en `localhost:8787` (con `npm run dev:worker`).

## Documentación interna

- **[`REGISTRO.md`](docs/operaciones/REGISTRO.md)**: índice maestro de todos los casos, con número fijo (OP-2026-001 en adelante).
- **[`ARQUITECTURA.md`](docs/architecture/ARQUITECTURA.md)**: base de datos, permisos por fila, funciones y reglas de negocio.
- **[`CHANGELOG.md`](CHANGELOG.md)**: cambios publicados por versión.
- **[`ROADMAP.md`](ROADMAP.md)**: pendientes activos y mejoras futuras.
- **[`docs/runbooks/`](docs/runbooks/)**: cómo desplegar, probar en staging y revertir.
- **[`docs/decisiones/`](docs/decisiones/)**: decisiones de diseño (seguridad, secretos, finanzas).
- **[`docs/incidentes/`](docs/incidentes/)**: fallos graves y sus causas.
- **[`docs/operaciones/`](docs/operaciones/)**: casos, auditorías e informes.
- **[`BITACORA.md`](BITACORA.md)**: registro cronológico antiguo. Para casos recientes, usar `REGISTRO.md`.

**Ley de documentación:** todo cambio, error, solución o decisión se documenta en `docs/` con lenguaje claro y con un número de caso. Ver `AGENTS.md`.
