# OP-2026-037 — Auditoría del reporte "Carteras de clientes — simulación con los abonos COD"

**Fecha:** 23 de noviembre de 2026
**Tipo:** revisión (auditoría), solo lectura
**Base de datos revisada:** producción, proyecto Supabase "listopos cotización"
**Cambios hechos:** ninguno. No se modificó ningún dato ni código.

## En resumen

- **El reporte es correcto en lo importante.** Los cobros de los despachos #2185 (Angel Pineda) y #3879 (Punto Amarillo) **ya están registrados** en Cuentas por Cobrar. **No hay que agregarlos otra vez**: sería contar dos veces el mismo dinero.
- **La cartera total cuadra al centavo:** $73.688,22 en 22 clientes. Revisé los 22 saldos uno por uno contra los movimientos y no hay ninguna diferencia.
- **Hay una conclusión que corregir:** el reporte dice que la pantalla de la aplicación muestra esos dos despachos como "pendientes". **No es así.** La aplicación reparte los abonos sin enlace al despacho más viejo primero, y con eso #2185 y #3879 salen pagados. Lo que salía "pendiente" era un cruce hecho a mano en un informe anterior, no la pantalla. Enlazar los 4 abonos a su despacho sirve para tener un historial más ordenado, pero **no es urgente**: ni la deuda ni la pantalla cambian.

## Qué se comprobó y qué salió

| # | Lo que dice el reporte | Resultado | Comentario |
|---|---|---|---|
| 1 | Angel Pineda: cargos $13.388,74 − abonos $9.386,64 = $4.002,10 | ✅ Correcto | Igual al saldo guardado. |
| 2 | Punto Amarillo: cargos $51.349,57 − abonos $51.349,57 = $0,00 | ✅ Correcto | Igual al saldo guardado. |
| 3 | Los 4 abonos (Zelle $1.000 ref. 9FTIZR, Zelle $2.000 ref. UDQOB, Efectivo $135, $490 "pago el 13 sistema no lo tomo") existen, con esas fechas, y ninguno tiene el despacho enlazado | ✅ Correcto | Todos con fecha y monto exactos. |
| 4 | #2185: cargo COD $3.135,96; abonos atribuibles $3.450 ($3.135 + $315 de devolución); pagado de más por $314,04 | ✅ Correcto | El despacho incluso tiene una marca interna de "conciliado sin abono", o sea que alguien ya había visto este caso. Esos $314,04 de más se usan solos para pagar el despacho siguiente (#3064). |
| 5 | Cartera: 22 clientes, $73.688,22, con los vendedores indicados | ✅ Correcto | Los 22 nombres, montos y vendedores coinciden. 0 diferencias entre saldo guardado y saldo recalculado. |
| 6 | Si se agregaran de nuevo: cartera $70.867,26 | ✅ Correcto | $73.688,22 − $2.820,96 = $70.867,26. |
| 7 | "Los $3.310,96 de los dos COD sí están registrados" | ⚠️ Mal expresado | $3.310,96 es lo que el informe anterior creía que **faltaba**. Lo que realmente se pagó y está registrado es **$3.625** ($3.135 + $490). La conclusión no cambia. |
| 8 | #3879 "marcado pagado con Zelle $490" | ⚠️ Detalle no señalado | El despacho dice **Zelle**, pero el abono en Cuentas por Cobrar dice **USDT**. El monto es el mismo; el método no. Para cuadrar caja conviene confirmar cuál fue (el informe de octubre dice USDT). |
| 9 | Punto Amarillo quedaría con "$490 de saldo a favor (falso)" | ⚠️ Matiz | En el sistema **no aparecería** como saldo a favor visible: el saldo se queda en $0 y el "saldo a favor" se calcula de otra forma. Los $490 quedarían **escondidos** y se comerían en silencio la siguiente factura del cliente. Es todavía peor que un saldo a favor visible, así que la recomendación de no agregarlos se refuerza. |
| 10 | "Por eso el detalle por despacho muestra #2185 con $2.820,96 y #3879 con $490 pendientes" | ❌ Incorrecto para la aplicación | Reproduje el mismo cálculo que hace la pantalla de Cuentas por Cobrar (primero los abonos enlazados, luego el resto por orden de fecha, del más viejo al más nuevo). Resultado: a Angel Pineda solo le quedan pendientes **#4841 ($3.552,50) y #4844 ($449,60)**, que suman los $4.002,10. Punto Amarillo no tiene nada pendiente. #2185 y #3879 salen pagados. |
| 11 | "143 abonos mencionan un número de despacho pero no tienen enlace, por $153.661,10" | ⚠️ Solo coincide la cantidad | Con un cruce parecido me salen 143 abonos, pero por **$157.932,04**. La diferencia depende de cómo se cuente; no se pudo reproducir la cifra exacta. Para tener contexto: en total hay **482 abonos sin enlace por $540.939,41**. Registrar abonos sin enlazar es lo normal en la operación diaria, no una falla aislada. |

