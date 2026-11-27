# OP-2026-084 — Plan de pruebas completo para inventario, préstamos, devoluciones, cobros y seguridad

- **Fecha:** 2026-11-25
- **Estado:** Aprobado por el dueño el 2026-11-25. En ejecución.
- **Para qué sirve:** comprobar con hechos que los arreglos del plan [OP-2026-078](OP-2026-078_plan-correccion-hallazgos-auditoria-inventario-staging.md) funcionan, que no rompen nada de lo que ya funciona y que se pueden deshacer si algo sale mal, **antes** de tocar producción.
- **Antecedentes:** [OP-2026-075](../operaciones/OP-2026-075_correcciones-y-reauditoria-inventario-staging.md) (arreglos de inventario), [OP-2026-076](../operaciones/OP-2026-076_auditoria-independiente-inventario-staging.md) (auditoría que encontró lo que las pruebas anteriores no vieron).

---

## En resumen

- **Por qué hace falta un plan nuevo:** las pruebas anteriores pasaron 508 de 508, pero no detectaron 2 problemas críticos ni 4 altos. Muchas solo revisaban que ciertas palabras estuvieran escritas en el código, o simulaban la base de datos. Este plan prueba **contra la base de datos de pruebas real**, intentando **romper** el sistema a propósito.
- **Qué cubre:** 10 bloques, unas 120 pruebas concretas. Abarca inventario, préstamos, devoluciones, cobros, permisos por rol, separación entre empresas, doble clic y mala conexión, respaldo y restauración, todo lo que ya funcionaba (para confirmar que sigue igual), pantallas en el navegador y la vuelta atrás.
- **Dónde se prueba:** todo en **staging** (la copia de pruebas). En producción solo se hace una **revisión mirando, sin cambiar nada**, y al final, con tu aprobación, el paso real con vigilancia.
- **Regla de salida:** no se pasa a producción si falla **una sola** prueba crítica o alta, o si queda alguna sin correr.

> **Glosario rápido.** *Staging:* copia de pruebas del sistema, separada de los clientes reales. *Prueba automática:* un programa que repite una acción y comprueba el resultado sin intervención humana. *Prueba de punta a punta:* simula a una persona usando el sistema completo (pantalla → servidor → base de datos). *Kardex:* el historial de entradas y salidas de cada producto. *Vuelta atrás (rollback):* los pasos para deshacer un cambio.

---

## 1. Cómo se va a probar (los niveles)

| Nivel | Qué es, en simple | Dónde | Quién |
|---|---|---|---|
| A. Pruebas automáticas del código | Revisan piezas sueltas: cálculos, reglas, mensajes de error | En la PC | Claude |
| B. Pruebas contra la base de datos real de pruebas | Ejecutan las funciones de la base con datos de prueba e intentan romperlas (doble cobro, permisos, cifras) | Staging | Claude |
| C. Pruebas del servidor (Worker) | Llaman al servidor como lo haría la pantalla, con cada rol (vendedor, supervisor, logística, administración, jefe) | Staging | Claude |
| D. Probador completo de punta a punta | El probador que ya existe (123 pasos) más los pasos nuevos de este plan, 2 corridas seguidas | Staging | Claude |
| E. Revisión en navegador | Pantalla por pantalla, con usuarios de prueba | Staging | Claude, y luego tú confirmas |
| F. Cuadre de datos | Stock contra Kardex, préstamos contra despachos, deudas contra pagos | Staging (y producción solo mirando) | Claude |
| G. Ensayo de vuelta atrás | Deshacer los cambios en una copia y comprobar que todo vuelve a funcionar | Base de pruebas desechable | Claude |

**Cambio clave frente a las pruebas anteriores:** cada prueba del nivel B y C deja **datos reales** en staging y se comprueba el resultado **leyendo la base**, no confiando en el mensaje de la pantalla. Al final, todos los datos de prueba se borran y se verifica que no quede basura.

---

## 2. Antes de empezar (preparación)

