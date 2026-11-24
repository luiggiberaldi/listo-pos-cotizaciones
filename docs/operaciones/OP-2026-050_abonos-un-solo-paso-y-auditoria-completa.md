# OP-2026-050 — Abonos en un solo paso, validación de monto y detalle, y revisión de la auditoría

**Fecha:** 2026-11-23 · **Entorno de los arreglos:** solo staging (copia de pruebas) · **Producción:** solo se leyó, sin cambios
**Fallas que atiende:** I2, N8, N9 (resto de la fase 1 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md)) y, a pedido del usuario ("la auditoría debe registrar todo"), I3, N5, N6 y tres fallas nuevas: N12, N13 y N14. Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md)

## En resumen

- **La auditoría de producción tiene huecos grandes.** Las devoluciones, los descuentos, los cambios de configuración, la designación del vendedor del día y los vehículos **nunca** quedaron anotados. La causa: el programa los anota con categorías que la base de datos no acepta, y la base las rechazaba sin avisar a nadie. Hay **63 devoluciones** en producción sin una sola anotación. Además, nada de dinero anterior al **23 de octubre** quedó anotado (882 movimientos), porque hasta ese día tampoco se aceptaba la categoría "FINANZAS".
- **En staging ya se corrigió:**
  - La base acepta esas categorías.
  - Si alguna vez rechaza una anotación, esta se guarda igual, marcada como "SISTEMA".
  - Los intentos de abono que no se guardan quedan anotados, con el motivo.
  - Al revertir un abono queda una copia completa de lo borrado.
- **Los abonos ahora se guardan en un solo paso**, con turno por cliente. Si dos personas abonan a la vez el saldo completo, solo se acepta uno. El abono y su anotación de auditoría se guardan juntos: o quedan los dos o ninguno.
- **El monto y el detalle se revisan con mensajes claros.** Un monto escrito como texto, o unas formas de pago que no suman el abono, se rechazan diciendo exactamente qué está mal.
- **Pruebas:** 20 de 20 en el escenario completo contra staging, 23 de 23 en un navegador real y 402 de 402 automáticas. **Nada está en producción**; los huecos que ya existen en la auditoría de producción no se pueden rellenar.

## 1. Revisión de la auditoría (pedido: "la auditoría debe registrar todo")

La auditoría es la libreta donde el sistema anota quién hizo qué y cuándo. Revisé tres cosas en producción, solo leyendo.

### 1.1 ¿Cada movimiento de dinero tiene su anotación?

Comparé cada movimiento de cuentas por cobrar desde el 23-oct con las anotaciones de la auditoría de ese cliente o despacho, en una ventana de ±3 minutos (`OP-2026-040_scripts/op050_auditoria_cobertura.py`):

| Resultado | Movimientos |
|---|---|
| Con anotación | 153 de 168 |
| **Sin ninguna anotación** | **15**: todos de devoluciones e intercambios |

Los 15 sin rastro:

| Movimiento | Cantidad | Dinero sin rastro |
|---|---|---|
| Reembolsos por devolución entregados al cliente | 3 | $4.567,57 |
| Saldo a favor para reembolso | 3 | $4.567,57 |
| Cargos por diferencia en intercambio | 3 | $1.380,10 |
| Saldo a favor por excedente en intercambio | 3 | $114,56 |
| Cobros de diferencia en intercambio | 2 | $35,10 |
| Abono por devolución/intercambio | 1 | $7,40 |

Corrección a N5: los cobros a destino conciliados ("Pago externo COD") **sí** quedan anotados, como `COD_CONCILIADO_CON_EVIDENCIA`.

### 1.2 ¿Por qué faltan? Categorías que la base no acepta (N12)

Cada anotación lleva una categoría, y la base solo acepta las de una lista fija. El programa usa cuatro que no estaban en esa lista:

| Categoría usada | Qué se perdía | Anotaciones en producción |
|---|---|---|
| `DESPACHO` | Devoluciones parciales, devoluciones con intercambio, anular abono por devolución, aplicar descuento, corregir código externo | **0** (63 devoluciones registradas) |
| `VEHICULO` | Crear, editar o desactivar vehículos | 0 |
| `CONFIG` | Guardar la configuración del negocio | 0 |
| `COMISIONES` | Designar o quitar el vendedor del día | 0 |

### 1.3 ¿Por qué nadie se enteró? (N13)

