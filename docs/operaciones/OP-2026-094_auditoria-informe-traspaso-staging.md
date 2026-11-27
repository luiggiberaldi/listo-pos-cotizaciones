# OP-2026-094 — Auditoría independiente del informe de traspaso (OP-2026-093) y de las solicitudes #83, #84 y #85

- **Fecha:** 2026-11-26
- **Alcance:** auditoría solo lectura del informe `INFORME-TRASPASO-construacero.md` (OP-2026-093), de las carpetas de trabajo locales (`construacero-op078`, `construacero-op086`, `construacero-op087`, `construacero-op080`, `construacero-work`), de las solicitudes de cambio abiertas en GitHub (#78, #83, #84 y #85), de las migraciones SQL (`312`–`326`), del código del servidor y pantallas, y de las pruebas automáticas.
- **Entornos tocados:** **ninguno.** No se tocó producción ni la base de datos de staging; solo se leyeron archivos, se consultó GitHub y se corrieron pruebas locales en la PC.
- **Carpeta de este documento:** `construacero-op094` (rama `docs/op-094-auditoria-informe-traspaso`, sin subir a GitHub todavía).

---

## En resumen

- **Veredicto:** **APROBADO CON OBSERVACIONES SERIAS — NO unir las solicitudes ni pasar a producción todavía.** El informe OP-2026-093 está bien escrito y es honesto sobre lo que falta ver en pantalla, pero **omite riesgos concretos** que harían perder documentos al limpiar carpetas, provocarían choques fuertes al unir ramas y dejarían pasar errores reales de seguridad y comisiones si esto llegara a producción tal cual.
- **Lo más urgente antes de unir nada:**
  1. **Hay 3 archivos importantes que NO están guardados en GitHub** porque la lista de archivos ignorados los bloqueó: el plan de pruebas **OP-2026-084** y los dos programas de pruebas `op084-pruebas-staging.mjs` y `op084-restauracion-real-staging.mjs`. Si unes #83 y #84 y borras esas carpetas, **se pierden para siempre**.
  2. **Unir #84 y #85 NO tiene "conflictos triviales": chocan 9 archivos** (uno fue borrado en #84 y editado en #85), se rompe el refresco inmediato del aviso "por aprobar" y falla una prueba automática de #85.
  3. **Hay una solicitud abierta que el informe olvidó (#78, en `construacero-op080`):** no borres esa carpeta sin revisar #78 primero.
- **Errores reales encontrados en el código y la base de staging:** un hueco de seguridad en la restauración del respaldo para tablas hijas, errores en las comisiones de préstamos (clientes de EMPRESA, comisiones ya pagadas, devoluciones parciales), y confirmación de que **crear un despacho 100 % préstamo** en Cotizaciones y Venta rápida **sí exige método de pago hoy**.
- **¿Qué tienes que hacer tú ahora?** Nada en producción. Decidir si quieres que primero salvemos los 3 archivos y resolvamos los choques y fallas en staging antes de que tú hagas la prueba visual en pantalla.

> **Glosario rápido.** *Solicitud de cambio (PR):* propuesta formal en GitHub para sumar cambios al código principal. *Migración:* archivo de instrucciones que cambia la estructura o las reglas de la base de datos. *Conflicto al unir:* cuando dos cambios distintos tocaron el mismo archivo y hay que decidir manualmente qué queda. *`.gitignore`:* lista de archivos que la herramienta de versiones ignora a propósito para no subir basura ni contraseñas.

---

## 1. Lo que SÍ se comprobó como verdadero

Para ser justos, la mayoría de la base del informe OP-2026-093 coincide con los hechos:

| Afirmación del informe | Verificación independiente |
|---|---|
| La copia del Escritorio (`INFORME-TRASPASO-construacero.md`) es el mismo documento OP-2026-093 | **Confirmado** (misma huella SHA-256 exacta que `construacero-op086/docs/operaciones/OP-2026-093_...`). |
| En producción solo se aplicó la migración 312 (cierre de 2 funciones de dinero) | **Confirmado** en la solicitud #83 (`supabase/migrations/312_cerrar_rpcs_dinero_abiertas.sql` + vuelta atrás). |
| Existe la colisión del número `312` entre producción y staging | **Confirmado.** |
| Respaldo previo de staging guardado en `construacero-backups/staging-2026-11-25-antes-op086` | **Confirmado** (la carpeta existe en el equipo). |
| Carpeta principal `construacero` en `main` y limpia para git | **Confirmado** (`main` al día con `origin/main`, sin cambios sin guardar; sí conserva archivos ignorados viejos como `.pid`, `.tmp-op040`, `tmp`). |
| Pruebas automáticas de código en verde | **Confirmado:** `571/571` en `construacero-op086` y `288/288` en `construacero-op087` (en nuestra corrida paralela una prueba dio tiempo agotado por carga de CPU, y al correrla sola pasó `8/8` en `122 ms`). |
| El siguiente número libre de caso es `OP-2026-094` | **Confirmado** revisando `main` y las 4 solicitudes abiertas. |
| La configuración de servidores locales (`launch.json`) existe en `construacero/.claude/launch.json` | **Confirmado.** |

---

## 2. Hallazgos críticos (corregir antes de unir solicitudes o pasar a producción)

### C1. Tres archivos clave NO están en GitHub y se perderían al limpiar carpetas

- **Qué dice el informe:** que el plan **OP-2026-084** está en la solicitud #83 y que los programas `scripts/op084-pruebas-staging.mjs` y `scripts/op084-restauracion-real-staging.mjs` se corren desde la rama de #84.
- **Qué encontramos en realidad:**
  1. En la solicitud #83 (`construacero-op078`), `docs/plans/OP-2026-084_plan-testeo-completo-inventario.md` **solo existe suelto en tu PC**. El archivo `.gitignore` de la raíz (línea 78: `*.md`) lo bloqueó. El commit de OP-084 solo subió la línea en `REGISTRO.md`.
  2. En la solicitud #84 (`construacero-op086`), `scripts/op084-pruebas-staging.mjs` y `scripts/op084-restauracion-real-staging.mjs` **tampoco están en GitHub**: `construacero-staging/.gitignore` (línea 85: `scripts/*`) los ignoró porque faltó añadir sus excepciones.
- **Qué significa para ti:** si unes #83 y #84 y borras las carpetas locales (como pide la regla OP-2026-083), **pierdes para siempre el plan de pruebas y dos de los tres programas que verifican seguridad y restauración**, y todos los enlaces a OP-084 quedarán rotos.

### C2. Unir #84 y #85 NO tiene "conflictos triviales": chocan 9 archivos y rompe "por aprobar"

- **Qué dice el informe:** que #83, #84 y #85 solo chocan en `.gitignore` y `REGISTRO.md` ("conflictos triviales").
- **Qué encontramos al simular la unión real entre #84 y #85:** chocan **9 archivos**:
  - `construacero-staging/.gitignore` y `docs/operaciones/REGISTRO.md`;
  - `construacero-staging/src/hooks/useStockComprometido.js` (**choque grave:** #84 lo **borró** completo porque ya nadie lo usaba, mientras #85 lo **modificó** para agregar "por aprobar");
  - 6 pantallas: `CotizacionBuscador.jsx`, `ProductoAutocomplete.jsx`, `ProductoCard.jsx`, `ProductCard.jsx`, `InventarioView.jsx` y `VentaRapidaView.jsx`.
- **Dos efectos ocultos de ese choque:**
  1. **El aviso "por aprobar" dejaría de actualizarse al instante** al aprobar o rechazar un despacho: #85 confía en que el sistema invalide la clave `['stock_comprometido']`, pero #84 eliminó esas llamadas de `useDespachos.js`.
  2. **Una prueba automática de #85 se romperá al unirlas:** `op087StockPorAprobar.test.js` exige encontrar el texto `const disponibleReal = stock - comprometido`, que #84 retiró de `ProductCard.jsx`.

### C3. Hueco de seguridad y riesgo de congelamiento en la restauración de respaldos (`migración 322` y `admin.js`)

- **Cruce entre empresas en tablas hijas:** `restaurar_respaldo_atomico` revisa si un registro pertenece a otra empresa **antes** de escribir solo en las tablas que tienen columna `cuenta_id`. En las 3 tablas hijas (`cliente_prestamos`, `despacho_devoluciones`, `despacho_devolucion_intercambios`), **primero sobrescribe la fila** (`ON CONFLICT DO UPDATE`) y **después** revisa si el cliente/despacho nuevo es de la empresa. Si alguien con acceso de otra empresa mete el identificador de un préstamo ajeno pero apuntando a su propio cliente, el control pasa y **sobrescribe/roba la fila ajena**.
- **Congelamiento total al restaurar:** la función hace `ALTER TABLE ... DISABLE TRIGGER USER` sobre 15 tablas principales a la vez. En PostgreSQL eso toma un candado total (`ACCESS EXCLUSIVE`) que **bloquea incluso las lecturas de todos los usuarios y de todas las empresas** mientras dure la restauración (crítico en producción con respaldos de ~20 MB).
- **Respaldo y restauración incompletos respecto a tablas nuevas:** `handleBackup` guarda 17 tablas y `restaurar_respaldo_atomico` restaura 15, pero **dejan fuera** `despacho_descuentos` (que usa la fórmula del precio del préstamo), `comision_liberaciones`, `comision_designacion_diaria`, `cxc_movimientos_borrados`, `proveedores`, `ordenes_compra`, `orden_compra_items`, `cuentas_por_pagar`, `vehiculos` y `pagos_transportistas`.
- **Acepta respaldos viejos recortados:** `handleRestore` solo rechaza un archivo si trae `completo: false` o `errores`. Los respaldos descargados antes de OP-086 (versiones `1.0` y `1.1`, recortados a 1000 filas) no traen ese campo y **se restaurarían sin rechazo**.

### C4. Fallas reales en comisiones al facturar préstamos (`migración 326` y freno de `OP-092`)

- **Desfase grave con cómo funcionan hoy las comisiones (confirmado con el dueño y con producción):** desde agosto 2026 (`2026-08-22-quitar-pago-comisiones.md`, migración `238`), el sistema **ya no registra si una comisión fue pagada al vendedor** ni tiene estados `pagada` / `pendiente` / `cta_cobrar`, ni existe el botón **"Liberar comisión CxC"** en `ComisionesView.jsx`. Hoy todas las comisiones nacen con estado único `'generada'` solo sobre ventas cobradas (las ventas a crédito/CxC se excluyen de `totalcomision` y el administrador solo consulta cuánto pagar). El informe OP-2026-093 y la migración `326` se basaron por error en código viejo que quedó en `construacero-staging/api/handlers/comisiones.js`: al facturar un préstamo **"A crédito"** dejan la comisión en estado `cta_cobrar` y dicen que administración la liberará con un botón **que ya no existe en la pantalla**, y en producción rompería el modelo actual de estado único `'generada'`.
- **Clientes de EMPRESA (viola regla OP-2026-032):** en `comision_prestamo_facturado_staging` (línea 41), si el cliente no tiene vendedor asignado (`cl.vendedor_id IS NULL`), el código cae a `nd.vendedor_id` (quien hizo el despacho). El motor oficial (`238b`) usa solo `cl.vendedor_id` porque los clientes de EMPRESA **no generan comisión**.
- **El freno provisional de OP-092 (`despachos.js`) tiene 3 huecos:**
  1. Si la base falla un instante al consultar si hay préstamos facturados (error 502, que el propio informe dice que ocurre seguido), el bloque `catch` deja `tienePrestamoFacturado = false` y **borra y recalcula la comisión igual** (debería frenar por seguridad, no seguir).
  2. En una **devolución parcial** de un despacho mixto (`handleDevolucionParcialDespacho`, línea 3399), el servidor llama a `recalcularComision238b` sin ese freno y **borra la comisión del préstamo facturado**.
  3. Lo mismo ocurre al reasignar clientes (`clientes.js`).

### C5. Solicitud abierta #78 olvidada en el informe (`construacero-op080`)

- **Qué dice el informe:** que hay 3 solicitudes abiertas (#83, #84, #85) y que `construacero-op080` es una carpeta vieja "pendiente de confirmar su limpieza".
- **Qué encontramos:** en GitHub sigue abierta la **solicitud #78** (`docs/op-080-publicado`, actualmente con conflictos contra `main`), que registra como publicados los casos OP-025, OP-077, OP-079 y OP-080. No se debe borrar `construacero-op080` sin cerrar o actualizar #78 primero.

---

## 3. Hallazgos importantes (funcionales, seguridad y exactitud del informe)

### A1. Confirmado: crear un despacho 100 % préstamo SÍ pide método de pago hoy

El informe dejó en "pendiente" revisar la creación de despachos 100 % préstamo. Revisando el código de staging confirmamos que **ambas pantallas tienen el mismo fallo que OP-092**:
- **Cotizaciones → Crear despacho** (`CotizacionesView.jsx`, línea 998) exige `pagoInmediatoCuadrado` incluso con total `$0`.
- **Venta rápida** (`VentaRapidaView.jsx`, líneas 771–772) exige lo mismo.

### A2. Dos cabos sueltos en las ventanas arregladas por OP-092

- En `EditarItemsDespachoModal.jsx` quedaron dos sitios (líneas 1012 y 1262) revisando `!pagoInmediatoCuadrado` en vez de `estaCuadrado`, por lo que puede seguir apareciendo el aviso o texto de ayuda **"Los montos no cuadran con el total"** aun cuando el botón sí deje guardar.
- Tanto `EditarItemsDespachoModal.jsx` como `EditDespachoModal.jsx` muestran el cartel **"Este despacho es 100 % préstamo"** cada vez que `total <= 0.015`, sin comprobar si los artículos son realmente préstamos. Si un despacho queda en `$0` por ser **100 % donación**, el mensaje será incorrecto.

### A3. Tasa al facturar préstamos y falta de fecha de vencimiento

- **Límite `1/4` a `4×` contra el despacho original (`clientes.js`, línea 951):** en Venezuela la tasa puede subir más de 4 veces entre la entrega de un préstamo y su facturación meses después. Si eso ocurre, **el servidor bloqueará una tasa real válida**. Además, el servidor ya tiene `/api/rates`, por lo que puede validar contra la tasa real del día en lugar de una foto vieja del despacho.
- **Sin fecha de vencimiento en préstamos "A crédito" (`migración 326`):** el cargo en `cuentas_por_cobrar` se crea sin `fecha_vencimiento` (mismo tipo de detalle que la falla N18), lo que afecta los reportes de deudas vencidas.

### A4. Condición frágil de aislamiento en 3 funciones de catálogo (`migración 317`)

Las funciones `obtener_stock_productos`, `obtener_categorias_vendedor` y `obtener_productos_vendedor` (que corren con permisos de dueño) filtran con:
`AND (auth.uid() IS NULL OR p.cuenta_id = (SELECT auth.uid()))`
Hoy no son accesibles sin sesión porque la migración `314` revocó a `anon`, pero **un usuario sin sesión también tiene `auth.uid() IS NULL`**, y la migración `317` no repite el `REVOKE` sobre esas 3 funciones. Si en producción se aplican en otro orden o alguien recrea una función, **cualquier visitante sin sesión vería el catálogo de todas las empresas**. Lo seguro es exigir `auth.role() = 'service_role'`.

### A5. Contradicciones en el informe y registros sin actualizar

1. **`liquidar_transportista` en producción:** el informe (sección 3) dice que **no está cerrada** en producción, pero el documento `INC-004` (línea 23) dice que **sí ya estaba cerrada** en producción.
2. **Estado `ACTION_REQUIRED` en GitHub:** el informe dice que pide "aprobación de un flujo de GitHub". En realidad es una revisión externa de **Kilo Code Review**; el chequeo de **Vercel** está en verde (`SUCCESS`).
3. **Registro de fallas desactualizado:** el informe dice que `N36-INV` a `N43` están arregladas en staging, pero en `construacero-op086/docs/operaciones/REGISTRO-FALLAS-CODIGO.md` siguen todas en rojo (`🔴 abierta`).
4. **Notas viejas sin limpiar:** `OP-2026-086` todavía lista como "Pendiente" tareas que ya terminó (Fase 3, plan OP-084, abrir solicitud); `REGISTRO.md` en #84 dice "hoy: OP-2026-084" al pie y mantiene OP-090 como "1 falla sin corregir" (ya cerrada en OP-091); `REGISTRO.md` en #85 dice "falta solicitud de cambio" (ya es la #85).

### A6. Calidad real de las pruebas nuevas y brecha en devoluciones (`321`)

- Las 5 pruebas nuevas de `vitest` (`op087`, `op088`, `op089`, `op091`, `op092`) **no ejecutan código ni pantallas**: solo leen el archivo de texto y buscan frases dentro del código fuente. Si cambia una variable o falla la lógica al correr, pueden seguir saliendo "en verde".
- La migración `321` (`registrar_devolucion_inventario_atomica`) verifica que `cantidad × precio = total`, pero **no verifica que el precio enviado coincida con el precio de la línea del despacho**, ni valida `cantidad × precio` en los intercambios. Además sigue insertando movimientos de devolución en Kardex **sin `origen_tipo`** (sigue creando filas "sin origen").

---

## 4. Detalles menores para pulir antes de producción

- **M1 · Decimales en "por aprobar" (`migración 324`):** declara `NUMERIC(12,2)` y `NUMERIC(10,2)` mientras que la migración `315` subió las cantidades a 4 decimales (`NUMERIC(12,4)`). Conviene alinear a `NUMERIC(12,4)`.
- **M2 · Redondeo visual del precio unitario (`migración 326`):** el texto del cargo muestra el precio unitario a 2 decimales aunque el cálculo del cobro usa 4 decimales.
- **M3 · Detección de columnas en restauración (`migración 322`):** lee las columnas solo de la **primera fila** del respaldo (`v_filas->0`); si esa primera fila omite un campo opcional que sí tienen otras filas, ese campo se pierde en toda la tabla.
- **M4 · Alcance gigante de la solicitud #84:** tiene **161 archivos** (incluye migraciones `301`–`308` de CxC, eliminación de vista lista OP-079, tasa en login OP-072). No afecta producción directamente porque está en `construacero-staging/`, pero exige extremo cuidado cuando se prepare el paso limpio a producción.

---

## 5. Orden recomendado antes de tocar producción

1. **Rescatar los 3 archivos perdidos por `.gitignore`:** añadir excepciones y guardar en GitHub `OP-2026-084` (en #83) y `op084-pruebas-staging.mjs` + `op084-restauracion-real-staging.mjs` (en #84). Revisar qué hacer con la solicitud olvidada **#78** antes de borrar `construacero-op080`.
2. **Resolver el choque real entre #84 y #85 en staging:** unir los 9 archivos con cuidado, restaurar el refresco inmediato de "por aprobar" al aprobar/rechazar despachos, alinear `324` a 4 decimales y corregir la prueba rota de #85.
3. **Corregir las fallas de código encontradas en staging:**
   - seguridad de restauración (`322` tablas hijas antes del `UPDATE`, sin `ACCESS EXCLUSIVE` masivo o con ventana controlada, rechazar respaldos viejos sin `completo: true`, incluir `despacho_descuentos` y tablas faltantes);
   - comisiones de préstamos (`326`: respetar regla de clientes de EMPRESA, no borrar `pagadaen`/`pagadapor`, arreglar `estado` en despachos mixtos; `despachos.js`: freno fail-closed y cubrir devolución parcial);
   - creación de despachos 100 % préstamo (`CotizacionesView`, `VentaRapidaView`), avisos sueltos de `EditarItemsDespachoModal` / `EditDespachoModal`, límite de tasa contra `/api/rates`, `fecha_vencimiento` y `auth.role() = 'service_role'` en `317`;
   - actualizar `REGISTRO-FALLAS-CODIGO.md`, `REGISTRO.md` y limpiar contradicciones de los documentos.
4. **Solo después:** hacer la verificación visual del dueño en pantalla (Bloque 10), el ensayo de vuelta atrás y la prueba de restauración de ~20 MB, y preparar el caso separado de paso a producción.
