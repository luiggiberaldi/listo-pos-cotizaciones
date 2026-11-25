# OP-2026-064 — Anular un despacho "Esperando aprobación" ya no pregunta por dinero

**Estado:** **subido a main el 2026-11-24** (commit `18488ec6`, directo a main por orden del dueño, sin solicitud de cambio). 1208 pruebas en verde y compilación correcta. Falta comprobar en pantalla que la versión publicada ya no pregunta por el dinero. Falla registrada: **N27** en [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md).

## En resumen

- Al anular un despacho "Esperando aprobación" (ejemplo: DES-04906, Rosme Franco, $30 Transf./Pago Móvil) el sistema preguntaba "¿Qué pasó con ese dinero?" y ofrecía crear saldo a favor. Eso no tiene sentido: en un despacho por aprobar **todavía no entró dinero**; la forma de pago es solo la intención. El dinero entra al aprobarlo.
- Con el arreglo, anular un despacho por aprobar solo pide el **motivo** (mínimo 5 letras) y la casilla de "entiendo". No se crea saldo a favor ni se pregunta nada del dinero.
- Para no perder rastro, la auditoría guarda igualmente la forma de pago que tenía anotada y la marca como "nunca se cobró".
- Para despachos ya aprobados o entregados todo sigue igual: el diálogo con las 3 opciones se mantiene.

## Qué pasaba (causa)

El diálogo de anulación (OP-2026-052, falla G2) se pensó para despachos con pagos reales. La base de datos (función `cxc_pagos_en_juego_despacho`, migración 305) decide "hay decisión que tomar" con solo mirar que el despacho esté pendiente y tenga una forma de pago anotada. Pero "pendiente" es justo "Esperando aprobación", donde esa forma de pago es solo una intención. Con la publicación de OP-2026-059 (24-nov-2026) el diálogo llegó a producción y apareció en todos esos despachos.

Riesgo real que había: elegir la primera opción ("el cliente pagó") habría **inventado $30 de saldo a favor** para un cliente que nunca pagó.

## Qué se cambió

- `api/handlers/despachos.js`: al anular un despacho pendiente, el servidor ya no exige decisión sobre el dinero ni crea saldo a favor. Si había pagos anotados, la auditoría guarda cuáles eran y que **nunca se cobraron**, junto con el motivo. La consulta de la pantalla (`pagos-en-juego`) ya responde que no hace falta decisión para pendientes.
- **Motivo mínimo: 5 letras** (antes 10), por indicación del dueño, solo al anular. Cambia en la pantalla y en el servidor.
- La pantalla (`DevolverAnularModal.jsx`) no cambió: al no recibir "hace falta decisión", muestra el diálogo simple de anulación.
- **No hay migración nueva**: se todo el cambio está en la pantalla y el servidor, no hay nada que aplicar en la base.
- Prueba nueva en `api/handlers/__tests__/despachoPagos052.test.js`.

## Qué NO se pudo comprobar (pendiente)

- **Datos de producción no consultados** (permiso denegado en esta sesión). El dueño informó que **ningún despacho pendiente ha recibido abono real**; no se verificó con datos.
- No se probó en staging (no hay migración que probar; falta una prueba manual de anular un pendiente tras publicar).

## Cómo comprobar al publicar

1. Crear un despacho de prueba "Esperando aprobación" con forma de pago anotada y anularlo: solo pide motivo; el cliente no recibe saldo a favor.
2. Revisar la auditoría: aparece "Despacho #N anulado con $X en pagos anotados: nunca se cobraron".
3. Anular uno aprobado: sigue saliendo el diálogo con las 3 opciones.
