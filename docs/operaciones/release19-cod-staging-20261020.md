# Release 19 — Pagos COD con varios métodos (cobro a destino): aplicado y verificado en staging

**Fecha:** 20 de octubre de 2026
**Entorno:** staging (la copia de pruebas; los clientes reales NO se tocaron)
**Estado:** ✅ instalado, probado con datos reales de prueba y limpio, sin residuos

---

## En resumen

- El **release 19** permite cobrar el "cobro a destino" (COD) de un despacho con **varios
  métodos de pago a la vez** (por ejemplo: efectivo en dólares + pago móvil en bolívares +
  Zelle), de forma segura y sin duplicar cobros si algo se repite.
- Se instaló primero una **base de respaldo (release 14)** y encima el **paquete 19**, en la
  copia de pruebas (staging), todo con verificación de huella digital (md5) para garantizar
  que cada carácter llegó exacto.
- Las **hojas de chequeo** quedaron en verde: 11 de 11 comprobaciones correctas antes y
  después de las pruebas.
- Se probaron los flujos con **datos reales de prueba**: pago parcial, sobrepago rechazado,
  pago en bolívares con tasa congelada, protección contra pagos ambiguos, cobro repetido sin
  duplicar, y regresión sobre despachos reales. **Todo salió como se esperaba.**
- Al terminar se **borraron todos los datos de prueba** (verificado: cero residuos).

**Lo que queda pendiente:** decidir cuándo pasar esto a **producción** (los clientes reales).
Eso es un paso aparte, con su propio plan y momento de menos actividad.

---

## ¿Qué hace este cambio, en palabras simples?

Antes, si un cliente pagaba el COD parte en dólares y parte en bolívares, el sistema no
tenía un camino claro para registrarlo. Ahora:

1. Se pueden registrar **hasta 6 métodos de pago en un solo cobro** (efectivo $, efectivo Bs,
   Zelle, transferencia/pago móvil, punto de venta, USDT).
2. Si el pago es en **bolívares**, el sistema guarda la "tasa del día" usada, como foto fija,
   para que después nadie pueda cambiar el resultado con una tasa distinta.
3. El sistema **reparte el pago entre la parte crédito y la parte COD** del despacho, y si el
   reparto no es claro (por ejemplo, un abono que no dice a qué parte corresponde), en lugar
   de adivinar lo marca como **"revisar a mano"** y no deja que se complete el cobro.
4. Si alguien intenta cobrar de más (más de un centavo), el sistema **lo rechaza** en lugar
   de tragar la diferencia.
5. Si el mismo cobro llega dos veces (por ejemplo, por un doble clic o una repetición de red),
   el sistema lo reconoce y **no duplica el cobro**.
6. La **comisión del vendedor solo nace cuando el COD queda en cero** — todo o nada, como
   hasta ahora.

---

## Qué se hizo, paso a paso

1. **Hojas de chequeo previas (solo lectura):** se confirmó que la base de pruebas estaba
   lista para recibir el cambio.
2. **Transmisión con resguardo:** el SQL se envió por trozos, cada uno con su huella digital
   (md5), y se comparó carácter por carácter antes de ejecutar. Los trozos que no cuadraban
   se corrigieron hasta quedar idénticos.
3. **Instalación en una sola operación protegida:** primero la base (release 14), después el
   paquete 19. La base además trae su propio **resguardo de respaldo** (ver abajo).
4. **Hoja de chequeo posterior:** 11 de 11 comprobaciones en verde.
5. **Pruebas con datos reales de prueba:** 3 despachos de prueba, cada uno con su propio
   cliente (para que nada tocara datos de clientes reales):
   - **Caso A — pago parcial:** el cobro queda en estado "parcial", con la comisión retenida.
   - **Caso B — pago de más:** rechazado con el aviso `MONTO_NO_COINCIDE`.
   - **Caso C — abono ambiguo:** el sistema detectó que un abono de $130 no sabía a qué parte
     correspondía (al desbordar $30 al COD) y lo marcó **"revisar a mano"**
     (`ATRIBUCION_AMBIGUA`) en vez de completar el cobro. ✔ Es el comportamiento deseado.
   - **Pago final en bolívares:** con la tasa congelada, el saldo quedó en cero y la comisión
     nació solo en ese último pago (regla todo-o-nada intacta).
   - **Cobro repetido:** el segundo intento con la misma clave reconoció el cobro anterior y
     **no duplicó nada**.
   - **Regresión:** dos despachos **reales** respondieron sin errores con las claves nuevas,
     y la parte a crédito de los despachos de prueba quedó intacta.
6. **Limpieza sin residuos:** se borraron en orden seguro los datos de prueba (libro de
   cuentas, idempotencia, auditoría, comisiones, despachos, cotizaciones y clientes) y se
   verificó con un escaneo final: **0 filas de prueba en todas las tablas**.

---

## Notas importantes

