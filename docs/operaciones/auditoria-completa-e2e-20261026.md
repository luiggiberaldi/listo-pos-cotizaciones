# Auditoría E2E completa, módulo por módulo — 2026-10-26

## En resumen

Esta es la auditoría **completa**: se revisaron **todos los flujos del sistema de punta a punta** (no solo los puntos tocados antes). Se cubrieron las ~110 rutas del servidor y todas las pantallas, agrupadas en 10 módulos: Autenticación, Clientes, Productos/Inventario, Cotizaciones/Venta rápida, Despachos, CxC/Comisiones/Transportistas, Reportes/PDF, Configuración/Proveedores/Tasa de cambio/Push/Logs, Modo sin conexión y Automatización/migraciones.

**Dato clave que cambió las prioridades:** el sistema **solo funciona con internet**. Eso significa que el "modo sin conexión" casi nunca se usa, así que los problemas de esa área bajan de prioridad. En cambio, suben los problemas que pasan **con internet normal**: un corte momentáneo de señal, un tiempo de espera que se agota, o un doble clic.

**Hallazgos principales:**

| # | Problema | Riesgo | ¿Pasa con internet normal? |
|---|----------|--------|------------------------------|
| 1 | Un cliente de **otra cuenta** puede heredar el vendedor "EMPRESA" equivocado al crearse (fuga entre cuentas) | 🟠 Alto | Sí |
| 2 | El **abono manual** (Ficha del Cliente) no tiene llave anti-duplicados: un reintento lo registra dos veces | 🟠 Alto | Sí |
| 3 | Al crear cliente por la parte técnica, **estado y ciudad no son obligatorios** (solo la pantalla los exige) | 🟡 Medio | Sí |
| 4 | La cola de reenvío (para cortes de señal) sigue sin llave anti-duplicados: puede duplicar ventas si la señal falla y vuelve | 🟡 Medio | Solo con cortes de señal |
| 5 | Los reportes se cortan en 5,000 filas **sin avisar** | 🟡 Medio | Sí |
| 6 | Las notificaciones push no validan a quién van dirigidas | 🟡 Medio | Sí |
| 7 | Los archivos PDF temporales se guardan en un espacio público | 🟡 Bajo-Medio | Sí |

**Lo que está bien (revisado y sano):** las 766 pruebas automatizadas pasan; las ~110 rutas del servidor **todas exigen iniciar sesión** (menos la tasa de cambio, que es pública e inocua); las operaciones peligrosas (borrar todo, reiniciar, limpiar inventario) exigen supervisor **y** palabra de confirmación; los pagos a transportistas son atómicos (todo-o-nada) con llave anti-duplicados; el inventario usa operaciones atómicas con llave anti-duplicados; las devoluciones exigen rol, motivo y llave anti-duplicados; los abonos revertidos exigen rol de administración/jefe/desarrollador; y las herramientas de desarrollador están cerradas al resto.

---

## Cómo se hizo esta auditoría

1. Se enumeraron **todas las rutas del servidor** (worker.js) — ~110 rutas.
2. Se verificó, ruta por ruta: ¿exige iniciar sesión?, ¿verifica el rol correcto?, ¿filtra por la cuenta del usuario?, ¿valida los datos que entran?, ¿tiene protección anti-duplicados?
3. Se revisó cada pantalla y su flujo completo (lo que el usuario ve → lo que el servidor hace → lo que se guarda).
4. Se ejecutó la suite completa de pruebas: **73 archivos, 766 pruebas, todas pasando**.

---

## Nivel de riesgo

- 🔴 **Crítico**: daña datos o dinero seguro. (No se encontró ninguno nuevo.)
- 🟠 **Alto**: puede dañar datos en un caso real y frecuente.
- 🟡 **Medio**: da cifras o resultados engañosos, o requiere mala suerte.
- 🟢 **Bien**: revisado y funcionando.

---

## MÓDULO 1 — Autenticación, PIN y operadores 🟢

**Flujos revisados:** login con correo/contraseña, selección de operador con PIN, cambio de operador, cierre de sesión de operador, acceso desarrollador, lista de operadores.

