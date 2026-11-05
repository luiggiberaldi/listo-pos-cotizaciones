# Aviso diario de cobranza (cuentas por cobrar vencidas y por vencer)

**Fecha:** 2026-11-05 · **Rama:** `feat/aviso-cobranza` · **Estado:** probado en staging (solo lectura), sin publicar.

## En resumen

Jefe y administración reciben **un solo aviso al día** con cuántas cuentas por cobrar están **vencidas** y cuántas **vencen en los próximos 3 días**, con sus montos. Llega al teléfono/PC a las **8:00 a. m. (hora de Venezuela)**, todos los días, y también aparece en la **campanita** la primera vez que entran al sistema ese día. Al tocarlo se abre **Reportes → Crédito**. Si no hay nada vencido ni por vencer, no se envía nada.

Ejemplo: `💰 Cobranza: 4 cuentas vencidas` — `4 vencidas ($3,200.00) · 6 vencen en los próximos 3 días ($5,100.00)`

## Cómo calcula los montos

Cada fila de `cuentas_por_cobrar` guarda el **saldo total del cliente** en ese momento, no lo que falta de esa deuda. Por eso el aviso hace lo mismo que el reporte de Crédito: toma los clientes activos con saldo, aplica sus abonos a los cargos (primero al mismo despacho, luego al más antiguo) y con lo que queda de cada cargo mira su fecha de vencimiento.

- **Vencida:** fecha de vencimiento antes de hoy y todavía con saldo.
- **Por vencer:** vence hoy o en los 3 días siguientes.
- Deudas sin fecha de vencimiento no cuentan.

## Piezas

| Pieza | Archivo |
|---|---|
| Cálculo compartido (servidor y campanita) | `src/utils/cobranza.js` |
| Lectura por cuenta + tarea de las 8 a. m. | `api/lib/cobranza.js` |
| Consulta para la campanita (`GET /api/cobranza/resumen`, solo jefe/administración/desarrollador) | `api/handlers/cobranza.js` |
| Nueva hora programada `0 12 * * *` (12:00 UTC) | `wrangler.toml`, `worker.js` |
| Campanita (una vez al día por operador) | `src/hooks/useAvisoCobranza.js`, `notificationService.js`, `AppLayout.jsx` |
| `Reportes?tab=credito` abre la pestaña Crédito | `src/views/ReportesView.jsx` |

## Pruebas

- Automáticas: 11 nuevas (cálculo, textos, destinatarios por cuenta). Suite completa: 972/972. Build correcto.
- **Staging (solo lectura, envío push interceptado):** 4 cuentas; en la cuenta con datos, 32 clientes con deuda y **los 32 cuadran** (lo pendiente por deuda suma exactamente el saldo del cliente). Resultado: 36 cuentas vencidas por $43,497.15, 0 por vencer. Ningún jefe/administración de staging tiene notificaciones activadas, así que no habría salido ningún push.
- **No probado:** la campanita y la pestaña en el navegador, y la entrega real a un teléfono (ver `auditoria-notificaciones-20261102.md`).

## Hallazgo aparte

La tarjeta **"Deudas por vencer"** del inicio de administración (`api/handlers/dashboard.js`) suma el `saldo_usd` de cada fila, que es el saldo del cliente y no el de la deuda: probablemente muestra montos de más. No se corrigió en este cambio.
