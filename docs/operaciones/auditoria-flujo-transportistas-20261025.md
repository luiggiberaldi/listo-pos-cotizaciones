# Auditoría: flujo de transportistas (locales y externos) y el aviso que bloquea el flete

**Fecha:** 2026-10-25
**Alcance:** solo lectura. No se cambió ningún código ni ningún dato.

---

## En resumen

- El aviso **"Chofer local: indica el estado del destino o completa el estado del cliente"** no es un fallo aleatorio: aparece cuando se juntan tres cosas a la vez — chofer marcado como **local**, **flete mayor que $0** y **nadie conoce el estado del destino** (ni la dirección alternativa ni la ficha del cliente).
- La regla es correcta y está bien blindada: sin el estado no se puede saber si el flete va por "nómina externa" (Carabobo) o genera comisión al chofer, y la propia base de datos se niega a guardar el despacho en ese caso.
- Lo que sí tiene fallas de experiencia es **por qué "a veces" te bloquea aunque parezca que todo está bien**: hay tres causas identificadas (cliente sin estado en su ficha, pantalla con una copia vieja de los datos del cliente, y una carga de cliente que falla en silencio). Ninguna corrompe datos, pero las tres dejan el botón bloqueado sin una forma obvia de arreglarlo.
- Mientras se decide el arreglo, **la solución rápida es**: activar "¿Enviar a otra dirección?" y elegir el Estado ahí, o completar el Estado en la ficha del cliente y recargar la pantalla.

---

## 1. El aviso: cuándo sale y por qué existe

### Cuándo aparece

Se muestran las tres condiciones a la vez:

1. El transportista elegido tiene la casilla **"Es transportista local"** activada en su ficha.
2. El campo **Flete $** es mayor que 0.
3. No se conoce el **estado del destino**:
   - la dirección alternativa ("¿Enviar a otra dirección?") está apagada, **y**
   - el cliente no tiene **Estado** guardado en su ficha.

Si falta cualquiera de las tres, el aviso no existe (por ejemplo: chofer general, o flete en 0, o cliente con estado cargado).

### Por qué existe la regla

La comisión del chofer local depende de **dónde** se entrega:

| Destino | Qué pasa con el flete |
|---|---|
| **Carabobo** | Se paga por **nómina externa** (fuera del sistema). Aquí no se registra comisión ni saldo que liquidar. |
| **Fuera de Carabobo** | **Genera comisión** para el chofer (un porcentaje del flete o una tarifa fija, según la configuración global). |
| **Sin estado** | **No se puede decidir**, así que no se permite guardar. |

Esta regla está "congelada" dentro de la base de datos (la migración `235_comision_flete_fuera_carabobo.sql`), no solo en la pantalla: si algo intentara guardar el despacho sin estado, la base lo rechaza con el código `DESTINO_ESTADO_REQUERIDO` y el servidor lo traduce al mensaje "Debe indicar el estado de destino para calcular la comisión del chofer local". El aviso en rojo que ves es esa misma regla, adelantada para que no llegues al error.

Al guardar, el despacho se lleva una **foto del estado del destino** usado, si el flete es comisionable, el neto calculado, el porcentaje aplicado y la regla que se aplicó (`nomina_carabobo`, `comision_fuera_carabobo`, `transportista_no_local` o `no_aplica`). Así, aunque el cliente cambie de dirección después, el cálculo histórico no se mueve.

---

## 2. Por qué te bloquea "a veces" (las tres causas)

### Causa A — La ficha del cliente no tiene Estado (la más común)
Si el cliente se creó sin llenar el campo **Estado** y no activaste la dirección alternativa, no hay estado en ningún lado del formulario y el botón se bloquea. El problema de experiencia: **el modal no tiene un campo de Estado visible** a menos que actives el interruptor "¿Enviar a otra dirección?"; para llenar el estado del cliente hay que salir, abrir Clientes, editarlo y volver.

### Causa B — La pantalla usa una copia vieja de los datos del cliente
La lista de cotizaciones guarda los datos del cliente (incluido su Estado) en una **caché de 5 minutos**. Si acabas de completar el Estado del cliente en otra pantalla y regresas al despacho sin recargar, el modal sigue viendo la copia vieja ("cliente sin estado") y sigue bloqueando **aunque el dato ya esté guardado**. Recargar la página (F5) lo despeja inmediatamente. Esto explica el patrón "lo arreglo y sigue saliendo… luego desaparece solo".

### Causa C — La carga del cliente falla en silencio
Los datos del cliente en la lista de cotizaciones vienen de una consulta extra (una búsqueda rápida en el servidor). Si esa consulta falla por un instante (red, sesión, etc.), el sistema la ignora a propósito para no tumbar toda la lista… pero entonces el modal ve "sin cliente" y bloquea **aunque el cliente sí tenga Estado**. También se despeja al recargar.

