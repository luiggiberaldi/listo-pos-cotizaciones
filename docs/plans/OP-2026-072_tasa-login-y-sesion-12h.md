# OP-2026-072 — Tasa en el login y sesión con PIN persistente por 12 horas

**Fecha:** 2026-11-24 · **Estado:** ✅ **Publicado en producción (2026-11-24)** — Solicitud #75, commit `cc5b0e4c`, unión a `main` `a279b3f2`. No requiere cambios en la base de datos.

## En resumen

- **Tasa en el login idéntica al encabezado post-PIN:** la barra superior de la pantalla de acceso (tanto en el correo/clave como en "¿Quién está operando?") muestra exactamente los mismos indicadores que ves dentro del sistema al ingresar tu PIN (**BCV**, **EUR**, **USDT** y la pastilla de **tasa activa** USDT o Manual en modo solo lectura), conservando intacto el diseño de [OP-2026-031](../operaciones/OP-2026-031_pantalla-quien-opera.md).
- **Sesión de 12 horas automática tras ingresar el PIN:** como hoy cada persona usa su propio equipo (sin equipos compartidos), el pase de 12 horas que emite el servidor se guarda en el dispositivo. Si **recargas la página (F5)**, **cambias a WhatsApp**, **abres otra pestaña** o **cierras y vuelves a abrir el navegador/app**, sigues adentro sin volver a poner el PIN hasta que pasen las **12 horas** o toques **"Cerrar sesión"**.
- **Verificación de seguridad al reabrir:** cada vez que la app despierta o recarga, valida en un instante con el servidor que el usuario siga activo y que no le hayan cambiado el PIN. En el aviso de nueva versión ahora se indica que puedes actualizar sin perder tu sesión de 12 horas.
- **Botón claro de salida:** dentro del sistema ahora dice **"Cerrar sesión"** (en PC y celular); al tocarlo, anula las 12 horas en el teléfono, en el servidor y en cualquier otra pestaña abierta, y regresa a "¿Quién está operando?". El botón rojo **"Salir"** de la cuenta de la empresa en el login ahora pide confirmación para evitar cierres por error.

---

## 1. Lo que hoy hace el sistema (punto de partida)

### Cómo funciona la pantalla de acceso hoy
La entrada al sistema tiene dos pasos:
1. **Correo y contraseña de la empresa** (normalmente se hace una sola vez por equipo y queda recordado).
2. **Pantalla "¿Quién está operando?"** (donde cada persona toca su nombre y escribe su PIN de 4 o 6 dígitos).

### Cómo funcionan las tasas hoy
- El sistema consulta la **tasa BCV** (oficial, dólar y euro) desde el servidor propio (`/api/rates`), y la **tasa USDT** desde Binance P2P (redondeada hacia arriba + 2 Bs). Ninguna de esas dos requiere que alguien haya puesto su PIN todavía.
- Además, la administración o el jefe pueden fijar una **tasa manual** para toda la empresa. Hoy ese dato se consulta a través de una ruta que **exige haber entrado con PIN antes**. En la pantalla de correo y clave todavía no se sabe qué empresa está entrando; en la pantalla **"¿Quién está operando?"** la empresa ya está identificada y el servidor sí puede entregar solo la tasa configurada sin mostrar datos privados del negocio.

### Por qué hoy se pierde la sesión del PIN aunque ya dure 12 horas
- **En el servidor (base de datos):** cada vez que alguien entra con su PIN, se crea un pase válido por **12 horas** (hasta que expire o el usuario salga).
- **En el celular o computadora:** por seguridad de equipos compartidos, ese pase se guarda únicamente en la **memoria temporal de la pestaña** (como tener un carné en la mano sin guardarlo en la cartera: si recargas la página, cierras la ventana o el celular duerme la app mientras respondes un WhatsApp, la memoria se limpia y te vuelve a pedir el PIN).

---

## 2. Evaluación: ¿es buena idea?

