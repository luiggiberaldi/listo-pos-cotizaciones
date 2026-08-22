# Smoke test controlado — productos con Kardex

**Fecha:** 2026-08-22  
**Proyecto:** principal (`oyfyuszgjwcepjpngclv`)  
**Worker:** `listo-pos-cotizaciones`  
**Objetivo:** comprobar el flujo nuevo antes de revocar los permisos legacy de producto.

## Deploy

Se publicó el Worker junto con el frontend compilado:

```bash
npm run build && npx wrangler deploy
```

- Build: PASS.
- Version ID: `592ebdec-3a8e-4f50-9a96-cd3bc092b1b3`.
- URL: https://listo-pos-cotizaciones.luigistorelogistics.workers.dev
- Assets: 87 leídos; 38 nuevos/modificados publicados.
- Smoke HTTP de la raíz: 200 OK.

## Diseño seguro del smoke

El runner `scripts/smoke-product-worker-main.mjs` exige:

```text
KARDEX_MAIN_SMOKE_CONFIRM=RUN_PRODUCT_SMOKE
```

Crea una cuenta Auth y un operador temporales, usa ese tenant aislado para todo el ciclo y elimina los fixtures al finalizar. Nunca utiliza el tenant real de negocio para crear el producto de prueba.

Uso reproducible:

```bash
KARDEX_MAIN_SMOKE_CONFIRM=RUN_PRODUCT_SMOKE npm run smoke:products:main
```

Las credenciales se leen localmente desde `.env`/`.dev.vars` y no se imprimen ni se guardan en el reporte.

## Resultado del ciclo

Fixture: `SMOKE-WORKER-mt3pw4qn`.

| Paso | Resultado |
|---|---|
| Crear producto vía Worker | PASS |
| Repetir crear con la misma clave | PASS; respuesta idempotente |
| Actualizar producto y stock `0 → 2` | PASS |
| Repetir actualización con la misma clave | PASS; respuesta idempotente |
| Borrar producto vía Worker | PASS; egreso `2 → 0` |
| Repetir borrado con la misma clave | PASS; respuesta idempotente |
| Provenance `product_update` | PASS |
| Provenance `product_delete` | PASS |
| Tres claves en `inventario_operaciones` | PASS |
| Auditoría del ciclo | 3 filas |
| Limpieza del tenant temporal | PASS; 0 usuarios, productos, movimientos, operaciones y auditorías |

No quedaron fixtures del smoke en la base.

## Baseline post-smoke

Auditoría read-only del principal después del test:

- Productos: **445**.
- Stock total: **284.317,00**.
- Movimientos: **3.715**.
- Anomalías matemáticas detectadas: **0**.
- Errores de auditoría read-only: **0**.
- Movimientos históricos sin provenance: **3.691**, sin cambio; corresponden a la deuda histórica documentada.

## Confirmación de estado de grants

`06_security_grants_review.sql` **todavía no fue aplicado**. El preflight posterior al smoke confirmó temporalmente:

- `authenticated` aún tiene `UPDATE` y `DELETE` sobre `productos`.
- `authenticated` aún tiene `EXECUTE` sobre las tres RPC legacy.

Esto es correcto: el objetivo del smoke era validar el reemplazo antes del corte de permisos, no revocarlos automáticamente.

## Gates restantes antes de aplicar 06

1. Confirmar el deploy de esta versión en la ventana operativa.
2. Mantener el smoke automatizado como evidencia reproducible.
3. Migrar el resto de deletes directos del cleanup de `TesterFlowView` sobre tablas ya cubiertas por `06a`.
4. Capturar backup fresco nativo y/o lógico.
5. Revisar el SQL `06_security_grants_review.sql` y ejecutar su `--apply` solo con confirmación explícita.
6. Ejecutar postflight de grants y repetir un smoke sin RPC legacy.