1. **Respaldo completo de staging** (con la herramienta oficial de la base de datos, no con el botón de respaldo de la app, que hoy está recortado) guardado en `construacero-backups/`.
2. **Foto del estado inicial** para comparar al final: cantidad de productos, movimientos, préstamos, deudas, saldos de clientes y los 14 descuadres históricos ya conocidos.
3. **Dos empresas de prueba** en staging (A y B), cada una con un usuario por rol, 10 productos, 3 clientes y 2 transportistas. Así se prueba que una no ve lo de la otra.
4. **Congelar staging durante las corridas:** ninguna otra sesión ni persona cambia staging mientras se prueba, para que los resultados no se mezclen.
5. **Confirmar qué versión del servidor está publicada en staging** y publicar la versión que se va a probar.

---

## 3. Catálogo de pruebas

Cada prueba tiene un código, qué se hace y qué debe pasar. **Gravedad:** C = crítica, A = alta, M = media.

### Bloque 1 — Productos, edición y conteo físico (N25)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| P1 | Crear un producto con stock inicial 10 | Stock 10 y un movimiento de entrada de 10 en el Kardex | A |
| P2 | Editar el precio, el nombre y la foto de un producto | Cambian esos datos; **el stock no se mueve** y no aparece ningún movimiento | C |
| P3 | Abrir la ficha, vender 3 unidades desde otra ventana y luego guardar la ficha | El stock queda con la venta descontada (no vuelve al número viejo) | C |
| P4 | Intentar mandar otro stock al editar (llamando al servidor directamente) | Rechazado con "usar conteo físico" | A |
| P5 | Conteo físico: contar 8 donde el sistema dice 10 | Stock 8; Kardex con salida de 2 y motivo "Conteo físico" | A |
| P6 | Conteo físico con venta en medio (se cuenta con 10, alguien vende 1 y se guarda) | Rechazado con aviso de "el stock cambió"; nada se modifica | C |
| P7 | Conteo de varios productos a la vez, con uno en conflicto | No se aplica **ninguno** (todo o nada) | A |
| P8 | Conteo con el mismo producto repetido en la lista | Rechazado | M |
| P9 | Conteo hecho por supervisor y por vendedor | Rechazado (solo administración, jefe y desarrollador) | A |
| P10 | Cantidades con 4 decimales (por ejemplo 1,2345) | Se guardan exactas en producto, Kardex, cotización y despacho | M |

### Bloque 2 — Ingreso de mercancía, lote e importación (N32, N34, M2, M3)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| L1 | Lote con un producto existente (+5) y uno nuevo | Stock +5; el nuevo se crea con su entrada; un solo grupo en el Kardex | A |
| L2 | El mismo producto repetido 3 veces en el lote (2 + 3 + 4) | Se suma +9 en un solo movimiento | M |
| L3 | Lote que intenta cambiar el precio de un producto existente | El precio **no cambia** (regla 278) | A |
| L4 | Intentar usar "sobrescribir" (ya no existe en la pantalla; se prueba también llamando al servidor directamente) | Rechazado | A |
| L5 | Cargar la misma cantidad del mismo producto dos veces en menos de 24 h | Aviso amarillo **antes** de confirmar; si se confirma, se aplica | M |
| L6 | Doble clic en "Confirmar" del lote | Una sola entrada en el Kardex | C |
| L7 | Cortar la conexión justo después de enviar y reintentar | Una sola entrada; el reintento responde "ya aplicado" | C |
| L8 | Lote con un producto archivado | Rechazado, sin aplicar nada | M |
| L9 | Importar un CSV de 50 filas con una fila mala en la mitad | No se crea **ninguna** (todo o nada) y se indica la fila con error | A |
| L10 | Reintentar el mismo CSV tras un corte | No se duplican productos | A |
| L11 | Movimiento manual de entrada y de salida | Stock y Kardex correctos; una salida que deja stock negativo se rechaza si la empresa no lo permite | A |
| L12 | Transformación/corte (de 1 tubo de 6 m salen 2 de 3 m) | Sale el origen, entra el destino, con el mismo grupo en el Kardex | A |

