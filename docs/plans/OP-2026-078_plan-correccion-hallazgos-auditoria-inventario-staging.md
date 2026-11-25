# OP-2026-078 — Plan para corregir en staging los hallazgos de la auditoría OP-2026-076

- **Fecha:** 2026-11-25
- **Estado:** Aprobado por el dueño el 2026-11-25. Fase 1 desbloqueada (ver bitácora: la rama guardada borra 13 archivos de `main` y hay que llevar solo lo de inventario).
- **Entorno:** solo **staging** (`construacero-staging/` y base de pruebas `spupqgkdsgohxxfoxydl`). Producción no se toca en este plan; solo se hará **una revisión de solo lectura** al final para saber si tiene los mismos problemas.
- **Origen:** [OP-2026-076](../operaciones/OP-2026-076_auditoria-independiente-inventario-staging.md) (fallas N36–N43 en el [registro de fallas](../operaciones/REGISTRO-FALLAS-CODIGO.md)).

---

## En resumen

- **Qué se va a hacer:** cerrar las "puertas" de dinero abiertas, hacer que el respaldo guarde todo, que restaurar no dañe préstamos, que facturar un préstamo no pueda cobrar dos veces, que ninguna cuenta lea datos de otra y pulir 4 detalles menores.
- **Lo primero:** guardar el trabajo actual en el historial y juntarlo con la versión principal. Hoy está sin guardar, en una rama vieja, y le falta el arreglo de vendedores (OP-070). Sin esto, cualquier arreglo nuevo se apoya en una base equivocada.
- **Cuánto toma:** 7 fases. Las fases 2 a 5 son independientes entre sí; la 1 va primero y la 7 (pruebas completas) al final.
- **Qué tienes que decidir tú:** 2 preguntas de negocio (al final del documento). Hay una recomendación para cada una.

> **Glosario rápido.** *Migración:* una actualización del "manual de instrucciones" de la base de datos. *Commit:* guardar un cambio en el historial del proyecto. *Rama:* una copia de trabajo paralela del proyecto. *Worker:* el servidor en la nube que recibe las acciones de la pantalla y habla con la base de datos. *Atómico:* que se hace todo o nada; si algo falla a la mitad, no queda nada a medias.

---

## Fase 1 — Poner el trabajo en orden (bloquea todo lo demás)

**Problema (A3):** el trabajo de OP-075 son 259 archivos sin guardar en la rama `fix/op-025-busqueda-sin-limites`, que va 62 cambios por detrás de la versión principal (`origin/main`). La principal ya usa el número de migración 311 (`311_staging_vendedor_edita_despacho_pendiente.sql`) y tiene `construacero-staging/src/utils/edicionVendedorDespacho.js`, que aquí falta.

Pasos:
1. Crear una rama nueva desde `origin/main` (`fix/op-077-inventario-staging`).
2. Pasar a esa rama solo los archivos de OP-071/075/076 (no los cambios ajenos que hay en la carpeta), revisando archivo por archivo los que también cambiaron en la principal (`despachos.js`, `inventario.js`, `admin.js`, `clientes.js`, `worker.js` y los componentes tocados).
3. **Renumerar** las migraciones de staging: `310→312`, `311→313`, `312→314`, `313→315` (cada una con su rollback). Corregir las referencias en documentos y pruebas.
4. Confirmar que el Worker de staging conserva la edición del vendedor de OP-070 (`esRolVendedor`/`validarEdicionVendedor`) y que la función `editar_despacho_profundidad` de la nueva `313` la mantiene.
5. Resolver los conflictos de numeración de documentos: OP-074, 075 y 076 solo existen en esta copia local; se conservan con sus números y se agregan al registro de la principal.
6. Anotar en `supabase_migrations.schema_migrations` de staging las migraciones ya aplicadas, para que quede rastro de qué hay instalado.
7. Correr las pruebas automáticas y la compilación antes de seguir.

**Listo cuando:** la rama nueva compila, pasan todas las pruebas y un vendedor puede editar su despacho pendiente en staging.

