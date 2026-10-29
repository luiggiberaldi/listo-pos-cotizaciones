# Auditoría a profundidad — Fuga entre cuentas con el vendedor "EMPRESA" (2026-10-26)

## En resumen

Se investigó a fondo el hallazgo 🟠 de la auditoría general. **Conclusión: el problema es real, hoy NO hay datos dañados, pero la trampa está cargada** — y descubrimos que el mismo fallo se repite en **3 lugares más** que no habíamos visto.

**Traducido:**

1. **Hoy no hay ningún cliente cruzado**: hay solo un usuario "EMPRESA" en todo el sistema (6 clientes personales bajo él, todo correcto). Nada está roto en este momento.
2. **Pero sí existen 2 cuentas (empresas) en el sistema**, y el código busca al usuario "EMPRESA" **sin decir de cuál cuenta**. El día que la segunda cuenta cree su propio "EMPRESA", el sistema escogerá **al azar** entre los dos, y un cliente podría quedar con un vendedor de otra empresa. Eso afectaría comisiones y permisos de venta.
3. **El mismo descuido aparece en 3 flujos más**: reasignar un cliente a un vendedor, reasignación masiva, y reciclar cotizaciones — todos aceptan un "vendedor destino" **sin comprobar que pertenezca a la cuenta**. Esos sí permitirían un cruce hoy mismo, si alguien pasara el ID de un usuario de la otra cuenta.
4. **La base de datos no tiene red de seguridad** para esto: no existe ninguna regla que diga "el vendedor de un cliente debe ser de la misma cuenta".

**Riesgo real:** no se pierden ni borran datos, pero las **comisiones se pagarían a la persona equivocada** y los permisos de venta (quién puede despachar a qué cliente) se confundirían.

---

## 1. El código exacto del problema

### 1.1 La búsqueda "EMPRESA" sin filtro de cuenta (2 lugares)

