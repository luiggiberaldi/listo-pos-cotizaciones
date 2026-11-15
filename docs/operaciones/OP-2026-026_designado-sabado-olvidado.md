# OP-2026-026 — Sábado 14-nov-2026: no se marcó a Edgar Ramírez como designado del día

**Fecha:** 2026-11-14 · **Estado:** diagnóstico terminado; **sin cambios en producción** (falta la decisión del dueño)

## En resumen

- Hoy (sábado) Edgar Ramírez era el vendedor designado, pero **nadie lo marcó** en la pantalla *Comisiones → Designado del día*. La última designación guardada es del 07-nov (Josué Marciales).
- Por eso las 11 ventas despachadas hoy calcularon la comisión **normal**, sin la división de sábado (0,5 % para el designado y 1,5 % para el dueño del cliente).
- **Se puede arreglar sin perder nada:** ninguna de esas 11 comisiones está pagada, y el sistema ya tiene una herramienta de recálculo que no toca las comisiones pagadas.

## Qué se revisó (solo lectura)

La lectura se hizo con consultas de solo lectura, con las credenciales del proyecto, porque el conector de Supabase negó el permiso. No se modificó ningún dato.

| Despacho | Vendió | Dueño del cliente | Comisión hoy a nombre de | Estado |
|---|---|---|---|---|
| 4747, 4748, 4749, 4752, 4757, 4758, 4759 | Edgar | Edgar | Edgar | generada (sin pagar) |
| 4750 | Edgar | Niki Ramírez | Niki | generada |
| 4753 | Josué | Josué | Josué | generada |
| 4754 | Edgar | Niki Ramírez | Edgar | generada |
| 4756 | Edgar | Josué | Josué | generada |

Las cotizaciones 4751 (Niki) y 4755 (Josué) siguen en estado "enviada" y todavía no tienen despacho.

## Por qué no se arregla solo

- Guardar la designación **solo afecta a los despachos que se calculen después**. No recalcula los ya entregados. La pantalla lo avisa: "aplica SOLO a los despachos creados ese día", pero el cálculo se hace al entregar.
- La regla de cálculo busca la designación por la **fecha del despacho** (hora de Venezuela). Si se designa hoy para el 14-nov y luego se recalcula, el sistema la toma.

## Propuesta

1. **El jefe** (Gabi o Enzo) entra a *Comisiones → Designado del día*, elige el sábado 14-nov, selecciona a **Edgar Ramírez** y pulsa *Designar*. Queda registrado en Auditoría con su nombre.
2. **Recalcular** las comisiones de los 11 despachos de hoy con la herramienta existente `recalcularcomisiondespacho_238b`. Esto cambia datos reales, así que se hace **solo con autorización expresa del dueño**. Antes y después se guarda una foto de cómo estaban y cómo quedaron.
3. Resultado esperado según la regla vigente: en las ventas a clientes de otros (4750, 4753, 4756 y posiblemente 4754), el dueño cobra 1,5 % y Edgar 0,5 %. En los clientes propios de Edgar no cambia nada (el designado que es dueño cobra su % normal).
4. **Para que no se repita (opcional):** un aviso los sábados en la pantalla de inicio del jefe: "Hoy no hay designado".

## Actualización 14-nov (tarde)

- El jefe **ya designó a Edgar Ramírez** para el 14-nov (captura enviada por el dueño). No se pudo comprobar en la base de datos: el sistema de permisos bloqueó la segunda lectura.
- **Mensaje de confirmación mejorado** (`src/views/ComisionesView.jsx`): la ventanita gris del navegador ("listo-pos-cotizaciones.vercel.app dice…", con la palabra técnica "split") se cambió por la ventana de confirmación propia de la app:
  - Título: "¿Designar a *Nombre*?"
  - Explica en palabras simples quién cobra 0,5 % y quién 1,5 %.
  - Si la designación es para **hoy**, avisa que las ventas ya entregadas mantienen su comisión hasta que se recalculen (justo lo que pasó en este caso).
  - Botones: "Sí, designar" / "Cancelar". El mensaje de éxito muestra la fecha legible en vez de "2026-11-14".