### Bloque 3 — Ciclo de venta: cotización, despacho y entrega (Release 17)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| V1 | Cotización en borrador, enviada y aceptada | **No** mueve stock | A |
| V2 | Despacho pendiente | **No** mueve stock | A |
| V3 | Aprobar el despacho (pasa a "despachada") | Descuenta el stock una sola vez | C |
| V4 | Confirmar la entrega | **No** vuelve a descontar | C |
| V5 | Venta rápida que sale directa | Descuenta una sola vez | A |
| V6 | Donación y pago contra entrega | Descuentan igual que una venta, sin duplicar al entregar | A |
| V7 | Aprobar con stock insuficiente | Avisa pero no bloquea (regla vigente "solo advertencia") | M |
| V8 | Dos personas aprueban el mismo despacho a la vez | Uno aprueba y el otro recibe "estado inválido"; un solo descuento | C |
| V9 | Despacho con artículos externos (sin producto de inventario) | No mueven stock | M |

### Bloque 4 — Préstamos (N27, N35, A2 y tu Decisión 1)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| PR1 | Despacho con un artículo prestado; aprobar | Descuenta el préstamo del almacén y crea el préstamo en la ficha del cliente | C |
| PR2 | Devolver 2 de 5 desde la ficha del cliente | Stock +2; préstamo "devuelto parcial" | A |
| PR3 | Facturar 1 de lo pendiente | Deuda nueva al **precio en dólares del despacho original** (con su descuento) y la **tasa del día** anotada; **el stock no se mueve** | C |
| PR4 | Doble clic en "Facturar" | **Un solo** cargo | C |
| PR5 | Corte de conexión al facturar y reintento | **Un solo** cargo | C |
| PR6 | Facturar y devolver a la vez, desde dos ventanas, por más de lo pendiente | Una de las dos se rechaza; las cifras cuadran | C |
| PR7 | Estado tras devolución parcial y facturación parcial | "devuelto parcial", no "pendiente" | M |
| PR8 | Intentar devolver un préstamo por "Devolución parcial" (pantalla y servidor directo) | Bloqueado | C |
| PR9 | Reabrir o anular un despacho con un préstamo ya devuelto o facturado (con cada rol, incluido jefe) | Bloqueado para todos | C |
| PR10 | Reabrir un despacho con un préstamo intacto | Se reintegra el stock y se borra el préstamo | A |
| PR11 | Devolver un préstamo de un producto que se archivó después | Se acepta y reintegra el stock | M |
| PR12 | Facturar con precio original 0 | Rechazado con mensaje claro | M |

### Bloque 5 — Devoluciones parciales, cambios de producto y reaperturas (N28, N31, M4)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| D1 | Devolver 2 de 10 de un despacho entregado | Stock +2; saldo a favor o reembolso correcto según el pago | A |
| D2 | Devolver más de lo que queda | Rechazado | A |
| D3 | Cambio de producto con dos filas de reemplazo del mismo artículo | Se suman; stock y deuda correctos | A |
| D4 | Devolver después parte de ese reemplazo | Validado contra la suma de ambas filas | A |
| D5 | Reabrir un despacho con devoluciones y cambios | Reingresa exactamente lo que el cliente tenía (ni doble ni de menos) | C |
| D6 | Reabrir, volver a aprobar y volver a reabrir (3 vueltas) | El stock termina igual que al inicio | C |
| D7 | Devolución con descuento aplicado al despacho | El reembolso usa el precio con descuento | A |
| D8 | Devolución de mercancía donada | Vuelve al almacén sin crédito, salvo autorización con motivo | A |
| D9 | Llamar a la función de la base con un total inventado o sin producto | Rechazado (la base recalcula) | A |
| D10 | Doble clic en "Confirmar devolución" | Una sola devolución | C |

