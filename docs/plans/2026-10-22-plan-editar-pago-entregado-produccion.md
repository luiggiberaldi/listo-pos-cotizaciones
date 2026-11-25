# Plan — Dejar funcional en producción: corregir métodos de pago en despachos ENTREGADOS · 2026-10-22

**En resumen:** el "motor" de esta función **ya existe y está en producción** — el servidor
(Worker) permite que administración, jefe o desarrollador corrija los métodos de pago de un
despacho ya entregado, con reglas de seguridad y 6 pruebas automáticas. Lo que falta es la
**puerta**: un botón y una ventanita (modal) en la pantalla del despacho, porque hoy nadie puede
usar esa función. Este plan describe ese trabajo + cómo validarlo en pruebas (staging) + la
ventana para subirlo a producción. **No se ejecuta todavía**: es el guion. Riesgo principal bajo:
esto **no toca la base de datos** — solo pantalla y servidor — así que el plan B es simplemente
volver atrás con la aplicación anterior.

---

## 0. Qué sube y qué NO

| Bloque | ¿Sube? | Piezas que viajan |
|---|---|---|
| **Botón "Editar métodos de pago"** en la tarjeta del despacho (solo visible en despachos ENTREGADOS y solo para administración/jefe/desarrollador) | ✅ Sí | `src/components/despachos/DespachoCard.jsx` |
| **Ventanita (modal) ligera** para corregir los métodos de pago y la referencia, con avisos de seguridad | ✅ Sí | `src/components/despachos/EditarPagoEntregadoModal.jsx` (nuevo) |
| **Cable del botón al servidor** (enviar la señal `soloPagoEntregado`) | ✅ Sí | `src/hooks/useDespachos.js` |
| **Pruebas de la pantalla nueva** | ✅ Sí | `src/components/despachos/__tests__/EditarPagoEntregadoModal.test.js` (nuevo) |
| **Cierre de la brecha con staging**: copiar la función del servidor al árbol de pruebas + sus pruebas | ✅ Sí (solo entorno de pruebas, no toca producción) | `construacero-staging/api/handlers/despachos.js` + pruebas |
| Cambios en la base de datos | ❌ No | **Ninguno.** El servidor ya está listo; no hay migración, ni respaldo especial, ni riesgo para los datos |
| Recálculo automático de comisión | ❌ No | Queda como aviso para revisión manual (decisión de negocio pendiente) |
| Restricción extra para que el servidor solo acepte esta vía en despachos entregados | ❌ No | Mejora posterior (ver §7) |
| Bitácora con valores "antes/después" | ❌ No | Mejora posterior (ver §7) |

## 1. Qué ya está hecho (nada que tocar)

Todo esto está confirmado con pruebas y vive en el árbol de producción (`main`, commit `ef55b45`):

1. **El servidor ya permite la corrección** con estas reglas de seguridad:
   - Solo administración, jefe o desarrollador. Un vendedor recibe rechazo inmediato.
   - Solo acepta los métodos de pago (del despacho y del cliente) + referencia opcional.
     Si llega cualquier otro campo (flete, transportista, notas, cliente, dirección) **rechaza
     la operación completa** — esto protege el resto del despacho.
   - Las reglas del Cobro a destino (COD) siguen intactas: por aquí **no** se puede quitar la
     obligación COD, ni marcarla pagada, ni cambiar su monto. Eso solo pasa por el flujo de
     conciliación con evidencia.
   - No recalcula la comisión (queda aviso de revisión manual).
   - Registra el cambio en la bitácora (quién, cuándo, qué).
2. **6 pruebas automáticas** cubren exactamente esta vía (`api/handlers/__tests__/cod.test.js`).

## 2. El trabajo pendiente (5 piezas, en orden)

### Pieza 1 — Botón en la tarjeta del despacho (`DespachoCard.jsx`)
- Nueva acción **"Editar métodos de pago"** en el menú "Más" (aparece en móvil y escritorio).
- Visible **solo** cuando: el despacho está **entregado** Y el rol es administración, jefe o
  desarrollador (la misma lista de roles que exige el servidor — si no coinciden, alguien vería
  un botón que el servidor rechaza).

### Pieza 2 — Ventanita ligera (`EditarPagoEntregadoModal.jsx`, archivo nuevo)
- Muestra: número del despacho, total, y los métodos de pago actuales editables (método + monto),
  más el campo de referencia.