**Dónde**: [clientes.js:363](api/handlers/clientes.js#L363) (al crear cliente) y [clientes.js:451](api/handlers/clientes.js#L451) (al mover un cliente a tipo "personal")

```js
const empRes = await fetch(
  `${env.SUPABASE_URL}/rest/v1/usuarios?nombre=ilike.EMPRESA&activo=eq.true&select=id`,
  { headers }
)
... finalVendedorId = empUsers[0].id   // ← toma el primero, sin orden ni filtro
```

**Dos defectos en esa línea:**

- **Falta `cuenta_id=eq.${user.id}`**: busca "EMPRESA" en **todas las cuentas** del sistema. Si hay dos (una por empresa), no hay forma de saber cuál vendrá primero — la base no garantiza orden, así que es **al azar**.
- **Se usa con llave maestra**: los `headers` que usa esta consulta son de servicio (llave maestra de la base, [auth.js:14-21](api/lib/auth.js#L14-L21)), que **no respeta los límites entre cuentas**. Por eso la consulta sí ve usuarios ajenos; si usara la sesión normal del usuario, la propia base los escondería.

**Nota**: el resto del código del mismo archivo sí filtra bien (el chequeo de RIF, la lista de clientes, etc., todos llevan `cuenta_id`). Este es un descuido puntual, no un diseño errado.

### 1.2 El mismo descuido en 3 flujos más (hallazgo nuevo de esta auditoría)

Todos validan que el "vendedor destino" exista, pero **no que sea de la cuenta del usuario**:

| Flujos | Dónde | Riesgo |
|--------|-------|--------|
| Reasignar cliente a otro vendedor | [clientes.js:186](api/handlers/clientes.js#L186) | Un administrador podría reasignar su cliente a un usuario **de la otra empresa** |
| Reasignación masiva (mover todos los clientes de un vendedor a otro) | [clientes.js:543](api/handlers/clientes.js#L543) | Ídem, pero en masa |
| Reciclar cotización (moverla a otro vendedor) | [cotizaciones.js:226](api/handlers/cotizaciones.js#L226) | Una cotización quedaría con vendedor ajeno |

```js
// clientes.js:186 — acepta CUALQUIER usuario activo, de cualquier cuenta
const vRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${nuevoVendedorId}&activo=eq.true&select=id`, { headers })
```

**Ojo**: estos flujos exigen rol administración/jefe/desarrollador y registro de auditoría, así que no es un agujero abierto a cualquiera; pero un operador con ese rol podría hacerlo sin darse cuenta (por ejemplo, pegando un ID equivocado), y el sistema no lo frenaría.

### 1.3 La base de datos no valida la relación vendedor ↔ cuenta

**Dónde**: [104_tenant_isolation_restrictive.sql](supabase/migrations/104_tenant_isolation_restrictive.sql)

Existe una red de seguridad general (aislamiento por `cuenta_id` en las tablas) y un relleno automático de `cuenta_id`, **pero ninguna regla que compruebe que `vendedor_id` pertenezca a la misma cuenta que el cliente**. La llave foránea `clientes_vendedor_id_fkey` solo comprueba que el usuario exista, no que sea de la misma empresa. Es decir: si el servidor llegara a mandar un vendedor ajeno, la base lo aceptaría sin protestar.

---

## 2. Estado real de los datos (producción, solo lectura)

Consultas ejecutadas el 2026-10-26 contra producción (solo lectura):

| Pregunta | Resultado |
|----------|-----------|
| ¿Cuántos usuarios "EMPRESA" hay? | **1** (cuenta principal, rol vendedor_sin_comision, activo) |
| ¿Cuántos clientes personales hay y bajo quién? | **6, todos bajo ese único EMPRESA** ✅ |
| ¿Hay clientes con vendedor de otra cuenta? | **0** ✅ nada cruzado hoy |
| ¿Cuántas cuentas (empresas) existen? | **2**: la principal (8 usuarios) y una cuenta de desarrollo (4 usuarios) |

**Lectura**: el sistema ya es multi-empresa (2 cuentas). Mientras la segunda cuenta no cree un usuario llamado "EMPRESA", la ruleta no se dispara; pero basta con que lo haga. Y los flujos del apartado 1.2 ya son explotables hoy por un rol administrativo que pase un ID ajeno.

---

## 3. ¿Qué pasaría si se dispara? (impacto)

Un cliente con vendedor de otra cuenta causaría:

1. **Comisiones equivocadas**: al despachar, el sistema toma el vendedor **del cliente** para calcular y asignar la comisión ([despachos.js:110-122](api/handlers/despachos.js#L110-L122)). La comisión se atribuiría (y pagaría) a un usuario de otra empresa.
2. **Permisos de venta confusos**: las reglas "solo puedes despachar tus propias cotizaciones" y "este cliente es ajeno" comparan contra `vendedor_id`; con un vendedor cruzado, esas reglas decidirían mal.
3. **Reportes mezclados**: los reportes por vendedor agruparían ventas de clientes que no son de esa cuenta.
4. **Nada se borra ni se pierde**: el daño es de atribución (quién cobra y quién puede), no de pérdida de datos.

---

## 4. Arreglo recomendado (en capas, para que no dependa de un solo lugar)

| Capa | Qué | Dónde | Esfuerzo |
|------|-----|-------|----------|
| 1 | Agregar `cuenta_id=eq.${user.id}` a las 2 búsquedas "EMPRESA" | [clientes.js:363, 451](api/handlers/clientes.js#L363) | Mínimo (2 líneas) |
| 2 | Agregar el mismo filtro a las validaciones de "vendedor destino" | [clientes.js:186](api/handlers/clientes.js#L186), [clientes.js:543](api/handlers/clientes.js#L543), [cotizaciones.js:226](api/handlers/cotizaciones.js#L226) | Bajo |
| 3 | Regla en la base que rechace vendedores de otra cuenta (red de seguridad final) | nueva migración | Bajo-Medio |
| 4 | Prueba automatizada que cree 2 cuentas con "EMPRESA" y verifique que cada una usa el suyo | suite de pruebas | Bajo |

Con las capas 1 y 2 el problema desaparece; con la 3, la base lo vuelve imposible aunque un futuro cambio de código se equivoque.

---

## 5. Verificación posterior (una vez arreglado)

- La consulta Q41 (clientes cruzados) debe seguir devolviendo **0**.
- Crear un cliente "personal" en cada cuenta debe asignar el EMPRESA **de esa cuenta**.
- Las 766 pruebas deben seguir pasando + las nuevas.

---

*Auditoría profunda del 2026-10-26. Evidencia: código ([clientes.js](api/handlers/clientes.js), [cotizaciones.js](api/handlers/cotizaciones.js), [104_tenant_isolation_restrictive.sql](supabase/migrations/104_tenant_isolation_restrictive.sql)) y datos reales de producción consultados en solo lectura (usuarios EMPRESA, clientes cruzados, cuentas activas). No se modificó ningún dato.*
