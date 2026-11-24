# OP-2026-044 — Auditoría de 12 clientes con deuda: ¿hay abonos sin registrar?

- **Fecha:** 2026-11-23
- **Pedido por:** luigi (captura de las 12 fichas con mayor deuda)
- **Tipo:** revisión (solo lectura en producción, ningún cambio guardado)
- **Estado:** revisión terminada; quedan preguntas para administración/caja
- **Relacionado:** [OP-2026-043](OP-2026-043_auditoria-cliente-219442-solidere.md) (Solidere), [OP-2026-041](OP-2026-041_casos-cxc-caso-por-caso.md) (REYKAR), [OP-2026-039](OP-2026-039_clientes-reportados-como-pagados.md) (Constructora Ew)

## En resumen

- **No se encontró ningún abono de estos 12 clientes anotado en otro lugar.** Se buscó en despachos y cartera de otros clientes, en la auditoría y en el historial de cambios de cada despacho. En los 12, el saldo de la ficha es exactamente la suma de sus cargos menos sus abonos.
- **El reporte de ventas no muestra abonos, y nunca los ha mostrado.** Solo enseña cómo se pagó cada despacho al salir (Zelle, USDT, Cruce…). Los abonos posteriores aparecen en **Reportes → Crédito (CxC)**, en "movimientos" del período.
- Aparecieron **pistas concretas en las dos direcciones**:
  - **Pagos que pueden haberse perdido** al anular un despacho que ya tenía un pago anotado. El caso más fuerte es **Angel Pineda: Zelle de $3.557,50**.
  - **Abonos que parecen repetidos**, que hacen ver la deuda más baja de lo real: REYKAR $1.000, Richard Mora $139, y un mismo Zelle de $78 anotado en Solidere y en REYKAR.
- Nada se corrigió. Cada pista necesita que caja confirme con sus comprobantes.

## Resultado por cliente

| Cliente | Saldo en el sistema | ¿Cuadra? | Pistas | Saldo si se confirman las pistas |
|---|---|---|---|---|
| INVERSIONES SOLIDERE #219442 | $34.188,00 | Sí | Zelle $78 "ALEJANDRO CUEVA" también anotado en REYKAR (ver OP-043) | $34.188 o $34.266 |
| RICHARD MORA #889387 | $12.054,72 | Sí | Cruce de $139 anotado dos veces para una sola factura de $139 | $12.193,72 |
| Juan Carlos Medrano #311301 | $5.851,75 | Sí | Pago USDT $4.136,06 en despacho anulado; posible pago contado dos veces ($3.000) | entre $1.715,69 y $8.851,75 (ver detalle) |
| Otilio Diaz #830206 | $5.517,10 | Sí | Nada importante | $5.517,10 |
| Angel Pineda #311543 | $4.002,10 | Sí | **Zelle $3.557,50 en despacho anulado y rehecho a crédito** | **$449,60** si el Zelle fue real |
| Marcos Villega #910654 | $3.738,78 | Sí | Nada (el cambio de tubos del #3346 está bien calculado) | $3.738,78 |
| INVERSIONES ARCADIAZCA #566021 | $1.453,00 | Sí | Nada | $1.453,00 |
| CONSTRUACERO LOS GUAYOS #155297 | $1.345,50 (+ $450 a favor) | Sí | Devoluciones de mercancía **donada** que dieron crédito ($805) | $1.700,50 y $0 a favor |
| Constructora Ew 2010 #441897 | $850,00 | Sí | Ver OP-039; el efectivo de $8.000 del #1850 no se usó | $850 (o $0 si caja confirma el pago de OP-039) |
| DEHIERRO JLSB #387665 | $774,40 | Sí | Nada | $774,40 |
| REYKAR A.S.E #475109 | $748,46 | Sí | Dos Zelle de $1.000 "ENZO CONFIRMO" con 32 segundos de diferencia; Zelle $78 compartido con Solidere; Zelle $7.056 en despacho anulado | entre $670,46 y $1.748,46 |
| Randy Patty #506944 | $625,00 | Sí | Nada importante | $625,00 |

## Detalle de cada pista

### A. Pagos que pueden haberse perdido al anular un despacho

Cuando un despacho se anula, el pago que tenía anotado **desaparece de todas partes**: no pasa a la cartera ni queda como saldo a favor. Si el cliente sí pagó, ese dinero no está en ningún sitio.

1. **Angel Pineda — #4775, Zelle $3.557,50 (el más importante).**
   - El 17-nov se creó el #4775 pagado por Zelle (cabillas, alambrón, tubos, láminas). Se anuló 3 horas después, sin haber salido.
   - El 20-nov se hizo el #4841, con mercancía parecida, por $3.552,50 **a crédito**. Ese despacho es casi todo lo que hoy debe Pineda.
   - **Pregunta:** ¿Pineda mandó el Zelle de $3.557,50 el 17-nov? Si sí, el #4841 ya está pagado y su deuda real es **$449,60** (solo el #4844), más $5 a su favor.
2. **Juan Carlos Medrano — #3401, USDT $4.136,06.**
   - El 23-sep se creó y se anuló en **1 minuto**, sin haber salido. Después no hay ningún otro despacho ni abono de Medrano.
   - Lo más probable es que fuera un error de captura, pero hay que confirmarlo.
3. **REYKAR — #4281, Zelle $7.056 (720 sacos de cemento).**
   - El 26-oct se creó y se anuló a los 28 minutos. No se rehízo.
   - Ese mismo día se registró un abono de $9.766 "PAGOS VIERNES Y SÁBADO", así que puede ser el mismo dinero.