- La línea de **Cobro a destino (COD) se muestra aparte y en solo lectura**, con su monto y si
  está pagada — porque el servidor no permite tocarla por esta vía.
- Reutiliza el mismo motor de formas de pago que ya usa la pantalla de edición
  (`useFormasPago` + los chips de métodos), para que se vea y funcione igual.
- **Avisos visibles dentro del modal** (no en letra pequeña escondida):
  - "Este cambio NO mueve dinero: si el despacho generó una cuenta por cobrar, la deuda sigue en
    los libros. Alguien debe cuadrarla aparte."
  - "La comisión del vendedor no se recalcula sola: revisarla manualmente después del cambio."
- Valida antes de guardar: que la suma de montos cierre con el total, y que "Cta por cobrar"
  traiga sus días de vencimiento (el servidor lo exige igual).

### Pieza 3 — Cable al servidor (`src/hooks/useDespachos.js`, `useEditarDespacho`)
- Aceptar el flag `soloPagoEntregado` y pasarlo en el mensaje al servidor.
- **Detalle importante:** en este modo el modal debe enviar SOLO los campos de pago
  (`formaPago`, `formaPagoCliente`, `referenciaPago`) — nunca flete/corte/notas/cliente con
  valor (ni siquiera `0`), porque el servidor rechaza todo si detecta un campo de más.

### Pieza 4 — Cerrar la brecha con staging (`construacero-staging/`)
- Copiar el bloque `soloPagoEntregado` del servidor al árbol de pruebas (hoy no lo tiene:
  cero coincidencias — es la divergencia que conviene cerrar), **comparando los cuerpos vivos
  de las funciones, no copiando a ciegas** (regla de `docs/runbooks/deploy-staging.md`).
- Copiar las 6 pruebas del servidor + la pieza de interfaz, adaptadas al árbol staging.
- La interfaz nueva se porta igual (botón + modal + cable), para poder probarla de verdad.

### Pieza 5 — Pruebas de la pantalla nueva
- Prueba del modal: abre con los datos actuales, no deja guardar si la suma no cierra, muestra
  los avisos, y envía exactamente los campos de pago (ninguno de más).
- Prueba de visibilidad del botón: aparece en entregado + rol admin/jefe/dev; NO aparece para
  vendedor, ni en despachos pendientes/despachadas.
- Las 6 pruebas del servidor ya existen: se ejecutan tal cual, sin tocarlas.

## 3. GATES — todo esto en verde ANTES de abrir la ventana

- [ ] Pruebas del proyecto principal en verde (las ~673 existentes + las nuevas de la pantalla).
- [ ] Compilación (`npx vite build`) sin errores (el aviso de "chunks > 500 kB" es conocido).
- [ ] E2E de staging: **123/123 en verde, dos pasadas seguidas** (el cambio toca dinero y
      comisiones → regla del runbook de staging).
- [ ] Prueba visual en staging: entrar como administración, abrir un despacho entregado, botón
      visible → editar método → guardar → el cambio se refleja y queda en la bitácora. Repetir
      como vendedor y confirmar que el botón **no** aparece.
- [ ] Commit preparado y revisado en `main`. **No empujar** hasta el paso 2 de la ventana:
      empujar a `main` despliega producción sola (Vercel + GitHub Actions).

## 4. La ventana de producción (guion, ~20 minutos)

Como **no toca la base de datos**, la ventana es tranquila: no hay respaldo especial obligatorio
ni bloqueo de operaciones. (Si se quiere máxima prudencia, se puede repetir antes el respaldo
habitual de producción.)

1. **Preparación:** correr pruebas + build una última vez; confirmar `git status` limpio y el
   commit identificado.
2. **Empujar a `main`.** Se despliega solo: Vercel (pantalla) y GitHub Actions (Worker).
3. **Verificar despliegues:** el job de GitHub Actions termina en verde; Vercel marca el
   deployment como "Ready".
4. **Pruebas de humo (smoke) en producción:**
   - La app abre y responde 200; `GET /api/ping` → 200.
   - Una ruta privada sin sesión → 401 (no 404, no 500).
   - Entrar como **administración real** → abrir un despacho **entregado** → el botón
     "Editar métodos de pago" aparece → cambiar un método → guardar →
     · el cambio se ve en la tarjeta y en el reporte de ventas,
     · la línea COD NO cambió,
     · el cambio aparece en la bitácora.
   - Entrar como **vendedor** → el botón NO aparece (y si se llamara al servidor a mano,
     responde 403 — las pruebas ya lo cubren).
   - Verificar que la versión del Worker desplegada es la nueva
     (`npx wrangler deployments list`) y anotarlo en la bitácora.
