# Plan: cobro COD en pedidos de pago mixto (funcionamiento completo, "e2e")

**Fecha:** 20 de octubre de 2026
**Estado:** PREPARADO y probado localmente — **listo para la ventana, sin instalar en producción** (sección 9)
**Problema que resuelve:** en los pedidos pagados "parte a crédito + parte por cobrar en entrega (COD)", el botón de cobro COD está bloqueado (caso real: DES-04099). Ver el diagnóstico en [el informe](../operaciones/2026-10-20-informe-cod-bloqueo-pago-mixto.md).

---

## En resumen

1. **La propuesta:** enseñarle al módulo COD a manejar pedidos "parte crédito + parte COD", cobrando **solo la parte COD** con el botón normal, y dejando la parte a crédito en su flujo de siempre (CxC). Nada de parches manuales: pantalla, cálculo contable y comisión quedan encadenados de punta a punta.
2. **El corazón del diseño** es una regla clara de "a qué deuda corresponde cada dólar que entra": los pagos que entran por el botón COD se aplican a la parte COD (ya vienen marcados así), y los pagos comunes de cuenta se aplican primero a la parte a crédito. Así nunca se acredita un pago a la deuda equivocada — que es justo lo que el sistema actual teme y por lo que bloquea.
3. **Lo que NO se toca:** la regla de comisiones actual (todo-o-nada: la comisión nace cuando el COD queda pagado), los permisos por rol, y el flujo de cobro de crédito. El cambio son 2 funciones de cálculo + la pantalla del modal.
4. **Ventana corta:** ~30–45 minutos para instalar, con respaldo previo y "deshacer" preparado. Antes se prueba todo en una base desechable con una matriz de 10 casos.
5. **Bonus:** al instalarlo, el cobro real de #4099 ($1.076,79) y el de #4098 ($3.728) se registran **con el botón**, sin maniobras manuales. Y se acabó el workaround que ya está pasando: el pedido #3879 se cobró el 13 de octubre y, como el botón no dejaba, lo anotaron a nivel de cuenta con la nota *"pago el 13 sistema no lo tomo"*.

---

## 1. Contexto: qué es un pedido de pago mixto y qué está roto

Un pedido de **pago mixto** es uno donde el cliente paga **parte a crédito** ("Cta por cobrar", paga después) y **parte al recibir la mercancía** ("Cobro a destino" / COD, paga en la entrega). Ejemplo real, DES-04099: $1.076,19 a crédito + $1.076,79 COD.

Lo que está roto hoy (verificado en producción, solo lectura):

