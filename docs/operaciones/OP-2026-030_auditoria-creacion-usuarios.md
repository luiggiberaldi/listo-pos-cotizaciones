# OP-2026-030 — Auditoría de la creación de usuarios nuevos (de punta a punta)

**Fecha:** 17 de noviembre de 2026 · **Tipo:** revisión + corrección · **Estado:** auditoría terminada. Los 3 asuntos medianos (3.1, 3.2 y 3.3) están **corregidos y probados en staging** (ver sección 8). **Producción sin cambios**; el problema serio (2.1) sigue abierto.

---

## Actualización 17-nov-2026 — corrección en staging

- **Hecho en staging** (la copia de pruebas, carpeta `construacero-staging/`):
  1. Al crear un usuario ahora se pide **"Repite el PIN"**. Si no coincide, no deja guardar.
  2. **No se pueden crear dos usuarios con el mismo nombre**: "José Pérez", "jose perez" y " JOSÉ  PÉREZ " cuentan como el mismo. Vale también al cambiarle el nombre a alguien. Si el repetido está desactivado, el mensaje sugiere reactivarlo.
  3. **Doble clic y reintentos** ya no duplican: la pantalla ignora el segundo clic y el servidor rechaza el segundo intento.
  4. **Pruebas automáticas nuevas**: 23 pruebas de esta función, más un guion que lo prueba de verdad contra la base de staging.
- **Resultado:** 336 de 336 pruebas pasan, la construcción funciona y la prueba real en staging dio **9 de 9**, sin dejar usuarios de prueba.
- **Pendiente:** ver la pantalla nueva con mis propios ojos (no pude entrar al navegador, ver 8.4); pasar el cambio a la copia principal; publicar en producción.

---

## En resumen

- **Crear un usuario funciona.** El camino completo (pantalla → servidor → base de datos → el usuario aparece en la lista de inicio y puede entrar con su PIN) está bien armado: el PIN se guarda cifrado, el código (ej. `V-7K2P`) no se repite y queda registro en Auditoría.
- **Hay un problema de seguridad serio:** el servidor deja que **Administración** cree usuarios, y con **cualquier rol, incluso "Jefe"**. La pantalla de Usuarios se lo esconde, pero el servidor no lo bloquea. Alguien de Administración con algo de conocimiento técnico podría crearse un "Jefe" y ganar todos los permisos.
- **Hay tres asuntos medianos:** no se pide repetir el PIN al crear (un error de dedo deja al usuario sin poder entrar), se pueden crear **dos usuarios con el mismo nombre** (incluso por doble clic si la conexión va lenta) y **no existe ninguna prueba automática** de esta función.
- **Lo que no cubrí:** no creé usuarios de verdad. La herramienta de base de datos que tengo conectada apunta a otro proyecto ("nube-pruebas"), no a construacero; revisé el código, las reglas guardadas en los archivos del proyecto y el respaldo de producción del 16 de agosto.

---

## 1. Cómo funciona hoy (el recorrido completo)

Una analogía: es como dar de alta a un empleado nuevo en la portería. El jefe llena la ficha (pantalla), el portero revisa que quien la entrega tenga permiso (servidor) y la archiva en el registro oficial (base de datos).

1. **Pantalla** — Usuarios → "Nuevo usuario" (`src/views/UsuariosView.jsx`, formulario `FormCrear`). Solo la ven **Jefe y Desarrollador** (`src/App.jsx:402`). Se llena nombre, teléfono, PIN (4 dígitos para vendedores, 6 para el resto), rol, color y si es vendedor externo.
2. **Envío** — `src/hooks/useUsuarios.js` → `src/services/supabase/adminClient.js` mandan la ficha al servidor (el "Worker") en `/api/admin/users`.
3. **Servidor** — `api/handlers/admin.js:40`:
   - comprueba que hay sesión y que quien pide es **Jefe, Administración o Desarrollador**;
   - revisa que haya nombre, rol válido y PIN del largo correcto;
   - **cifra el PIN** (nunca se guarda tal cual);
   - genera un **código único** según el rol (`V-`, `S-`, `J-`, `A-`, `L-`, `D-`) que no choque con otro de la misma empresa;
   - guarda el usuario en la tabla `usuarios` y anota **"CREAR_USUARIO"** en Auditoría.
4. **Base de datos** — acepta solo los roles permitidos y no deja repetir un código dentro de la misma empresa.
5. **Primer ingreso** — el usuario nuevo aparece en la lista de "¿Quién eres?" y entra eligiendo su nombre y escribiendo su PIN (`api/handlers/auth-operators.js`). Los intentos fallidos quedan en Auditoría.

## 2. Problema serio

### 2.1 Administración puede crear un "Jefe" (o un "Desarrollador")