### Detalle menor (asimetría con la base de datos)
Si activas la dirección alternativa y llenas solo el Estado, la pantalla exige además la Ciudad. La base de datos solo usa el Estado. Es decir, en ese modo la pantalla es **más estricta** que la regla real: puede bloquearte aunque el guardado sí sería válido.

---

## 3. Cómo desbloquearlo hoy (sin tocar código)

Cualquiera de estas tres sirve:

1. **Desde el mismo modal:** activa "¿Enviar a otra dirección?" y elige el **Estado** (y la Ciudad). No hace falta cambiar la dirección real.
2. **Desde la ficha del cliente:** Clientes → editar el cliente → llenar **Estado** → guardar → **recargar la pantalla** (importante por la Causa B).
3. **Otra vía:** dejar el flete en $0 y cobrar el envío de otra forma.

---

## 4. El flujo completo, revisado

### 4.1 Transportista LOCAL (chofer local)

1. **Ficha del chofer:** casilla "Es transportista local (cobra comisión del flete fuera de Carabobo)". La relación legal (empleado/contratista/proveedor) es un dato aparte y no cambia este comportamiento.
2. **Al crear o editar el despacho:** con flete > 0 se exige el estado de destino (la validación está en la pantalla Y en el servidor, y el servidor lee el estado directo de la base, no de la copia de pantalla).
3. **Al guardar (base de datos):** se congela el snapshot del destino y se clasifica el flete:
   - `nomina_carabobo` → sin comisión, se muestra aparte como nómina externa.
   - `comision_fuera_carabobo` → genera neto al chofer.
   - `transportista_no_local` / `no_aplica` → sin nada que liquidar.
4. **Cálculo del neto:** configuración **global** (no por chofer) en Configuración de Negocio:
   - porcentaje sobre el flete (0–100%, redondeo a 4 decimales), o
   - tarifa fija, que **nunca puede exceder el flete cobrado al cliente**.
5. **Liquidación** (módulo Transportistas → reporte):
   - Solo aparecen **locales**; cada uno con despachos comisionables, nómina (Carabobo), flete total, neto, pagado y **saldo por pagar**.
   - El detalle lista los despachos pendientes en orden **FIFO** (los más viejos primero).
   - **Pagar:** registra el pago en un libro propio (`pagos_transportistas`); si el monto cubre de más, el sobrante queda como "abono a cuenta". Es **idempotente**: un mismo pago no se registra dos veces.
   - **Revertir pago:** deja marcas de reversión (cuándo y quién) y libera los despachos otra vez.
6. **Protección de lo ya pagado:** si el flete del despacho ya fue liquidado, **no se puede editar** el chofer, el flete ni el destino hasta revertir ese pago (código `FLETE_YA_PAGADO`). Lo mismo aplica al revertir entregas.

### 4.2 Transportista EXTERNO / general

1. **Ficha:** sin la casilla local. El sistema lo describe como "Transportista General: flete directo estándar, sin comisión de nómina local".
2. **Al despachar:** **no exige estado de destino** (por eso el aviso nunca te sale con estos).
3. **Finanzas:** no genera comisión ni saldo que liquidar dentro del sistema; su pago se maneja por fuera. El reporte de transportistas **solo lista locales**, así que un general nunca aparecerá ahí (ni con saldo, ni con deuda).
4. Si se le intentara registrar un pago de flete en el sistema, la base lo rechaza (solo se liquidan comisiones de flete fuera de Carabobo a locales).

### 4.3 Protecciones encontradas (están bien puestas)

- La regla vive en la **base de datos**, no solo en la interfaz: nada puede guardar un flete de chofer local sin estado.
- El **servidor re-valida** antes de crear/editar, leyendo el estado del cliente de la base (no de la caché de pantalla).
- Los fletes **ya pagados** quedan protegidos contra ediciones accidentales.
- La **nómina de Carabobo** jamás entra al libro de pagos de transportistas "por accidente".
- La liquidación es **idempotente** y con reversión registrada (quién, cuándo).

---

## 5. Debilidades detectadas (las que causan el "a veces")

| # | Debilidad | Efecto | Dónde está |
|---|---|---|---|
| A | No hay campo de Estado accesible en el modal de despacho (está detrás del interruptor de dirección alternativa) | Bloqueo sin forma obvia de resolverlo sin salir del flujo | `src/views/CotizacionesView.jsx`, `src/views/VentaRapidaView.jsx`, `src/components/despachos/EditDespachoModal.jsx` |
| B | Caché de 5 minutos de los datos del cliente en la lista de cotizaciones | Bloqueo fantasma justo después de completar el Estado del cliente; se arregla con recargar | `src/hooks/useCotizaciones.js` |
| C | La consulta de datos del cliente degrada a "vacio" si falla | Bloqueo fantasma con clientes que sí tienen Estado | `src/hooks/useCotizaciones.js` (`.catch(() => [])`) |
| D | La pantalla exige Ciudad cuando hay dirección alternativa; la base solo usa el Estado | Bloqueo más estricto que la regla real | `src/views/CotizacionesView.jsx` / `VentaRapidaView.jsx` / `EditDespachoModal.jsx` |

