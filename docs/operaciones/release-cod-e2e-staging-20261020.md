# COD conciliación — prueba E2E en staging (20 oct 2026)

## En resumen

- **La conciliación COD ya funciona de punta a punta en staging, probada desde la pantalla:** aprobar despacho → marcar despachada → el modal de "Conciliar COD" se abre solo → registrar el abono con evidencia obligatoria → la nota queda **PAGADO** y el resto queda a crédito separado.
- También se arregló el **Inventario**, que se caía al abrir (error interno del código). Ahora carga normal, solo está vacío porque no hay productos sembrados en staging.
- El **login con PIN** de staging quedó arreglado: al Jefe de prueba se le asignó el PIN `246813` (antes el flujo nuevo ya no aceptaba el PIN maestro del sistema).
- Los datos de prueba **se dejan en staging a propósito** para que puedas revisarlos tú mismo: despacho `DES-03181` (conciliado, PAGADO), despacho `DES-03180` (el que muestra "0 ítems", que es la evidencia del caso de productos externos sin ítems), cliente "Fixture UI A" y 4 operadores de prueba.

## Qué se probó paso a paso (desde la pantalla)

1. Login con correo + PIN de operador (Jefe E2E Staging, PIN `246813`).
2. Pantalla "Notas de Despacho": despacho `DES-03181` ($11, COD pendiente).
3. Botón "Aprobar despacho" → confirmación → quedó **Aprobada** y **Despachada**.
4. Al momento se abrió automáticamente el modal **"Conciliar COD — DES-03181"** con datos del ledger:
   - Saldo COD del ledger: **$6.00** (estado derivado: `pendiente`).
   - Parte COD (se cobra aquí): **$6.00** · Parte a crédito (se cobra en CxC): **$5.00**.
5. Se registró el abono: Efectivo $6, evidencia obligatoria escrita, botón "Registrar abono COD".
6. Resultado en pantalla: notificación **"COD conciliado: $6.00"**, badge de la nota pasa a **COBRO A DESTINO (PAGADO ✓)** con bandera **PAGADO**, y el total visible baja a $5 (lo que queda por cobrar en la Cuenta por Cobrar).
7. El dashboard refleja la operación: Cuentas por cobrar $279, venta del día $285 y la comisión del vendedor registrada ($0,18).

## Qué se arregló durante la prueba

- **Inventario caído:** un bloque de código (`crearFilaObjeto` en `IngresoLoteHubModal.jsx`) estaba definido después de su primer uso; al montar la pantalla, esa referencia aún no existía. Se movió la definición arriba de donde se usa. La pantalla de Inventario ya abre sin errores.
- **Login con PIN:** el sistema ya no valida el PIN maestro para el Jefe; se le asignó un PIN real con el mismo formato criptográfico que usa el sistema al asignar PINs. Valores: Jefe `246813` (los demás operadores de prueba aún sin PIN).

## Estado de los servidores al cierre

- Vite (frontend staging): corriendo en `http://localhost:5174`.
- Worker (servidor local de API staging): corriendo en el puerto `8789`.
- Suite de pruebas: 19/19 en verde. Build de producción del frontend: sin errores.

## Pendientes antes de pensar en producción

1. Sembrar productos en el inventario de staging y repetir un despacho **con productos reales** para el flujo COD (la prueba actual usó productos externos sin ítems, que es la causa del despacho con "0 ítems" — `DES-03180`).
2. Asignar PINs a los vendedores de prueba si se quiere probar cambio de operador entre roles.
3. Decidir la limpieza: si se quiere un staging limpio, hay que borrar los despachos `DES-03180` / `DES-03181`, la cuenta por cobrar derivada, los abonos del ledger COD, la comisión registrada y el cliente "Fixture UI A" — conviene hacerlo con borrado lógico en un script, no a mano.
4. Revisión de seguridad antes de producción: la conciliación COD exige evidencia obligatoria y tasa fija al momento de registrar; validar con el equipo que el texto de evidencia cumpla el estándar del negocio (identificador de transferencia/depósito real).