## Fase 2 — Cerrar las puertas de dinero (C1, M5)

**Problema:** `registrar_cargo_cxc(uuid,uuid,numeric,text,uuid)`, `registrar_pago_comision(uuid,uuid,uuid)` y `liquidar_transportista(…)` las puede ejecutar cualquiera, incluso sin iniciar sesión, y no revisan quién llama. `tester_cleanup_cotizacion` borra datos de cualquier cuenta.

Pasos:
1. Buscar en el código quién usa cada función (el Worker con su llave de servidor, o la pantalla directamente).
2. Migración nueva `316_staging_cierre_rpcs_dinero.sql`:
   - Quitar el permiso de `PUBLIC`, `anon` y `authenticated` y dárselo solo a `service_role` (el servidor).
   - En `tester_cleanup_cotizacion`, borrar solo si la cotización es de la cuenta de quien llama.
   - Revisar **todas** las funciones con "permisos de dueño" (`SECURITY DEFINER`) que hoy pueden ejecutar `anon`/`authenticated` (la auditoría encontró 40), y dejar abiertas solo las de lectura o login que de verdad necesite la pantalla, cada una justificada por escrito.
3. Si alguna pantalla llamaba esas funciones directamente, cambiarla para que pase por el Worker.
4. Prueba automática que **consulte la base de verdad** (no que busque texto en el archivo) y falle si alguna función que modifica datos queda abierta a `anon`/`authenticated`.

**Listo cuando:** la consulta en vivo devuelve 0 funciones que modifiquen datos abiertas a `anon`/`authenticated`, fuera de una lista corta y justificada.

## Fase 3 — Respaldo completo y restauración segura (C2, A1, B3)

**Problema:** el respaldo guarda como máximo 1000 filas por tabla sin avisar; restaurar daña préstamos, no es atómico y puede tocar filas de otra cuenta.

Pasos del respaldo (`admin.js`, `handleBackup`):
1. Leer cada tabla página por página (de 1000 en 1000) hasta terminar, también en las tablas hijas que se leen por grupos de ids.
2. Pedir el total a la base (`count=exact`) y comparar: si no cuadra, el respaldo se marca **incompleto** con aviso visible.
3. Guardar en el respaldo el conteo de cada tabla.

Pasos de la restauración (`handleRestore` + migración nueva `317_staging_restaurar_respaldo_atomico.sql`):
1. Pasar la restauración a una sola función de base de datos que haga **todo o nada**.
2. Durante la carga, apagar el disparador que crea préstamos automáticamente, para que los préstamos del respaldo entren tal cual (con lo devuelto y lo facturado).
3. Rechazar cualquier fila cuyo id ya pertenezca a otra cuenta.
4. Conservar los números de cotización originales (`OVERRIDING SYSTEM VALUE`) y avanzar los contadores al final.
5. Antes de restaurar, mostrar un aviso claro: restaurar **reemplaza** los datos actuales; se recomienda hacer un respaldo justo antes.
6. Prueba en staging: respaldo → base de prueba vacía → restauración → comparar conteos, saldos de clientes, stock contra Kardex y préstamos.

**Listo cuando:** el respaldo de staging trae 6002 movimientos (o los que haya ese día) y al restaurarlo los préstamos conservan lo devuelto y lo facturado.

## Fase 4 — Facturar préstamo sin cobro doble (A2)

**Problema:** `handleFacturarPrestamo` (`clientes.js:925-984`) cobra y actualiza en pasos separados, sin candado ni sello único.

Pasos:
1. Migración nueva `318_staging_facturar_prestamo_atomico.sql` con una función que, en un solo paso: bloquee el préstamo (`FOR UPDATE`), valide el saldo, cree el cargo en CxC, actualice `cantidad_facturada` y el estado (con la misma regla que `sincronizar_prestamos_despacho`: `devuelto_parcial` cuando corresponda) y guarde el resultado bajo un sello único.
2. El Worker solo llama esa función y exige el sello único (`Idempotency-Key`); la pantalla lo reutiliza en los reintentos.
3. No mueve stock (se respeta tu decisión N27).
4. Precio: según tu respuesta a la **Decisión 1**.
5. Pruebas: doble envío con la misma clave = 1 solo cargo; dos envíos simultáneos con claves distintas por más de lo pendiente = uno rechazado; devolución y facturación simultáneas = estado correcto.