4. **Pequeños:** Richard Mora #1550 (Zelle $540; la venta se rehízo y luego se anuló porque "no lo va a llevar"), Randy Patty #4512 (USDT $72), Otilio Diaz #3136 (punto de venta $8,50).

Revisados y **sin problema**: Medrano #977 (el USDT $149 se pasó a la cartera el 19-jun, con nota de Enzo), Constructora Ew #2978 (el USDT pasó al #2977 y se abonó el 15-sep) y REYKAR #1529 (el Zelle de $10.000 pasó al #1612).

### B. Abonos que parecen repetidos (la deuda real sería mayor)

1. **Zelle $78 "ALEJANDRO CUEVA" (16-jun).** Está en **Solidere** (18:17) y en **REYKAR** (18:37), con la misma referencia y el mismo monto. Lo más probable es que sea un solo pago anotado en dos clientes. Solidere solo tiene ese abono; REYKAR tiene más de 150.
2. **REYKAR: dos Zelle de $1.000 "ENZO CONFIRMO" (05-oct, 16:03).** Se anotaron con 32 segundos de diferencia, con la misma referencia y la misma descripción ("PAGO FACT 3576"). Si fue uno solo, REYKAR debe $1.000 más.
3. **Richard Mora: Cruce de $139 dos veces.** El 12-ago se anotó "CRUCE CON ENZO — PAGO TOTAL FACT", y el 17-nov otra vez "CON ENZO". Mora tiene una sola factura de $139 (#2345). Si el segundo es repetido, debe $139 más.
4. **Juan Carlos Medrano: $3.000 que pueden estar contados dos veces.**
   - El #959 (06-jun) tiene anotado al despachar "Efectivo $1.000 + Zelle $2.000".
   - El 13-jun hay dos abonos exactamente iguales: Zelle $2.000 y Efectivo $1.000, "Pago parcial".
   - Si fueron el mismo dinero, Medrano debe $3.000 más ($8.851,75). Si fueron dos pagos distintos, está bien como está.

### C. Devoluciones de mercancía donada (Construacero Los Guayos)

- El **#4211** (135 sacos de cemento, $1.350) se anotó como **"Donación"**. Después se devolvieron 45 sacos y el sistema le dio al cliente **$450 de saldo a favor**.
- El **#4800** (láminas por $355) también se anotó como "Donación". Se cambió por láminas de $1.700 y el sistema le cobró solo **$1.345**, porque descontó los $355 "devueltos".
- Si lo donado no se pagó, devolverlo no debería generar crédito. En ese caso el saldo real sería **$1.700,50 de deuda y $0 a favor**, $805 en contra del cliente.
- **Pregunta:** ¿cómo debe tratarse lo donado cuando se devuelve? ¿Los Guayos es una empresa relacionada?

### D. Diferencias pequeñas, sin impacto real

- Angel Pineda #2185: el cobro a destino era $3.135,96 y se abonaron $3.135. Faltan $0,96.
- Otilio Diaz: un abono de $20 en efectivo dice "DESCUENTO FLETE / DONATIVO". Es un descuento anotado como si fuera dinero en efectivo.
- Marcos Villega #3346: su total ($1.639,02) es mayor que la suma de artículos ($1.516,06) porque hubo un cambio de tubos: devolvió $80,56 y se llevó $203,52. Está bien calculado.

## Preguntas para caja/administración

1. Angel Pineda: ¿llegó el Zelle de $3.557,50 del 17-nov?
2. Juan Carlos Medrano: ¿el #3401 (USDT $4.136,06) fue un error? ¿El efectivo $1.000 + Zelle $2.000 del #959 es el mismo dinero que los abonos del 13-jun?
3. REYKAR: ¿los dos Zelle de $1.000 del 05-oct son dos pagos o uno? ¿Llegó el Zelle de $7.056 del #4281, o forma parte del abono de $9.766?
4. Zelle $78 "ALEJANDRO CUEVA": ¿es de Solidere o de REYKAR?
5. Richard Mora: ¿el Cruce de $139 del 17-nov es un segundo cruce real o se repitió?
6. Construacero Los Guayos: ¿las devoluciones de mercancía donada deben dar crédito?
7. Pendientes que ya venían de antes: OP-043 (Solidere), OP-041 (REYKAR) y OP-039 (Constructora Ew $850).

## Mejoras que se desprenden (no hechas)

- **Al anular un despacho que tiene un pago anotado** (Zelle, USDT, efectivo…), el sistema debería preguntar qué hacer con ese dinero: pasarlo a saldo a favor, moverlo al despacho nuevo o confirmar que no se cobró. Hoy desaparece sin aviso. Es la pista más grande de este caso.
- **Avisar de abonos posiblemente repetidos**: mismo cliente o misma referencia, mismo monto y pocos minutos de diferencia.

## Cómo se hizo (técnico)

- Scripts en `docs/operaciones/OP-2026-040_scripts/`: `op044_bajar.py` (descarga de solo lectura), `op044_analizar.py` (cruce de cada despacho con su cargo y su historial de formas de pago en la auditoría) y `op044_detalle.py` (anulaciones, devoluciones, intercambios y referencias repetidas).
- Se descargaron 12 clientes, 199 despachos, 262 movimientos de cartera, 10 devoluciones y 888 registros de auditoría. Los datos crudos quedan en `.tmp-op040/op044/` (ignorado por git, porque tiene datos reales).
- Para cada despacho entregado se comparó la parte "Cta por cobrar" con el cargo creado. Las diferencias encontradas se explican por cobro a destino, devoluciones o intercambios.
- Producción no se modificó.
