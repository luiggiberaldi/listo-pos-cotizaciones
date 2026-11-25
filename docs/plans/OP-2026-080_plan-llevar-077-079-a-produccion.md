# OP-2026-080 — Plan para llevar a producción OP-2026-077 (móvil) y OP-2026-079 (solo cuadrícula)

**Fecha:** 2026-11-25 · **Versión:** 2 (corregida tras la auditoría [OP-2026-081](../operaciones/OP-2026-081_auditoria-plan-080.md)) · **Estado:** 📝 Plan propuesto, pendiente de tu aprobación. No se ha tocado producción ni se ha creado ninguna rama.

## En resumen

- Los dos arreglos (pantallas bien ajustadas en teléfono y vista única en cuadrícula) funcionan en staging: 521 pruebas aprobadas y compilación correcta.
- **No se puede subir staging tal cual.** Esa carpeta mezcla trabajo de otros casos sin aprobar, y producción ya tiene muchas mejoras que staging no tiene.
- El plan: en una **carpeta de trabajo aparte**, partir de la versión real de producción (la de GitHub), **añadir** solo estos dos arreglos sin quitar nada más, probar, que tú lo revises y entonces publicar. Es como pasar a limpio dos páginas sobre la versión más reciente del cuaderno, sin borrar lo que ya estaba escrito.
- **Qué tienes que hacer tú:** aprobar el plan (paso 0), decidir lo del botón `+` (paso 0), mirar la vista previa en tu teléfono (paso 8) y dar el visto bueno final (paso 10).
- Riesgo general: **bajo**. Son cambios solo de pantalla; no tocan base de datos, dinero ni inventario, y se pueden deshacer en minutos.

---

## Reglas de oro (versión 2)

1. **La referencia es `origin/main`** (lo que está en GitHub), descargado justo antes de empezar. Nunca la copia local de `main`, que estaba 37 cambios atrás.
2. **Partir del archivo de producción y solo añadir.** Nunca copiar un archivo entero de staging. Lo único que se quita es la vista lista (OP-079).
3. **No tocar la carpeta actual.** Tiene 266 cambios sin guardar; todo se hace en una carpeta de trabajo separada.
4. **La vista previa usa datos reales:** solo mirar y navegar; no guardar, editar, anular ni crear nada.

## Decisiones tomadas

| Fecha | Decisión | Por qué |
|---|---|---|
| 2026-11-25 | El botón flotante `+` (cotización rápida) se muestra **solo en Inicio** en el teléfono. Desaparece en todas las demás pantallas, incluidas Clientes, Despachos, Mis ventas e Inventario | Decidido por el dueño. Clientes ya tiene su propio botón "Cotizar" en cada tarjeta; en las demás pantallas el botón estorba más de lo que ayuda. Coste aceptado: en Inventario, para cotizar hay que volver a Inicio o ir a Cotizaciones |

## Qué NO entra

- Todo lo que no sea OP-077 u OP-079 y que exista solo en staging: migraciones SQL `300`–`313`, Worker y `api/`, inventario y seguridad (OP-075, 076, 078), y cualquier otro archivo de `construacero-staging/`.
- **Ojo, ya están en producción y deben quedarse tal cual** (no son "a excluir", son "a respetar"): tasas en el encabezado (`HeaderTasas`) y "Cerrar sesión" en `AppLayout.jsx`; calendario de sábados en `ComisionesView.jsx`; "Pagos de más sin deuda" y selector `formato-reporte-cxc` en `ReportesView.jsx`; pago por "Cruce" en `CotizacionesView.jsx`; ventana `DevolverAnularModal` en `DespachosView.jsx`; aviso de versión nueva.

## Pasos