Cuando la base rechaza una anotación, el programa avisa solo en la consola del servidor, una pantalla de mensajes temporales que nadie revisa y que se borra. No queda en ninguna tabla. Así pasó con "FINANZAS" hasta el 23-oct, y así sigue pasando con las cuatro categorías de arriba.

### 1.4 Otros huecos

- **Intentos de abono rechazados (N14):** si un abono no se guardaba (monto mayor que la deuda, rol sin permiso, error), no quedaba rastro.
- **Revertir un abono (I3):** se borra la fila y la anotación solo guardaba el monto, sin método ni referencia.
- **Funciones de la base que mueven dinero sin anotar por sí mismas** (`ajustar_finanzas_devolucion_*`, `registrar_cobro_diferencia_devolucion`, `revertir_entrega_finanzas_atomica`, `confirmar_entrega_finanzas_*`): las anotaciones las hace el servidor después de llamarlas. Con N12 corregido, sí quedan. Que la anotación vaya dentro de la misma función queda pendiente (lista en `.tmp-op040/op050_funciones.txt`).
- **Antes del 23-oct (N7):** 882 movimientos (US$ 1,19 millones) sin anotación. No se puede reconstruir.

### 1.5 Qué se arregló en staging

| Arreglo | Cómo funciona |
|---|---|
| Categorías aceptadas (N12) | La migración 302 agrega `DESPACHO`, `VEHICULO`, `CONFIG` y `COMISIONES` a la lista |
| Nunca perder una anotación (N13) | Si la base rechaza una anotación, se guarda de nuevo como `SISTEMA`, con la descripción "[Categoría X rechazada] …", la categoría original y el motivo del rechazo (`api/lib/audit.js`) |
| Abonos rechazados (N14) | Cada rechazo queda como `ABONO_RECHAZADO`, con el motivo, el monto intentado, las formas de pago, la referencia y la huella |
| Abono guardado | La anotación `REGISTRAR_ABONO` se guarda en el mismo paso que el abono, con saldo anterior y nuevo, formas de pago y referencia |
| Revertir abono (I3) | La anotación guarda método, referencia, despacho y la copia completa de la fila borrada |
| Cargo COD inventado al abonar un despacho antiguo | Ahora queda anotado como `AUTOGENERAR_CARGO_COD` |

Así se ve en staging lo anotado durante la prueba: cada abono guardado tiene su `REGISTRAR_ABONO`, y cada intento rechazado su `ABONO_RECHAZADO` con el motivo (por ejemplo: "El abono ($600.00) es mayor que la deuda del cliente ($534.00)" o "Las formas de pago suman $10.00 pero el abono es de $40.00").

## 2. Abonos en un solo paso (I2)

**Antes:** el servidor leía la deuda, comparaba y después guardaba, en pasos separados. Si dos personas abonaban a la vez el saldo completo, las dos veían la deuda entera y las dos se guardaban. El cliente quedaba pagado de más (confirmado en OP-047).

**Ahora:** el abono se guarda con una sola función dentro de la base (`cxc_registrar_abono_atomico`). Funciona como una ventanilla con turno por cliente: mientras se atiende un abono, el siguiente para ese cliente espera. Dentro del turno se revisa:
1. La huella del abono: si es un reintento, se devuelve el que ya estaba guardado.
2. Si hay un abono igual en los últimos 15 minutos: se pregunta "¿Es otro pago?".
3. La deuda real contra el monto.

Después se guardan el abono y su anotación de auditoría, juntos.

**Prueba real (A9):** dos abonos simultáneos por el saldo completo ($437,70), ambos confirmados como "otro pago". Se aceptó uno; el otro recibió "El abono ($437.70) es mayor que la deuda del cliente ($0.00)".

## 3. Validación del monto (N9) y del detalle de pago (N8)

| Caso | Antes | Ahora |
|---|---|---|
| Monto "abc" | Error técnico 500 | "El monto del abono debe ser un número (llegó: "abc")." |
| Monto 0 o negativo | "Monto inválido" | "El monto del abono debe ser mayor que cero." |
| Monto mayor que la deuda | "El abono ($600) supera el saldo pendiente ($534.0000)" | "El abono ($600.00) es mayor que la deuda del cliente ($534.00). Revisa el monto." |
| Abono de $40 con formas de pago que suman $10 | **Se aceptaba** | "Las formas de pago suman $10.00 pero el abono es de $40.00. Corrige los montos para que coincidan." |
| Forma de pago sin método o sin monto válido | Se aceptaba | Mensaje que dice qué línea está mal |

