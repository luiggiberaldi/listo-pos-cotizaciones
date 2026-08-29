# Ensayo E2E de inventario en staging

Checklist específico de la comisión de fletes fuera de Carabobo: `docs/plans/2026-08-15-flete-fuera-carabobo-staging.md`.

Archivo:

```text
supabase/staging/228_e2e_devolucion_staging.sql
```

## Garantías de seguridad

- No es una migración de producción.
- Rechaza bases cuyo nombre no contenga `stage`, `staging`, `test` o `qa`.
- Crea fixtures con UUIDs nuevos y números negativos explícitos para no avanzar los correlativos de cotizaciones/despachos.
- Ejecuta todo dentro de una transacción y termina con `ROLLBACK`.
- No modifica los datos persistentes de la base staging.
- La base de producción no debe usarse para este ensayo.

## Ejecución recomendada

1. Crear una base staging separada o un branch/database clone de Supabase.
2. Nombrarla con un identificador como `construacero_staging`.
3. Aplicar allí todas las migraciones hasta la `236`, incluyendo las exclusivas de staging `227`, `229` y `230`. La `231` añade el nombre del operador que aprobó cada despacho, la `232` revierte inventario, CxC y comisión de forma atómica, la `233` elimina overloads ambiguos de las RPCs de productos, la `234` hace tenant-safe la limpieza del Tester, la `235` corrige la comisión manual de staging y la `236` limita la comisión de choferes locales a destinos fuera de Carabobo.
4. Verificar antes de repetir el Tester que `pg_proc` solo tenga la firma de 15 parámetros para `crear_producto_con_kardex` y la de 16 para `actualizar_producto_con_kardex`, y que `tester_cleanup_cotizacion(uuid)` controle `cuenta_id`, use `comisiones.despachoid/cotizacionid` y `pagos_transportistas_despachos`. La corrida anterior falló en el paso 1 porque la `233` todavía no estaba confirmada en la base remota.
5. Ejecutar el SQL con un usuario administrativo de la base:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SET app.construacero_staging = 'CONFIRM_STAGING_ONLY';
-- Opcional en clones multi-tenant:
-- SET app.construacero_cuenta_id = 'UUID-DE-LA-CUENTA-STAGING';
\\i supabase/staging/228_e2e_devolucion_staging.sql
SQL
```

6. Verificar el resultado:

```text
PASS — ensayo staging ejecutado y revertido; no persistieron fixtures
```

Las migraciones `233`, `234`, `235` y `236` deben ejecutarse únicamente contra el proyecto Supabase de staging antes del Tester; no se deben aplicar en producción como parte de esta validación. El ensayo también valida la reversión financiera `232`: restaura el stock neto después de devoluciones/intercambios y elimina los movimientos CxC y la comisión no pagada dentro de la misma transacción. Después comprueba que un destino Aragua genera comisión, que un destino Carabobo queda fuera de la liquidación, y finalmente valida pago FIFO, idempotencia y reversa del pago externo.
