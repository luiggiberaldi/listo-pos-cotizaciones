# Auditoría: error "pends is not defined" en el PDF de comisiones

Fecha: 2026-11-06 · Alcance: solo lectura (no se cambió código de producción).

## En resumen

- **El error es real, pero está en una función que la aplicación ya no usa.** Es la versión antigua
  `generarComisionesPDF` de `src/services/pdf/comisionesPDF.js` (líneas 45–1577).
- Desde el 23-ago-2026 (commit `dbbee238`) **todas las pantallas** (Comisiones, Reportes y el detalle de
  vendedor) usan la versión nueva, que vive en `src/services/pdf/comisionesGeneradasPDF.js`, y esa **no tiene el error**.
- La única parte de `comisionesPDF.js` que sí se usa es `generarReporteVentasPDF` (Reportes → PDF de ventas),
  y **tampoco tiene el error**.
- **Conclusión:** los usuarios no pueden toparse con este fallo. Mi aviso anterior de "falla en producción"
  fue demasiado alarmista: la función falla solo si alguien la llamara directamente.

## Qué pasó

1. El 22-ago-2026 (`f3c4ac8d`, "eliminar flujo de pago") se borraron del código antiguo los cálculos del resumen
   (`pends`, `cxc`, `totalPagado`, `totalPendiente`, `comisionesNormales`, `cuentasCobrar`…), pero se dejaron los
   lugares donde se usaban.
2. Al día siguiente (`dbbee238`) las pantallas se cambiaron al generador nuevo. La función antigua quedó
   olvidada en el archivo, sin que nadie la llame.
3. La revisión automática de código (lint) lo marca: 17 errores "no definido" en esa función (líneas 720–814,
   1168, 1366–1374). No hay errores de este tipo en `generarReporteVentasPDF` (desde la línea 1578).

## Cómo lo comprobé

- Probé la función antigua con datos de ejemplo: falla con `pends is not defined` (tanto detallado como resumido).
- Busqué quién la llama: solo una prueba automática (`comisionesTasa.test.js`), que pasa porque espera un rechazo
  por tasa **antes** de llegar al código roto.
- Las pantallas importan `comisionesGeneradasPDF`; la revisión de código sobre ese archivo no marca variables
  indefinidas y sus pruebas (`comisionesGeneradasPDF.test.js`, `pdfCodigosDeterminista.test.js`) pasan.
- La suite completa de producción pasa (987/987).

## Riesgo y recomendación

| Tema | Riesgo | Recomendación |
|---|---|---|
| Usuarios hoy | Ninguno | — |
| Alguien reutiliza la función antigua por error | Bajo | Borrar la función antigua (≈1.500 líneas) en un cambio aparte y sin prisa |
| Ruido en lint (17 errores) | Bajo | Se elimina al borrar el código muerto |

Antes de borrar: ajustar la prueba `comisionesTasa.test.js` para que apunte al generador nuevo.

## Lo que no se pudo verificar

- No generé un PDF de comisiones con un reporte **real** de producción (no tengo sesión en la app real).
  Conviene que, cuando quieras, descargues uno desde Reportes → Comisiones y confirmes que sale bien.