### Bloque 6 — Kardex y reversiones (N26, M1)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| K1 | Revertir un ajuste manual | Se revierte una sola vez | A |
| K2 | Revertir el mismo ajuste dos veces (incluso a la vez, desde dos ventanas) | El segundo intento se rechaza | C |
| K3 | Intentar revertir una venta, una devolución, un préstamo, un corte o un lote | Rechazado; el botón no aparece | A |
| K4 | Intentar revertir uno de los movimientos viejos sin origen (hay 619) | Rechazado | A |
| K5 | Revertir una reversión | Rechazado | M |

### Bloque 7 — Seguridad, permisos y separación entre empresas (C1, A4, M5, N30)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| S1 | Lista automática de todas las funciones de la base que modifican datos y quién puede usarlas | Ninguna abierta a usuarios sin sesión ni a sesiones comunes (salvo una lista corta y justificada) | C |
| S2 | Sin sesión, intentar crear un cargo de deuda, pagar una comisión o liquidar un transportista | Rechazado | C |
| S3 | Con sesión de vendedor, intentar lo mismo directo contra la base | Rechazado | C |
| S4 | Con sesión, intentar escribir directo en productos, Kardex, despachos, préstamos o devoluciones | Rechazado | C |
| S5 | Con la empresa B, leer productos, despachos, artículos, Kardex, préstamos, clientes y deudas de la empresa A | **0 filas** en todas | C |
| S6 | Administrador de B intenta lo mismo | **0 filas** | C |
| S7 | Matriz de roles: cada acción del sistema con cada rol (vendedor, vendedor sin comisión, supervisor, logística, administración, jefe) | Cada rol hace solo lo que le toca (tabla en el informe) | A |
| S8 | Vendedor edita su despacho pendiente (OP-070) | Permitido | A |
| S9 | Vendedor edita el despacho de otro, o uno aprobado | Rechazado | A |
| S10 | Borrador de pruebas (`tester_cleanup_cotizacion`) usado contra otra empresa | Rechazado | A |
| S11 | Catálogo público sin sesión | Solo muestra productos activos con stock, sin costos | M |

### Bloque 8 — Respaldo y restauración (C2, A1, B3)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| R1 | Descargar el respaldo de staging | Trae **todas** las filas (por ejemplo, los 6002 movimientos) y el conteo de cada tabla cuadra con la base | C |
| R2 | Respaldo de una tabla con más de 1000 filas en una tabla hija | Completa | A |
| R3 | Restaurar en una base de pruebas vacía | Mismos conteos, saldos de clientes, stock contra Kardex y préstamos con lo devuelto/facturado | C |
| R4 | Restaurar con un error forzado a la mitad | No queda **nada** a medias | C |
| R5 | Respaldo que trae filas de otra empresa | Rechazado | A |
| R6 | Números de cotización tras restaurar | Iguales a los originales | M |
| R7 | Siguiente cotización o despacho tras restaurar | Número correlativo sin choques | A |

### Bloque 9 — Todo lo que ya funcionaba (no debe romperse)

| Código | Qué se hace | Qué debe pasar | Grav. |
|---|---|---|---|
| RG1 | Probador completo de punta a punta (123 pasos actuales), 2 corridas seguidas | 123/123 las dos veces | C |
| RG2 | Cuentas por cobrar: cargo, abono, saldo a favor, reparto entre dos deudas, nada se borra sin rastro | Igual que hoy | C |
| RG3 | Cotizaciones que no se pierden (OP-069): guardar con mala conexión | La cotización llega una sola vez | C |
| RG4 | Comisiones al aprobar, editar pago y devolver | Igual que hoy | A |
| RG5 | Pago a transportistas y flota local | Igual que hoy | A |
| RG6 | Edición profunda de despacho aprobado por administración (OP-053) | Ajusta stock y deuda por la diferencia | A |
| RG7 | Pantallas en celular y solo cuadrícula (OP-077/079) | Siguen bien | M |
| RG8 | Inicio de sesión con PIN, sesión de 12 h y tasa en el login (OP-072) | Igual que hoy | A |
| RG9 | Proveedores y Órdenes de Compra | **No** mueven stock (tu decisión N32) | A |
| RG10 | Todas las pruebas automáticas del proyecto y la compilación del sitio | Sin errores | A |

