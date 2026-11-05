# Plan de arreglo: tarjeta "Deudas por vencer" del inicio

**Fecha:** 2026-11-05 · **Origen:** `docs/operaciones/auditoria-deudas-por-vencer-20261105.md` · **Estado:** propuesto, sin empezar.

## En resumen

Se arregla en **dos partes**:

- **Parte A (ahora):** la tarjeta calcula bien, aparece al lado una nueva cifra de **"Vencidas"** y se corrige la prueba automática. Solo cambia cómo se *muestra* el número, no toca datos guardados. **Riesgo bajo.**
- **Parte B (después, aparte):** las fechas de vencimiento nuevas se calculan con el día de Venezuela y no con la hora del servidor. Cambia cómo se *guardan* las ventas nuevas, así que va separada y con más cuidado. **Riesgo medio-bajo.**

Ninguna parte necesita cambios en la base de datos ni respaldo. Cada una se prueba en staging, se compara con producción solo leyendo y se publica con tu autorización.

**Qué verás al terminar la Parte A** (con los datos de hoy en producción):

| Tarjeta | Hoy | Después |
|---|---|---|
| Deudas por vencer (7 días) | $5,549 · 2 cuentas | $5,549 · 2 cuentas (hoy ya coincide) |
| **Vencidas** (nueva) | no existe | **$49,976 · 45 cuentas** |

La diferencia en "por vencer" se notará en las semanas en que venzan deudas de clientes que ya debían o que ya pagaron: hoy esas semanas salen infladas hasta unas 13 veces.

---

## Antes de empezar

- **Depende del aviso de cobranza** (rama `feat/aviso-cobranza`): el cálculo correcto ya está en `src/utils/cobranza.js` (`cargosPendientes`, `fechaCaracas`, `sumarDias`). La Parte A se hace **después de publicar el aviso**, partiendo de `main`, para reutilizar ese cálculo y no copiarlo.
- Rama nueva: `fix/deudas-por-vencer`.

## Parte A — Que la tarjeta muestre la verdad

### A1. Cálculo en el servidor
**Archivo:** `api/handlers/dashboard.js` (bloque `if (isAdministration)`, ~líneas 147-160) y `api/lib/cobranza.js`.

1. Hoy la tarjeta pide los cargos con `saldo_usd > 0` y suma `saldo_usd`. Ese valor es el saldo total del cliente al crearse la deuda, por eso infla y cuenta deudas ya pagadas.
2. En su lugar se reutiliza la lectura del aviso: clientes **activos** con saldo → sus cargos y abonos → `cargosPendientes` (abonos primero al mismo despacho, luego por antigüedad).
3. Con lo pendiente de cada cargo a crédito (`metodo_pago = 'cxc'`, igual que hoy):
   - **Por vencer:** vence de hoy a hoy + 6 días (la misma ventana de 7 días que hoy).
   - **Vencidas:** vence antes de hoy y todavía tiene saldo.
4. Respuesta: `operaciones.deudasPorVencer = { cantidad, totalUsd }` (mismo formato que hoy) y nueva `operaciones.deudasVencidas = { cantidad, totalUsd }`.
5. Para no duplicar código, `api/lib/cobranza.js` expone una función que devuelve los cargos pendientes de una cuenta, y la usan tanto el aviso como la tarjeta, cada uno con su ventana (aviso 3 días, tarjeta 7).

### A2. La pantalla
**Archivo:** `src/views/DashboardView.jsx` (~línea 141).

- La tarjeta "Deudas por vencer" se queda igual (mismo texto y formato).
- Al lado, una tarjeta nueva **"Deudas vencidas"** en rojo: monto y "N cuentas · ya pasaron su fecha".
- Las dos llevan a **Reportes → Crédito** (`/reportes?tab=credito`, que ya funciona con el aviso).
- Se quita la tarjeta "Cuentas por cobrar" de la línea 142: su condición (`!administration && access.receivables`) nunca se cumple, porque solo administración tiene `receivables`. Es código muerto.

### A3. Pruebas automáticas
**Archivo:** `api/handlers/__tests__/dashboard.test.js` (datos en la línea 62).

- Se reemplazan los datos irreales (saldo = monto) por un caso realista: un cliente que ya debía $500, una deuda nueva de $90 (en la fila queda `saldo_usd` 590) y un abono de $40 a ese despacho → la tarjeta debe decir **$50**, no $590.
- Una deuda totalmente pagada que vence esta semana **no** cuenta.
- Una deuda vencida con saldo aparece en "Vencidas" y no en "Por vencer".
- Un cliente inactivo no cuenta.
- Un rol que no es administración no recibe ninguno de los dos datos (como hoy).

