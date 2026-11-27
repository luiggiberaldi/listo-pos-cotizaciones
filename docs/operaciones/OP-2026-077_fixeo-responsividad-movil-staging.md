# OP-2026-077 — Arreglo completo de responsividad móvil aplicado y verificado en staging

> ✅ **Publicado en producción el 2026-11-25** mediante [OP-2026-080](../plans/OP-2026-080_plan-llevar-077-079-a-produccion.md) (solicitud #77, unión `fa13d0c2`). Diferencia con lo probado en staging: el botón `+` de cotización rápida quedó **solo en Inicio** por decisión del dueño.

**Fecha:** 2026-11-25 · **Plan base:** [OP-2026-074](../plans/OP-2026-074_plan-fixeo-responsividad-movil.md) · **Estado:** 🧪 **Aplicado y verificado en `construacero-staging/` (copia de pruebas)** · Pendiente revisión del usuario para pasar a producción (`main`).

## En resumen

- Se corrigieron **todas las pantallas con problemas de tamaño en teléfono (`360×800 px` y `375×812 px`) dentro de la copia de pruebas (`construacero-staging/`)**, conservando intacta la vista de computadora (`1280×800 px`) y sin hacer ningún cambio en la base de datos.
- En pruebas automáticas (`60` archivos, **`517` pruebas aprobadas**), empaquetado web y revisión en navegador real simulado (**`65` verificaciones** entre celular y computadora), el resultado fue **cero pantallas rotas, cero botones cortados y cero desbordamientos horizontales**.
- Además del plan original, durante la revisión visual se detectaron y corrigieron de una vez **Mis ventas**, **Reporte de Vendedores** y la pestaña **Vehículos de la empresa**, junto con un recorte que apareció brevemente en **Configuración** en computadora al ajustar los tabs.

---

## 1. Qué cambió en `construacero-staging/` (explicado simple)

| Área | Archivo modificado en staging | Qué mejora en el teléfono |
|---|---|---|
| **Encabezado compartido** | `src/components/ui/PageHeader.jsx` | Da todo el ancho disponible a las filas de botones en celular para que no empujen la pantalla hacia un lado. |
| **Clientes y Personal** | `src/views/ClientesView.jsx`, `src/views/PersonalView.jsx` | Los botones *Imprimir*, *Descargar PDF* y *+ Nuevo* bajan ordenados a una segunda línea cuando no caben juntos en teléfono. |
| **Transportistas y Vehículos** | `src/views/TransportistasView.jsx`, `src/components/transportistas/VehiculosFranja.jsx` | Los botones superiores (*Actualizar*, *Imprimir*, *Descargar PDF*, *+ Nuevo* y *Ver inactivos*, *+ Nuevo Vehículo*) se acomodan en dos líneas sin cortar nada; sus ventanas emergentes respetan el alto real con barra del navegador móvil. |
| **Comisiones** | `src/views/ComisionesView.jsx` | Se quitó el candado de ancho fijo; ahora las tasas (*Euro* / *USDT*) caben claras lado a lado y debajo salen los botones completos **Imprimir** y **Descargar** con menús que abren sin salirse del borde. |
| **Orden de Compra** | `src/views/OrdenCompraView.jsx` | Los filtros (*VER TODOS · PENDIENTE · APROBADA · ANULADA*) se reparten en dos líneas en celular sin estirar la pantalla. |
| **Configuración** | `src/views/ConfiguracionView.jsx` | Las pestañas (*Negocio*, *Fiscal*, *Comisiones*, *Transportistas*, *Usuarios*, *Datos*) se ven en una cuadrícula de 2 columnas en celular y en una sola fila completa en computadora (sin recortar texto). |
| **Reportes** | `src/views/ReportesView.jsx` | Las aclaratorias debajo de las cifras grandes en tarjetas ahora se muestran completas (hasta 2 líneas) y la sección de alertas de crédito separa nombre y monto sin chocar. |
| **Mis ventas y Rep. Vendedores** | `src/views/MisVentasView.jsx`, `src/views/ReporteVendedoresView.jsx` | *(Extra detectado en auditoría)* Se ajustaron los botones de **Mis ventas** para que envuelvan limpio en `360 px` y el menú/filtros de **Reporte de Vendedores** (*Hoy · Esta semana · Este mes · Mes anterior · Trimestre*) para que queden visibles sin recorte. |
| **Botones flotantes y tacto** | `src/components/cotizaciones/QuickQuoteFAB.jsx`, `src/components/ui/BuzonFAB.jsx`, `src/components/layout/AppLayout.jsx`, `src/views/ProveedoresView.jsx`, `src/views/TutorialView.jsx` | El botón flotante **Buzón** 💬 pasa abajo a la izquierda en celular (nunca choca encima del botón **`+`** a la derecha); el **`+`** de cotización rápida se muestra solo en pantallas operativas (*Inicio*, *Mis ventas*, *Clientes*, *Despachos*, *Inventario*) y se oculta en vistas administrativas o de consulta (*Proveedores*, *Usuarios*, *Auditoría*, *Reportes*, *Personal*, *Comisiones*, etc.); se amplió el espacio final de desplazamiento y la altura táctil mínima (`36 px`) de *Editar* en Proveedores e *Iniciar / Restablecer progreso* en Tutorial. |
| **Ventanas emergentes** | `src/components/despachos/EditDespachoModal.jsx`, `src/views/TransportistasView.jsx`, `src/components/transportistas/VehiculosFranja.jsx` | Usan altura máxima dinámica de pantalla móvil (`100dvh`) y ancho seguro para evitar cortes con la barra del navegador. |
| **Prueba automática nueva** | `src/utils/__tests__/mobileResponsiveContract074.test.js` | Protege estas reglas (`9` comprobaciones) para que no se vuelvan a romper en futuros cambios. |

---

## 2. Pruebas realizadas y resultados observados

- **Pruebas unitarias y de contrato (`npm --prefix construacero-staging test`):**
  - Resultado: **`60` archivos de prueba / `517` pruebas aprobadas** (`0` fallos, incluyendo `9/9` del contrato móvil `mobileResponsiveContract074.test.js`).
- **Construcción web + aplicación móvil (`npm --prefix construacero-staging run build`):**
  - Resultado: compilado sin errores (`83` recursos listos para PWA).
- **Auditoría real en navegador Chromium (datos simulados, sin tocar la base real):**
  - Tamaños probados: **`360×800`**, **`375×812`** (teléfonos) y **`1280×800`** (computadora), en flujos de **Login, Jefe, Vendedor y Desarrollador** (incluyendo *Ventas del día* y apertura de menú en *Comisiones*, ventana *Nuevo cliente*, pestaña *Vehículos* y *Reportes → Crédito*).
  - Resultado global: **`65` verificaciones ejecutadas · `0` fallos** (`0` errores de pantalla, `0` desbordamiento lateral de página, `0` botones cortados, `100%` cumplimiento de visibilidad de `+` y ubicación separada de Buzón/Crear, botones táctiles verificados en `36 px`).

---

## 3. Pendiente para pasar a producción

1. Revisar tú mismo las pantallas modificadas en **staging**.
2. Cuando des el visto bueno, trasladar exactamente estos cambios desde una **rama limpia creada desde `main`** (para no arrastrar borradores de inventario u otras ramas locales de `construacero-staging/`), teniendo en cuenta ajustar también las variantes propias que aún existen en `ReportesView.jsx` de `main` (*selector `formato-reporte-cxc` y subpestañas de Crédito* descritas en la Tarea 4 del plan [OP-2026-074](../plans/OP-2026-074_plan-fixeo-responsividad-movil.md)).
