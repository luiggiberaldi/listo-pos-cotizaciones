# ADR-004: Finanzas — devoluciones, reembolsos y ajustes de comisiones

- Estado: Aceptado
- Fecha: acumulado 2026-08 (244–255) a 2026-09-05 (release 06 + espejo 264/267); lección estructural 262→263
- Decisores: Propietario del proyecto; ejecución documentada sesión a sesión en `BITACORA.md`
- Contexto:
  - Las devoluciones tocan inventario, CxC, comisiones y caja al mismo tiempo. Históricamente existían rutas parciales no atómicas que permitían estados inconsistentes (stock devuelto sin ajuste financiero, o comisiones viejas que no escalaban al revesar).
  - Los reembolsos reales al cliente no son lo mismo que un ajuste contable interno: un reembolso mueve dinero (multi-método), un ajuste solo re-clasifica saldos (ej: saldo a favor).
  - El incidente de clase 262→263: una migración con `CREATE OR REPLACE` pisó el bucle multi-fila de comisiones split que había introducido 257, silenciosamente.
- Decisión:
  1. **Atomicidad por operación financiera**: cada ruta crítica es una única función SQL transaccional — devolución parcial financiera (226), reversión de entrega (232), reembolso multi-método con destino de saldo (release 05 / 262), reversión con devoluciones previas (release 06 / 264). Nada deja estados a medias: o todo aplica o nada.
  2. **Idempotencia**: wrappers y alias idempotentes (251 P0 financial idempotency, 261 alias devolución idempotente, 247/249/255 en inventario). Reprocesar el mismo evento no duplica efectos.
  3. **Ajuste contable ≠ cobro real**: `ajustar_finanzas_*` re-clasifica saldos y comisiones; `reembolso` registra el pago real al cliente (multi-método, liquidación mixta). El destino del saldo en devoluciones es explícito: **saldo a favor vs. reembolso** (v1.0.1) y **reembolso multi-método** (v1.0.2). La comisión CxC manual se registra aparte (200) y las comisiones en estado `generada` se excluyen del re-cálculo (238).
  4. **Comisiones multi-fila siempre**: cualquier ajustador que escale comisiones debe recorrer **todas** las filas del despacho (incluidas las split del designado de sábados, 257/260/267), no solo la primera (`SELECT INTO` + `IF FOUND`). Es la lección 262→263, verificada con E2E y con `scripts/audit-function-chains.mjs`.
  5. **Guardarraíles de reversión**: aplicar con patrón **preflight (read-only) → backup de cuerpos vivos → apply transaccional → smoke → rollback probado → postflight**; los releases incluyen su rollback (`*_rollback.sql`) y los cambios de comportamiento nuevo arrancan con toggle OFF (ej: `comision_split_activo`).
  6. **Evidencia de cálculo**: las comisiones guardan evidencia JSON (`calculo_evidencia` con claves `split_*`), que es la fuente para auditar por qué una venta spliteó o no.
- Consecuencias:
  - Positivas: devoluciones y reembolsos reproducibles, sin residuos; auditoría financiera posible fila por fila; el rollback es de 3 escalones (toggle → borrar filas afectadas → reversión completa con backup).
  - De costo: cada función financiera nueva exige verificar su cadena de redefiniciones y la paridad principal/staging (`docs/operaciones/matriz-migraciones.md`); los E2E financieros son obligatorios antes de promover.
- Alternativas consideradas:
  - Ajustes desde el backend (Worker) con múltiples statements — descartado: no hay atomicidad entre statements; todo lo financiero vive en una RPC transaccional.
  - Re-calcular comisiones "solo de la primera fila" por simplicidad — descartado: subpaga al designado split (bug real detectado y corregido con 263).
- Referencias:
  - `BITACORA.md` — sesiones 2026-09-01 a 2026-09-05 (v1.0.1, v1.0.2, release 05/06, split v3, lección 262→263).
  - `docs/runbooks/rollback-base-de-datos.md`
  - `docs/operaciones/matriz-migraciones.md`
  - `docs/runbooks/2026-09-05-runbook-split-sabados-principal.md`