### A. Mostrar la tasa en el menú de login — ✅ Sí, muy buena idea
- **Ventaja:** vendedores, administración y gerencia pueden consultar la tasa del día al abrir la app sin tener que escribir el PIN solo para ver un número.
- **Cuidados necesarios:**
  1. **Solo lectura:** antes del PIN nadie debe poder cambiar la tasa manual de la empresa.
  2. **Sin dañar el espacio en pantalla:** en la pantalla "¿Quién está operando?" (caso [OP-2026-031](../operaciones/OP-2026-031_pantalla-quien-opera.md)) se cuidó que todas las tarjetas entren sin tener que bajar (*scroll*) en teléfonos, tabletas y PC. La tasa debe ir en una pastilla o barra muy compacta.
  3. **Dato real si usan tasa manual:** en "¿Quién está operando?" conviene consultar al servidor si la empresa tiene tasa manual activa, para no mostrar USDT cuando la empresa fijó una tasa manual en otro equipo.

### B. Sesión de 12 horas al iniciar con PIN — ⚖️ Depende del equipo
| Situación | ¿Conviene? | Qué pasa en la práctica |
|---|---|---|
| **Teléfono o laptop personal** (vendedor en la calle, jefe en su celular) | ✅ **Excelente idea** | Si cambias a WhatsApp, recargas la página o cierras y abres la app durante el día, entras directo sin poner el PIN 10 veces al día. |
| **Computadora compartida** (oficina, mostrador, almacén) | ⚠️ **Riesgo alto si queda abierto** | Si Administración o el Jefe cierra el navegador sin tocar **"Cambiar usuario"**, 2 horas después otro empleado abre esa PC y entra directo con permisos de Administración/Jefe. Además, todas las ventas, aprobaciones o abonos quedarían anotados en la auditoría a nombre de la persona equivocada. |

**Un punto bueno de seguridad que ya existe:** si un empleado pierde el teléfono o deja la empresa, al cambiarle su PIN o desactivarlo en *Usuarios*, el servidor rechaza su sesión de 12 horas **al instante** en la siguiente acción, aunque no haya cerrado sesión.

**Un detalle importante de las salidas:** hoy dentro de la app el botón se llama **"Cambiar usuario"** (abajo en el menú lateral). Si la sesión sobrevive al cierre del navegador durante 12 horas, conviene que el botón diga claramente **"Cerrar sesión"** (o **"Cerrar sesión / Cambiar usuario"**) para que nadie dude cómo cerrar su turno.

---

## 3. Qué proponemos (actualizado: sin equipos compartidos)

Como hoy cada persona trabaja en su propio teléfono o computadora, **no hace falta complicar el login con casillas ni preguntas adicionales**. La propuesta queda directa en 4 piezas:

### 1) Tasa visible en la pantalla "¿Quién está operando?"
- Mostrar una **pastilla/barra compacta (solo lectura)** con la **tasa activa** del negocio (USDT o Manual si la empresa fijó una tasa manual) y la **tasa BCV** (y Euro en computadoras grandes si cabe sin apretar).
- Agregar una ruta mínima en el servidor para consultar **solo** si la empresa tiene tasa manual activa (sin exponer clientes, ventas ni otros datos antes del PIN).
- Mantener el diseño **sin desplazamiento (sin scroll)** en celular, tablet y PC.

### 2) Sesión de 12 horas automática al entrar con el PIN
- Guardar en el almacenamiento del navegador/teléfono el pase de **12 horas** que el servidor ya emite hoy.
- Así, si la persona **recarga la página**, **cambia a WhatsApp y regresa**, **abre otra pestaña** o **cierra la app y la abre más tarde**, sigue adentro durante esas 12 horas sin volver a teclear el PIN.
- Al cumplirse las 12 horas exactas desde que puso el PIN (por ejemplo, al empezar la jornada del día siguiente), la sesión vence sola y vuelve a pedir el PIN.

### 3) Verificación de seguridad cada vez que la app despierta o se recarga
- Antes de mostrar datos tras recargar o reabrir la app, el sistema pregunta en silencio al servidor: *"¿Este pase de 12 horas sigue vigente y el usuario sigue activo?"*.
- Si en la oficina desactivaron a un vendedor o le cambiaron el PIN, su sesión se cierra de inmediato aunque no hayan pasado las 12 horas.
- Si el teléfono está **sin internet**, solo deja ver lo básico que ya tenía permiso para modo sin conexión mientras no hayan vencido las 12 horas.
- Cuando se publique una **actualización nueva**, el usuario podrá tocar *"Actualizar ahora"* sin miedo a que le pida el PIN de nuevo (y el aviso se ajustará para no decir lo contrario).