5. **Aviso al equipo** de que la función está disponible, con el aviso de que NO mueve dinero.

## 5. Plan B (rollback)

- **No hay nada que restaurar en datos** — la base de datos no se tocó.
- Pantalla: en Vercel, "Instant Rollback" al deployment anterior.
- Worker: `npx wrangler rollback` (o redeploy del commit anterior).
- Repetir los smoke tests tras el rollback.
- Riesgo residual: el servidor YA tiene la función desde antes (commit `ef55b45`), así que
  aunque se revierta la pantalla, la función del servidor sigue existiendo — pero sin botón nadie
  la usa, que es el estado actual y es seguro.

## 6. Avisos importantes (dinero y comisiones)

- **Cambiar el método de pago no mueve dinero.** Es corregir el rótulo del archivo, no devolver
  nada: si el despacho generó una deuda en CxC y se cambia a "Efectivo $", **la deuda sigue en
  los libros**. Alguien de administración debe cuadrar eso aparte.
- **La comisión del vendedor puede cambiar** con el nuevo método (p. ej. a Donación o COD) y
  **no se recalcula sola** — queda el aviso dentro del modal para revisión manual.
- **COD se protege solo**: por esta vía no se puede quitar ni pagar un Cobro a destino; eso
  pasa únicamente por el flujo de conciliación con evidencia.

## 7. Mejoras opcionales posteriores (NO incluidas en esta ventana)

1. **Cerrar la vía a entregados en el servidor**: hoy el modo especial se acepta en cualquier
   estado; se puede exigir que el despacho esté realmente entregado.
2. **Bitácora "antes/después"**: guardar cómo estaba el pago antes del cambio (hoy guarda solo
   el resultado).
3. **Advertir si el despacho ya tiene cobros reales en CxC** dentro del modal, para ver el
   impacto contable antes de corregir.
4. **Nombre propio en la bitácora** ("Editar pago de entregado") para poder filtrar estos cambios.

---

## Anexo técnico (para quien ejecute)

| Archivo | Cambio |
|---|---|
| `src/components/despachos/DespachoCard.jsx` | Acción en `getMoreActions()`: `label: 'Editar métodos de pago'`, visible con `despacho.estado === 'entregada' && ['administracion','jefe','desarrollador'].includes(rol)`; abre el modal nuevo (mismo patrón que `showConciliarCod`). |
| `src/components/despachos/EditarPagoEntregadoModal.jsx` (nuevo) | Modal con `useFormasPago` + chips de métodos (copiar el bloque de pago de `EditDespachoModal.jsx`), COD solo lectura, avisos fijos, validación de suma y de `diasVencimiento` en "Cta por cobrar". Al guardar envía `{ despachoId, soloPagoEntregado: true, formaPago, formaPagoCliente, referenciaPago }` — nada más. |
| `src/hooks/useDespachos.js` (`useEditarDespacho`, ~línea 472) | Aceptar y reenviar `soloPagoEntregado`. |
| `src/components/despachos/__tests__/EditarPagoEntregadoModal.test.js` (nuevo) | Pruebas de la Pieza 5 (patrón: `ConciliarCodModal.test.js`). |
| `construacero-staging/api/handlers/despachos.js` (`handleEditarPagoDespacho`, ~línea 539) | Portar el bloque `soloPagoEntregado` de `api/handlers/despachos.js` (líneas ~340-363, ~460, ~589), verificando el cuerpo vivo contra producción. |
| `construacero-staging/api/handlers/__tests__/cod.test.js` | Portar el `describe` "métodos de pago en entregada" (6 pruebas, `api/handlers/__tests__/cod.test.js` líneas 295-357). |
| `construacero-staging/src/...` | Portar botón + modal + cable (Piezas 1-3). |

Referencias: contrato del servidor en `api/handlers/despachos.js` (vía nueva con flag
`soloPagoEntregado`, validación ANTES de consultar la base), pruebas en
`api/handlers/__tests__/cod.test.js` (líneas 295-357), runbooks `docs/runbooks/deploy-produccion.md`
y `docs/runbooks/deploy-staging.md`, matriz de entornos en `docs/operaciones/matriz-entornos.md`.
