# OP-2026-081 — Auditoría del plan OP-2026-080 (llevar OP-077 + OP-079 a producción)

**Fecha:** 2026-11-25 · **Tipo:** revisión de solo lectura del plan · **Resultado:** plan **corregido** (versión 2 en [OP-2026-080](../plans/OP-2026-080_plan-llevar-077-079-a-produccion.md)). No se tocó código, ramas ni producción.

## En resumen

- El plan tenía bien la idea general: rama limpia, copiar solo los dos arreglos, probar y que tú lo veas antes de publicar.
- Pero lo armé comparando contra una copia vieja de `main` en esta computadora, que estaba **37 cambios atrás** de la versión real en GitHub. Por eso la lista "NO entra" estaba mal: incluía cosas que **ya están en producción** (tasas en el encabezado, "Cerrar sesión", calendario de sábados, "Pagos de más sin deuda", pago por "Cruce", nueva ventana de anulación). Si se hubiera seguido al pie de la letra, se podía **quitar de producción** algo que ya funciona.
- Además faltaban detalles de seguridad: cómo crear la rama sin tocar los 266 cambios sin guardar de esta carpeta, que la vista previa usa **datos reales**, y que publicar también reinstala el servidor (Worker).
- Ninguno de estos fallos llegó a ejecutarse. El plan quedó corregido.

## Hallazgos

| Severidad | Qué estaba mal en el plan | Evidencia | Qué significa / corrección |
|---|---|---|---|
| **Alto** | Comparé contra `main` local desactualizado | `main` local = `966b26a4`; GitHub (`origin/main`) = `ed76e680`, **37 cambios más nuevo** | Toda comparación debe hacerse contra `origin/main` recién descargado. |
| **Alto** | Lista "NO entra" incluía cosas ya publicadas | En `origin/main` ya existen: `HeaderTasas` y "Cerrar sesión" (`src/components/layout/AppLayout.jsx`), calendario OP-036 (`src/views/ComisionesView.jsx`), `clientesPagadoDeMas` y `formato-reporte-cxc` (`src/views/ReportesView.jsx`), "Cruce" (`src/views/CotizacionesView.jsx`), `DevolverAnularModal` (`src/views/DespachosView.jsx`) | "Excluirlas" podía borrarlas de producción. Regla nueva: **partir siempre del archivo de producción y solo añadir** los ajustes de OP-077/079; nunca quitar nada que no sea la vista lista. |
| **Alto** | No decía cómo crear la rama con la carpeta "sucia" | La carpeta actual tiene 266 cambios sin guardar en la rama `fix/op-025-busqueda-sin-limites` | Cambiar de rama aquí podía mezclar o perder trabajo. Corrección: crear una **carpeta de trabajo aparte** (git worktree) desde `origin/main`, como ya se hizo en otros casos (`construacero-work`, etc.). |
| **Medio** | La vista previa se presentaba como "de prueba" | `vercel.json` envía `/api/*` al Worker de producción | Una vista previa de Vercel muestra **datos reales de clientes**. Solo se mira y navega; no se guarda, anula ni edita nada. |
| **Medio** | Vuelta atrás incompleta | `.github/workflows/deploy-worker.yml`: cada unión a `main` también recompila y reinstala el Worker en Cloudflare | La vuelta atrás debe cubrir Vercel (pantalla) **y** Cloudflare (Worker). Lo más seguro: revertir la solicitud en GitHub, que reinstala ambos. |
| **Medio** | Lista de "archivos delicados" corta | Comparando staging actual contra producción también difieren mucho `ConfiguracionView` (+203/−155), `DespachosView` (+68/−136), `CotizacionesView` (+67/−90), `EditDespachoModal` (+29/−8), `ReporteVendedoresView` (+16/−22), `ReportesView` (+416/−730) | Todos estos se portan a mano, no copiando el archivo de staging. |
| **Medio** | Cambio de comportamiento no confirmado | `QuickQuoteFAB` en producción se oculta solo en Cotizaciones, Venta rápida, Login y Reportes; con OP-077 **también desaparece** en Personal, Proveedores, Usuarios, Comisiones, Auditoría, etc. | Es una decisión de negocio: el dueño debe confirmarla antes de publicar. |
| **Bajo** | Faltaba avisar del aviso de versión nueva | `src/components/ui/AvisoVersionNueva.jsx` en producción aplaza la recarga si hay un operador con sesión | Algunos usuarios verán el cambio solo al cerrar sesión o recargar. No es fallo; hay que saberlo al verificar. |
| **Bajo** | Pruebas: la configuración de producción lista rutas a mano | `vitest.config.js` en `origin/main` solo incluye `src/utils/__tests__/**` y otras rutas fijas | Las dos pruebas nuevas deben ir en `src/utils/__tests__/` para que se ejecuten. |
| **Bajo** | Errata | Paso 9: "Tú aprueban" | Corregido. |
| **OK** | Lo que sí estaba bien | `BuzonFAB`, `QuickQuoteFAB`, `PageHeader`, `MisVentasView`, `OrdenCompraView`, `VehiculosFranja`, `ProveedoresView`, `ClientesView`, `PersonalView`, `ListaPreciosModal` no cambiaron entre `main` local y `origin/main`; la vista lista (`vistaMode`) sigue en producción; las claves `clientes_vista-<cuenta>` coinciden; el tamaño `xs` existe en `tailwind.config.js` | Se mantiene esa parte del plan. |

## Estado

- Plan OP-2026-080 actualizado a **versión 2** con todas las correcciones.
- Sigue sin ejecutarse nada; pendiente de tu aprobación.