### 4) Botones de salida claros (para no confundir cerrar sesión con sacar la empresa)
- Dentro de la app (menú lateral): renombrar **"Cambiar usuario"** a **"Cerrar sesión"**. Al tocarlo, anula el pase de 12 horas en el teléfono y en el servidor, y regresa a **"¿Quién está operando?"** (también cierra otras pestañas abiertas en el mismo navegador).
- En la pantalla **"¿Quién está operando?"**: el botón rojo **"Salir"** (que saca el correo y contraseña de la empresa y obliga a escribirlos de nuevo) pedirá una pequeña confirmación para evitar toques accidentales.

*(Nota a futuro: si algún día ponen una computadora compartida en almacén o mostrador, en ese momento se puede agregar la casilla "Este es un equipo compartido" sin deshacer nada de esto).*

---

## 4. Qué se cambió en staging (`construacero-staging/`)

No hizo falta ninguna migración nueva en la base de datos: la tabla `operator_sessions` (migración 241) ya emitía sesiones de **12 horas**.

| Pieza | Cambio realizado |
|---|---|
| `api/handlers/auth-operators.js` y `worker.js` | Nuevas rutas `GET /api/auth/current-operator` (valida el pase de 12 h al recargar/reabrir y devuelve el perfil actualizado) y `GET /api/auth/tasa-config` (entrega únicamente `tasa_bcv_manual` a la pantalla de tarjetas antes del PIN, sin exponer datos privados). |
| `src/services/operatorSession.js` | Guarda el pase de 12 h en `localStorage` separado por proyecto (`construacero_operator_session_spupqgkdsgohxxfoxydl`), lo restaura al recargar si no venció y sincroniza el cierre de sesión entre pestañas abiertas. |
| `src/store/useAuthStore.js` | Al abrir o recargar la app, restaura el operador validando con `/api/auth/current-operator` (con renovación automática del token de empresa si caducó tras varias horas y soporte sin internet cuando hay perfil en caché dentro de las 12 h). Si el servidor responde 401/403 (sesión cerrada o PIN cambiado), limpia todo y pide PIN. |
| `src/hooks/useConfigNegocio.js` y `src/hooks/useTasaCambio.js` | Permite leer tasas (BCV, EUR, USDT y Manual de la empresa cuando hay cuenta conectada) antes de ingresar el PIN sin errores de sesión. |
| `src/components/layout/HeaderTasas.jsx`, `AppLayout.jsx` y `LoginPage.jsx` | Se extrajo el bloque de tasas del encabezado a un componente único `HeaderTasas` para que en `/login` se vea **tal cual** como dentro del sistema (modo solo lectura). En el menú lateral se cambió "Cambiar usuario" por **"Cerrar sesión"**, y el botón rojo de salir de la cuenta de empresa ahora pide confirmación. |

---

## 5. Verificación en staging (2026-11-24)

- **Pruebas automáticas nuevas y relacionadas:** `16/16` en verde en 3 archivos (`authOperatorSession12h.test.js` 4/4, `operatorSessionPersistence12h.test.js` 7/7, `LoginPinModal.test.js` 5/5). *(Nota: en la corrida previa de toda la carpeta falló 1 prueba ajena de `fichaYConteoKardex071.test.js` por edición concurrente de OP-071 en archivos de inventario).*
- **Compilación (`npm run build`):** correcta en staging.
- **Revisión de código (`eslint`):** 0 errores en nuestros cambios (solo 2 errores preexistentes en otras líneas de `useConfigNegocio.js` y `LoginPage.jsx`).
- **Prueba real en navegador Chromium (PC `1280×800` y celular `390×844` contra `localhost:5174` + Worker `8789`):** guion `construacero-staging/scripts/verify-op072-login-tasa-y-sesion12h-staging.mjs` — **13/13 comprobaciones en verde**:
  - Header de tasas visible en correo/clave y en "¿Quién está operando?" idéntico al header post-PIN (verificado visualmente en capturas PC y móvil).
  - Tasa Manual de prueba (`77,77`) reflejada en el login antes del PIN (y restaurada después).
  - Sesión guardada con duración de **12,00 h**.
  - Recarga (`F5`) en `/cotizaciones` y apertura de una segunda pestaña mantienen la sesión sin pedir PIN.
  - Botón **"Cerrar sesión"** cierra todas las pestañas, limpia `localStorage`, revoca en el servidor (403 posterior) y recargar sigue pidiendo PIN.
  - Operador temporal y datos de prueba limpiados al terminar.