La pantalla de la ficha ya evitaba estos casos. Ahora también los revisa el servidor, así que tampoco pasan por otros caminos.

## 4. Pruebas

| Prueba | Resultado |
|---|---|
| Escenario completo contra staging (`construacero-staging/scripts/op047-abonos-api.mjs`) | **20/20** (en OP-047 eran 14 bien y 6 con problema). Incluye A1 (queda en auditoría), A2 (montos inválidos), A3 (mayor que la deuda), A5 (detalle que no suma), A7/A8 (doble clic y reintento), A9 (dos a la vez) y B3 (copia completa al revertir) |
| Pruebas automáticas (`npx vitest run`) | **402/402** en 45 archivos; incluye las nuevas de `abonoClaveUnica049.test.js` (I2, N8, N9 y rechazos anotados) y el rescate de `audit.test.js` |
| Pantalla en navegador real (`scripts/op049-abonos-pantalla.mjs`) | **23/23** (apartado 4.1) |

Antes de cada prueba se crea el cliente temporal "PRUEBA OP047 ABONOS" y al final se borra (`escenario047.py limpiar`, restos 0).

### 4.1 Resultado de pantalla

**23/23 bien**, con el servidor nuevo, en Chromium contra staging:
- abono correcto;
- tres tipos de falla (sesión vencida, error del servidor, sin internet), con aviso rojo y lo escrito conservado;
- reintento sin duplicar;
- doble clic, que guarda uno solo;
- "¿Es otro pago?", tanto con "No" como con "Sí".

La pantalla no cambió en este caso: solo cambió el servidor. Esta prueba confirma que lo de OP-049 sigue funcionando. Capturas en `tmp/op049/`.

Al terminar se borraron el cliente temporal (restos 0) y el operador temporal "OP042 Admin Prueba" (HTTP 200; no queda en la base).

## 5. Archivos cambiados (staging)

- `construacero-staging/supabase/migrations/302_staging_auditoria_categorias_y_abono_atomico.sql` (+ `_rollback.sql`): categorías nuevas de auditoría y función `cxc_registrar_abono_atomico`. **Aplicada en staging y verificada.** La reversa quita la función; las categorías no se pueden quitar (así funciona Postgres) y no hacen daño.
- `construacero-staging/api/handlers/cxc.js`: el abono usa la función de un solo paso, valida monto y detalle, anota los rechazos, anota el cargo COD autogenerado y guarda la copia completa al revertir.
- `construacero-staging/api/lib/audit.js`: rescate de anotaciones rechazadas como `SISTEMA`.
- Pruebas: `api/handlers/__tests__/abonoClaveUnica049.test.js` (reescrita), `api/handlers/__tests__/cxcReparto042.test.js` (ajustada), `api/lib/__tests__/audit.test.js` (caso nuevo), `scripts/op047-abonos-api.mjs` (margen de reloj; la carrera A9 ahora prueba el turno por cliente).
- Revisión en producción, solo lectura: `docs/operaciones/OP-2026-040_scripts/op050_auditoria_cobertura.py` y `op050_funciones_cxc.py`.

## 6. Pendiente

- **Nada de esto está en producción.** Pasarlo requiere un caso propio, aplicar las migraciones 301 y 302 en producción y tu aprobación.
- Los huecos que ya existen en la auditoría de producción (las 63 devoluciones, los 15 movimientos desde el 23-oct y todo lo anterior al 23-oct) no se pueden rellenar. Las devoluciones sí tienen su propio registro en la tabla de devoluciones (`despacho_devoluciones`).
- "Cargar saldo a favor", "Devolución de saldo" y "Cruzar saldo a favor" todavía se guardan en varios pasos. Su anotación va aparte y sus rechazos no se anotan. Mismo arreglo pendiente.
- I3 a medias: todavía se pueden revertir abonos que vienen de una devolución.
- Los fallos sin internet no llegan al servidor, así que no se pueden anotar. La pantalla sí los avisa (OP-049).
- Que las funciones de la base que mueven dinero anoten dentro de su propio paso (fase 4 del plan).
- Sin publicar en GitHub: no hay solicitud de cambio ni commit.
