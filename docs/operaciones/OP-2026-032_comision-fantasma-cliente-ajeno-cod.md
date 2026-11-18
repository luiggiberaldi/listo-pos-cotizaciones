# OP-2026-032 — Wendy Lozano aparece con comisión en una venta a un cliente de Niki (DES-04808)

**Fecha:** 2026-11-18 · **Estado:** **PUBLICADO en producción** el 18-nov-2026 — solicitud [#58](https://github.com/luiggiberaldi/listo-pos-cotizaciones/pull/58), commit `cd5f964a`, unión `f33a97dc`. Verificado antes con datos reales (Reporte Vendedores = Reportes → Comisiones = $24,70).

## En resumen

- **Nadie le pagó ni le guardó comisión a Wendy.** En la base de datos esa venta tiene **cero comisiones** registradas. Lo que se ve ($2,72) es un **cálculo "de relleno"** que hace la pantalla *Reporte de Vendedores* cuando no encuentra una comisión guardada.
- Ese relleno está mal hecho: le pone la comisión a **quien vendió** (Wendy), cuando la regla real del sistema se la da al **dueño del cliente** (Niki Ramírez). Además ignora que la venta tiene **cobro a destino pendiente** ($36), y la regla dice que mientras eso no se cobre, **no hay comisión para nadie**.
- Cuando se registre el cobro de los $36, el sistema generará la comisión real **a nombre de Niki**, y el $2,72 de Wendy desaparecerá del reporte.

## Qué se revisó (solo lectura, producción)

| Dato | Valor |
|---|---|
| Despacho | DES-04808, entregada 18-nov-2026 |
| Vendió | Wendy Lozano (rol vendedor, interna) |
| Cliente | Jesus Enrique Chirino — **asignado a Niki Ramírez** desde el 05-nov-2026 |
| Pago | Zelle $100 + **Cobro a destino $36, sin cobrar** |
| Comisiones guardadas | **ninguna** |

Comparación: DES-04805 (Josué, mismo día) también tenía cobro a destino, pero **ya cobrado** → sí tiene su comisión guardada. Confirma que la tranca "sin cobro a destino pagado no hay comisión" (opción `comision_cod_solo_pagado`) funciona en la base de datos.

## Por qué sale la comisión de Wendy

1. La regla oficial (función `calcularcomisiondespacho_238b` en la base) da la comisión al **dueño del cliente**, y no genera nada si queda cobro a destino pendiente o si el dueño es un usuario sin comisión (p. ej. "EMPRESA").
2. La pantalla *Reporte de Vendedores* (`src/hooks/useReporteVendedores.js`, función `calcularComisionDespachoJS`) y también *Reporte de Ventas* (`src/hooks/useReporteVentas.js`) tienen un "plan B": si un despacho entregado **no tiene comisión guardada**, la estiman por su cuenta. Esa estimación:
   - se la asigna al **vendedor de la venta**, no al dueño del cliente;
   - **no** revisa el cobro a destino pendiente;
   - **no** revisa si el dueño del cliente es "EMPRESA" (sin comisión).
3. Resultado: comisiones "fantasma" en los reportes. Hoy solo afecta a Wendy ($2,72), pero en otros días también pueden aparecer en ventas de vendedores a clientes de EMPRESA (ej. 4762, 4778, 4795, 4800 del 16 y 17-nov no tienen comisión guardada).

## Riesgo

- **Dinero real:** ninguno; las comisiones que se pagan salen de las guardadas en la base, no de este cálculo de relleno.
- **Confusión:** los reportes muestran comisiones que no existen y totales de comisión inflados.

## Auditoría completa de la base (18-nov-2026, solo lectura)

Se revisaron **todas** las ventas entregadas o despachadas (mayo a noviembre de 2026, 2.212 ventas).

**1. Comisiones guardadas: correctas.** De 1.707 comisiones, casi todas están a nombre del dueño del cliente, como dice la regla. Las filas de los sábados con división (0,5 % designado / 1,5 % dueño) también están bien. Hay **3 excepciones** pequeñas: DES-3060, 3856 y 3857 (sep-oct), vendidas por Edgar a clientes que ya eran de Niki. Se guardaron a nombre de Edgar ($2,13 en total). **Pendiente de explicar.**

**2. Ventas sin comisión guardada (todas con motivo, salvo 16):**

| Motivo | Ventas |
|---|---|
| Cliente de EMPRESA (no genera comisión) | 495 (132 vendidas por un vendedor) |
| Cliente de un jefe/administración | 8 |
| Donación | 5 |
| Cobro a destino pendiente | 1 (DES-04808) |
| **Sin motivo claro** | **16** (casi todas mayo-julio; las recientes son 2893 y 4270) |

**3. Comisiones "fantasma" en los reportes.** Son ventas sin comisión guardada a las que *Reporte de Vendedores* y *Reporte de Ventas* les estiman una comisión:

| Vendedor | Ventas afectadas | Comisión fantasma aprox. (2 %-3 %) | En noviembre |
|---|---|---|---|
| Niki Ramírez | 47 | $723 – $1.085 | 1 |
| Edgar Ramírez | 28 | $225 – $337 | 7 |
| Josué Marciales | 25 | $161 – $242 | 7 |
| Wendy Lozano | 1 | $2,72 | 1 |

Es un cálculo aproximado y la cifra real puede ser menor (por ventas a crédito, préstamos, etc.). **No es dinero pagado:** las pantallas *Comisiones* y *Liquidación*, con las que se paga, solo usan las comisiones guardadas.

## Decisión de negocio (tomada 18-nov-2026)

El dueño confirmó: **los clientes de EMPRESA no generan comisión**. La base de datos ya hace eso; lo que está mal son los reportes.

## Propuesta (pendiente de autorización)

Quitar el "plan B" en ambos reportes para despachos entregados/despachados (o hacerlo respetar las mismas reglas que la base: dueño del cliente, cobro a destino pendiente, dueño sin comisión). Probar primero en staging.

---

## Auditoría de punta a punta de DES-04808 (18-nov-2026, solo lectura)

### En resumen

- **La regla del sistema funcionó bien en todos los pasos.** Wendy fue avisada de que el cliente era de Niki y de que la comisión iría a Niki. Confirmó y vendió. El sistema no le guardó comisión a nadie porque falta cobrar los $36 a destino.
- **Hay 3 fallas alrededor de la regla:**
  1. **Los avisos al celular no funcionan en producción, y nunca han funcionado** desde que existe el registro (4-nov-2026). Al jefe no le llegó el aviso de "venta con cliente ajeno". Tampoco le llega ningún otro aviso.
  2. **Los reportes inventan la comisión** a nombre de Wendy (ver arriba).
  3. **La pantalla de venta rápida le muestra a Wendy "Comisión est. $2,72"** mientras arma la venta, aunque el mismo sistema le acaba de decir que esa comisión será de Niki.

### El recorrido, paso a paso

| Hora (Venezuela) | Paso | Qué pasó | ¿Correcto? |
|---|---|---|---|
| 17-nov 4:23 p. m. | Alta de Wendy | Usuario creado como **vendedor**, sin % propio (usa los % generales) | ✅ |
| 18-nov 2:22 p. m. | Elige al cliente | Jesus Enrique Chirino es de **Niki Ramírez** (desde el 05-nov). La venta rápida muestra la ventana "Este cliente pertenece a otro vendedor… La comisión se le asignará a él" y Wendy confirma | ✅ |
| 2:22 p. m. | Arma la venta | 4 láminas arquitectónicas azules, $136. La pantalla muestra **"Comisión est. $2,72"** a Wendy | ⚠️ confuso |
| 2:22 p. m. | Crea la venta rápida | Cotización #4808 + despacho #4808, quedan en Auditoría ("VENTA_RAPIDA") | ✅ |
| 2:22 p. m. | Avisos | Aviso al celular del jefe "Venta rápida con cliente ajeno": **falló** (faltan las llaves de notificaciones en el servidor de producción). El aviso dentro de la app solo le llega a quien la tenga abierta en ese instante, y no queda guardado | ❌ |
| 3:24 p. m. | Aprobación | ADMINISTRADOR la pasa a "despachada" y descuenta el inventario | ✅ |
| 3:31 p. m. | Entrega | LOGISTICA la marca "entregada". Pago: Zelle $100 + **cobro a destino $36 sin cobrar** | ✅ |
| 3:31 p. m. | Comisión | La regla de la base **no la genera**: la opción "comisión solo con cobro a destino pagado" está **activa** | ✅ |
| — | Reporte de Vendedores / Reporte de Ventas | Muestran **$2,72 para Wendy** (estimación de relleno) | ❌ |
| — | Mis Ventas de Wendy | No aparece la venta, porque el cliente no es suyo | ✅ |
| — | Mis Ventas de Niki | Aparece la venta con $0 de comisión hasta que se cobre | ✅ |
| — | Comisiones / Liquidación (lo que se paga) | Nada, porque no hay comisión guardada | ✅ |

### Qué pasará al cobrar los $36

Se comprobó con 5 ventas parecidas de noviembre (4534, 4631, 4685, 4732, 4805): la comisión **nace en el mismo segundo** en que se registra el cobro a destino. La regla de la base toma al **dueño del cliente en ese momento**. Para DES-04808 se espera:

- **A nombre de Niki Ramírez**, 2 % de $136 = **$2,72** (la categoría LÁMINAS usa el % general de "otros", que hoy es 2 %).
- La venta es de un miércoles, así que no aplica la división de sábado.
- **Ojo:** si antes de cobrar se reasigna el cliente a otro vendedor, la comisión irá al nuevo dueño.

### Riesgo

- **Dinero:** ninguno. Lo que se paga sale de las comisiones guardadas, y esas siguen la regla.
- **Confianza:** Wendy (y quien mire los reportes) puede creer que ganó $2,72; el jefe no se enteró de la venta con cliente ajeno.

### Correcciones propuestas (ninguna hecha todavía)

1. **Reportes de Vendedores y de Ventas:** que no inventen comisiones de ventas entregadas que no tienen comisión guardada. Así coinciden con lo que se paga. Probar en staging.
2. **Venta rápida y cotización:** si el cliente es ajeno, no mostrar "Comisión est." o mostrar "Comisión: de Niki Ramírez".
3. **Avisos al celular:** configurar las llaves de notificaciones (VAPID) en el servidor de producción. Es un caso aparte, porque afecta a todos los avisos y no solo a este.

---

## Comparación: Reportes → Comisiones vs Reporte de Vendedores (18-nov-2026, "Hoy")

El dueño mandó una captura de **Reportes → Comisiones**: total $24,70, 7 despachos. **Coincide al centavo con la base de datos:**

| Despacho | Vendió | Dueño del cliente | Comisión guardada a | Monto |
|---|---|---|---|---|
| 4802, 4806, 4811 | Eiker | Eiker | Eiker | $3,60 + $0,24 + $1,22 = **$5,06** |
| 4803 | Josué | **Niki** | **Niki** | **$5,19** |
| 4805, 4810 | Josué | Josué | Josué | $12,80 + $1,07 = **$13,87** |
| 4812 | Edgar | Edgar | Edgar | **$0,58** |
| 4804, 4807 | EMPRESA | EMPRESA | — (no genera) | $0 |
| 4808 | Wendy | Niki | — (cobro a destino pendiente) | $0 |

**Conclusión:** *Reportes → Comisiones* está **bien**: usa solo las comisiones guardadas, y Wendy no aparece. La que está mal es la pantalla **Reporte de Vendedores** (tabla "Ventas USD / # Desp. / Comisión"), que ese mismo día dice **$22,23**:

- **+ $2,72 de Wendy** que no existen (estimación de relleno).
- **− $5,19 de Niki** que sí existen pero no se ven: esa tabla **oculta a los supervisores** por diseño (`src/utils/reporteVendedoresAccess.js`), y Niki es supervisora. Su comisión por la venta de Josué (4803) se pierde del total.

$24,70 + $2,72 − $5,19 = **$22,23** ✔ (cuadra exacto).

---

## Corrección del Reporte de Vendedores (18-nov-2026, autorizada por el dueño)

### En resumen

- La tabla del **Reporte de Vendedores** ahora muestra **solo las comisiones que el sistema guardó**, las mismas que se pagan y que muestra *Reportes → Comisiones*. Ya no inventa comisiones.
- Los **supervisores que venden** (como Niki) aparecen cuando tienen ventas o comisión en el periodo. Antes se ocultaban, y su comisión desaparecía del total.
- Verificado con datos reales: **hoy $24,70** y **1 al 18 de noviembre $938,70**, idéntico a lo guardado en la base. Antes, en noviembre, el reporte **escondía 24 ventas y $249,19 de comisión de Niki**.

### Qué cambió

| Archivo | Cambio |
|---|---|
| `src/utils/reporteVendedoresComisiones.js` (nuevo) | Arma las comisiones del reporte solo con las filas guardadas, a nombre de quien la recibe (dueño del cliente) |
| `src/hooks/useReporteVendedores.js` | Se quitó la "estimación de relleno" (`calcularComisionDespachoJS`) y las consultas que solo servían para ella (configuración, categorías de productos, comisiones del periodo anterior). El reporte hace menos consultas |
| `src/utils/reporteVendedoresAccess.js` | Un supervisor aparece si tiene ventas o comisión en el periodo. Los supervisores sin actividad (p. ej. usuarios ADMINISTRADOR/LOGISTICA con rol supervisor) siguen ocultos |
| `src/utils/__tests__/reporteVendedoresComisiones.test.js` (nuevo) | 6 pruebas con el caso real del 18-nov: Wendy sin comisión, EMPRESA sin comisión, la de 4803 a nombre de Niki, total $24,70 en 7 despachos |
| `src/utils/__tests__/reporteVendedoresAccess.test.js` | Prueba nueva: supervisor con actividad sí aparece; sin actividad, no |

### Comprobaciones

- Pruebas automáticas: **1.102 de 1.102 OK** (112 archivos).
- La app compila (`npm run build`) sin errores.
- Verificación con datos reales de producción (solo lectura), pasados por el código nuevo:

| Periodo | Total de la tabla | Total guardado en la base |
|---|---|---|
| Hoy 18-nov | $24,70 (Josué 13,87 · Niki 5,19 · Eiker 5,06 · Edgar 0,58 · Wendy 0 · EMPRESA 0) | $24,70 ✅ |
| 1-18 nov | $938,70 | $938,70 ✅ |

### Pendiente / sin verificar

- **No se vio en pantalla**: entrar a la app requiere el PIN de un usuario real. Hay que mirarla en staging o tras publicar.
- **Sin guardar en el historial (commit) ni publicar.** La rama actual (`fix/op-025-busqueda-sin-limites`) tiene otros cambios sin guardar de otros casos; esta corrección debe ir en su propia rama.
- **Copia de staging** (`construacero-staging/`): su versión de `useReporteVendedores.js` es distinta y **no se tocó**.
- ~~Reporte de Ventas, venta rápida y cotización sin corregir~~ → **corregidos después**, ver la sección siguiente.

---

## Corrección completa y prueba en staging (18-nov-2026)

### En resumen

- Se corrigieron las **4 pantallas** que inventaban o sugerían comisiones: Reporte de Vendedores, Reporte de Ventas, venta rápida / cotización y detalle del despacho.
- Se probó **todo en staging**: el código nuevo, conectado a la base de pruebas, con un caso igual al de Wendy y tres casos vecinos. **Todo salió correcto.**
- **Producción no se tocó.** Falta guardar el cambio en el historial, crear la solicitud de cambio y publicarlo.

### Qué cambió en las pantallas

| Pantalla | Antes | Ahora |
|---|---|---|
| Reporte de Vendedores | Inventaba comisión a quien vendía y ocultaba a los supervisores que venden | Solo comisiones guardadas; los supervisores con ventas o comisión aparecen |
| Reporte de Ventas (pestaña Ventas) | Inventaba comisión a quien vendía | Solo comisiones guardadas, a nombre del dueño del cliente |
| Venta rápida y cotización | "Comisión est. $X" aunque el cliente fuera de otro | Cliente ajeno: "Comisión para *dueño* (dueño del cliente)". Cliente de EMPRESA: "Sin comisión (cliente de EMPRESA)". Cliente propio: igual que antes |
| Detalle del despacho (artículos) | Etiqueta "$ 3%" por artículo para quien vendió, aunque el cliente no fuera suyo | El vendedor solo la ve si el cliente es suyo. Nadie la ve si es cliente de EMPRESA |

Archivos: `src/hooks/useReporteVentas.js`, `src/views/VentaRapidaView.jsx`, `src/components/cotizaciones/CotizacionBuilder.jsx` y `src/components/ui/DetalleModal.jsx`; nuevo `src/utils/destinoComision.js` (misma regla que la base: la comisión es del dueño del cliente) con 7 pruebas en `src/utils/__tests__/destinoComision.test.js`. Más lo de la sección anterior (Reporte de Vendedores).

### Cómo se probó en staging

- **Montaje:** código principal (la versión que va a producción) corriendo en esta computadora y **conectado a la base de staging** (configuraciones `rama-api-con-staging` y `rama-web-con-staging`). La copia `construacero-staging/` tiene una versión más vieja de estas pantallas; probar ahí no habría probado el código que se va a publicar.
- **Escenario:** guion `scripts/op032-escenario-staging.mjs` (solo staging; se niega a correr si la configuración no apunta a staging). Creó usuarios de prueba "OP032 …" (vendedora, dueña supervisora, EMPRESA, jefe), 3 clientes y 4 ventas hechas por la vendedora. Se activó en la cuenta de pruebas la opción "comisión solo con cobro a destino pagado", igual que en producción, y se restauró al final.

| # | Venta (vende OP032 Vendedora) | Comisión guardada en la base | ¿Correcto? |
|---|---|---|---|
| 3729 | Cliente de la Dueña + cobro a destino pendiente (igual a DES-04808) | Ninguna | ✅ |
| 3729 | … después de registrar el cobro a destino | **Dueña $0,59** | ✅ va a la dueña, no a la vendedora |
| 3730 | Cliente de la Dueña, pagado | Dueña $0,81 | ✅ |
| 3731 | Cliente de EMPRESA | Ninguna | ✅ |
| 3732 | Cliente propio | Vendedora $0,29 | ✅ |

**En pantalla** (antes de cobrar el COD; total real guardado = $1,10):

| Pantalla | Resultado |
|---|---|
| Reportes → Comisiones | $1,10 (Dueña 0,81 · Vendedora 0,29) — referencia |
| Reportes → Ventas | Comisiones $1,10; tabla: Vendedora $0,29, Dueña $0,81 ✅ |
| Reporte Vendedores | Vendedora $0,29; **Dueña $0,81 visible**; total $1,10 ✅ |
| Inicio del jefe y de la vendedora | Vendedora $0,29 ✅ |
| Detalle #3729 (cliente ajeno), visto por la vendedora | Sin etiqueta de comisión ✅ |
| Detalle #3732 (cliente propio) | Etiqueta "$ 3%" ✅ |
| Venta rápida con cliente de la Dueña | Aviso "pertenece a otro vendedor" + "Comisión para OP032 Duena (dueño del cliente)" ✅ |
| Venta rápida con cliente de EMPRESA | "Sin comisión (cliente de OP032 EMPRESA)" ✅ |
| Venta rápida con cliente propio | "Comisión est. (3%)" ✅ |
| Cotización con cliente de la Dueña | "Comisión para OP032 Duena (dueño del cliente)" ✅ |

Con el código viejo, la vendedora habría visto unos $1,29 (sus $0,29 más unos $1,00 inventados por la venta con cobro a destino y la de EMPRESA), y la Dueña no habría aparecido en el Reporte de Vendedores.

- **Pruebas automáticas:** 1.109 de 1.109 OK (113 archivos). La app compila sin errores.

### Lo que quedó en staging

- Usuarios "OP032 …" **desactivados** (no aparecen en "¿Quién está operando?").
- Las 5 ventas de prueba (#3728 anulada, #3729–#3732) **quedan** en la cuenta de pruebas, marcadas "OP032".
- La opción "comisión solo con cobro a destino pagado" de la cuenta de pruebas volvió a **apagada**, su valor original.
- La contraseña de la cuenta de pruebas se reinstaló con `npm run provision:e2e:staging` (procedimiento documentado), porque no coincidía con su archivo.
- **Aviso, no relacionado con este caso:** siguen ocultos los usuarios de prueba E2E que se desactivaron en OP-2026-031 ("Vendedor E2E Staging", etc.). La prueba nocturna de staging puede fallar hasta que se restauren (`node scripts/op031-usuarios-demo.mjs --restaurar` en `construacero-staging/`).

### Pendiente

- Guardar en una rama propia (la actual tiene cambios de otros casos), solicitud de cambio, publicar y revisar en producción.
- No se corrió la batería E2E completa de staging (123 pasos), porque este cambio solo toca pantallas y no la base de datos ni el servidor.

---

## Ensayo con datos reales de producción antes de publicar (18-nov-2026)

### En resumen

- Se pasó el **código nuevo por las 2.212 ventas reales de producción** (desde mayo), solo leyendo, y se comparó contra lo guardado en la base, que es lo que se paga.
- **Totales de comisión:** el reporte nuevo coincide al centavo con la base en **todos** los periodos probados (hoy, semana, sábado, cada mes de mayo a noviembre y el total histórico de $23.488,18).
- **Avisos de comisión** (venta rápida, cotización y detalle): coinciden con la regla de la base en **2.185 ventas**. Las únicas **5 diferencias** son datos viejos ya conocidos, no fallas del código nuevo.
- **Conclusión:** es seguro publicar. El cambio solo toca pantallas, no la base de datos ni el servidor, y se puede deshacer en minutos volviendo a la versión anterior.

### Detalle

Guion: `scripts/ensayo-op032-produccion.mjs` (usa una copia de solo lectura de ventas, comisiones y usuarios).

**A) Totales (Reporte de Vendedores nuevo vs base)**

| Periodo | Base | Reporte (jefe) | Reporte (supervisor) |
|---|---|---|---|
| Hoy 18-nov | $24,70 | $24,70 ✅ | $24,70 |
| Semana 16-18 nov | $159,69 | $159,69 ✅ | $159,69 |
| Sábado 14-nov | $24,69 | $24,69 ✅ | $24,69 |
| Mayo | $3.216,28 | $3.216,28 ✅ | $3.185,56 (*) |
| Junio a noviembre | igual al centavo en cada mes | ✅ | ✅ |
| Todo | $23.488,18 | $23.488,18 ✅ | $23.457,46 (*) |

(*) Diferencia de $30,72 solo en mayo: son 2 comisiones antiguas guardadas **a nombre de EMPRESA** (#494 $17,55 y #760 $13,17, de mayo, anteriores a la regla actual). Por diseño previo, el supervisor no ve las filas de EMPRESA. No lo causa este cambio.

**B) Aviso de comisión vs regla de la base (2.212 ventas)**

- 2.185 coinciden.
- 22 sin comisión guardada por otros motivos (cobro a destino pendiente como DES-04808, donaciones, ventas antiguas).
- 5 no coinciden, todas de datos viejos:
  - #494 y #760 (mayo): comisión guardada a nombre de EMPRESA. La regla actual dice "sin comisión" y la pantalla nueva dice lo mismo que la regla.
  - #3060, #3856 y #3857 (sep-oct): las 3 excepciones ya anotadas arriba (Edgar cobró en clientes de Niki, $2,13). La pantalla nueva dice "para Niki", que es la regla.

### Recomendación para publicar

1. Guardar el cambio en su propia rama, **sin** los cambios de otros casos que hay en la carpeta.
2. Al crear la solicitud de cambio, Vercel arma una **vista previa** con datos reales. Antes de aprobar, el jefe entra con su PIN y mira *Reporte Vendedores → Hoy*: debe dar el mismo total que *Reportes → Comisiones*.
3. Publicar. Si algo se ve raro, se vuelve a la versión anterior desde Vercel en minutos; no hay datos que reparar.


---

## Publicación (18-nov-2026)

- **Prueba final hecha por el dueño**, antes de publicar, con datos reales en una copia local de la versión nueva: *Reporte Vendedores → Hoy* = **$24,70** = *Reportes → Comisiones → Hoy*. Wendy Lozano en $0,00; Niki Ramírez visible con $5,19.
- La vista previa de Vercel no sirvió para esa prueba: el servidor real solo acepta la dirección oficial y `localhost` (protección de seguridad), así que se usó una copia local (`localhost:5173`).
- **Publicado** por autorización del dueño: solicitud #58 unida (`f33a97dc`); Vercel publicó la versión; comprobado que la app y `/api/ping` responden 200.
- **Cómo deshacerlo si hiciera falta:** en Vercel, volver a la publicación anterior. Solo cambian pantallas, así que no hay datos que reparar.
- **Pendiente para el negocio:** cuando se cobren los $36 de DES-04808, la comisión ($2,72) nacerá a nombre de Niki Ramírez.