| Pieza | Comportamiento actual | Problema |
|---|---|---|
| Pantalla "Conciliar COD" | Muestra "manual_review" y **apaga el botón** | No se puede cobrar la parte COD |
| Función de lectura (`resumen_financiero_despacho`) | Marca `manual_review` si el pedido tiene cargos de más de una clase | Trata todo pago mixto como "dudoso" |
| Función de registro (`registrar_pago_externo_cobro_idempotente`) | Rechaza con `LEDGER_AMBIGUO` | Aunque se forzara la pantalla, el fondo también niega |
| Consecuencia | Los operadores registran el cobro **a nivel de cuenta** y alguien marca "pagado" a mano | Vuelve el flujo de 2 pasos sin respaldo cruzado que el release 14 quiso eliminar (pasó en #3879, y antes en el incidente #2185) |

La guarda actual existe por una razón válida: si un pedido tiene dos deudas (crédito y COD), un pago sin indicar a cuál corresponde **no se puede aplicar con seguridad**. El diseño nuevo resuelve la ambigüedad en vez de saltársela.

## 2. Qué significa "que funcione e2e" (criterios de éxito)

Cuando esté instalado, se deben poder observar **exactamente** estas cosas:

1. En un pedido mixto, el botón **"Registrar abono COD" queda activo** y muestra claramente: "Parte COD $X (se cobra aquí) · Parte a crédito $Y (se cobra por CxC)".
2. Al cobrar la parte COD: el dinero queda en el libro **ligado al pedido**, con método, referencia y evidencia (igual que hoy en los pedidos 100% COD).
3. El **flag "cobro_destino_pagado" pasa a `true` solo cuando la parte COD queda en $0**, y entonces **nace la comisión completa** del pedido (regla actual, intacta).
4. La parte a crédito sigue cobrándose por el flujo normal de cuenta (CxC) **sin estorbar** al cobro COD, y viceversa.
5. Reintentar el mismo cobro **no duplica nada** (idempotencia), y un pago mayor a la deuda COD **se rechaza**.

## 3. La propuesta (diseño)

### 3.1 El corazón: regla de atribución del dinero

Para un mismo pedido conviven dos deudas; cada dólar entrante se etiqueta así:

| Tipo de abono | Se aplica primero a | Regla de desborde |
|---|---|---|
| Pago registrado por el botón COD (viene marcado `metodo_pago='cod'`) | **Parte COD** | Nunca a la parte crédito |
| Pago común de cuenta (abono normal de CxC, sin marca) | **Parte a crédito** | Solo si la parte crédito queda en $0, el excedente pasa a la parte COD |
| Pedido 100% COD (sin parte crédito) | **Parte COD** (todos los abonos, como hoy) | — (sin cambios; compatibilidad total con el pasado) |

Esto es aritmética pura y determinista (nada de "adivinar"): el dinero siempre se conserva, cada porción tiene su deuda visible, y **es imposible cobrar dos veces la misma porción** porque el tope de cada pago es la deuda COD que quede.

Casos límite que la regla cubre:
- **Pago parcial COD** → estado "parcial", el flag sigue en `false` (comisión sigue retenida, regla actual).
- **Marca de "pagado" sin dinero que la respalde** (el patrón del incidente #2185 y del caso #3879) → el sistema mantiene "manual_review" y **no permite cobrar de nuevo** hasta que un humano aclare con evidencia.
- **Abonos antiguos sin marca** en pedidos mixtos → la regla los aplica primero a la parte crédito (como eran los cobros de cuenta de antes); si el resultado sigue siendo confuso, el pedido queda en "manual_review" para revisión humana (ejemplo real: #3064, ver sección 4).

### 3.2 Cambios en la base de datos (2 funciones, con respaldo y deshacer)

**A. `resumen_financiero_despacho` (lectura) — versión 2:**
- Calcula por separado: `cargo_cod`, `cargo_cxc`, `abono_cod` (marcados), `abono_cxc` (los demás), y la **deuda de cada porción** con la regla 3.1.
- El estado derivado pasa a mirar **la porción COD**: `pendiente | parcial | cobrado | compensado`, y `manual_review` solo en los casos verdaderamente ambiguos (marca de pagado sin respaldo, abonos antiguos sin atribución clara, COD declarado sin cargo).
- Devuelve los dos montos (`cargo_cxc_usd`, `deuda_cxc_usd`) para que la pantalla muestre las dos porciones.

**B. `registrar_pago_externo_cobro_idempotente` (registro) — versión 2:**
- Sustituye la guarda "dos cargos de clases distintas → `LEDGER_AMBIGUO`" por:
  - el pedido **debe tener su cargo COD** y el monto debe coincidir con el declarado (guardas actuales `LEDGER_AMBIGUO` / `CARGO_NO_COINCIDE`, se conservan);
  - el pago **no puede superar la deuda COD** según la regla 3.1 (`MONTO_NO_COINCIDE`, se conserva);
  - **nuevo:** si el pedido tiene abonos antiguos sin marca cuya atribución sea ambigua → rechaza con `COD_CONCILIACION_ATRIBUCION_AMBIGUA` (mensaje claro para el operador);
  - **nuevo:** si la marca dice "pagado" pero no hay ningún movimiento que la respalde → rechaza con `COD_CONCILIACION_FLAG_SIN_SOPORTE` (protección anti doble cobro, lección #2185).
- El resto queda **idéntico**: abono ligado al pedido + actualización de la marca + auditoría `COD_CONCILIADO_CON_EVIDENCIA` + liberación de la comisión al quedar en $0.

### 3.3 Cambios en la pantalla (`ConciliarCodModal.jsx`)

- Dos tarjetas claras cuando hay pago mixto: **"Parte COD $X — se cobra aquí"** y **"Parte a crédito $Y — se cobra en CxC"**.
- El formulario y el botón se habilitan cuando la deuda COD sea mayor a $0 (los estados `pendiente/parcial` ya son alcanzables para mixtos).
- Aviso específico si el pedido queda en "manual_review": texto que diga **qué** está ambiguo (marca sin respaldo / abonos sin atribuir) y qué hacer (avisar a administración con la evidencia).
- Micro-aviso para el operador: "la parte a crédito se cobra desde la ficha del cliente", para que nadie intente cobrarla por aquí.

### 3.4 Lo que NO cambia (control de alcance)

- **Comisiones:** la "tranca v4" (todo-o-nada: cero comisión mientras el COD no esté pagado; al pagarse nace completa) **se respeta tal cual**. Si alguien paga la parte COD por fuera del botón, la comisión sigue retenida hasta que un humano registre la evidencia — es la política actual y se mantiene.
- **Roles:** mismos permisos de hoy (conciliar COD: administración, jefe, supervisor, desarrollador).
- **Flujo CxC** (abonos de cuenta, saldos a favor, devoluciones): intacto.
- **Sin migraciones de datos:** los estados se calculan en vivo; no se reescribe historia.
- Fuera de alcance (como mejora aparte, si luego quieres): la alerta de "entró un pedido de pago mixto" para tener el cobro preparado antes de la entrega.

## 4. Los 5 casos existentes: qué pasa con cada uno

| Pedido | Situación real (verificado) | Con el cambio |
|---|---|---|
| **#4099** (Inversiones Ferrefrio V&D) | COD $1.076,79 sin cobrar | ✅ **Se cobra con el botón** (este será además la prueba e2e en vivo) |
| **#4098** (Inversiones Ferrefrio V&D) | COD $3.728 sin cobrar | ✅ Se cobra con el botón cuando el cliente pague |
| **#3879** (Ferretería El Punto Amarillo) | Su COD $490 **sí se cobró** (USDT, 13/16 oct) pero quedó anotado **a nivel de cuenta** con la nota *"pago el 13 sistema no lo tomo"*; la marca quedó puesta a mano | ⚠️ Requiere **atribución con evidencia**: ligar ese abono de $490 al pedido (script pequeño con respaldo). Su comisión también se ordena con esto |
| **#3064** (Angel Pineda) | COD $2.000 + crédito $2.187,78; abonos antiguos sin marca por $2.246,28; la marca dice "pagado" | ⚠️ Queda en "manual_review" (ambigüedad real). **Decisión tuya:** confirmar si su COD se cobró (y con qué) para atribuirlo, o corregir la marca |
| **#2832** (ALBERT OMAR RUIZ AVILA) | Todo pagado con abonos antiguos ($16,00) | ✅ Con la regla de desborde queda saldado automáticamente (crédito $15,90 + desborde $0,10 al COD) |

Nota de transparencia: el informe anterior daba #3879 como "sin cobrar"; la verificación fina de su cuenta demostró que **sí se cobró** (fuera del sistema). El informe quedó corregido.

## 5. Plan de pruebas e2e (matriz)

**Nivel 1 — base de datos, en Postgres desechable (Docker), con el arnés local existente (`scripts/test-cod-main-release-local.mjs`, ampliado):**

| # | Caso | Resultado esperado |
|---|---|---|
| 1 | Pedido 100% COD, cobro completo (regresión) | Igual que hoy: `cobrado`, marca `true`, comisión nace |
| 2 | Mixto, cobro COD completo por el botón | `cobrado` solo la porción COD; crédito intacto; marca `true`; **comisión nace completa** |
| 3 | Mixto, cobro COD parcial y luego el resto | `parcial` → `cobrado`; la marca solo salta al final |
| 4 | Mixto, pago del crédito por CxC (abono común) | No altera la deuda COD; el botón sigue cobrable solo por lo que falte |
| 5 | Mixto, pago mayor a la deuda COD | Rechazo `MONTO_NO_COINCIDE` |
| 6 | Reintento con la misma clave (idempotencia) | Segunda llamada inerte, sin duplicar abonos |
| 7 | Marca "pagado" sin movimientos (caso #3879/#2185) | `manual_review` en lectura + rechazo `FLAG_SIN_SOPORTE` al registrar |
| 8 | Abonos antiguos sin marca ambiguos (caso #3064) | `manual_review` + rechazo `ATRIBUCION_AMBIGUA` |
| 9 | Desborde de abono común (caso #2832) | Crédito saldado + desborde al COD → todo saldado |
| 10 | Devolución/cruce en pedido mixto | Semántica de compensación documentada y fijada con este test |

**Nivel 2 — servicios:** ampliar `api/handlers/__tests__/cod.test.js` (contrato del Worker: roles, evidencia obligatoria, mismo origen, claves).

**Nivel 3 — pantalla:** probar el modal en el navegador contra la base local con los casos 2, 3 y 7 (capturas de la pantalla con las dos porciones).

**Nivel 4 — producción (la prueba e2e de verdad):** registrar el cobro real de **#4099** por el botón y verificar los 5 criterios de la sección 2, incluida la comisión del pedido.

## 6. Cómo se instalaría (ventana corta)

1. **Preparación (fuera de ventana):** escribir los SQL con su `review` / `apply` / `rollback` (mismo estilo que los releases 14 y 17), pasar toda la matriz de pruebas locales, y dejar lista la actualización de pantalla.
2. **Preflight solo lectura:** identidad del proyecto, cuerpos actuales de las 2 funciones, y un **dif de estados**: lista exacta de pedidos cuyo estado derivado cambiaría con la regla nueva (con solo 5 mixtos, se revisa a mano).
3. **Respaldo verificable:** guardar los cuerpos actuales byte a byte (patrón ya usado; permite deshacer en minutos).
4. **Ventana (30–45 min, de poca actividad):** aplicar SQL → postflight (checks de catálogo + lecturas reales) → publicar la pantalla nueva (`./deploy.sh`) → **smoke e2e con #4099**.
5. **Cierre:** evidencia de la ventana (salidas guardadas), y luego, con calma, la atribución de #3879 y la decisión de #3064.

**Deshacer (rollback):** restaurar los cuerpos respaldados de las 2 funciones + volver a publicar la pantalla anterior. Sin datos que migrar, así que el deshacer es limpio.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Que la regla de atribución cambie el estado de algún pedido histórico | El **dif preflight** lista cada pedido afectado antes de tocar nada; con 5 casos, revisión humana completa |
| Doble cobro de la misma porción | Tope estricto por deuda COD + guarda de "marca sin respaldo" + idempotencia (ya probada en el release 14) |
| Que alguien cobre la parte COD por la vía de cuenta (fuera del botón) | La regla de desborde conserva el dinero correctamente; la comisión queda retenida hasta registrar evidencia (política actual) y la pantalla lo explica |
| Error en la instalación | Respaldo byte a byte + rollback ensayado antes de la ventana (como en los releases anteriores) |
| Que el cambio toque comisiones | No las toca: solo cambia **cuándo se ve "COD pagado"**, que es el disparador actual de la comisión |

## 8. Esfuerzo y qué necesito de ti

- **Esfuerzo:** una jornada de preparación (SQL + pruebas + pantalla) y una ventana corta de 30–45 minutos. Puedo empezar en cuanto digas "sí".
- **De ti se necesita:**
  1. La aprobación para prepararlo e instalarlo (y una idea de horario para la ventana corta).
  2. Después, dos decisiones puntuales: qué hacer con **#3064** (¿su COD de $2.000 se cobró?) y confirmar la atribución de **#3879** (el abono de $490 de octubre).

---

## 9. Estado de la preparación (2026-10-20) — todo listo para la ventana

La preparación terminó sin tocar producción. Entregables:

| Artefacto | Ruta | Estado |
|---|---|---|
| SQL v2 (resumen + conciliador, con candado) | `supabase/release/main/19_cod_mixto_review.sql` | ✅ generado por ediciones quirúrgicas exactas sobre el release 14 vivo |
| Copia ejecutable para la ventana | `supabase/release/main/19_cod_mixto_apply.sql` | ✅ idéntica, sin candado |
| Preflight solo lectura | `supabase/release/main/19_cod_preflight_readonly.sql` | ✅ |
| Postflight solo lectura | `supabase/release/main/19_cod_postflight_readonly.sql` | ✅ |
| Deshacer | `supabase/release/main/19_cod_rollback_review.sql` | ✅ restaura cuerpos v14 byte-idénticos; **ensayado** |
| Arnés de la matriz (10 casos e2e) | `scripts/test-cod-mixto-release-local.mjs` | ✅ **PASS, exit 0** en PostgreSQL 17 desechable |
| Pantalla | `src/components/despachos/ConciliarCodModal.jsx` | ✅ dos porciones + motivos de revisión |
| Worker | `api/handlers/cod.js` | ✅ códigos nuevos como error de negocio 400 |
| Tests | `api/handlers/__tests__/cod.test.js`, `scripts/lib/invariantes.mjs` (+ `estadoCodDerivadoV2`), tests del modal | ✅ suite completa **559/559 en verde** |

**Lo que probó el arnés** (ruta real: instala release 14 → upgrade 18 → matriz → deshacer, en una base desechable):

1. **Regresión 100% COD**: los valores del contrato v14 son **idénticos** paso a paso (incluidos la política de un centavo y el excedente explícito).
2. **Matriz mixta 10/10**: caso feliz (#4099), pago parcial y cierre, crédito pagado por CxC sin estorbar, rechazo de sobreprecio, idempotencia, #3879 (marca sin respaldo), #3064 (atribución ambigua), #2832 (desborde salda todo), compensaciones (≤ crédito y con desborde) y etiqueta `compensado`.
3. **Rollback ensayado**: restaura la semántica v14 (el mixto vuelve a `manual_review`) sin tocar asientos.

**Dos hallazgos de la preparación** (corregidos y fijados con tests):

- Una compensación parcial NO cuenta como pago parcial: deja `pendiente` (paridad v14 descubierta por la propia regresión).
- El guarda v14 de "deuda total del cliente" compara contra el saldo neto del cliente; cada caso de prueba lleva su propio cliente para no contaminarse (comportamiento del producto sin cambios).

**Decisión de diseño**: la matriz corre en un arnés nuevo hermano (`test-cod-mixto-release-local.mjs`) en vez de ampliar el del release 14, para que ese arnés siga verificando el artefacto 14 intacto.

---

### Anexo técnico (para el equipo de sistemas)

- **Funciones objetivo (producidas por el release 14, vivas hoy):** `public.resumen_financiero_despacho(uuid,uuid)` (`STABLE SECURITY INVOKER`) y `public.registrar_pago_externo_cobro_idempotente(...)` (`VOLATILE SECURITY DEFINER`), ambas con grants solo a `service_role`. Fuente actual: `supabase/release/main/14_cod_financial_rpcs_apply.sql`.
- **Guardas a sustituir:** `ELSIF v_cargo_cod<=0 OR abs(v_cargos-v_cargo_cod)>0.01 THEN v_estado:='manual_review'` (lectura) y `IF v_cargos_cod<=0 OR abs(v_cargos-v_cargos_cod)>0.01 THEN RAISE 'COD_CONCILIACION_LEDGER_AMBIGUO'` (registro). Se conservan: `CARGO_NO_COINCIDE` (cargo COD ≠ monto declarado), `MONTO_NO_COINCIDE` (pago > deuda), `SIN_DEUDA`, `IDEMPOTENCIA_REUTILIZADA`, `FORMA_PAGO_INVALIDA`, `COD_AMBIGUO`.
- **Atribución implementable como sumas puras:** `deuda_cxc = max(0, cargo_cxc − abono_sin_marca)`; `desborde = max(0, abono_sin_marca − cargo_cxc)`; `deuda_cod = max(0, cargo_cod − abono_cod_marcado − desborde)`. En 100% COD: `deuda_cod = max(0, cargo_cod − todos_los_abonos)` (idéntico a hoy).
- **Los abonos del flujo atómico ya salen marcados** (`metodo_pago='cod'`, ver `INSERT` del release 14); los abonos de `/api/cxc/abono` salen sin marca. La distinción ya existe en los datos — el cálculo actual solo no la usa.
- **Comisiones:** `calcularcomisiondespacho_238b` y `comision_238b_cod_pendiente` leen `cobro_destino_pagado` (la "tranca v4", toggle `comision_cod_solo_pagado` activo 13/13 cuentas). El flujo atómico ya llama `recalcularcomisiondespacho_238b` al saldar la porción COD — esa cadena se conserva intacta.
- **Arneses a ampliar:** `scripts/test-cod-main-release-local.mjs` (SQL real en Postgres desechable), `api/handlers/__tests__/cod.test.js`, fixtures `scripts/fixtures/cod-modal/`. Precedente de ensayo con casos montados a mano: la variante 17b (20-oct).
- **Arte previo revisado:** las migraciones staging 277–282 del árbol ERP (`regularizar_cod_efectivo_atomico`, `resumen_financiero_despacho`, `conciliar_cod_con_evidencia`, `fix_cod_parcial_no_compensacion`, `fix_cod_centavo_excedente`) **no** resuelven el caso mixto: su 279 conserva la misma guarda `LEDGER_AMBIGUO`. Esta propuesta es la pieza que falta, diseñada para convivir con ellas si se promueven después.
