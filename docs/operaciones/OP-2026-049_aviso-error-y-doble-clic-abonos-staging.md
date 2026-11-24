# OP-2026-049 — Aviso de error y protección contra doble clic al registrar abonos (staging)

**Fecha:** 2026-11-23 · **Entorno:** solo staging (copia de pruebas) · **Producción:** sin tocar
**Fallas del registro que atiende:** N10 (grave), G4 (grave), N11 (menor) — ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md)
**Plan del que forma parte:** fase 1 de [OP-2026-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md)

## En resumen

- **Si un abono no se puede guardar, ahora la pantalla lo dice clarito**: aparece un aviso rojo dentro del formulario ("No se guardó el abono…") y otro arriba. Lo escrito se queda en el formulario para reintentar. Antes no salía nada y el operador podía creer que el abono estaba guardado (así pudieron "perderse" abonos como el de Yahveh, [OP-047](OP-2026-047_abonos-no-registrados-y-pruebas-staging.md)).
- **Un doble clic ya no guarda el abono dos veces.** Y si alguien intenta registrar **el mismo monto al mismo cliente en menos de 15 minutos**, el sistema pregunta "¿Es otro pago?" antes de guardar. Esto evita casos como Yhoel Sánchez (2 × $500 en 7 segundos) o REYKAR (2 × $1.000).
- **Los mensajes verdes ya se borran solos** en staging, para que un "Abono registrado" viejo no confunda después de un fallo.
- **Probado:** 23 de 23 pruebas en un navegador real y 387 de 387 pruebas automáticas, sin errores. **Nada de esto está en producción todavía**: para pasarlo hace falta un caso propio y tu aprobación.

## Qué cambió para el operador

| Situación | Antes | Ahora (staging) |
|---|---|---|
| El abono falla (sesión vencida, sin internet, error del servidor) | Ningún mensaje. El botón volvía a la normalidad como si nada | Aviso rojo en el formulario + mensaje rojo arriba, con el motivo en palabras simples. Lo escrito no se borra |
| Sesión vencida | Silencio | "Tu sesión venció. Vuelve a entrar con tu PIN." |
| Sin internet | Silencio | "No se guardó el abono: No hay conexión con el servidor. Revisa internet y vuelve a intentar." |
| Doble clic en "Confirmar abono" | Se guardaban 2 abonos | Se guarda 1 |
| Reintentar tras un fallo | Riesgo de duplicar si el primero sí había llegado | El reintento usa la misma "huella" de la operación: si el primero llegó, no se guarda otro |
| Mismo monto al mismo cliente en menos de 15 minutos | Se guardaba sin preguntar | Aviso amarillo "¿Es otro pago?" con dos botones: **Sí, es otro pago** (guarda) / **No, cancelar** (no guarda) |
| Mensaje verde "Abono registrado" | En staging se quedaba pegado para siempre | Se borra solo a los pocos segundos (igual que producción) |

Los formularios de **Cargar saldo a favor**, **Devolución de saldo** y **Cruzar saldo a favor** también muestran ahora el aviso rojo si fallan y no aceptan un segundo clic mientras se está guardando.

## Cómo funciona (explicado simple)

- **Aviso de error:** antes, la pantalla le preguntaba al servidor "¿guardaste?" y, si la respuesta era "no", la ignoraba. Ahora lee la respuesta y, si es "no", lo muestra.
- **Huella de la operación (clave única):** cada abono que se escribe en la ficha recibe un número de huella. La base de datos ahora tiene una regla: **no puede haber dos abonos con la misma huella**. Así, aunque lleguen dos clics o un reintento, solo entra uno. Es como un ticket numerado: el mismo ticket no se puede cobrar dos veces. Si el operador cambia el monto o los datos, se genera una huella nueva.
- **Aviso "¿Es otro pago?":** el servidor revisa si ese cliente ya tiene un abono del **mismo monto en los últimos 15 minutos**. Si lo hay, no guarda y pregunta. El operador decide.

## Pruebas hechas