---

## 6. Paso a producción (código principal listo)

Tras tu aprobación, se portaron los mismos cambios al código principal (`src/`, `api/`, `worker.js`), adaptando las referencias propias de producción y manteniendo íntegro el diseño de [OP-2026-031](../operaciones/OP-2026-031_pantalla-quien-opera.md):

| Pieza | Qué se actualizó en producción |
|---|---|
| `api/handlers/auth-operators.js` y `worker.js` | Rutas `GET /api/auth/current-operator` (valida la sesión de 12 h al recargar/reabrir y devuelve el perfil vigente) y `GET /api/auth/tasa-config` (entrega únicamente `tasa_bcv_manual` y su fecha antes del PIN). |
| `src/services/operatorSession.js` y `src/store/useAuthStore.js` | Persistencia de la sesión de PIN por 12 h por proyecto, validación con renovación automática del token de empresa si caducó, soporte sin conexión mientras siga vigente y cierre sincronizado entre pestañas. |
| `src/hooks/useConfigNegocio.js` y `src/hooks/useTasaCambio.js` | Consulta de tasa BCV, EUR, USDT y Manual de la empresa también en el menú de acceso antes del PIN. |
| `src/components/layout/HeaderTasas.jsx`, `AppLayout.jsx`, `LoginPage.jsx` y `src/components/ui/AvisoVersionNueva.jsx` | Encabezado de tasas idéntico en el login (solo lectura), botón **"Cerrar sesión"**, confirmación al tocar **"Salir"** de la empresa y aviso de nueva versión adaptado a las 12 horas. |
| Base de datos (Supabase) | **Sin cambios necesarios:** la tabla `operator_sessions` (migración 241) ya trabaja con vigencia de 12 horas. |

### Verificación en el código principal (producción local)

- **Batería completa de pruebas (`npm test`):** **125 archivos / 1.243 pruebas en verde** (incluidas 4 nuevas pruebas de servidor en `api/handlers/__tests__/authOperatorSession12h.test.js`, 7 nuevas pruebas de persistencia de 12 h en `src/utils/__tests__/operatorSessionPersistence12h.test.js` y las 46 pruebas existentes de `operatorSessionIntegration.test.js`).
- **Compilación (`npm run build`):** correcta (`dist/` y paquete de aplicación instalable con 84 archivos precargados).
- **Revisión de calidad (`eslint`):** 0 errores nuevos en los archivos creados o modificados (solo 1 aviso previo sin relación en otra línea de `LoginPage.jsx`).
- **Vista previa visual del paquete compilado en navegador (con datos simulados, sin tocar producción):** barra de tasas visible arriba idéntica al sistema tras el PIN tanto en PC (`1280×800`) como en celular (`375×812`), sin solapamientos sobre el logo ni el cuadro "¿Quién está operando?".

### Despliegue en producción y verificación en vivo (2026-11-24)

1. **Solicitud de cambio #75** (`feat/op-072-tasa-login-sesion-12h`, commit `cc5b0e4c`) unida a `main` en `a279b3f2`.
2. **Cloudflare Worker (`Deploy Worker a Cloudflare`, ejecución `45543668259`):** completado en verde (58 s).
3. **Vercel (producción):** despliegue en `success` sobre `a279b3f2`.
4. **Comprobaciones reales en el sitio publicado (`listo-pos-cotizaciones.vercel.app` y Worker):**
   - `GET /` → `200 OK`.
   - `GET /api/ping` → `200 OK` (`ok`).
   - `GET /api/rates` → `200 OK`.
   - `GET /api/auth/current-operator` y `GET /api/auth/tasa-config` sin sesión → `401 No autenticado` (confirma que ambas rutas nuevas están activas y protegidas; pendiente únicamente probar el inicio de sesión de 12 h desde un usuario real en el navegador de producción).
5. **Base de datos:** no requirió ningún cambio ni archivo SQL nuevo (`operator_sessions` de la migración 241 ya trabaja a 12 horas).
