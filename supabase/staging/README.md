# Ensayo E2E de inventario en staging

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
3. Aplicar allí todas las migraciones hasta la `235`. En el staging completo se incluyen también las extensiones `227`, `229` y `230`; la `231` añade el nombre del operador que aprobó cada despacho, la `232` revierte inventario, CxC y comisión de forma atómica, la `233` elimina los overloads ambiguos de las RPCs de productos, la `234` corrige la limpieza tenant-safe del Tester y la `235` limita la comisión de choferes locales a destinos fuera de Carabobo.
4. Verificar en `pg_proc` que `crear_producto_con_kardex` solo conserve la firma de 15 parámetros y `actualizar_producto_con_kardex` la de 16 parámetros. Verificar además que `tester_cleanup_cotizacion(uuid)` incluya el control de `cuenta_id`, use `comisiones.despachoid/cotizacionid` y limpie `pagos_transportistas_despachos`. Si PostgREST aún devuelve `Could not choose the best candidate function`, la `233` no está aplicada.
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

Las migraciones `233`, `234` y `235` deben aplicarse primero en el SQL Editor o mediante una conexión administrativa exclusivamente al proyecto staging; no se deben ejecutar en producción. El ensayo también valida la reversión financiera `232`: restaura el stock neto después de devoluciones/intercambios y elimina los movimientos CxC y la comisión no pagada dentro de la misma transacción. Después comprueba que un destino Aragua genera comisión, que un destino Carabobo queda fuera de la liquidación, y finalmente valida pago FIFO, idempotencia y reversa del pago externo.