**En un navegador real contra staging** (`construacero-staging/scripts/op049-abonos-pantalla.mjs`, cliente de prueba "PRUEBA OP047 ABONOS"): **23/23 bien**.

1. Abono correcto: se guarda, sale "Abono registrado", el formulario queda vacío y el mensaje verde se borra solo.
2. Tres fallos simulados (sesión vencida, error del servidor, sin internet): en los tres sale aviso rojo en el formulario y arriba, no se guarda nada, el monto sigue escrito y **no** aparece "Abono registrado".
3. Reintento después del fallo: se guarda una sola vez y el aviso rojo desaparece.
4. Doble clic: se guarda **un** abono.
5. Mismo monto otra vez: aparece "¿Es otro pago?"; mientras se decide no se guarda nada; "No, cancelar" no guarda; "Sí, es otro pago" guarda uno.

Capturas en `tmp/op049/` (no se suben a GitHub; contienen datos de prueba). En `02-falla-4.png` se ve el aviso rojo dentro del formulario y los mensajes rojos arriba.

**Pruebas automáticas:** 387/387 en 45 archivos (incluye 7 nuevas en `api/handlers/__tests__/abonoClaveUnica049.test.js`: huella guardada, reintento con misma huella, dos envíos a la vez, huella de otro cliente rechazada, aviso de abono repetido, confirmación y caso normal). **Construcción de la app** (`npm run build`): correcta.

**Limpieza:** el cliente de prueba y el operador temporal se borraron; quedó 0 en staging.

## Archivos cambiados (staging)

- `construacero-staging/src/hooks/useCuentasCobrar.js` — lectura de errores del servidor y mensajes claros (`llamarApiCxc`, `avisarErrorGuardado`); el abono manda su huella.
- `construacero-staging/src/components/clientes/FichaClienteModal.jsx` — aviso rojo dentro de los formularios, bloqueo del segundo clic, huella por operación y aviso "¿Es otro pago?".
- `construacero-staging/api/handlers/cxc.js` — el servidor respeta la huella y avisa de abonos iguales recientes (`POSIBLE_DUPLICADO`).
- `construacero-staging/src/components/ui/Toast.jsx` — los mensajes se borran solos (N11).
- `construacero-staging/src/components/despachos/EditarPagoEntregadoModal.jsx` — el cuadre automático del modal de pago entregado no pregunta "¿Es otro pago?" (ya tenía su propia huella) y muestra sus propios errores.
- `construacero-staging/supabase/migrations/301_staging_cxc_abono_clave_unica.sql` (+ `_rollback.sql`) — columna `idempotency_key` y regla de "huella única" en `cuentas_por_cobrar`. **Aplicada en staging y verificada.**
- Pruebas: `api/handlers/__tests__/abonoClaveUnica049.test.js` (nuevo), `src/components/despachos/__tests__/EditarPagoEntregadoModal.test.js` (ajustado).

## Lo que queda pendiente

- **No está en producción.** Pasarlo requiere un caso nuevo, aplicar la migración 301 en producción y tu aprobación explícita.
- **N8 y N9** (el servidor todavía no valida que el detalle de formas de pago sume el monto, ni da un mensaje claro si el monto supera la deuda): siguen abiertos; la prueba A2/A5 de OP-047 seguirá fallando hasta arreglarlos.
- **I2** (guardar el abono y el nuevo saldo en un solo paso dentro de la base): abierto.
- La huella única protege los **abonos**. "Cargar saldo a favor", "Devolución de saldo" y "Cruzar saldo a favor" ya bloquean el doble clic en la pantalla, pero el servidor todavía no tiene la regla de huella para ellos.
- Abonos ya duplicados en producción (Yhoel Sánchez, REYKAR, Zelle $78) siguen como estaban: son corrección de datos, van en sus casos ([OP-044](OP-2026-044_auditoria-12-clientes-abonos.md), [OP-046](OP-2026-046_donaciones-y-registro-de-abonos.md)).
- Sin publicar en GitHub: no hay solicitud de cambio ni commit todavía.