- **Tabla de respaldo `_cod19_backup_cuerpos`:** la instalación guardó ahí una copia de las
  funciones anteriores (2 registros). Es el "seguro" para poder volver atrás si hiciera falta.
  **No se borró a propósito.** Se puede retirar después de que el release pase a producción.
- **Lado de la aplicación (la interfaz y el servidor):** este trabajo cubre la **base de
  datos** de staging. El código de la aplicación con el nuevo modal de conciliación ya existe
  en el repositorio; su despliegue a staging/producción es un paso aparte.
- **Producción queda pendiente:** cuando se decida, repetir el mismo protocolo (hojas de
  chequeo → transmisión con huella → instalación protegida → pruebas → limpieza) en el
  entorno de producción, preferiblemente en horario de baja actividad.

---

## Apéndice técnico (para quien lo necesite)

- Contrato instalado: `public.resumen_financiero_despacho(uuid,uuid)` (estable, invoker) y
  `public.registrar_pago_externo_cobro_idempotente(uuid,uuid,uuid,uuid,text,jsonb,text,text)`
  (volátil, definer), ambas con `COMMENT ... 'Main COD release 19: ...'`.
- Guardas nuevas: `COD_CONCILIACION_ATRIBUCION_AMBIGUA` y `COD_CONCILIACION_FLAG_SIN_SOPORTE`;
  se mantiene la política de "máximo un centavo de sobrepago" (`v_total_pago>v_deuda_cod+0.01`).
- Permisos: `EXECUTE` solo para `service_role` (ni `anon` ni `authenticated`).
- Atribución por porciones: variables `v_abono_marc_dinero/comp`, `v_abono_comun_dinero/comp`
  y `v_spill_dinero/comp` en el reconciliador; `desborde_sin_marca_usd`, `cargo_cxc_usd`,
  `pago_mixto` y `motivo_revision` en el resumen financiero.
- Verificación de instalación: hoja `supabase/release/main/19_cod_postflight_readonly.sql`
  ejecutada tras la instalación y de nuevo tras la limpieza: 11/11 en verde en ambas.
- Transmisión: troceado con separadores verificados por md5 en origen y destino; instalación
  en una sola transacción con guarda de huella (`6701b6db…` para el baseline 14).

---

## 2026-10-21 — Actualización del contrato: nota opcional y referencia mínima de 4

**En resumen:** el campo "evidencia del pago" del formulario pasó a llamarse **Nota** y
**no es obligatoria** (máximo 500 caracteres; vacía se registra como "(sin nota)"), y la
referencia de los medios que no son efectivo quedó en **mínimo 4 caracteres** (antes 2).
Todo quedó aplicado y probado en staging.

- Archivos actualizados: `19_cod_mixto_apply.sql` y `19_cod_mixto_review.sql` (mismo
  cuerpo, con y sin candado) más las pruebas del modal, del handler, del navegador y del
  arnés mixto (casos nuevos C12). Huellas SHA-256 regeneradas en
  `19_cod_mixto_SHA256SUMS.txt` (`sha256sum -c` → 6/6 OK).
- Re-instalación en staging SOLO del `registrar_pago_externo_cobro_idempotente`
  actualizado, con guarda de huella md5 dentro de la propia transacción (aborta con
  `CHUNK_MISMATCH` si los bytes no coincidían, antes de ejecutar nada).
  `resumen_financiero_despacho` no cambió. Verificación por marcadores en `pg_proc`:
  reglas nuevas presentes, reglas viejas ausentes y `COMMENT` del contrato release 19
  intacto.
- Sondas en vivo (sin escribir datos): nota vacía → pasa la validación; nota de 501
  caracteres → `COD_CONCILIACION_PARAMETROS_INVALIDOS`; referencia de 3 caracteres →
  `COD_CONCILIACION_PAGO_O_REFERENCIA_INVALIDOS`; referencia de 4 → pasa.
- Prueba funcional en navegador (app staging, sesión "Jefe E2E Staging"): **DES-03183**
  (pago mixto $63.30: crédito $30.00 + COD $33.30) → "Marcar COD como pagado" → Zelle
  $33.30, referencia `1234` (4 caracteres) y **nota vacía** → `POST
  /api/despachos/conciliar-cod` 200, aviso "COD conciliado: $33.30", tarjeta "COBRO A
  DESTINO (PAGADO ✓)" y asiento `Pago externo COD — nota: (sin nota)` con referencia
  `1234`. La parte a crédito ($30.00) quedó intacta.
- Suites locales: vitest 559/559, `test:cod` 50/50, `test:cod:browser` 13/13 (incluye
  "la nota es opcional: se envía vacía cuando no se escribe") y suite de staging 19/19.
- **Limitación del entorno:** los arneses de PostgreSQL local
  (`test-cod-mixto-release-local.mjs` y compañía) no pudieron ejecutarse aquí: el
  PostgreSQL de Windows se niega a iniciar con un usuario administrador (la app de
  escritorio corre elevada) y la app bloquea los intermediarios para bajar privilegios.
  El arnés mixto quedó extendido con los casos C12 para correrlo en una máquina sin
  elevación.
