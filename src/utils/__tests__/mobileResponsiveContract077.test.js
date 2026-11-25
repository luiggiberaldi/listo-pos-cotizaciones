// Contrato de fuente y lógica para el arreglo integral de responsividad móvil (OP-2026-074/077),
// portado a producción en OP-2026-080 con la decisión de mostrar el botón + solo en Inicio.
// Protege que las barras críticas vuelvan a envolver en teléfono, que los botones flotantes no
// se apilen ni tapen pantallas administrativas, y que las áreas táctiles bajas no regresen.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  QUICK_QUOTE_FAB_VISIBLE_PATHS,
  isQuickQuoteFabVisible,
} from '../../components/cotizaciones/quickQuoteFabRutas.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const leer = rel => fs.readFileSync(path.join(projectRoot, rel), 'utf8')

describe('OP-2026-074 — Contrato de responsividad móvil', () => {
  it('PageHeader permite envolver acciones en móvil sin empujar por shrink-0 ni pl-5', () => {
    const src = leer('src/components/ui/PageHeader.jsx')
    expect(src).toContain('w-full sm:w-auto sm:shrink-0 min-w-0')
    expect(src).not.toContain('shrink-0 pl-5 sm:pl-0')
  })

  it('ClientesView, PersonalView, TransportistasView y MisVentasView envuelven sus botones superiores', () => {
    const clientes = leer('src/views/ClientesView.jsx')
    const personal = leer('src/views/PersonalView.jsx')
    const transportistas = leer('src/views/TransportistasView.jsx')
    const misVentas = leer('src/views/MisVentasView.jsx')

    expect(clientes).toContain('flex flex-wrap items-center gap-2 min-w-0')
    expect(personal).toContain('flex flex-wrap items-center gap-2 min-w-0')
    expect(transportistas).toContain('flex flex-wrap items-center gap-2 min-w-0')
    expect(misVentas).toContain('flex flex-wrap items-center gap-2 min-w-0')
  })

  it('ComisionesView no bloquea la barra de tasas/exportar con shrink-0 y muestra texto legible en móvil', () => {
    const src = leer('src/views/ComisionesView.jsx')
    expect(src).not.toContain('flex flex-wrap items-center gap-2.5 ml-auto shrink-0 self-end')
    expect(src).toContain('w-full md:w-auto flex flex-wrap items-center gap-2 md:ml-auto min-w-0 self-end')
    expect(src).toContain('<span className="sm:hidden">Euro:</span>')
    expect(src).toContain("exportando ? 'Generando...' : 'Imprimir'")
    expect(src).toContain("exportando ? 'Generando...' : 'Descargar'")
    expect(src).toContain('left-0 sm:left-auto sm:right-0')
  })

  it('OrdenCompraView envuelve la tira de filtros de estado en móvil', () => {
    const src = leer('src/views/OrdenCompraView.jsx')
    expect(src).toContain('flex flex-col md:flex-row gap-3 min-w-0')
    expect(src).toContain('flex flex-wrap sm:flex-nowrap items-center gap-1.5 w-full md:w-auto min-w-0')
  })

  it('ConfiguracionView usa cuadrícula 2 columnas en móvil sin recortar pestañas con overflow-hidden', () => {
    const src = leer('src/views/ConfiguracionView.jsx')
    expect(src).toContain('grid grid-cols-2 sm:flex sm:flex-wrap gap-1 bg-slate-100 p-1 rounded-2xl min-w-0')
    expect(src).not.toContain('justify-center overflow-hidden')
  })

  it('ReportesView KpiCard permite subtítulos hasta en 2 líneas sin truncarlos a 1 sola línea', () => {
    const src = leer('src/views/ReportesView.jsx')
    expect(src).toContain('leading-snug line-clamp-2 text-slate-400')
    expect(src).toContain("leading-snug line-clamp-2\" style={{ color: 'rgba(255,255,255,0.4)' }}")
  })

  it('ReportesView (pestaña Comisiones) envuelve la barra de tasas y conserva lo ya publicado en producción', () => {
    const src = leer('src/views/ReportesView.jsx')
    expect(src).toContain('w-full md:w-auto flex flex-wrap items-center gap-2 md:ml-auto min-w-0 self-end')
    expect(src).toContain('<span className="sm:hidden">Euro:</span>')
    expect(src).not.toContain('flex flex-wrap items-center gap-2.5 ml-auto shrink-0 self-end')
    // Lo que producción ya tenía y no debe perderse al portar (OP-2026-081)
    expect(src).toContain('formato-reporte-cxc')
    expect(src).toContain('clientesPagadoDeMas')
  })

  it('QuickQuoteFAB (+) solo aparece en Inicio (decisión del dueño, OP-2026-080)', () => {
    expect(QUICK_QUOTE_FAB_VISIBLE_PATHS).toEqual(['/'])
    expect(isQuickQuoteFabVisible('/')).toBe(true)
    expect(isQuickQuoteFabVisible('')).toBe(true)

    for (const otraRuta of [
      '/mis-ventas',
      '/clientes',
      '/despachos',
      '/inventario',
      '/proveedores',
      '/usuarios',
      '/auditoria',
      '/reportes',
      '/reporte-vendedores',
      '/orden-compra',
      '/configuracion',
      '/personal',
      '/comisiones',
      '/transportistas',
      '/tutorial',
      '/cotizaciones',
      '/venta-rapida',
      '/login',
      '/clientes/123',
    ]) {
      expect(isQuickQuoteFabVisible(otraRuta)).toBe(false)
    }
  })

  it('BuzonFAB se ubica a la izquierda en móvil (bottom-20 left-4) y AppLayout da respiro suficiente abajo', () => {
    const buzon = leer('src/components/ui/BuzonFAB.jsx')
    const layout = leer('src/components/layout/AppLayout.jsx')

    expect(buzon).toContain('bottom-20 left-4 md:left-auto md:bottom-6 md:right-6')
    expect(buzon).not.toContain('bottom-36 right-4')
    expect(layout).toContain("location.pathname === '/' ? 'h-36' : 'h-24'")
  })

  it('ProveedoresView, TutorialView y modales clave cumplen altura táctil mínima y ajuste a viewport móvil', () => {
    const proveedores = leer('src/views/ProveedoresView.jsx')
    const tutorial = leer('src/views/TutorialView.jsx')
    const modal = leer('src/components/ui/Modal.jsx')
    const editDesp = leer('src/components/despachos/EditDespachoModal.jsx')

    expect(proveedores).toContain('inline-flex items-center min-h-9 px-3 py-1.5')
    expect(tutorial).toContain('inline-flex items-center min-h-9 px-2 -ml-2')
    expect(tutorial).toContain('min-h-9 px-3.5 py-2')
    expect(modal).toContain('max-h-[calc(100dvh-2rem)]')
    expect(editDesp).toContain('max-h-[calc(100dvh-2rem)]')
  })
})
