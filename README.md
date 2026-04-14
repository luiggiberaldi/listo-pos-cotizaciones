# Listo POS Cotizaciones

Sistema de cotizaciones comerciales para ferretería. Permite a los vendedores registrar clientes, construir cotizaciones con el inventario disponible y generar PDFs profesionales para compartir por WhatsApp.

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
└── migrations/        # 15 migrations SQL (ver ARQUITECTURA.md)
```

## Configuración

```bash
# 1. Instalar dependencias
bun install

# 2. Variables de entorno
cp .env.example .env
# Editar .env con las credenciales del proyecto Supabase

# 3. Ejecutar migrations en Supabase
# SQL Editor → ejecutar en orden 001 → 015

# 4. Iniciar dev server
bun run dev
```

## Documentación interna

- **`ARQUITECTURA.md`** — Esquema de BD, RLS, RPCs, reglas de negocio (v1.1)
- **`BITACORA.md`** — Registro cronológico de decisiones y sesiones de trabajo