Ninguna de estas corrompe datos ni produce comisiones mal calculadas: el efecto es **bloqueo temporal o confusión**, no dinero mal registrado.

---

## 6. Recomendaciones (por prioridad)

1. **Quitar el bloqueo de encima del interruptor:** mostrar un selector de "Estado del destino" siempre que haya chofer local con flete, aunque la dirección alternativa esté apagada (guardándolo como dato del envío o actualizando la ficha del cliente con confirmación).
2. **Recargar los datos del cliente al abrir el modal de despacho** (o al elegir chofer local con flete), para eliminar la ventana de 5 minutos de la Causa B.
3. **Avisar cuando la carga del cliente falla** en vez de bloquear en silencio (Causa C): un "no se pudieron cargar los datos del cliente — reintentar" es mejor que un requisito que parece cumplido.
4. **Alinear la pantalla con la base:** si el estado del cliente ya existe, exigir solo Estado (no Ciudad) cuando la dirección alternativa está activa.

---

---

## 7. Cierre del caso (2026-10-25, tarde): causa raíz exacta y arreglo aplicado

### En resumen

El error **solo salía desde el botón "Despachar" del aviso de "Cotización enviada
exitosamente"** porque ese camino entregaba al modal únicamente el NOMBRE del
cliente (sin su número de ficha ni su Estado). Con la ficha a la mano, el sistema
ya no pide "Estado del destino": toma el Estado del cliente registrado, salvo que
se elija "¿Enviar a otra dirección?".

### Por qué fallaba un camino y el otro no (el caso auditado)

| Camino para abrir "Crear orden de despacho" | Qué recibía el modal | Resultado |
|---|---|---|
| Desde la ficha de la cotización ("Despachar" directo) | La cotización completa, con `cliente_id` y datos del cliente | ✅ Siempre funcionaba |
| Desde "Cotización enviada exitosamente" → "Despachar" | Solo `{ nombre }` del cliente | ❌ Sin `cliente_id` no se podían refrescar los datos; al elegir chofer local con flete salía el aviso rojo y no dejaba crear el despacho |

El arreglo está en `src/components/cotizaciones/CotizacionBuilder.jsx`: ambos
botones "Despachar" ahora envían el cliente completo (id + estado + ciudad).

### La regla nueva (definitiva)

1. El destino del flete es el **Estado del cliente registrado** (Estado y Ciudad
   son obligatorios al crear un cliente).
2. El selector "Estado del destino" **solo aparece como respaldo** si el cliente
   es legado y no tiene Estado guardado.
3. Con "¿Enviar a otra dirección?" activo, manda el Estado de esa dirección (su
   bloque ya lo pide).
4. Los datos del cliente se refrescan al abrir cada modal (se acabó el bloqueo
   fantasma de la copia vieja de 5 minutos).

### Cómo se verificó

- Prueba de contrato `src/utils/__tests__/fleteEstadoDestinoContract.test.js`
  (16 casos) y prueba de la regla `src/utils/__tests__/fleteDestino.test.js`
  (11 casos): **27/27 en verde en el principal y en staging**.
- Suites completas: principal **756/756** (dos pasadas seguidas) y staging
  **116/116**.
- Los cambios están aplicados en ambos árboles (principal y `construacero-staging`).

---

## Dónde mirar (referencias)

- Regla de negocio en la base: `supabase/migrations/235_comision_flete_fuera_carabobo.sql` (disparador `aplicar_regla_comision_flete`)
- Validación en el servidor: `api/handlers/cotizaciones.js` y `api/handlers/despachos.js` (`validarDestinoFleteLocal`, `errorReglaFlete`)
- Cálculo del neto: `api/lib/transportistaUtils.js`
- Liquidación y reporte: `api/handlers/transportistas.js`, módulo `src/views/TransportistasView.jsx`
- Avisos en pantalla: `src/views/CotizacionesView.jsx` (~línea 493), `src/views/VentaRapidaView.jsx`, `src/components/despachos/EditDespachoModal.jsx`, `src/components/despachos/CambiarTransportistaModal.jsx`
- Clasificación local/general: migraciones `206_transportistas_locales.sql`, `220_transportistas_clasificacion.sql`, `221_transportistas_liquidacion_atomica.sql`