- **Qué pasa:** la pantalla de Usuarios solo se muestra a Jefe y Desarrollador, pero el servidor acepta la orden de crear usuarios también de **Administración** (`api/lib/auth.js:147`, `verifyAdminRole`). Además, el servidor **no limita qué rol se puede asignar**: acepta `jefe` y hasta `desarrollador` (este último ni aparece en la pantalla).
- **Lo mismo vale para editar y borrar usuarios** (`PUT` y `DELETE /api/admin/users`): Administración podría subirse de rol a sí misma, cambiarle el PIN a un Jefe o borrar usuarios.
- **Por qué importa:** es como si la puerta del despacho del jefe tuviera cerradura, pero la ventana estuviera abierta. Una persona normal no la usa, pero no hace falta mucho para hacerlo.
- **Arreglo propuesto:** que el servidor use la misma lista que la pantalla (solo Jefe y Desarrollador) para crear, editar y borrar usuarios, y que **nadie que no sea Desarrollador pueda crear o asignar el rol "desarrollador"**.

## 3. Asuntos medianos

### 3.1 No se pide repetir el PIN al crear
- Al **editar** un usuario sí se pide "Confirmar PIN", pero al **crear** no. Si el jefe se equivoca en un dígito, el usuario nuevo no puede entrar y hay que volver a ponerle PIN.
- **Arreglo:** agregar el campo "Confirmar PIN" también al crear.

### 3.2 Usuarios con el mismo nombre (y duplicados por doble clic)
- Ni la pantalla, ni el servidor, ni la base de datos impiden dos usuarios llamados igual. En la lista de "¿Quién eres?" se verían dos "José Pérez" y cada uno con PIN distinto.
- Si la conexión está lenta y la pantalla se rinde a los 15 segundos, el usuario ya pudo haberse creado; al volver a darle "Guardar" se crea **otro igual**.
- **Arreglo:** que el servidor rechace un nombre que ya existe en la empresa (sin importar mayúsculas o espacios) con un mensaje claro.

### 3.3 No hay pruebas automáticas de esta función
- Las pruebas automáticas (programas que revisan solos que todo siga funcionando) cubren despachos, cobros, inventario, etc., pero **ninguna prueba crea un usuario** ni revisa quién tiene permiso. Por eso el problema 2.1 pasó desapercibido.
- Las pruebas que sí existen alrededor (inicio de sesión del operador y conexión con el servidor) **pasan: 73 de 73**.
- **Arreglo:** agregar pruebas que confirmen: Jefe puede crear; Administración, Supervisor y Vendedor no; nadie crea un "desarrollador"; PIN de largo incorrecto se rechaza.

## 4. Asuntos menores

| # | Qué | Efecto |
|---|---|---|
| 4.1 | Un usuario llamado exactamente **"Super Admin"** queda **escondido** de la pantalla de Usuarios (`src/hooks/useUsuarios.js:21` filtra por nombre) pero sí aparece para iniciar sesión. | Un usuario "invisible" para el jefe. Conviene prohibir ese nombre. |
| 4.2 | Si falla el guardado, el mensaje muestra el **texto técnico de la base de datos** (`admin.js`, "Error al crear usuario: …"). | Mensaje confuso para el usuario. |
| 4.3 | Un nombre con solo espacios lo frena la pantalla, pero el servidor lo dejaría pasar y guardaría un nombre vacío. Tampoco hay largo máximo. | Solo por vía técnica directa. |
| 4.4 | El servidor deja marcar "vendedor externo" a cualquier rol (la pantalla sí lo limita a vendedores). | Solo por vía técnica directa. |
| 4.5 | Mensaje viejo en la pantalla: "Falta VITE_SUPABASE_SERVICE_KEY…" (`UsuariosView.jsx`, `UsuarioModal`). Ya no aplica: la llave vive en el servidor. | Código muerto, sin efecto. |
| 4.6 | Al **editar solo el PIN** sin mandar el rol, el servidor asume "vendedor" y exige 4 dígitos (`admin.js`, ruta `PUT`). Hoy la pantalla siempre manda el rol, así que no ocurre. | Trampa para cambios futuros. |
| 4.7 | **Los archivos de instrucciones de la base de datos están desactualizados:** la última regla de roles en `supabase/migrations/096_rol_jefe.sql` no incluye "vendedor_sin_comision". En producción sí está (confirmado en el respaldo del 16-ago-2026, que además admite un rol viejo "trabajador"). | Si alguna vez se reconstruye la base desde esos archivos, crear un "Vendedor sin comisión" fallaría. |

## 5. Lo que está bien

- El PIN se cifra con un método fuerte (PBKDF2 con "sal" única por usuario) y nunca viaja de vuelta a la pantalla.
- La llave maestra de la base de datos vive solo en el servidor, nunca en el navegador.
- Cada empresa solo ve y toca sus propios usuarios (filtro por `cuenta_id`).
- El código del usuario no se repite (lo cuida el servidor y además la base de datos) y no se puede cambiar después.
- Crear, editar, activar/desactivar y borrar quedan registrados en Auditoría.
- Hay un límite de pedidos por minuto en el servidor contra abusos.

## 6. Próximos pasos sugeridos (en orden)

1. **Cerrar el problema 2.1** (servidor: solo Jefe/Desarrollador administran usuarios; "desarrollador" solo lo asigna un Desarrollador) + sus pruebas automáticas (3.3). Probar en staging antes de producción.
2. Agregar "Confirmar PIN" al crear y bloquear nombres repetidos (3.1 y 3.2).
3. Limpiar los menores (4.1 a 4.7) en un solo cambio.