- Verificación: el archivo compila sin errores. **No se vio en pantalla** porque no hay usuario jefe de prueba disponible para entrar a la copia de pruebas. **Sin publicar.**

## Recálculo autorizado (14-nov)

- El dueño autorizó el recálculo ("Sí, recalcula").
- No se pudo ejecutar desde aquí: el conector de Supabase y la vía alternativa están **bloqueados por permisos**, y no se intentó saltar ese bloqueo.
- Se preparó la receta [OP-2026-026_recalculo.sql](OP-2026-026_recalculo.sql) para que el dueño la pegue en el editor de Supabase. Hace esto:
  1. Se detiene sin cambiar nada si no hay designación de Edgar para el 14-nov o si alguna comisión ya está pagada.
  2. Guarda una foto de las comisiones de los 11 despachos (antes).
  3. Recalcula cada despacho con `recalcularcomisiondespacho_238b`, que borra la comisión de ese despacho y la vuelve a calcular con la designación.
  4. Muestra una tabla con el antes, el después y la diferencia por despacho y por vendedor.
- **Al reintentar (a pedido del dueño), el acceso funcionó** y el recálculo se hizo desde aquí, sin usar la receta. La receta queda como respaldo.

### Resultado del recálculo (ejecutado 14-nov-2026)

Antes de cambiar nada se comprobó que la designación de Edgar estaba guardada para el 14-nov (creada a las 00:24 UTC del 15-nov) y que ninguna comisión estaba pagada. Las 11 respondieron "recalculado", sin errores.

| Despacho | Antes | Después |
|---|---|---|
| 4747 | Edgar $0,23 | Edgar $0,23 |
| 4748 | Edgar $0,44 | Edgar $0,44 |
| 4749 | Edgar $1,70 | Edgar $1,70 |
| 4750 | Niki $0,42 | Niki $0,32 + Edgar $0,11 |
| 4752 | Edgar $6,42 | Edgar $6,42 |
| 4753 | Josué $8,45 | Josué $6,34 + Edgar $2,11 |
| 4754 | Edgar $3,00 | **Niki $2,25** + Edgar $0,75 |
| 4756 | Josué $0,60 | Josué $0,45 + Edgar $0,15 |
| 4757 | Edgar $0,78 | Edgar $0,78 |
| 4758 | Edgar $2,44 | Edgar $2,44 |
| 4759 | Edgar $0,20 | Edgar $0,20 |
| **Total** | **$24,68** | **$24,69** (1 centavo de redondeo) |

Por persona: **Edgar** $15,21 → $15,33 · **Niki** $0,42 → $2,57 · **Josué** $9,05 → $6,79.

Ojo con el **4754**: antes la comisión completa ($3) era de Edgar, aunque el cliente es de Niki. Con la regla del sábado, el dueño del cliente cobra 1,5 % y el designado 0,5 %, así que Niki pasa a cobrar $2,25 y Edgar $0,75. Es lo que dice la regla, pero conviene que el jefe lo sepa.

Fotos completas guardadas **solo en la computadora del dueño** (`docs/operaciones/OP-2026-026_comisiones_antes.json` y `..._despues.json`). No se suben a git porque el repositorio es público. Con la foto de "antes" se puede volver atrás si hiciera falta.

## Pendiente

- [x] El jefe marca la designación del 14-nov.
- [x] Recálculo ejecutado y verificado.
- [x] Cambio guardado en git: rama `fix/op-026-designado-sabado`, commit `3b6c8ad4` (subido a GitHub; **sin solicitud de cambio ni publicación todavía**).
- [ ] Ver en pantalla la nueva ventana de confirmación y publicarla.
- [ ] Decidir si se hace el aviso de sábado "Hoy no hay designado".
- [ ] Ver la nueva ventana en pantalla y publicar el cambio.
- [ ] Autorización para recalcular y ejecución, con la foto de antes y después anotada aquí.
- [ ] Decidir si se hace el aviso de sábado.