| # | Paso | Quién | Cómo se comprueba |
|---|---|---|---|
| 0 | Aprobar el plan. **Botón `+` ya decidido (2026-11-25): solo en Inicio** (ver "Decisiones tomadas") | Tú | Respuesta en el chat |
| 1 | Descargar lo último de GitHub y anotar aquí el commit de `origin/main` (punto de vuelta atrás) | Claude | Commit anotado |
| 2 | Crear una carpeta de trabajo aparte (git worktree) con la rama `feat/op-080-movil-y-cuadricula` desde `origin/main`. La carpeta actual no se toca | Claude | `git worktree list` y `git log` muestran que parte de `origin/main` |
| 3 | **OP-079:** crear `src/utils/vistaCuadricula.js`; en `ClientesView`, `PersonalView`, `CotizacionesView` y `DespachosView` quitar solo el selector lista/cuadrícula, `vistaMode` y las filas, dejando todo lo demás de producción; borrar `ClienteRow`, `CotizacionRow`, `DespachoRow` tras confirmar que nadie más los usa; comprobar que `ListaPreciosModal` (PDF) y las tablas de `ReportesView` no cambian | Claude | Búsqueda sin rastros de `vistaMode`, `*Row`, "Vista lista"; cuadrícula conserva todas las acciones |
| 4 | **OP-077, archivos simples** (iguales en staging y producción salvo el ajuste): `PageHeader`, `BuzonFAB`, `QuickQuoteFAB` (visible **solo en `/`**, Inicio; difiere de staging, que también lo muestra en Mis ventas, Clientes, Despachos e Inventario: ajustar también su prueba de contrato), `MisVentasView`, `OrdenCompraView`, `VehiculosFranja`, `ProveedoresView` | Claude | Diferencia contra producción = solo clases de estilo |
| 5 | **OP-077, archivos que difieren mucho de staging, a mano y solo añadiendo:** `ReportesView` (solo `line-clamp-2`, `min-w-0`, alertas de crédito; respetar selector de formato y "Pagos de más"), `ComisionesView` (solo barra de tasas y menús; respetar calendario), `AppLayout` (solo espaciador final: alto mayor únicamente en Inicio, donde está el `+`; respetar `HeaderTasas` y "Cerrar sesión"), `ConfiguracionView`, `DespachosView`, `CotizacionesView`, `EditDespachoModal` (alturas `dvh`), `ReporteVendedoresView`, `TransportistasView`, `TutorialView`, `ClientesView`, `PersonalView` | Claude | Diferencia contra `origin/main` revisada línea a línea: **ninguna línea de producción eliminada** salvo la vista lista |
| 6 | Pruebas: adaptar `mobileResponsiveContract074.test.js` y `soloVistaCuadricula079.test.js` dentro de `src/utils/__tests__/` (la ruta que lee la configuración de pruebas de producción); correr `npm test`, `npm run lint` y `npm run build`. Anotar cifras reales | Claude | Todo en verde; cifras anotadas |
| 7 | Revisión local: abrir la compilación en el navegador con datos simulados, en 360, 375 y 1280 px, en las pantallas tocadas | Claude | Capturas y cero desbordes horizontales |
| 8 | Abrir la solicitud de cambio (pull request) hacia `main`. Vercel genera una vista previa: **usa datos reales, solo mirar**. Tú la abres en tu teléfono | Claude + Tú | Tu confirmación |
| 9 | Control final de la lista de archivos de la solicitud: solo los del plan; nada de `api/`, migraciones, `construacero-staging/` ni Worker | Claude | Lista revisada |
| 10 | **Tu visto bueno final** y publicar (unir a `main`). Esto actualiza Vercel (pantalla) y, automáticamente, reinstala el Worker en Cloudflare | Tú apruebas, Claude ejecuta | Solicitud unida; número y commit anotados |
| 11 | Verificar en producción: Clientes, Personal, Cotizaciones y Despachos en cuadrícula; Reportes con su selector de formato; un teléfono real; sin errores; que la instalación del Worker en GitHub Actions terminó bien. Recordar que quien tenga sesión abierta puede ver el cambio al cerrar sesión o recargar (aviso de versión nueva) | Claude + Tú | Revisión posterior |
| 12 | Cerrar documentación: `REGISTRO.md` (OP-077, OP-079, OP-080 con solicitud y commit), `README` si cambia cómo se usa, nota sobre los números de pruebas | Claude | Enlaces y registro verificados |

## Plan de vuelta atrás

1. **Lo más seguro:** revertir la solicitud unida desde GitHub. Eso vuelve a publicar la pantalla en Vercel y reinstala el Worker con la versión anterior.
2. **Más rápido, solo pantalla:** en Vercel, volver al despliegue anterior (un clic).
3. No hay cambios de base de datos: no hay nada que deshacer allí.
4. Las preferencias guardadas en los navegadores no se dañan: solo se cambia `"list"` por `"grid"`.

## Riesgos conocidos

| Riesgo | Efecto | Cómo se evita |
|---|---|---|
| Comparar contra una copia vieja de `main` | Borrar cosas ya publicadas | Regla 1 y paso 1 |
| Copiar un archivo completo de staging | Perder el selector de formato, "Pagos de más", calendario, etc. | Regla 2 y pasos 5 y 9 |
| Trabajar en la carpeta actual | Mezclar o perder 266 cambios sin guardar | Regla 3 y paso 2 |
| Tocar datos en la vista previa | Modificar información real de clientes | Regla 4 |
| Producción aún usa `ClienteRow`, etc. | Importaciones rotas | Paso 3 busca referencias; paso 6 compila |
| Vendedores echan en falta el `+` en Inventario | Un paso más para cotizar desde ahí | Decisión aceptada; si molesta, se agrega `/inventario` a la lista (cambio de una línea) |

## Ejecución (2026-11-25)

**En resumen:** los dos arreglos ya están aplicados en una rama limpia, en una carpeta aparte (`construacero-op080`, rama `feat/op-080-movil-y-cuadricula`), partiendo de producción `ed76e680`. Todo lo que ya estaba en producción se respetó. Pruebas y compilación correctas. **Aún no se ha guardado (commit) ni subido nada:** primero lo revisa el dueño en el navegador.