## Fase 5 — Cada cuenta ve solo lo suyo (A4)

**Problema:** reglas de lectura viejas (`nd_items_vendedor_read`, `productos_admin_select`, `despachos_admin_select`, `despachos_logistica_select`, `movimientos_admin_select`, `productos_supervisor_select`, `movimientos_supervisor_select`) no filtran por cuenta y se suman a las nuevas.

Pasos:
1. Migración nueva `319_staging_rls_aislamiento_cuentas.sql`: reescribir cada regla agregando `cuenta_id = auth.uid()` (o eliminarla si ya la cubre otra), manteniendo lo que cada rol puede ver dentro de su cuenta (vendedor: solo lo suyo).
2. Revisar las mismas reglas en `clientes`, `cotizaciones`, `cotizacion_items` y `cuentas_por_cobrar`.
3. Prueba en vivo con dos cuentas de prueba: la cuenta B no ve nada de la cuenta A en ninguna tabla.

## Fase 6 — Detalles menores (M1, M2, M3, M4, B1, B2)

1. **Revertir en Kardex (M1):** cambiar a lista de permitidos (ajustes manuales, conteos físicos y movimientos manuales), bloquear siempre las devoluciones y los movimientos sin origen, en la base y en el botón de `KardexModal.jsx`.
2. **Lote "sobrescribir" (M2):** según tu respuesta a la **Decisión 2**.
3. **Importador CSV (M3):** enviar todo el archivo al ingreso por lote atómico (`batch-ingest`) en vez de crear producto por producto.
4. **Devolución parcial en la base (M4):** recalcular el total dentro de la base y rechazar filas inconsistentes (sin producto o con origen distinto de inventario, intercambio o externo).
5. **Transacciones (B1):** envolver en `BEGIN; … COMMIT;` la migración 313 (antes 311) y los rollbacks de 313/314.
6. **Conteo tras conflicto (B2):** al recibir 409, refrescar el stock de la pantalla y avisar qué productos cambiaron.
7. Escribir en el rollback de 315 (antes 313) qué **no** revierte.

## Fase 7 — Pruebas completas, documentación y revisión de producción (solo lectura)

1. Pruebas automáticas, compilación, probador completo de staging (2 corridas) y auditoría de Kardex.
2. Revisión visual en navegador de: ficha de producto, conteo físico, lote, Kardex, devolución parcial, facturar préstamo, respaldo y restauración.
3. **Revisión de solo lectura en producción** (sin cambiar nada): ¿tiene abiertas las mismas funciones de dinero (C1)? ¿las mismas reglas de lectura entre cuentas (A4)? ¿el mismo tope de 1000 filas en el respaldo (C2)? El resultado va en un documento nuevo y define el plan de paso a producción.
4. Documento de cierre con resultados reales, actualizar el registro y el registro de fallas (N36–N43), y abrir la solicitud de cambio.

---

## Orden y dependencias

| Fase | Depende de | Puede ir en paralelo con |
|---|---|---|
| 1 | — | — |
| 2, 3, 4, 5 | 1 | entre sí (tocan archivos distintos, salvo `admin.js` que solo toca la 3) |
| 6 | 1 | 2–5 |
| 7 | todas | — |

## Riesgos

- **Fase 1** es la más delicada: unir 62 cambios de la principal con 259 archivos locales puede reintroducir errores ya arreglados. Por eso se hace archivo por archivo y con todas las pruebas.
- **Fase 5** puede ocultarle a algún rol algo que hoy ve legítimamente. Se prueba rol por rol.
- **Fase 3** cambia cómo se restaura: hasta terminarla, conviene **no restaurar respaldos** en staging ni en producción.

---

## Decisiones del dueño (tomadas el 2026-11-25)