### A4. Verificación
1. Suite completa (`npm test`) y build.
2. **Staging:** ver el inicio como administración en el navegador. Hoy debe mostrar por vencer $0 y **vencidas 36 · $43,497.15**, lo que coincide con la auditoría.
3. **Producción, solo lectura:** correr `node tmp/auditar-deudas-por-vencer.mjs produccion` y confirmar que el nuevo cálculo da lo mismo que la columna "Correcto" ($5,549 por vencer · $49,976.45 vencidas al 5 de noviembre; las cifras cambiarán con los días).
4. Publicar (pasar a `main`), con tu autorización, y revisar el inicio real de administración.

**Cómo deshacerlo:** basta con revertir el cambio; no deja nada guardado en la base de datos.

## Parte B — Fecha de vencimiento con el día de Venezuela (después)

**Problema:** al crear la deuda, la fecha se calcula con la hora del servidor (UTC). Una venta registrada después de las 8 p. m. de Venezuela, que en UTC ya es el día siguiente, queda con vencimiento **un día más tarde**.

**Dónde:**
- `api/handlers/despachos.js` líneas ~1266-1269 y ~1866-1869 (cuentas por cobrar).
- `api/handlers/proveedores.js` línea ~423 (cuentas por pagar a proveedores, mismo error).

**Arreglo:** `fecha_vencimiento = sumarDias(fechaCaracas(ahora), días)`, con las funciones que ya existen en `src/utils/cobranza.js`.

**Cuidado:**
- Solo afecta a deudas **nuevas**. Las viejas **no se corrigen** automáticamente. Si quieres corregirlas, sería un ajuste de datos aparte, con respaldo y tu autorización explícita (no está incluido en este plan).
- Pruebas: una venta a las 9 p. m. de Venezuela con 15 días de crédito debe vencer exactamente 15 días después **de ese día en Venezuela**.
- Probar en staging creando una venta de prueba y luego limpiarla.

## Fuera de este plan
- Mostrar estas cifras también al **jefe** (hoy su inicio no tiene tarjetas de cobranza). Es una decisión de negocio: dime si lo quieres.
- Corregir las fechas de vencimiento ya guardadas (ver Parte B).

## Orden y tiempos

| Paso | Qué | Necesita de ti |
|---|---|---|
| 0 | Publicar el aviso de cobranza | Tu "sí" para guardar y publicar |
| 1 | Parte A completa + pruebas + staging | Nada |
| 2 | Comparación con producción (solo lectura) | Permitir la lectura cuando aparezca el aviso |
| 3 | Publicar Parte A | Tu autorización |
| 4 | Parte B (rama aparte) | Tu autorización para empezar y para publicar |

---

## Avance

**Parte A — hecha (rama `fix/deudas-por-vencer`), pendiente de publicar.**
- La tarjeta usa `leerCargosPendientes` + `resumirCargos` (los mismos del aviso de cobranza). Por vencer: de hoy a hoy + 6 días. Vencidas: antes de hoy, con saldo.
- Cambio respecto al plan: ya no se filtra por `metodo_pago = 'cxc'`. Cuenta toda deuda con fecha de vencimiento, igual que el reporte de Crédito y el aviso, para que las tres pantallas digan lo mismo.
- Se dejó sin tocar la tarjeta muerta "Cuentas por cobrar": no hace daño y quitarla no era necesario.
- Pruebas: 2 nuevas en `dashboard.test.js` (caso realista: antes $1,370, ahora $140; fallan con el código viejo). Suite 974/974, build correcto.
- Verificado solo leyendo, 2026-11-05: **producción** por vencer 2 · $5,549, vencidas **45 · $49,976.45**; **staging** 0 · $0 y 36 · $43,497.15. Coincide con la auditoría.
- No verificado: la tarjeta en el navegador.

**Parte B — no se hace por ahora (no es necesaria).** Medido en producción (solo lectura, 2026-11-05): de 200 deudas con fecha de vencimiento, **0** se registraron después de las 8 p. m. de Venezuela, así que ninguna quedó corrida un día. Revisar si el negocio empieza a registrar ventas de noche (`tmp/medir-parte-b.mjs`).