## Qué significa para ti

- **No hay que hacer nada urgente.** La deuda de cada cliente está bien y la pantalla también.
- **No agregues esos abonos de nuevo.** Esto ya lo decía el reporte y se confirma.
- **Opcional (orden y trazabilidad):** enlazar los 4 abonos a sus despachos. Es como engrapar el recibo a su factura: no cambia cuánto se debe, pero ayuda si algún día alguien revisa despacho por despacho. Lo decide luigi.
- **Para revisar con caja:** confirmar si el cobro de $490 del #3879 fue por Zelle o por USDT.

## Cómo se hizo (detalle técnico)

- Consultas **solo lectura** a la base de datos de producción (por la vía de consultas de solo lectura de Supabase).
- Tablas revisadas: `clientes` (saldo guardado), `cuentas_por_cobrar` (cargos y abonos), `notas_despacho` (forma de pago de #2185 y #3879).
- Fórmula del saldo: la misma que usa la base de datos (`trg_recalcular_saldo_pendiente`): cargos menos abonos, sin bajar de 0.
- Cálculo por despacho: se copió la lógica de `src/hooks/useCuentasCobrar.js` (fase 1: abonos con despacho; fase 2: abonos restantes del más viejo al más nuevo) y se aplicó a los movimientos reales.
- Se confirmó que las funciones de conciliación COD del plan de octubre (`supabase/release/main/19_*`) **no están instaladas en producción**, así que no hay ningún proceso automático que pueda volver a crear esos abonos.
- La función de comisiones `comision_238b_cod_pendiente` da "no pendiente" para #2185 y #3879: las comisiones tampoco quedan trabadas por este tema.

## Antecedentes

- [Informe COD de octubre](2026-10-20-informe-cod-bloqueo-pago-mixto.md): ya explicaba que el cobro del #3879 se anotó a mano el 16 de octubre.
- [Plan de conciliación COD](../plans/2026-10-18-solucion-definitiva-conciliacion-cod-corregido.md): de ahí salen los montos "$2.820,96" y "$490" como "sin abono".

## Segunda revisión (mismo día): ¿todos los abonos se reflejaron bien?

El usuario envió un video. Muestra un **reporte de CxC impreso** con un total de **$95.819,76**, donde Ali Rafael Vargas aparece debiendo **$2.092,92 "VENCIDO (4d)"**, y luego la pantalla del sistema, donde ese mismo cliente tiene dos abonos ($1.800 y $292,92) y queda en **$0**.

### En resumen

- **Ali Rafael Vargas está bien.** Debía $2.092,92 (despacho #4068, venció el 27-oct). Pagó $1.800 en efectivo el 02-nov y $292,92 en efectivo el 09-nov. $1.800 + $292,92 = $2.092,92, así que queda en $0. Correcto.
- **El papel es del 31 de octubre.** Reconstruí la cartera de ese día con los movimientos y coinciden los clientes y montos que se ven en el video (Sofía's Foods $9.700, Antoplast $8.443,48, Ferrecostruciones $2.945, Rosinda Simoes $941,40, Quinco 22 $80,20, centavos sueltos, etc.). Reconstruido sale **$95.820,24**: hay 48 centavos de diferencia con el papel que no se pueden explicar sin verlo completo. No importan para el negocio.
- **Todos los abonos registrados están sumados en los saldos** (0 diferencias en todos los clientes).
- **Pero encontré 3 cosas que no son errores de suma, sino posibles errores al registrar:**

| # | Cliente | Qué pasa | Efecto | Qué hacer |
|---|---|---|---|---|
| 1 | **REYKAR A.S.E, C.A** | El 05-oct se registraron **dos abonos de $1.000 con 32 segundos de diferencia**, con la misma referencia ("ENZO CONFIRMO") y la misma descripción ("PAGO FACT 3576"). Los demás pagos de ese momento tienen referencias distintas. | Si fue un doble registro, REYKAR debe **$1.748,46**, no $748,46. | Preguntar a Enzo o a caja si ese día entraron uno o dos pagos de $1.000. |
| 2 | **Decoraciones Encendo Alfa & Omega** | El despacho #1863 ($2.144) se canceló **dos veces**: un abono "Cruce – NO PROCEDE" por $2.144 y además un abono por devolución por $2.144. | Sobran $2.144 en pagos. Eso esconde una deuda real de **$195** (despacho #1954, sin pagos) y deja $1.949 escondidos que se van a comer en silencio las próximas compras a crédito del cliente. | Confirmar y anular uno de los dos abonos de $2.144. |
| 3 | **14 clientes más con pagos de más escondidos** | Sus abonos suman más que sus cargos. Los más grandes: Adalberto Rojas ($1.051), Ferrechuros ($810), A_40 ($600), Carlos Escalona ($356). Varios son abonos de mayo (el primer mes del sistema) sin ningún cargo, seguramente deudas del sistema anterior. Ferrechuros es un pago con saldo a favor y no tiene impacto. | En total, contando Decoraciones Encendo, hay **$4.969,71 en pagos que el sistema no muestra en ningún lado**: el saldo marca $0 y el saldo a favor tampoco los cuenta. Si uno de estos clientes vuelve a comprar a crédito, su deuda nueva aparecerá más baja de lo real. | Revisar caso por caso. Si son deudas viejas, cargar la deuda vieja o anular el abono. |

> **Actualización ([OP-2026-041](OP-2026-041_casos-cxc-caso-por-caso.md)):** al revisarlo caso por caso, $1.014,03 de estos montos (Ferrechuros incluido) resultaron ser registros viejos de pagos con saldo a favor guardados con el tipo equivocado. Lo de que Ferrechuros "no tiene impacto" **era incorrecto**: esos $810 se comerían su próxima compra a crédito.

Detalle técnico: el saldo se calcula como cargos − abonos y nunca baja de 0 (`trg_recalcular_saldo_pendiente`), así que un exceso de abonos queda oculto. El "saldo a favor" se calcula aparte, solo con movimientos de tipo crédito.

## Pendiente / sin verificar

- REYKAR: confirmar con caja si fueron uno o dos pagos de $1.000 el 05-oct-2026.
- Decoraciones Encendo: confirmar cuál de los dos abonos de $2.144 sobra.
- Los 14 clientes con pagos de más escondidos: revisión caso por caso.

- La cifra exacta de $153.661,10 del reporte no se pudo reproducir (ver fila 11).
- El método real del cobro de #3879 (Zelle o USDT) depende de caja, no de la base de datos.
- Seguridad: la llave de acceso a Supabase se compartió por el chat. Se recomienda cambiarla (ver la conversación).
