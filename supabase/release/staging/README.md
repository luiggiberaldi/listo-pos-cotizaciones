# Enlace de la copia principal en staging

## Estado

El enlace principal y la corrección de comisiones fueron **ejecutados únicamente en staging**.

La cuenta `supervisor@listo.sys` del proyecto staging puede ver el tenant principal restaurado de **CONSTRUACERO CARABOBO C.A.**

La corrección de `comisiones.cuentaid` se aplicó el 2026-08-16 después de un preflight de solo lectura. Se actualizaron 654 filas; no se modificaron montos, estados, fechas, vendedores, despachos ni liberaciones.

La tasa Euro fue verificada por el usuario en staging y se confirmó correcta. No se modificó el proyecto principal.


La copia restaurada conserva un segundo tenant separado. Este paquete **no lo mezcla** con el principal ni modifica las cuentas internas de autenticación.

## Archivos y orden

1. `00_preflight.sql` — consulta de comprobación; no cambia datos.
2. `01_relink_main_tenant.sql` — cambio transaccional; enlaza únicamente el tenant principal con la cuenta de staging.
3. `02_relink_comisiones.sql` — corrección transaccional de la referencia histórica de las comisiones; ejecutado en staging.
4. `99_postflight.sql` — consultas para confirmar el resultado.

## Protección

- Solo está dirigido al proyecto staging `spupqgkdsgohxxfoxydl`.
- Busca la cuenta de destino por `supervisor@listo.sys`.
- Busca el tenant de origen por la configuración `CONSTRUACERO CARABOBO C.A.` en la fila principal.
- Se detiene si la cuenta de staging ya tiene datos propios, para no mezclarlos.
- Se detiene si no encuentra exactamente el origen esperado.
- No cambia `auth.users`, contraseñas ni correos.
- No toca producción.
- El cambio principal está dentro de una transacción: si falla antes de confirmar, se revierte automáticamente.

## Respaldo

Antes de ejecutar `01_relink_main_tenant.sql` debe conservarse el respaldo independiente de staging:

`backup_staging_2026-08-16.dump`

Si después de confirmar la transacción se necesita volver al estado anterior, la opción segura es restaurar ese respaldo de staging; no ejecutar una reversa ciega sobre los mismos identificadores después de crear datos nuevos.

## Decisión de aislamiento

El tenant principal restaurado contiene 10 operadores (9 activos) y los datos de Construacero. El segundo tenant contiene 3 operadores y queda sin enlazar, preservando la separación original.
