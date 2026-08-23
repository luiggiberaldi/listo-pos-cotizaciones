# Auditoría de PDFs de comisiones

Fecha de actualización: 2026-08-23
Estado: validado localmente, sin cambios remotos

## Alcance

Se validaron los cuatro formatos activos de comisiones:

- General detallado.
- Individual detallado.
- General resumido.
- Individual resumido.

Las rutas activas usan `src/services/pdf/comisionesGeneradasPDF.js` desde `ReportesView.jsx` y `ComisionesView.jsx`.

`src/services/pdf/comisionesPDF.js` permanece reservado para el PDF de ventas. No debe reutilizarse para exportar comisiones.

## Hallazgos y correcciones

- El cliente ausente se corrige priorizando `despacho.cliente_nombre`, con fallback a cliente de despacho, fila y cotización.
- El correlativo se conserva en su columna propia (`despacho.numero`) y el cliente no se mezcla con ese dato.
- El error `Invalid arguments passed to jsPDF.line` se corrige usando coordenadas numéricas finitas y una firma consistente para `drawTableHeader` al cambiar de página.
- El encabezado y las columnas se ajustan a nombres largos y montos en Bs; el detalle separa `Comisión ($)` y `Comisión (Bs)`.
- El conteo de despachos del encabezado y de los resúmenes usa la identidad compartida `despachoid`/ID antes del correlativo, evitando contar filas de producto como despachos distintos.
- La fecha de filtro y la fecha mostrada en el detalle usan la fecha del despacho, no la fecha de creación de la fila de comisión.
- Las filas generadas por el Worker no vuelven a prorratearse por CxC.
- Las filas legacy con pago mixto aplican solo la fracción no-CxC.
- Donaciones, préstamos y productos cuyo nombre comienza por `corte` quedan fuera de la comisión generada.
- Un despacho compuesto únicamente por productos excluidos no reaparece como una comisión genérica.
- En productos legacy mixtos, la parte excluida no se reasigna a los productos válidos.
- El PDF resumido mantiene exclusivamente la fórmula manual: `Comisión período + Comisión CxC manual - Descuento Carro`.
- La CxC no se incluye en los PDFs detallados ni en la comisión generada; solo aparece como campo manual del resumido.
- No hay botón ni acción de pago en `ComisionesView`; el estado visible de comisión es `Generada`. Las referencias a pendiente/pagada que quedan en `ReportesView` pertenecen a saldos de clientes/proveedores o estilos legacy fuera del flujo de liquidación de comisiones.

## Contrato de montos

Para un pago mixto de `$100` con `$40` CxC y `$60` no-CxC:

- Comisión calculada: solo se aplica el factor `0.60` a la comisión legacy.
- La CxC no entra en `totalcomision`.
- La CxC manual del resumido se agrega después, como ajuste administrativo independiente.
- El descuento de carro se resta después del ajuste manual.
- `Total a pagar = Comisión período + Comisión CxC manual - Descuento Carro`.

Las filas de la migración 238 se identifican en la capa Worker como `stored_net_238`; las filas antiguas se marcan como legacy y reciben el ajuste defensivo de lectura. La migración sigue siendo revisable y no se ejecutó remotamente en esta auditoría.

## Evidencia local

Pruebas focalizadas:

- `src/utils/__tests__/comisionUtils.test.js`: 8 pruebas.
- `src/utils/__tests__/comisionesGeneradasPDF.test.js`: 9 pruebas.
- Total focalizado: 17 pruebas aprobadas.

La matriz cubre:

- CxC completa.
- Pago mixto CxC/no-CxC.
- JSON legacy y CxC sin monto.
- Métodos definitivos de COD.
- Donación y préstamo.
- Despachos únicos frente a filas repetidas por producto.
- Prorrateo de producto legacy excluido sin reasignación.
- Cliente, fecha de despacho y rango del corte.
- General detallado.
- Individual detallado.
- General resumido.
- Individual resumido.
- Ausencia del error de coordenadas y paginación de PDFs extensos.
- Fórmula del resumen y conversión a Bs.

Últimos gates ejecutados:

- `npm test`: 31 archivos, 281 pruebas aprobadas.
- `npm run build`: aprobado.
- `node --check api/handlers/comisiones.js`: aprobado.
- `node --check src/services/pdf/comisionesGeneradasPDF.js`: aprobado.
- `git diff --check`: aprobado.
- ESLint focalizado: 0 errores y 67 warnings preexistentes/de limpieza en vistas y hooks; no hay errores bloqueantes.

## Estado visual

Validado automáticamente en los cuatro formatos mediante generación real de `jsPDF` con datos de prueba extensos. No se observaron excepciones de coordenadas, overflow de columnas ni páginas vacías en esa matriz.

La validación visual de navegador con una sesión autenticada y datos reales todavía debe hacerse en staging para confirmar el resultado exacto de descarga, logo, header y valores reales. Esa comprobación no se puede sustituir por una prueba de unidad.

## Pendientes remotos

- No se ejecutaron migraciones, SQL, backups, cambios de datos ni despliegues remotos.
- Antes de aplicar la migración 238 en staging debe confirmarse que el esquema tiene las columnas y relaciones usadas por la función, y tomar backup/baseline.
- Después de aplicar 238 en staging debe auditarse que los montos almacenados sean netos de CxC y que el Worker no vuelva a prorratearlos.
- El SQL conserva columnas y estados legacy por compatibilidad de esquema; el frontend de comisiones ya no ofrece el ciclo de pago.
- Los 67 warnings de ESLint no bloquean build ni tests, pero conviene limpiarlos en una tarea separada antes del deploy final.
