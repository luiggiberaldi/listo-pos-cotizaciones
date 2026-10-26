# Auditoría: los precios se guardan y luego "vuelven" al valor antiguo

**Fecha:** 24 de octubre de 2026
**Alcance:** persistencia de los 3 precios (Precio 1, 2 y 3) de los productos, en producción.

---

## En resumen

1. **Guardar los precios SÍ funciona.** El botón de confirmar escribe los 3 precios
   correctamente en la base de datos. Lo verifiqué pieza por pieza, incluida la función
   que vive en la base de producción (no solo la del código).
2. **El problema es que OTRO procedimiento los vuelve a escribir con el valor viejo:**
   el **Ingreso de Lote** (cuando se registra una compra o entrada de inventario).
   Ese flujo no solo suma existencias: **también reescribe los precios del producto con
   los precios que traía la lista del ingreso**. Si esa lista se cargó con el precio
   antiguo (por ejemplo, el formulario se abrió antes de cambiar el precio), al aplicar
   el lote el precio vuelve al valor anterior. Eso explica exactamente el síntoma:
   "cambia por un momento y luego vuelve el precio antiguo".
3. Hay dos detalles menores que también pueden dar sensación de "no cambió": los
   precios **no se pueden borrar** (dejarlos vacíos no limpia el valor), y poner un
   precio en **0** no se refleja en algunas pantallas.

---

## La causa raíz, explicada simple

Piensen en el producto como una ficha con varias casillas: existencias, costo y los 3
precios. Hay dos personas tocando esa ficha:

- **Edición de producto** (el formulario que ustedes usan para cambiar precios): escribe
  los precios nuevos. ✅ Funciona bien.
- **Ingreso de Lote** (la pantalla para registrar compras/entradas de mercancía): debería
  solo sumar existencias, pero **además escribe en las casillas de precios** con los
  valores que traía su propia lista. ❌ Ese es el problema.

La lista del Ingreso de Lote trae cada artículo con su precio **pre-cargado desde el
momento en que se abrió la pantalla**. Si después alguien cambia el precio en la edición
de producto y luego se aplica el ingreso de lote, la ficha vuelve a quedar con el precio
viejo.

Esto NO es el mismo bug que ya pasó con los despachos (DES-04161 / DES-04243), pero es
de la misma familia: **dos procesos escriben la misma casilla y gana el último**.

---

## Qué se revisó y qué está bien (pruebas hechas contra la base de producción real)

| Pieza revisada | Resultado |
|---|---|
| Formulario de edición (los 3 precios + porcentajes) | ✅ Envía los 3 precios correctamente |
| Ruta de guardado en el servidor (`/api/productos/actualizar`) | ✅ Recibe y transmite todos los valores |
| Función de guardado en la base (definición VIVA en producción) | ✅ Guarda los 3 precios y los 3 porcentajes |
| Llave anti-duplicados (idempotencia) | ✅ Se genera nueva en cada envío; no traga guardados |
| Lectura en pantalla (lista de inventario) | ✅ Lee directo de la base; sin copias viejas |
| Almacenamiento del navegador (service worker) | ✅ No guarda datos de la API (está excluido a propósito) |
| Disparadores (triggers) que pisen precios | ✅ No existen |
| Actualización masiva de precios (función aparte) | ✅ Existe pero **no se ha usado en 30 días** |

## La evidencia que encontré en los datos

- **Ráfagas de guardados repetidos**: el artículo ALA0103001 se guardó **6 veces en 47
  segundos** y LAM1916004 dos veces con **11 segundos** de diferencia, siempre por el
  mismo usuario. Esa es la huella típica de "guardé, no quedó, guardé otra vez".
- **Varios productos actualizados en el mismo instante exacto** (al microsegundo), en
  lotes de 2 a 5 artículos, varias veces por semana: es la firma del Ingreso de Lote
  escribiendo varios productos de una vez.
- **Un producto con precio desincronizado** de su porcentaje (TUB0202023), consistente con
  escrituras parciales encimadas.

---

## Arreglo propuesto (pendiente de tu aprobación)

**Cambio principal (el que resuelve el problema):** el Ingreso de Lote **no debe escribir
precios** en productos que ya existen. Debe solo sumar (o sobrescribir) las existencias y,
si se marcó la casilla de actualizar costo, el costo. Los precios nuevos solo aplican
cuando el artículo es **nuevo**. Es un cambio pequeño y seguro en la función de la base.

**Correcciones menores opcionales:**
1. Permitir **vaciar** un precio (que dejarlo en blanco sí lo borre), o avisar en pantalla
   que no se puede.
2. Que el precio **0** se muestre tal cual (hoy algunas pantallas lo esconden).
3. Evitar que al editar el **costo** se recalcule y pise silenciosamente precios escritos
   a mano.

**Verificación propuesta después del arreglo:** prueba de regresión tipo DES-04243:
editar precios → registrar un ingreso de lote → confirmar que los precios NO cambian.

---

## Riesgo actual (mientras no se aplique el arreglo)

Cada ingreso de compra/lote que se registre **puede pisar los precios de los artículos
involucrados** con los valores pre-cargados. Recomendación práctica temporal: registrar
los ingresos de lote **antes** de cambiar precios, o revisar los precios después de cada
ingreso.
