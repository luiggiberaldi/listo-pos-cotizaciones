# Retiro variante actualizar_producto_con_kardex de 16 args (PRODUCCIÓN) — 2026-10-26T01:55Z

Proyecto: `oyfyuszgjwcepjpngclv` vía Management API (database/query), script oficial
`scripts/apply-282-retiro-16-produccion.mjs` (`PROD_282_CONFIRM=APLICAR_282_PRODUCCION`).
Respaldo previo: pre-imagen exacta + grants en `supabase/release/main/backup_pre_282/`.
Rollback: `supabase/migrations/282_retira_actualizar_producto_kardex_16_rollback.sql`
(embebido también en `supabase/release/main/282_retiro_16_rollback_review.sql`).
La sentencia de DROP lleva el pase autorizado de la guarda de precios (281) porque la
función es una de las protegidas.

> Nota de transcripción: evidencia reconstruida a mano desde la salida del script
> (el primer POST 5 detuvo el proceso antes de escribir el archivo; era un fallo de
> la PRUEBA, no del apply — ver final).

### PRE 2: inventario de variantes (esperado: 16 y 21 args)
- status: 201
```
[{"proname":"actualizar_producto_con_kardex","pronargs":16,"args":"p_id uuid, p_codigo text, ...","def_md5":"deefcba22799d0d8ae3ffa272e97a0cc","prosecdef":true},{"proname":"actualizar_producto_con_kardex_tenant_safe","pronargs":21,...}]
```

### PRE 4: referencias desde otros cuerpos (esperado: 0)
- status: 201
```
[]
```

### PRE 5: huella de tenant_safe (21 args)
- status: 201
```
[{"def_md5":"5a4cc39385af368790ed114e8143f292"}]
```

### PRE 6: integridad de datos
- status: 201
```
[{"productos":468,"precios_md5":"49051913f9cf9533dbd8bc72b89ee2d9"}]
```

- Pre-imagen del rollback verificada contra la definición viva ✓
  (el script comparó `pg_get_functiondef` vivo con `backup_pre_282/…16.live.sql` antes de aplicar)

### APPLY: 282_retira_actualizar_producto_kardex_16.sql
- status: 201
```
[]
```

### POST 1: la variante de 16 args ya no existe (esperado: true)
- status: 201
```
[{"retirada":true}]
```

### POST 2: tenant_safe intacta (mismo md5 que PRE 5)
- status: 201
```
[{"def_md5":"5a4cc39385af368790ed114e8143f292"}]
```

### POST 3: referencias huérfanas a la variante retirada (esperado: 0)
- status: 201
```
[]
```

### POST 4: integridad de datos idéntica al PRE 6
- status: 201
```
[{"productos":468,"precios_md5":"49051913f9cf9533dbd8bc72b89ee2d9"}]
```

### POST 5 (primer intento): FALLÓ por la prueba, no por el apply
- status: 400
```
{"message":"Failed to run sql query: ERROR:  P0001: IDEMPOTENCY_KEY_OBLIGATORIA ... function actualizar_producto_con_kardex_tenant_safe(...) line 18 at RAISE"}
```
Causa: `tenant_safe` exige llave de idempotencia y la prueba pasó NULL. El apply
estaba correcto (POST 1–4 verdes).

### POST 5 (corregido, corrida `test` del script): comportamiento revertido — edición vía tenant_safe (ruta viva)
- status: 400 (el error ES el mecanismo de seguridad: revierte la transacción completa)
```
{"message":"Failed to run sql query: ERROR:  P0001: ROLLBACK_POR_SEGURIDAD [282] edición vía tenant_safe OK: precio_usd=0 válido, precio_2/3 vaciados a NULL; fixture c590f6e7-675f-44f9-85c1-640b24e79869"}
```
La prueba crea un producto fixture dentro de la transacción revertida, lo edita
por la ruta que usa el Worker (`actualizar_producto_con_kardex_tenant_safe`, con
llave de idempotencia descartable) y verifica el contrato de precios (precio 0 =
válido; vaciar limpia a NULL). Al fallar con `ROLLBACK_POR_SEGURIDAD`, todo
desaparece: la base queda exactamente como estaba.

## Conclusión

282 aplicado y verificado en PRODUCCIÓN ✓ — la variante legada de 16 parámetros
quedó retirada; la ruta viva de edición de productos (`tenant_safe`, 21 args) está
intacta (huella idéntica antes/después) y sigue funcionando; la integridad de
datos es idéntica antes/después (468 productos, huella de precios sin cambios).