### Bloque 10 — Pantallas en el navegador (revisión visual)

Con usuarios de prueba, en computadora (1280 px) y en celular (375 px):

1. Ficha de producto: stock en solo lectura y botón "Ajustar por conteo físico".
2. Movimiento por lote: pestañas Entrada, Salida y Conteo físico; aviso de "el stock cambió".
3. Ingreso por lote: sin "sobrescribir"; aviso amarillo de carga repetida.
4. Importar CSV: resultado claro y sin duplicados.
5. Kardex: botón Revertir solo donde corresponde.
6. Devolución parcial: el artículo prestado aparece marcado y bloqueado.
7. Ficha del cliente → préstamos: devolver y facturar, con monto, tasa del día y estado correctos.
8. Reabrir/anular un despacho con préstamo movido: mensaje claro.
9. Respaldo y restauración: aviso de "reemplaza los datos actuales".
10. Mensajes de error comprensibles, sin textos técnicos.

---

## 4. Cuadre de datos (antes y después)

Se ejecutan al inicio, después de cada bloque y al final:

- **Stock contra Kardex:** cada producto debe coincidir con su último movimiento (salvo los 14 descuadres históricos ya conocidos, que no deben crecer).
- **Préstamos:** lo devuelto más lo facturado nunca supera lo prestado; cada préstamo apunta a un artículo prestado real.
- **Deudas:** el saldo de cada cliente es igual a la suma de sus cargos menos sus abonos.
- **Sin basura:** al terminar, 0 productos, clientes, despachos o préstamos de prueba.
- **Vigilante nocturno** (`auditor-saldos`, `audit:kardex:staging`): sin alertas nuevas.

## 5. Ensayo de vuelta atrás

En una base de pruebas desechable (copia de staging):
1. Aplicar todos los cambios nuevos.
2. Ejecutar las vueltas atrás en orden (de la más nueva a la más vieja).
3. Comprobar que el sistema viejo vuelve a funcionar con el probador completo.
4. Anotar qué **no** se puede deshacer (por ejemplo, los 4 decimales) y qué datos quedarían descuadrados si se deshace con despachos en curso.

## 6. Revisión en producción (solo mirando, sin cambiar nada)

Antes del paso a producción, y con tu permiso:
- ¿Hay funciones de dinero abiertas a usuarios sin sesión? (C1)
- ¿Hay reglas de lectura que dejen ver datos de otras empresas? (A4)
- ¿El respaldo de producción también se recorta a 1000 filas? (C2)
- Foto del estado actual: stock contra Kardex, préstamos y deudas, para comparar después del paso.

## 7. Paso a producción y vigilancia (solo con tu aprobación)

1. Respaldo completo de producción justo antes, guardado en `construacero-backups/`.
2. Paso en un horario tranquilo, con la vuelta atrás ensayada y lista.
3. Pruebas rápidas en producción **solo de lectura** y con un producto de prueba marcado, si lo autorizas.
4. Vigilante nocturno y cuadre de datos durante los 3 días siguientes, con informe diario.

## 8. Reglas para pasar a producción

Se pasa **solo si**:
- todas las pruebas **críticas y altas** pasan, y las medias pasan o tienen una excepción aprobada por ti por escrito;
- el probador completo da 2 corridas seguidas sin fallos;
- el cuadre de datos no muestra descuadres nuevos;
- el ensayo de vuelta atrás salió bien;
- tú revisaste las pantallas y diste el visto bueno;
- una segunda revisión independiente (otra sesión, sin acceso a este informe al empezar) no encuentra problemas críticos ni altos.