### Qué se hizo, paso a paso

| Paso | Resultado |
|---|---|
| 1. Punto de partida | `origin/main` = `ed76e680` (Merge PR #76, OP-072). |
| 2. Carpeta aparte | `C:\Users\luigg\Desktop\construacero-op080` con la rama `feat/op-080-movil-y-cuadricula`. La carpeta principal (con sus 266 cambios sin guardar) no se tocó. |
| 3. OP-079 | Quitado el selector lista/cuadrícula en Clientes, Personal, Cotizaciones y Despachos; borrados `ClienteRow.jsx`, `CotizacionRow.jsx`, `DespachoRow.jsx`; nuevo `src/utils/vistaCuadricula.js`. Las tarjetas de producción ya tenían todas las acciones (ver detalle y editar despacho están dentro de `DespachoCard.jsx`; ver cotización dentro de `CotizacionCard.jsx`). |
| 4. OP-077 simples | `PageHeader`, `BuzonFAB`, `MisVentasView`, `OrdenCompraView`, `VehiculosFranja`, `ProveedoresView`, `TransportistasView`, `ConfiguracionView`, `PersonalView`: solo clases de ajuste en pantalla. |
| 4b. Botón `+` | Solo en Inicio. Las reglas pasaron a `src/components/cotizaciones/quickQuoteFabRutas.js` (así lo pide la herramienta de revisión de código). En `AppLayout.jsx` solo cambió el espacio final: mayor en Inicio. |
| 5. Archivos delicados | `ComisionesView` (barra de tasas y menús; calendario de sábados intacto), `ReportesView` (subtítulos de cifras en 2 líneas y barra de la pestaña Comisiones; la pestaña Crédito de producción ya tenía su propio arreglo móvil y no se tocó), `ClientesView`, `CotizacionesView`, `DespachosView`, `EditDespachoModal` (altura `dvh`), `ReporteVendedoresView`, `TutorialView`. |
| Descartado a propósito | Pedazos de staging que **no** son de estos casos: pago "Cruce" en `CotizacionesView`/`EditDespachoModal`, quitar "stock comprometido" del Tutorial, `HeaderTasas`/"Cerrar sesión" (ya en producción), "Pagos de más sin deuda" (ya en producción). |
| 6. Pruebas | Nuevas: `src/utils/__tests__/mobileResponsiveContract077.test.js` (10) y `soloVistaCuadricula079.test.js` (4): **14/14**. Batería completa: **1254 pruebas aprobadas**; 1 archivo (`medirRendimientoServerTiming.test.js`) no arranca porque pide credenciales de base de datos que la carpeta aparte no tiene a propósito: no tiene relación con este cambio. |
| 6b. Lint | Mismos 14 errores que ya tenía producción en esos archivos; **0 nuevos** (los 2 que aparecieron con el botón `+` se corrigieron). |
| 6c. Compilación | `npm run build` correcto; PWA con 84 entradas. Solo la advertencia de tamaño de bloques que ya existía. |
| 7. Navegador | Pantalla de la rama en `http://localhost:4173` conectada a **staging** (datos de prueba) con el servidor local (`op080-api-staging` / `op080-web-staging` en `.claude/launch.json`); el dueño entró con su usuario de staging. Revisión automática y visual: **360 px** en 15 rutas y **1280 px** en 12 rutas → **0 desbordes laterales**, **0 botones de lista**, botón `+` solo en Inicio (y nunca en computadora), Buzón abajo a la izquierda en teléfono sin chocar con el `+` y abajo a la derecha en computadora. Clientes en 1 columna con botones envueltos; Comisiones con tasas lado a lado e Imprimir/Descargar completos; Reportes → Crédito conserva el selector `formato-reporte-cxc` (Resumen / Detallado PDF); Configuración en 2 columnas en teléfono y una fila en computadora. Única falla en consola: `/api/rates` (tasas de cambio) responde 500 porque en esta prueba local esa llamada va al puerto 8787, donde no hay servidor; es del montaje de prueba, no del cambio, y la pantalla usa la tasa guardada. |

## Pendiente / sin verificar

- Visto bueno del dueño tras su propia prueba en el navegador.
- Guardado (commit `95474733`), subido y abierta la **solicitud de cambio #77** (https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/77) tras el visto bueno del dueño a su prueba en navegador (2026-11-25).
- **Pendiente:** mirar la vista previa de Vercel en el teléfono (usa datos reales: solo mirar) y el visto bueno final para unir a `main`. Al unir se anotará el commit de la unión y la verificación en producción (paso 11).
- Relacionado: [OP-2026-077](../operaciones/OP-2026-077_fixeo-responsividad-movil-staging.md), [OP-2026-079](../operaciones/OP-2026-079_solo-vista-cuadricula-staging.md), [plan OP-2026-074](OP-2026-074_plan-fixeo-responsividad-movil.md), [auditoría OP-2026-081](../operaciones/OP-2026-081_auditoria-plan-080.md).
