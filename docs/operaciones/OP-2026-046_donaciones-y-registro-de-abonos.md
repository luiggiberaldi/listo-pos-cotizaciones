# OP-2026-046 — ¿Lo donado da crédito al devolverse? ¿Los abonos se registran bien?

- **Fecha:** 2026-11-23
- **Pedido por:** luigi
- **Tipo:** revisión de código y de datos (solo lectura en producción, ningún cambio)
- **Estado:** revisión terminada; las fallas quedaron en el [registro de fallas](REGISTRO-FALLAS-CODIGO.md) (N2, N5, G4, I3)

## En resumen

- **Sí, lo donado da crédito al devolverse, y eso es una falla (N2).** Al registrar una devolución, el sistema valora lo devuelto a precio completo y no revisa si el despacho fue una donación. En toda la historia ha pasado 3 veces. El único caso con efecto en dinero es **Construacero Los Guayos: $805 a su favor que no le corresponden** si lo donado no daba crédito.
- **Los abonos se guardan bien:** los saldos de todos los clientes coinciden con sus movimientos, no hay montos inválidos y ningún abono está pegado al despacho de otro cliente.
- **Pero hay fallas en cómo se registran:**
  - Se pueden **duplicar** (G4): Yhoel Sanchez tiene 2×$500 con 7 segundos de diferencia.
  - Los cobros a destino conciliados **no dejan rastro en la auditoría** (N5): 29 abonos desde el 23-oct.
  - **Revertir** un abono lo borra y deja muy poca información (I3).

## Parte 1: devoluciones de mercancía donada

### Qué hace el sistema

- La pantalla de devolución (`src/components/despachos/DevolucionParcialModal.jsx`, líneas 246–272) suma **cantidad × precio** de lo devuelto. Si eso es más que la deuda del despacho, el sobrante queda como **saldo a favor**, o se puede **reembolsar en efectivo**.
- No mira la forma de pago del despacho. Lo único que excluye "Donación" es la lista de métodos para **cobrar** una diferencia (línea 11).
- Ninguna de las 8 funciones de devolución de la base de producción menciona "Donación". El servidor tampoco.
- Resultado: como un despacho donado no tiene deuda, **todo lo devuelto se convierte en crédito** para el cliente.

### Casos en producción (todos los despachos donados con devolución)

| Despacho | Cliente | Qué pasó | Efecto |
|---|---|---|---|
| #4211 | Construacero Los Guayos | Se donaron 135 sacos de cemento ($1.350) y se devolvieron 45 ($450) | **$450 de saldo a favor** |
| #4800 | Construacero Los Guayos | Se donaron láminas por $355; se devolvieron y se cambiaron por láminas de $1.700 | Se cobraron **$1.345 en vez de $1.700** |
| #3248 | Ana Rivero | Se donaron $748,15; se devolvieron $12 y se cambiaron por $27 | Sin efecto en su cuenta |

### Decisión pendiente (de negocio)

¿Devolver algo donado debe dar crédito? Lo lógico es que **no**. Si es así:
- Los Guayos debería quedar con **$1.700,50 de deuda y $0 a favor**, en vez de $1.345,50 de deuda y $450 a favor.
- El arreglo de código sería que, en un despacho donado, la devolución no genere crédito ni reembolso, salvo autorización explícita.

## Parte 2: ¿los abonos se registran correctamente?

### Cómo se registra hoy un abono

Botón **Confirmar abono** en la ficha → servidor (`api/handlers/cxc.js`, `handleRegistrarAbono`) → valida el rol, el monto y que no supere la deuda → guarda el abono → recalcula el saldo → escribe en la auditoría.

### Comprobaciones en producción (624 abonos, $701.861,74)

| Comprobación | Resultado |
|---|---|
| Saldo de cada cliente = cargos − abonos | ✅ 0 diferencias |
| Abonos con monto cero o negativo | ✅ 0 |
| Detalle de pago que no suma el monto del abono | ✅ 0 |
| Abonos enlazados a un despacho de otro cliente | ✅ 0 |
| Abonos enlazados a despachos anulados | ✅ 0 |
| Abonos posiblemente duplicados (mismo cliente, mismo monto, menos de 10 minutos) | ⚠️ 3 (ver abajo) |
| Misma referencia y monto en dos clientes distintos | ⚠️ 1: Zelle $78 "ALEJANDRO CUEVA" en Solidere y REYKAR |
| Abonos registrados sin que hubiera deuda (dejan pagado de más) | ⚠️ 22: son los casos ya conocidos de OP-041 (13 pagos con saldo a favor guardados como abono, Adalberto Rojas, A_40, Carlos Escalona, Encendo), más Osniel Coronel ($301,92), Alexander Isena ($311,10) y Ferrechuros ($810) |
| Abonos desde el 23-oct sin registro en la auditoría | ⚠️ 29: 27 son "Pago externo COD" y 2 son "Cobro de diferencia en intercambio" |
| Abonos registrados y luego revertidos | ℹ️ 9 reversiones. Los abonos ya no existen y de cada uno solo queda el monto |

### Los posibles duplicados

- **Yhoel Sanchez:** 2 abonos de $500 el 02-jun, con **7 segundos** de diferencia, sin referencia. Tiene toda la pinta de un doble clic.
- **REYKAR:** 2 abonos de $1.000 "ENZO CONFIRMO" el 05-oct, con 32 segundos de diferencia (ya estaba en OP-044).
- **Beatriz Landadeta:** 2 abonos de **$0,01** que dicen "Abono de prueba temporal", del 11-jun. Son pruebas hechas en producción que nunca se borraron.

### Fallas encontradas (pasan al registro de fallas)

- **G4 — duplicados:** la ficha no manda la protección contra repetidos y el servidor solo la usa si la recibe. No hay aviso de "ya hay un abono igual".
- **N5 — cobros sin rastro:** el camino de conciliar cobro a destino y el de cobrar diferencias de intercambio guardan el abono, pero **no escriben en la auditoría**. Entre ellos hay pagos grandes: Distribuidora N.E. $24.875, Sofia's Foods $9.700 y Repyfer $5.821.
- **I3 — revertir borra:** al revertir, la fila desaparece. La auditoría guarda el monto y el número interno, pero no el método, la referencia ni la descripción.

## Preguntas para administración

1. ¿Lo donado debe dar crédito al devolverse? (Los Guayos, $805.)
2. Yhoel Sanchez: ¿fue un solo pago de $500 o dos?
3. ¿Se pueden borrar los dos abonos de prueba de $0,01 de Beatriz Landadeta?
4. Reversiones de hoy (Albert Ruiz $60,59 y Lerwis Pinto $180): ¿fueron correcciones de caja? Albert Ruiz estaba en OP-039.

## Cómo se hizo (técnico)

- Código leído: `DevolucionParcialModal.jsx`, `api/handlers/cxc.js` (`handleRegistrarAbono`, `handleRevertirAbono`) y `src/hooks/useCuentasCobrar.js`. También se buscó "Donación" en las funciones de devolución instaladas en producción.
- Script de comprobaciones: `docs/operaciones/OP-2026-040_scripts/op046_abonos.py` (solo lectura). Los resultados crudos están en `.tmp-op040/op046.txt` (carpeta ignorada por git, porque tiene datos reales).
- Producción no se modificó.
