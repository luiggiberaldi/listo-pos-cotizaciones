# Plan: peso por artículo, peso total del despacho y capacidad del vehículo

**Fecha:** 2026-11-03 · **Estado:** plan para revisar. Nada de esto está construido. Todo se hace **primero en staging**; producción solo con tu autorización.

## En resumen

Vamos a guardar cuánto pesa cada artículo (por unidad), sumar el peso de cada despacho y compararlo con la capacidad del vehículo. Los campos nuevos son **opcionales**: si falta un peso, el sistema no se rompe ni bloquea ventas, solo avisa "peso incompleto". Se hace en 3 fases; cada una se prueba en staging antes de pasar a la siguiente.

## Punto de partida (medido en producción, solo lectura)

- **Vehículos:** ya existe el campo `capacidad_kg` (5 vehículos, ninguno lo tiene lleno). Hoy solo se muestra, no se compara con nada.
- **Productos:** 470 activos, sin ningún campo de peso. 459 están en unidad "und"; el resto en kg, lt, lámina y paquete. Las categorías más grandes: tuberías de acero (64), conexiones PVC (49), tuberías PVC (39), vigas (35), láminas (27+26+18), cabillas (15).
- **Cotizaciones y despachos:** cada línea guarda una *copia* de código, nombre y unidad del artículo al momento de la venta. El peso debe copiarse igual, para que cambiar el peso de un producto mañana no cambie los despachos de ayer.
- Las líneas se crean desde varios lugares del código (cotizaciones, despachos, edición de despachos, venta rápida). Por eso la copia del peso se hará **en la base de datos con un disparador automático** y no en cada lugar: así no se nos escapa ninguna ruta.

## Decisiones tomadas (2026-11-03)

1. **Solo advertir**, nunca bloquear, cuando el peso supere la capacidad del vehículo.
2. **Los pesos los cargan a mano administración o jefe** (y desarrollador), pesando los artículos. El supervisor, el vendedor y logística solo los ven. El servidor lo valida.
3. **La capacidad de cada vehículo (kg) también la colocan ellos a mano**, en la pantalla de Transportistas (el campo ya existe).
4. **Unidad: kilogramos con punto decimal**, hasta 3 decimales. 100 g = 0.1 kg; 250 g = 0.25 kg; 1 tonelada = 1000 kg. Si el artículo se vende por kilo, su peso por unidad es 1. **Esta explicación está escrita dentro del formulario de producto**, junto al campo de peso.

## Fase 1 — Guardar el peso (sin tocar ventas ni despachos)

**Qué se construye**
- Columna `peso_kg` (opcional, número con 3 decimales, no negativo) en `productos`.
- Campo "Peso por unidad (kg)" en el formulario de producto (`ProductoForm.jsx`) y columna visible en el listado de inventario.
- La carga es **manual**, producto por producto, desde el mismo formulario de producto (decisión 2). No hay importador masivo en esta fase.
- Un filtro "Sin peso" en inventario, para ver qué falta cargar y dar seguimiento.
- Regla: el peso se valida (≥ 0, máximo razonable) tanto en pantalla como en el servidor.

**Estado Fase 1 (2026-11-03):** construida y probada en staging; pendiente de tu revisión en pantalla. No publicada.

**Staging**
- Migración `295_staging_peso_productos.sql` (solo agrega la columna; reversa que la quita).
- Pruebas: crear/editar producto con y sin peso; importar un Excel de prueba; filtro "Sin peso".
- Criterio de salida: 20 productos de prueba con peso cargados y editables; nada más cambia.

## Fase 2 — Peso del despacho y capacidad del vehículo

**Qué se construye**
- Columna `peso_unit_kg_snap` en `cotizacion_items` y `notas_despacho_items`, con un **disparador** que la llena sola con el peso del producto al crear la línea (si la línea ya trae un valor, se respeta). Los despachos viejos quedan sin peso ("peso incompleto"), no se inventan datos.
- Peso total del despacho = suma de cantidad × peso de cada línea. Se calcula con los datos que ya carga la pantalla; si alguna línea no tiene peso, se muestra "peso incompleto (faltan N artículos)" en vez de un número engañoso.
- En la tarjeta del despacho y en el detalle: "Peso total: 3.200 kg".
- Al elegir vehículo (`VehiculoViajeSelect`, despachos y cotizaciones): "3.200 kg de 5.000 kg (64 %)". Si se pasa: advertencia roja, sin bloquear (según tu decisión 1).
- Las ediciones de cantidad en un despacho recalculan el total; las devoluciones parciales lo reducen.

**Estado Fase 2 (2026-11-03):** construida y probada en staging (base de datos, vistas, ficha y detalle); pendiente de tu revisión en pantalla. No publicada. Diseño de la ficha acordado: el peso va junto a "N ítems" bajo el TOTAL, y el peso contra la capacidad en la línea del camión (rojo si se pasa, solo advertencia); el desglose por artículo está en el detalle. El peso total se calcula en la base de datos (vista `despacho_pesos`), no en cada pantalla, para que la lista no se vuelva lenta.

**Staging**
- Migración `296_staging_peso_lineas.sql` (columnas + disparador; reversa que los quita).
- Pruebas: cotización → despacho con artículos con y sin peso; editar cantidades; cambiar el peso del producto después y comprobar que el despacho viejo no cambia; vehículo con y sin capacidad; venta rápida.
- Se suman pruebas automáticas del cálculo (con/sin peso, redondeos, devolución parcial).

## Fase 3 — Usar el dato

- Peso total en el PDF del despacho y en la guía del chofer.
- Reporte de flota (`CuadroVehiculosFlota`): kilos movidos por vehículo y porcentaje de capacidad usado.
- Opcional: aviso a logística cuando un despacho pendiente supera la capacidad del vehículo asignado.

## Orden de trabajo y publicación

1. Plan aprobado (este documento) y decisiones 1-4.
2. Fase 1 en staging → tu revisión → publicación a producción (migración con respaldo y reversa, PR, Worker).
3. Carga de pesos y capacidades en producción, a tu ritmo.
4. Fase 2 en staging → revisión → publicación.
5. Fase 3.

Cada publicación sigue el proceso de siempre: respaldo, migración con reversa lista, verificación y tu autorización antes de tocar producción.

## Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Pesos mal cargados dan totales falsos | Cargar por lotes con vista previa, filtro "Sin peso" y marcar "peso incompleto" en vez de adivinar |
| Cambiar el peso de un producto altera despachos viejos | El peso se copia a cada línea al crearla (disparador) |
| Alguna ruta de creación de líneas se nos escapa | El disparador está en la base de datos, no en el código |
| Se frena una venta por el peso | Solo advierte; nunca bloquea |
| El disparador afecta el rendimiento | Es una lectura por línea insertada; se mide en staging con un despacho grande |
| Unidades que no son "und" (kg, lt, lámina) | Se define con la decisión 4 antes de cargar datos |

## Qué NO incluye

Pesos por lote o por variante de un mismo producto, volumen del vehículo (m³), cálculo automático de cuántos viajes hacen falta, ni cambios en precios, stock o comisiones.
