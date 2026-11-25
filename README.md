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
| `vendedor` | Sus propios clientes y cotizaciones; gana comisión. Puede editar productos y cantidades de **sus** despachos que esperan aprobación (ver abajo) |
| `vendedor_sin_comision` | Ventas de empresa, sin comisión. Mismo permiso de edición de sus despachos que esperan aprobación |
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

El Worker usa "ubicación inteligente" (`[placement] mode = "smart"` en `wrangler.toml`): Cloudflare lo ejecuta cerca de la base de datos. Ver `docs/operaciones/OP-2026-021_velocidad-cambios-bajo-riesgo.md`.

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

## Cuentas por Cobrar y despachos — cambios publicados en producción (OP-2026-059)

> **Estado:** **publicados en producción el 2026-11-24** (migraciones 301 a 309 y código, solicitud #66; ver [OP-2026-059](docs/operaciones/OP-2026-059_paso-a-produccion-cxc.md)).

Cuando se publiquen, así funcionará:

- **Abonos:** se guardan en un solo paso junto con su anotación de auditoría; un doble clic o reintento no duplica; si hay un abono igual en los últimos 15 minutos se pregunta "¿Es otro pago?"; si falla, sale un aviso rojo. El abono se puede enlazar a un despacho y el detalle de formas de pago debe sumar el monto.
- **Saldo a favor** (cargar, devolver, cruzar): mismo control en un solo paso.
- **Revertir un movimiento** pasa a ser **anular con motivo** (mínimo 10 caracteres); se guarda una copia completa en el archivo de movimientos borrados, visible en la ficha del cliente.
- **Reabrir un despacho entregado** con pagos pide decidir: dejar el dinero en la cuenta o pasarlo a saldo a favor. **Anular un pendiente** con pagos anotados pide qué pasó con ese dinero (saldo a favor, otro despacho o no cobrado) y un motivo.
- **Edición profunda:** artículos y cuenta del cliente en un solo paso; si quedan pagos sin deuda, pregunta qué hacer.
- **Devoluciones:** usan el mismo reparto que la ficha (ven los pagos sueltos) y, si un abono manual ya cubría ese crédito, permiten anularlo en el mismo paso. Lo **donado** que se devuelve no da crédito, salvo autorización con motivo (administración, jefe o desarrollador).
- **"Cruce"** exige decir contra qué se cruzó.
- La ficha y el reporte de Crédito muestran los **pagos de más** que antes no se veían.

## Cotizaciones: guardado, pendientes y limpieza nocturna (OP-2026-069)

> **Publicado en producción el 2026-11-24** (solicitud #72; ver [OP-2026-069](docs/operaciones/OP-2026-069_cotizaciones-que-desaparecen.md)).

- **Guardar con internet:** si el servidor tarda más de 20 segundos o falla, la pantalla avisa "No se pudo guardar" y la cotización sigue en pantalla para reintentar. Ya no se guarda a escondidas en el equipo.
- **Sin internet:** la cotización queda **PENDIENTE** en ese equipo, con el aviso de que todavía no está en el sistema. Se sube sola **como borrador** cuando hay conexión y entra con su PIN **el mismo vendedor que la hizo**; después hay que abrirla y pulsar Enviar. El aviso de pendientes (arriba en el menú) muestra cuáles hay, y descartar una pide confirmación.
- **Sin duplicados:** cada cotización nueva lleva su propia identidad desde el primer intento. Si un intento sí llegó al servidor, el reintento no crea otra.
- **Limpieza nocturna** (11:00 p. m. de Venezuela, una sola vez por noche):
  - enviada sin movimiento en **30 días** → **vencida**; borrador sin movimiento en 30 días → **anulada**. Cada una queda en la auditoría.
  - vencida, rechazada o anulada sin movimiento en **1 año** → se borra, **después de guardar una copia completa** en la auditoría. Si la copia no se guarda, no se borra.
  - Las aceptadas nunca se tocan. "Sin movimiento" cuenta desde la última modificación.

## Vendedores: editar sus despachos que esperan aprobación (OP-2026-070)

> **Publicado en producción el 2026-11-24** (solicitud #73; ver [OP-2026-070](docs/operaciones/OP-2026-070_vendedor-edita-despacho.md)).

- **Dónde:** en la ficha del despacho (botón "1 Ítem" de la tarjeta) aparece **Editar productos** si el despacho es del vendedor y está **Esperando aprobación**.
- **Qué puede cambiar:** agregar, quitar y cambiar cantidades. El precio se elige de una lista con los **precios de lista** (P1, P2 y P3 habilitados, con su recargo si es vendedor externo) o el precio que ya tenía.
- **Qué no puede:** escribir precios a mano, agregar artículos externos o préstamos, poner descuentos, elegir o cambiar pagos, ni editar despachos ajenos o ya aprobados.
- **Pagos:** si el despacho tiene un solo método de pago, su monto se ajusta solo al nuevo total (mismo método). Con pagos combinados, adelantos o saldo a favor, el vendedor no puede editar y debe pedirlo a administración.
- Lo controlan la pantalla, el servidor (`src/utils/edicionVendedorDespacho.js`) y la base de datos (`editar_despacho_profundidad`, migración 311). El supervisor sigue aprobando después.

## Acceso con PIN y tasas en el inicio (OP-2026-072)

> **Listo para publicar en `main`** (ver [OP-2026-072](docs/plans/OP-2026-072_tasa-login-y-sesion-12h.md)).

- **Tasas visibles antes del PIN:** la barra superior de la pantalla de inicio muestra las mismas tasas del encabezado interno (**BCV**, **EUR**, **USDT** y tasa activa `USDT` o `Manual`) en modo solo lectura.
- **Sesión de 12 horas automática:** tras ingresar el PIN, el acceso queda guardado en el equipo durante **12 horas** (sobrevive recargas, cambios de pestaña y cierre/reapertura de la app o navegador) hasta vencer o tocar **Cerrar sesión**.
- **Validación al recargar:** cada vez que la app recarga o despierta, confirma con el servidor que el operador siga activo y su PIN no haya cambiado; si fue revocado, vuelve de inmediato a "¿Quién está operando?".
- **Salidas claras:** el menú lateral dice **Cerrar sesión** (cierra todas las pestañas y revoca el pase de 12 horas en el servidor); el botón **Salir** de la cuenta de la empresa en el login pide confirmación.

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