1. **Precio al facturar un préstamo:** se cobra **el mismo precio en dólares del despacho original** (el de la línea prestada, con su descuento si lo tuvo, igual que hace la devolución parcial), **convertido a bolívares con la tasa BCV del día de la facturación**. Como las deudas se guardan en dólares, el monto en dólares queda fijo y la tasa del día se anota en la descripción del cargo y en la auditoría. *Aplica a la Fase 4.*
2. **"Sobrescribir" en el ingreso por lote:** **se quita**. Para cuadrar existencias solo se usa "Conteo físico". *Aplica a la Fase 6, punto 2.*

## Decisiones que se le plantearon al dueño

**Decisión 1 — ¿A qué precio se factura un préstamo?**
Hoy usa el **precio actual del catálogo**. Si el precio subió desde que se prestó, el cliente paga el precio nuevo.
- **Recomendado:** usar el **precio del despacho original** (el que vio el cliente al llevarse la mercancía).
- Alternativa: mantener el precio actual del catálogo.

**Decisión 2 — ¿Qué hacemos con "sobrescribir" en el ingreso por lote?**
Hoy permite fijar el stock a un número sin comprobar si hubo ventas mientras tanto (el mismo problema que arreglamos en la ficha).
- **Recomendado:** **quitar "sobrescribir"** del ingreso por lote; para cuadrar existencias se usa solo "Conteo físico", que ya está protegido.
- Alternativa: dejarlo, pero exigir el stock esperado (como el conteo) y permitirlo solo a administración y jefe.

---

## Bitácora de ejecución

- **2026-11-25 · Número cambiado:** este plan se escribió como OP-2026-077, pero otra sesión había tomado ese número minutos antes (responsividad móvil, [OP-2026-077](../operaciones/OP-2026-077_fixeo-responsividad-movil-staging.md)). Pasó a **OP-2026-078**.
- **2026-11-25 · Fase 1 en pausa:** la otra sesión está cambiando archivos en la misma carpeta, y cuatro de ellos también son parte del trabajo de inventario (`EditDespachoModal.jsx`, `OrdenCompraView.jsx`, `ProveedoresView.jsx`, `QuickQuoteFAB.jsx`). Los dos cambios están mezclados dentro de los mismos archivos sin guardar. Antes de mover nada a la rama nueva hay que acordar con el dueño cómo separarlos o si van juntos.
- **2026-11-25 · Revisión tras el orden de la carpeta (OP-2026-083):** la otra sesión terminó. El trabajo de inventario quedó guardado, **solo en esta PC**, en la rama `wip/op-075-inventario-staging` (commit `415db31a`), apoyada sobre `main` (`a186b391`). Pero esa rama es una "foto" de la carpeta vieja, no solo los cambios de inventario: además de agregarlos, **borra 13 archivos que `main` sí tiene**, entre ellos:
  - la edición del vendedor de OP-070 en staging (`construacero-staging/src/utils/edicionVendedorDespacho.js` y la migración `311_staging_vendedor_edita_despacho_pendiente.sql` con su rollback);
  - la limpieza de cotizaciones de OP-069 (`api/lib/limpiezaCotizaciones.js`, sus pruebas y `cotizacionesGuardarOp069.test.js`);
  - el detalle de stock comprometido (`StockComprometidoDetalle.jsx`, `useStockComprometido.js`);
  - `ClienteRow.jsx`, `CotizacionRow.jsx`, `DespachoRow.jsx` y `verify-op042-cxc-staging.mjs` (falta confirmar si su borrado era intencional por OP-079).
  
  **Consecuencia:** si esa rama se uniera tal cual, staging perdería OP-069 y OP-070. La Fase 1 debe tomar de esa rama **solo los archivos de inventario** (migraciones 310–313 renumeradas, handlers, pantallas, pruebas `*071`, `idempotencyKey.js`, `cargaDuplicada.js`) y aplicarlos sobre `main` actualizado, sin los borrados. Los 4 archivos que antes se mezclaban con la sesión de responsividad ya no chocan: el arreglo móvil se publicó por separado (solicitudes #77 y #79). **La Fase 1 queda desbloqueada.**