- 🟢 Todas las rutas de operadores exigen sesión y filtran por la cuenta del usuario ([auth-operators.js:62](api/handlers/auth-operators.js#L62)).
- 🟢 El PIN se guarda cifrado (hash + sal) y el cambio de operador tiene límite de intentos por minuto.
- 🟢 El acceso desarrollador exige un código secreto del servidor + sesión iniciada + límite de intentos ([auth-operators.js:157-165](api/handlers/auth-operators.js#L157-L165)).
- 🟢 El sistema de sesiones de operador (12 horas, revocable por token) funciona como fue diseñado.

## MÓDULO 2 — Clientes y Ficha del cliente

### 🟠 2.1 Fuga entre cuentas: el vendedor "EMPRESA" se busca en TODAS las cuentas

**Dónde**: [clientes.js:363](api/handlers/clientes.js#L363) y [clientes.js:451](api/handlers/clientes.js#L451)

Cuando se crea un cliente de tipo "personal", el sistema busca al usuario llamado "EMPRESA" para asignarlo como vendedor. Esa búsqueda **no filtra por cuenta**: si otra empresa (otra cuenta) también tiene un usuario "EMPRESA", se podría tomar el de la otra cuenta. Un cliente quedaría asociado a un vendedor ajeno.

**Arreglo sugerido**: agregar el filtro `cuenta_id=eq.${user.id}` a esa búsqueda (2 líneas).

### 🟡 2.2 Estado y ciudad no son obligatorios en el servidor

**Dónde**: [clientes.js:378-380](api/handlers/clientes.js#L378-L380)

La pantalla sí exige el estado ([ClienteForm.jsx:186](src/components/clientes/ClienteForm.jsx#L186)), pero el servidor acepta crear clientes con estado y ciudad vacíos (como pasó con el cliente de prueba detectado antes). Cualquier integración o llamada técnica podría crear clientes incompletos.

**Arreglo sugerido**: rechazar en el servidor la creación sin estado y sin ciudad, igual que exige el nombre.

### 🟠 2.3 El abono manual no tiene llave anti-duplicados

**Dónde**: [FichaClienteModal.jsx:65-73](src/components/clientes/FichaClienteModal.jsx#L65-L73) → [cxc.js:25-29](api/handlers/cxc.js#L25-L29)

El servidor protege los abonos contra duplicados **solo si** el que envía manda la llave. El cuadre de pagos de despachos sí la manda; el abono manual de la ficha del cliente **no** (el propio servidor lo documenta: "llamadas sin idempotencia, p.ej. abonos manuales de FichaCliente"). Con internet normal: el tiempo de espera se agota a los 15 segundos, el usuario ve error y vuelve a pulsar → **el abono queda doble**.

**Arreglo sugerido**: generar la llave al abrir el formulario y enviarla (el servidor ya la acepta).

### 🟢 Lo demás de Clientes

- Todas las consultas filtran por la cuenta del usuario (nadie ve clientes ajenos).
- RIF duplicado se detecta al crear/editar.
- Reasignación de vendedor, borrado, activación y préstamos: validados y con rol.
- El formulario exige nombre, RIF, teléfono, estado y categoría.

## MÓDULO 3 — Productos, precios e Inventario 🟢

**Flujos revisados:** crear/editar/borrar producto, precios 1-3 y sus habilitadores, precios masivos, importación masiva (batch-ingest), ingreso por lotes, movimientos de inventario, reversión de movimientos, transformaciones, búsqueda híbrida, limpieza de inventario.

- 🟢 **Regla de precio 0/vacío**: bloqueada con sonido y aviso, cubierta por pruebas ([preciosCeroYVacios.test.js](api/handlers/__tests__/preciosCeroYVacios.test.js)).
- 🟢 Movimientos de inventario: operación **atómica** (todo-o-nada) vía función de la base, con llave anti-duplicados obligatoria ([inventario.js:132](api/handlers/inventario.js#L132)) y cantidades validadas (> 0).
- 🟢 Reversión de movimientos: idempotente (revertir dos veces no deshace dos veces) y con llave obligatoria.
- 🟢 Importación masiva **no pisa precios existentes** (pruebas `batchIngestNoPisaPrecios`).
- 🟢 Guardas contra stock negativo en la base de datos.
- 🟢 La limpieza de inventario exige supervisor + palabra de confirmación exacta + llave anti-duplicados.

## MÓDULO 4 — Cotizaciones y Venta rápida

### 🟡 4.1 La cola de reenvío (por cortes de señal) puede duplicar ventas

**Dónde**: [sw.js:60-110](src/sw.js#L60-L110), [useVentaRapida.js:55-57](src/hooks/useVentaRapida.js#L55-L57)

Aunque el sistema solo funciona con internet, si la señal falla un momento (típico en móviles), la venta se guarda en una cola para reenviarla. Al reenviar, **no lleva llave anti-duplicados**: si el primer intento sí llegó al servidor pero la respuesta se perdió, el reenvío la crea otra vez. Como el modo sin conexión casi no se usa, el riesgo es bajo-medio, pero el arreglo es el mismo del problema 2.3.

**Arreglo sugerido**: llave única por venta desde la cola (el servidor de ventas debería aceptarla igual que CxC).

### 🟢 Lo demás de Cotizaciones y Venta rápida

- Guardar cotización valida cada artículo (nombre, cantidad > 0, precio ≥ 0) ([cotizaciones.js:73-75](api/handlers/cotizaciones.js#L73-L75)).
- Vendedores de prueba validados contra la cuenta autenticada.
- Estados de cotización controlados (solo se despacha lo enviado/aceptado).
- La regla de precio 0 aplica también aquí.

## MÓDULO 5 — Despachos 🟢

**Flujos revisados:** crear despacho desde cotización, cambio de estado, edición profunda de artículos, devoluciones parciales e intercambios, códigos externos, descuentos, conciliación COD, edición de pago entregado, reciclaje.

- 🟢 **Todas** las mutaciones de despachos verifican el origen de la petición (8 rutas con `isSameOriginRequest`).
- 🟢 Crear despacho: valida cotización existente, sin duplicado de nota de despacho, estado correcto, dueño de la cotización, montos de flete/corte, saldo a favor suficiente y días de vencimiento obligatorios para crédito.
- 🟢 Devolución parcial: exige rol (administración/logística/jefe/desarrollador), motivo obligatorio, llave anti-duplicados, y valida cantidades y precios de los intercambios ([despachos.js:2196-2250](api/handlers/despachos.js#L2196-L2250)).
- 🟢 COD: conciliación con montos validados y mezcla de formas de pago controlada.
- 🟢 Pruebas de contrato: `despachosReversionRelease17`, `editarItemsRetiraDevoluciones`, `codigosExternos`, `cod.test`.

## MÓDULO 6 — CxC, Comisiones y Transportistas 🟢

**Flujos revisados:** abono, revertir abono, revertir cargo, saldo a favor, cruce de saldo, devolución de crédito, pago a transportista, reversión de pago, designación de vendedor del día, listado y resumen de comisiones.

- 🟢 Revertir abonos/cargos: solo administración, jefe o desarrollador + verificación de origen + validación de que la transacción sea reversible + salvaguardas (ej. no revertir un consumo de crédito ya conciliado) ([cxc.js:188-218](api/handlers/cxc.js#L188-L218)).
- 🟢 Pago a transportista: montos validados (hasta 4 decimales, tope de seguridad), **operación atómica** vía función `liquidar_transportista` con llave anti-duplicados, y reversión también atómica.
- 🟢 Designar vendedor del día: **solo el jefe** (regla del negocio), y el designado se valida contra la cuenta.
- 🟡 (único pendiente menor) El contrato de pruebas del E2E de staging no contempla el monto excluido en la liberación de comisiones; afecta cobertura de pruebas, no datos.

## MÓDULO 7 — Reportes y PDF

### 🟡 7.1 Cortes silenciosos a 5,000 filas

**Dónde**: [useReportePipeline.js:33](src/hooks/useReportePipeline.js#L33), [useReporteVendedores.js:64-70](src/hooks/useReporteVendedores.js#L64-L70)

Los reportes cortan la lectura en 5,000 registros (para evitar que la base corte en 1,000 sin avisar), pero **nadie avisa al usuario** cuando eso pasa: las cifras parecen completas y no lo son.

**Arreglo sugerido**: mostrar "mostrando 5,000 de N — acota las fechas" cuando se alcanza el tope.

### 🟡 7.2 PDFs temporales en espacio público

**Dónde**: [inventario.js:13-45](api/handlers/inventario.js#L13-L45)

Los PDF temporales (órdenes, facturas) se suben a un espacio de almacenamiento **público**: cualquiera con la URL podría verlos. Subir exige iniciar sesión, pero la URL no.

**Arreglo sugerido**: mover el bucket a privado y servir los PDF con enlace firmado de corta duración, o purgar los archivos al rato (ya hay una rutina de purga similar para imágenes de seguimiento).

### 🟢 Lo demás de Reportes

- Todos los reportes filtran por la cuenta del usuario.
- Los PDFs de CxC y órdenes de despacho están cubiertos por pruebas de contrato.

## MÓDULO 8 — Configuración, Proveedores, Tasa de cambio, Push y Logs

### 🟡 8.1 Push sin validar el destino

**Dónde**: [push.js:89-103](api/handlers/push.js#L89-L103)

El destino (`targetUserId`/`targetRole`) se pega tal cual en el filtro de la base sin comprobar que sea un identificador o rol válido. Exige sesión y tiene límite de envíos por minuto, así que el riesgo es acotado.

**Arreglo sugerido**: validar formato de identificador y lista de roles conocidos.

### 🟢 Lo demás

- **Configuración del negocio**: solo supervisores/jefe/administración/desarrollador, con validación de los campos de comisión split (rechaza valores inválidos en vez de guardarlos).
- **Proveedores y Cuentas por Pagar**: validación de RIF, montos > 0, tipos de transacción permitidos y roles.
- **Tasa de cambio (BCV)**: ruta pública sin datos sensibles, con 4 fuentes de respaldo y caché (correcto que sea pública).
- **Logs del sistema**: exige sesión; ver, descargar y purgar exigen supervisor. El análisis AI está deshabilitado permanentemente (403).
- **Herramientas desarrollador** (`/api/dev/`): solo rol desarrollador.

## MÓDULO 9 — Modo sin conexión / Service Worker 🟡

Véase el hallazgo 4.1 (la cola de reenvío sin llave anti-duplicados). Dado que el sistema **solo funciona con internet**, este módulo es casi decorativo hoy; se recomienda igualmente el arreglo por si la señal falla un momento. El resto del SW está bien: nunca intercepta la API ni autenticación (todo va siempre a la red), y limpia las cachés viejas al actualizar.

## MÓDULO 10 — Automatización, CI y migraciones 🟢

- 🟢 **Pruebas automatizadas**: 73 archivos, **766 pruebas, todas pasando** (2026-10-26).
- 🟢 **Tareas nocturnas** (Auditor de saldos y E2E de staging): reparadas en intervenciones anteriores y corren en la suite actual.
- 🟢 **Migraciones**: cada release lleva su respaldo, checksums (SHA-256), preflight y postflight de solo lectura, y script de reversión. Los scripts de aplicación tienen guardia de proyecto (nunca apuntan a producción por accidente).

---

## Plan de arreglo sugerido (orden de prioridad)

| # | Qué arreglar | Riesgo | Esfuerzo | ¿Dónde? |
|---|--------------|--------|----------|---------|
| 1 | Filtrar la búsqueda "EMPRESA" por cuenta (2 líneas) | 🟠 | Mínimo | servidor |
| 2 | Llave anti-duplicados en el abono manual de la ficha | 🟠 | Bajo (el servidor ya la acepta) | pantalla + servidor |
| 3 | Exigir estado y ciudad al crear cliente en el servidor | 🟡 | Mínimo | servidor |
| 4 | Llave anti-duplicados en la cola de reenvío (ventas/cotizaciones) | 🟡 | Medio | pantalla + servidor |
| 5 | Aviso cuando un reporte se corta en 5,000 filas | 🟡 | Bajo | pantalla |
| 6 | Validar destino de notificaciones push | 🟡 | Bajo | servidor |
| 7 | PDFs temporales privados o con purga automática | 🟡 | Medio | servidor |

---

*Auditoría E2E completa del 2026-10-26 sobre la rama `main`. Cobertura: ~110 rutas del servidor revisadas una por una, los 10 módulos de pantallas, y la suite completa de pruebas (73 archivos / 766 pruebas pasando). Solo lectura: no se modificó ningún dato de producción. Prioridades ajustadas al hecho de que el sistema opera únicamente con internet.*