## 7. Estado y verificación

- **Nada se cambió.** Es un informe.
- **Verificado:** lectura del código de pantalla, servidor y base de datos; reglas de roles en el respaldo de producción y staging del 16-ago-2026; pruebas automáticas relacionadas (73/73 pasan).
- **Sin verificar (auditoría):** no se comprobó que la regla de roles de producción siga igual que en agosto.

## 8. Corrección en staging de 3.1, 3.2 y 3.3 (17-nov-2026)

### 8.1 Qué cambió (solo en `construacero-staging/`)

| Archivo | Cambio |
|---|---|
| `src/utils/usuarioValidacion.js` (nuevo) | Reglas compartidas por la pantalla y el servidor: largo del PIN por rol, cómo se comparan los nombres (sin mayúsculas, acentos ni espacios de más), mensaje de nombre repetido, validación del formulario. |
| `src/views/UsuariosView.jsx` | Campo **"Repite el PIN"** con aviso en rojo o verde. Si se cambia a un rol con otro largo de PIN, se vacían ambos campos. Aviso inmediato de nombre repetido. Freno al doble clic. Se quitó el mensaje viejo de "VITE_SUPABASE_SERVICE_KEY" (asunto 4.5). |
| `api/handlers/admin.js` | Antes de crear o renombrar, el servidor busca en la empresa un usuario con el mismo nombre. Si existe, responde "ya existe" (código 409) y no guarda. Si no puede hacer la búsqueda, **no guarda** (código 503: es mejor reintentar que duplicar). El nombre se guarda limpio y se rechaza un nombre hecho solo de espacios (asunto 4.3). |
| `api/handlers/__tests__/crearUsuario.test.js` (nuevo) | 13 pruebas del servidor: crear, repetido en 3 escrituras, desactivado, reintento, base caída, 3 PIN inválidos, nombre en blanco, sin permiso, y 3 de renombrar. |
| `src/utils/__tests__/usuarioValidacion.test.js` (nuevo) | 10 pruebas de las reglas del formulario. |
| `scripts/verify-op030-usuarios-staging.mjs` (nuevo) | Prueba real contra staging (se niega a correr si la base no es la de staging). Crea usuarios "OP030 …", intenta duplicarlos y luego los borra. |
| `.gitignore` (de staging) | Se agregaron los 3 archivos nuevos de prueba para que se guarden en el historial; si no, ese archivo los escondía. |

### 8.2 Resultados

- **Pruebas automáticas de staging:** 336 de 336 pasan (39 archivos).
- **Revisión de código:** los archivos nuevos no tienen avisos. `UsuariosView.jsx` muestra 3 errores en una línea vieja del formulario de edición, sin tocar en este cambio. La construcción (`vite build`) funciona.
- **Prueba real en staging** (servidor local 8789 + base `spupqgkdsgohxxfoxydl`): **9 de 9**.
  1. Crear un usuario nuevo → 201 (creado).
  2. El mismo nombre escrito distinto → 409 "Ya existe un usuario llamado…".
  3. Dos "Guardar" seguidos → el primero se crea y el segundo se rechaza.
  4. Renombrar a un nombre que ya está ocupado → 409.
  5. Guardar sin cambiar el propio nombre → 200.
  6. PIN con un largo que no corresponde al rol → 400.
  7. En la base quedaron exactamente 2 usuarios de prueba (no hubo duplicados).
  8. El usuario nuevo entra con su PIN → 200.
  9. Limpieza: no quedó ningún usuario de prueba.
- El primer intento se cortó con un error pasajero (503) porque el servidor de pruebas se estaba reiniciando. Al repetirlo, todo pasó.

### 8.3 Límites conocidos

- Si dos personas crean el mismo nombre **en el mismo segundo** desde dos equipos, todavía podrían quedar dos. Para cerrarlo del todo haría falta una regla en la base de datos ("índice único"), y antes habría que revisar si producción ya tiene nombres repetidos. Hoy es muy poco probable.
- Si en la base **ya hay** dos usuarios con el mismo nombre, al editar uno de ellos se pedirá cambiarle el nombre.
- Detalle encontrado: en la copia de staging el servidor deja administrar usuarios también a **Supervisor** (`verifySupervisor`). En la copia principal se usa `verifyAdminRole`. No se tocó: es parte del problema serio 2.1.

### 8.4 Pendiente

- [ ] **Revisión visual** de la pantalla "Nuevo usuario" en staging (`http://localhost:5174/usuarios`). No pude entrar: no tengo permiso para leer la contraseña de la cuenta de pruebas y escribirla en el navegador. La lógica de la pantalla sí está cubierta por las 10 pruebas de `usuarioValidacion.test.js`.
- [ ] Pasar el cambio a la copia principal (`src/`, `api/`) y correr ahí sus pruebas.
- [ ] Guardar el cambio en el historial y publicarlo en producción (con número de solicitud de cambio y commit aquí).
- [ ] Problema serio 2.1 (sigue abierto).
