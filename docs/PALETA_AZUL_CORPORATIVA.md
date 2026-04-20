# Paleta Azul Corporativa — Construacero Carabobo

> Documentación para restaurar la paleta azul en caso de que se requiera en el futuro.
> Fecha de creación: 2026-04-20

---

## Colores de la paleta

| Nombre            | Hex       | Uso principal                              |
|-------------------|-----------|--------------------------------------------|
| Midnight Express  | `#050834` | Fondos oscuros, sidebar, nav, texto títulos |
| Midnight Dark     | `#030520` | Estados pressed/active, gradientes profundos |
| Mariner           | `#3A63A8` | Botones primarios, acciones, bordes activos |
| Mariner Deep      | `#2D5090` | Hover de botones, acentos secundarios       |
| Maya Blue         | `#7CB8F2` | Highlights, CTA, gradientes, focus rings    |
| Maya Blue Light   | `#93C5F9` | Hover suave, gradientes claros              |

### Colores anteriores que fueron reemplazados

| Antes (Navy/Gold)         | Después (Azul corporativo) |
|---------------------------|----------------------------|
| `#1B365D` (Navy)          | `#3A63A8` (Mariner)        |
| `#0d1f3c` (Dark navy)     | `#050834` (Midnight)       |
| `#0f1f3c` (Dark navy alt) | `#050834` (Midnight)       |
| `#0a1628` (Deepest navy)  | `#030520` (Midnight Dark)  |
| `#B8860B` (Gold)          | `#7CB8F2` (Maya Blue)      |
| `#d4a017` (Light gold)    | `#93C5F9` (Maya Blue Light)|
| `#92400e` (Dark gold)     | `#2D5090` (Mariner Deep)   |

### RGBA equivalencias

| Antes                     | Después                     |
|---------------------------|-----------------------------|
| `rgba(27,54,93,...)`      | `rgba(58,99,168,...)`       |
| `rgba(184,134,11,...)`    | `rgba(124,184,242,...)`     |

### Tailwind classes cambiadas (BottomNav, BcvWidget)

| Antes              | Después           |
|--------------------|-------------------|
| `text-amber-400`   | `text-sky-300`    |
| `bg-amber-400/15`  | `bg-sky-300/15`   |
| `bg-amber-500/20`  | `bg-sky-500/20`   |
| `border-amber-500/20` | `border-sky-500/20` |
| `focus:ring-amber-500/40` | `focus:ring-sky-400/40` |

> **Nota**: Los `amber` en contextos semánticos (warnings, stock bajo, pendiente, alertas) NO se cambiaron. Solo se cambiaron los que eran branding/acento.

---

## Archivos modificados (27 archivos)

### Componentes UI
- `src/components/ui/PageHeader.jsx` — gradientes de barra e iconos
- `src/components/ui/ConfirmModal.jsx` — variante default (strip, botón, icono)
- `src/components/ui/EmptyState.jsx` — fondos, bordes, iconos, botón acción
- `src/components/ui/Logo.jsx` — color texto "Carabobo"
- `src/components/ui/ErrorBoundary.jsx` — fondo del error
- `src/components/ui/OnboardingTooltip.jsx` — sin cambios significativos (amber semántico)

### Layout
- `src/components/layout/AppLayout.jsx` — sidebar gradientes, botón colapsar, notificaciones
- `src/components/layout/BottomNav.jsx` — nav inferior gradiente, estados activos amber→sky
- `src/components/layout/BcvWidget.jsx` — popover/sheet fondo, botón aplicar, badges

### Cotizaciones
- `src/components/cotizaciones/CotizacionBuilder.jsx` — gradientes, fondos, bordes
- `src/components/cotizaciones/CotizacionRapida.jsx` — fondos, botones
- `src/components/cotizaciones/QuickQuoteFAB.jsx` — FAB gradiente y sombra

### Inventario
- `src/components/inventario/ProductoCard.jsx` — hover editar
- `src/components/inventario/ProductoRow.jsx` — hover editar

### Auth
- `src/modules/auth/LoginPage.jsx` — fondo completo, gradientes, glow, botón PIN
- `src/components/auth/LoginPinModal.jsx` — fondo gradiente

### Vistas
- `src/views/DashboardView.jsx` — MetricCards, botones, tarjetas comisiones
- `src/views/ClientesView.jsx` — fondos
- `src/views/InventarioView.jsx` — filtros
- `src/views/UsuariosView.jsx` — gradientes tarjetas
- `src/views/ComisionesView.jsx` — gradientes, estados
- `src/views/TransportistasView.jsx` — gradientes
- `src/views/ConfiguracionView.jsx` — botones acción
- `src/views/CotizacionesView.jsx` — fondos

### Reportes
- `src/components/reportes/KpiCards.jsx` — gradientes KPI

### Config
- `tailwind.config.js` — design tokens completos (primary, accent, app, surface, content, status, border, brand, blue scale, indigo scale)

### PDFs (commit d61a53d)
- `src/services/pdf/cotizacionPDF.js` — barras, fondos, textos
- `src/services/pdf/despachoPDF.js` — barras, fondos, textos

---

## Cómo restaurar la paleta azul

### Opción 1: Aplicar el patch guardado (recomendado)

```bash
# Desde la raíz del proyecto:
git apply docs/paleta-azul-ui.patch

# También revertir el revert del commit de PDFs:
git cherry-pick d61a53d

# Construir y desplegar:
bun run build
wrangler deploy --dispatch-namespace chiridion
```

### Opción 2: Reemplazar colores manualmente

Ejecutar estos comandos sed desde la raíz del proyecto:

```bash
find src/ -name "*.jsx" -o -name "*.js" -o -name "*.css" | xargs sed -i \
  -e 's/#1B365D/#3A63A8/g' \
  -e 's/#0d1f3c/#050834/g' \
  -e 's/#0f1f3c/#050834/g' \
  -e 's/#0a1628/#030520/g' \
  -e 's/#B8860B/#7CB8F2/g' \
  -e 's/#d4a017/#93C5F9/g' \
  -e 's/#92400e/#2D5090/g'

find src/ -name "*.jsx" -o -name "*.js" | xargs sed -i \
  -e 's/rgba(27,54,93/rgba(58,99,168/g' \
  -e 's/rgba(27, 54, 93/rgba(58, 99, 168/g' \
  -e 's/rgba(184,134,11/rgba(124,184,242/g' \
  -e 's/rgba(184, 134, 11/rgba(124, 184, 242/g'
```

Luego actualizar manualmente BottomNav y BcvWidget (amber→sky) y el tailwind.config.js.

---

## Tailwind Design Tokens (paleta azul)

```js
// tailwind.config.js → theme.extend.colors
primary: {
  DEFAULT: '#050834',
  hover:   '#0A1050',
  light:   '#E8EEF8',
  focus:   '#7CB8F2',
  dark:    '#030520',
},
accent: {
  DEFAULT: '#3A63A8',
  hover:   '#2D5090',
  light:   '#E8F0FA',
  focus:   '#7CB8F2',
  dark:    '#264580',
},
app: {
  light: '#F0F3F7',
  dark:  '#050834',
},
surface: {
  light: '#FFFFFF',
  dark:  '#0A1050',
},
content: {
  main:      '#050834',
  secondary: '#5C6972',
  inverse:   '#F0F3F7',
},
status: {
  success:   '#0D9668',
  successBg: '#D1FAE5',
  danger:    '#DC2626',
  dangerBg:  '#FEE2E2',
  warning:   '#D97706',
  warningBg: '#FEF3C7',
},
border: {
  subtle: '#D5D5D5',
  focus:  '#3A63A8',
},
```