## 9. Entregables

- Informe de resultados con la tabla de las ~120 pruebas: pasó, falló o no se pudo correr, con evidencia.
- Lista de fallas nuevas (si aparecen) en el [registro de fallas](../operaciones/REGISTRO-FALLAS-CODIGO.md).
- Las pruebas nuevas quedan guardadas en el proyecto para repetirlas en cada cambio futuro.

## 10. Lo que este plan no garantiza

- Que no exista **ningún** otro problema: solo se prueban los caminos de esta lista (que cubren todo lo que mueve inventario, préstamos, devoluciones y cobros relacionados).
- El comportamiento con la cantidad de datos y usuarios de producción: staging tiene menos.
- Arreglar los descuadres históricos (mayo–agosto) o los 3400 movimientos viejos sin origen: eso es un caso aparte.

---

## Lo que se necesita del dueño

1. **Permiso para escribir en staging** (crear datos de prueba, aplicar las migraciones del plan OP-078, publicar el servidor de staging y borrar después los datos de prueba). Hasta ahora solo se leyó.
2. **Permiso para crear 2 empresas de prueba en staging** con un usuario por rol (las contraseñas y PIN se guardan en el archivo local de pruebas, no en el chat).
3. **Permiso para revisar producción solo mirando** (sección 6), y confirmar que se use el acceso de producción del archivo `.env` de la carpeta principal.
4. **Staging congelado durante las corridas:** que ninguna otra sesión ni persona trabaje en staging mientras se prueba (se avisa antes de empezar y al terminar).
5. **Acceso para publicar el servidor de staging** (Cloudflare): confirmar que la sesión de Cloudflare de esta PC sigue activa o iniciarla cuando se pida.
6. **Unos 30–45 minutos tuyos** para la revisión final de pantallas (Bloque 10), siguiendo una lista paso a paso.
7. **Tres confirmaciones de negocio:**
   - ¿Aprobar un despacho sin stock suficiente debe seguir solo avisando (sin bloquear)?
   - ¿El supervisor debe poder hacer ingresos por lote? (Hoy puede; el conteo físico solo lo hacen administración, jefe y desarrollador.)
   - Al facturar un préstamo, ¿el monto en dólares se redondea a 2 decimales?
8. **Visto bueno para trabajar en carpeta aparte y subir los cambios a GitHub** mediante solicitudes de cambio que tú apruebas.

## Aprobación (2026-11-25)

- El dueño escribió en el chat: **"apruebo todo lo que pides"**. Quedan aprobados los puntos 1 a 8 de "Lo que se necesita del dueño".
- Las 3 preguntas de negocio no se respondieron una por una. Se toman estos supuestos, que el dueño puede corregir en cualquier momento:
  1. Aprobar un despacho sin stock suficiente **sigue solo avisando** (como hoy).
  2. El supervisor **sigue pudiendo** hacer ingresos por lote, que ahora solo suman (ya no existe "sobrescribir").
  3. El monto en dólares al facturar un préstamo **se redondea a 2 decimales**.

## Bitácora de ejecución

- **2026-11-25 · Revisión de producción, solo mirando (sección 6):** hecha. Hallazgos en [INC-004](../incidentes/INC-004-funciones-de-dinero-abiertas-en-produccion.md):
  - 2 funciones de dinero abiertas sin sesión y sin control (`registrar_cargo_cxc` de 5 datos y `registrar_pago_comision`); el programa no las usa;
  - el respaldo de la app también se recorta a 1000 filas en producción;
  - reglas de lectura sin filtro de empresa (2 cuentas en producción);
  - 0 escrituras directas a tablas.
  
  Se pausa el resto del plan para pedir al dueño autorización del arreglo urgente en producción.
- **2026-11-25 · Arreglo urgente en producción:** el dueño autorizó cerrar las 2 funciones; aplicado y verificado (OP-2026-085, INC-004). Se retoma el plan con el respaldo de staging y la Fase 1 de OP-078.
