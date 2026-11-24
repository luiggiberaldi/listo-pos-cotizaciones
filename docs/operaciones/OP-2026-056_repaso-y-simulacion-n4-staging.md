# OP-2026-056 — Repaso de lo ya arreglado y simulación de la corrección N4

**Fecha:** 2026-11-24 · **Entorno:** staging para las pruebas; producción **solo leída** para la simulación · **Producción:** sin cambios
**Fase:** 5 del [plan OP-048](../plans/OP-2026-048_plan-arreglo-26-fallas-staging.md) (G1, G3, I1, M2, N4, N11). Ver [REGISTRO-FALLAS-CODIGO.md](REGISTRO-FALLAS-CODIGO.md)

## En resumen

- **Lo que se arregló en OP-042 sigue funcionando junto con todo lo nuevo:**
  - las devoluciones ven los pagos sueltos (G1);
  - el "pagado de más" se ve en la ficha y en el reporte (G3);
  - el selector "¿Qué despacho paga?" (I1);
  - el historial completo de la ficha (M2). **Corrección:** el historial seguía cortado en 100; se arregló en OP-057 (ver la tabla).
- **N4 (13 pagos viejos con saldo a favor guardados como "abono"): simulado en producción solo leyendo.** Al corregirlos, $1.013,69 de "pagado de más" escondido de 11 clientes pasan a $0, y solo FERRETERIA EL GRAN ADONAY cambia su deuda: de $0 a $0,34. Ningún saldo a favor cambia. El guion de corrección está listo y **no se ejecutó**: necesita tu aprobación.
- **N11** (mensajes que no se borraban en staging) quedó resuelto en [OP-049](OP-2026-049_aviso-error-y-doble-clic-abonos-staging.md).

## 1. Repaso de G1, G3, I1 y M2

| Falla | Prueba | Resultado |
|---|---|---|
| G1, G3, I1 | `scripts/verify-op042-cxc-staging.mjs` (navegador real, escenario de OP-042), repetida en [OP-054](OP-2026-054_devolucion-donado-sin-credito-staging.md) con todo lo nuevo | **16/16**. Encendo muestra "Pagado de más" de $1.949; Ferrechuros $810; reporte con 16 clientes y $4.969,71; selector de despacho en REYKAR; la devolución confirmando el Cruce deja la deuda en $294 |
| M2 | `scripts/op056-historial-pantalla.mjs`: ficha de REYKAR en navegador real | **Corrección (OP-057):** esta primera medición estaba mal hecha. Midió otra consulta de la página (424 filas) y no la del historial. Al afinarla en [OP-057](OP-2026-057_acceso-y-consistencia-staging.md) se vio que **el historial seguía cortado en 100** (`.limit(100)`): OP-042 solo había ampliado el resumen. Ya está arreglado y medido: la ficha de REYKAR recibe sus 124 movimientos |

## 2. N4 — simulación en producción (solo lectura)

Script: `docs/operaciones/OP-2026-040_scripts/op056_n4_simulacion.py` (resultado en `.tmp-op040/op056_n4.txt`).

| Cliente | A corregir | Deuda hoy → después | Pagado de más hoy → después |
|---|---|---|---|
| Ferrechuros 2025 | $810,00 | $0 → $0 | $810,00 → $0 |
| JONNY Espinoza | $66,25 | $0 → $0 | $66,25 → $0 |
| Jesus Daniel Chirinos Camacho | $37,50 | $0 → $0 | $37,50 → $0 |
| Ernesto Daniel Castilla Alastre | $31,50 | $0 → $0 | $31,50 → $0 |
| Georgina Gomez | $24,38 | $0 → $0 | $24,38 → $0 |
| Leidy Contreras | $15,75 | $0 → $0 | $15,75 → $0 |
| Héctor Jordan | $9,57 | $0 → $0 | $9,57 → $0 |
| FERRETERIA EL GRAN ADONAY | $8,10 | **$0 → $0,34** | $7,76 → $0 |
| Dayimar Mercado | $5,50 | $0 → $0 | $5,50 → $0 |
| Manuel Veliz | $3,38 | $0 → $0 | $3,38 → $0 |
| Anthony Ruiz | $2,10 | $0 → $0 | $2,10 → $0 |
| **Total** | **$1.014,03** (13 registros) | 1 cliente cambia | **$1.013,69 → $0** |

El saldo a favor de todos queda igual: ya contaba bien.

**Guion de corrección listo:** `docs/operaciones/OP-2026-040_scripts/op056_n4_correccion.sql`.
- Guarda un respaldo de los 13 registros y deja una anotación por registro en la auditoría.
- Cambia el tipo de "abono" a "consumo de saldo a favor".
- Termina en `rollback` (deshacer) a propósito: para aplicarlo hay que cambiarlo a `commit` (confirmar), en un caso propio con tu aprobación.

## 3. Pendiente

- **Aprobar (o no) la corrección N4 en producción.**
- Todo lo de staging (OP-049 a OP-056) sigue sin publicar en producción.
