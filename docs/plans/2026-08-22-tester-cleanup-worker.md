# Cleanup del Tester vía Worker

**Fecha:** 2026-08-22  
**Objetivo:** eliminar los últimos deletes directos del `TesterFlowView` que quedaron bloqueados después de aplicar 06.

## Implementación

Se agregó `DELETE /api/admin/tester/cleanup-fixtures` al Worker.

El endpoint:

- exige sesión autenticada y operador con rol `desarrollador`;
- deriva el tenant de `user.id` y no acepta `cuenta_id` del body;
- exige `Idempotency-Key`/`idempotencyKey` UUID;
- limita cada arreglo a 20 UUIDs;
- acepta únicamente tres tipos de fixture: clientes, lotes de movimientos y transportistas;
- vuelve a filtrar todos los accesos por tenant antes de mutar;
- verifica marcadores conocidos antes de borrar:
  - cliente `rif_cedula = J-88888888-0`;
  - transportista `nombre = Transportista Determinista Test`;
  - movimiento con motivo exacto `Ajuste de inventario por tester determinista`;
- devuelve 409 si el ID existe pero no coincide con el fixture esperado;
- trata la repetición como segura: un recurso ya limpiado se convierte en no-op.

Las escrituras internas las realiza el Worker con `service_role`, nunca el navegador. La limpieza de cotizaciones y sus dependencias continúa usando la RPC `tester_cleanup_cotizacion`; los productos continúan usando las RPC tenant-safe de producto a través del Worker.

## Cambios en `TesterFlowView`

Se reemplazaron los deletes directos de:

- `cuentas_por_cobrar`;
- `inventario_movimientos`;
- `reasignaciones_clientes`;
- `transportistas`.

También se movieron al endpoint del Worker las operaciones de desactivar el cliente y el transportista durante el cleanup. Los inserts normales del flujo de prueba no son cleanup y permanecen en sus contratos existentes.

El grep de cleanup ya no encuentra `.delete()` directo en `TesterFlowView.jsx`.

## Pruebas locales

- `api/handlers/__tests__/testerCleanup.test.js`: 4 pruebas PASS.
- Contrato estático `rpcProductContract.test.js`: incluye la prohibición de deletes directos.
- Suite completa: **259/259 PASS** en **27** archivos.
- `node --check api/handlers/admin.js worker.js`: PASS.
- ESLint focalizado: **0 errores**; permanecen warnings heredados de imports/variables preexistentes.
- Build Vite: PASS.

## Deploy

El Worker y el frontend se publicaron juntos:

- URL: `https://listo-pos-cotizaciones.luigistorelogistics.workers.dev`.
- Versión: `f880612c-da8c-49f9-a988-89f0f02bd575`.
- Assets: 87 leídos; 38 nuevos/modificados.

## Smoke remoto aislado

Se ejecutó:

```bash
KARDEX_MAIN_SMOKE_CONFIRM=RUN_TESTER_CLEANUP_SMOKE npm run smoke:tester:cleanup:main
```

El runner `scripts/smoke-tester-cleanup-worker-main.mjs` creó un tenant/Auth temporal, un producto, un movimiento marcado como fixture, un cliente/CxC y un transportista; no utilizó el tenant real de negocio.

Resultado: **PASS**.

- Cleanup remoto de cliente/CxC: PASS.
- Cleanup remoto de lote Kardex: PASS.
- Desactivación del transportista: PASS.
- Replay con la misma clave: PASS.
- Verificación posterior de filas y estados: PASS.
- Eliminación completa del tenant temporal: PASS.

## Alcance y límites

Esta ruta no usa la RPC `limpiar_inventario_atomico`, porque esa función elimina todo el inventario del tenant y sería demasiado amplia para un fixture. Tampoco abre un endpoint genérico de borrado: cada operación está atada a un marcador y a un tenant.

El cleanup compuesto no es una transacción SQL única entre todas las tablas; ejecuta operaciones acotadas y reintentables en secuencia. Si una petición falla a mitad, el Tester puede repetirla sin ampliar el alcance. Las cotizaciones siguen protegidas por la RPC transaccional existente.

## Gate posterior

El endpoint y la UI ya están desplegados y el smoke remoto del endpoint pasó. Falta ejecutar el flujo completo de `TesterFlowView` desde la interfaz con un operador desarrollador para confirmar que los pasos 65–66 terminan en PASS. Ese E2E debe usar únicamente los códigos/marcadores deterministas y verificar que el tenant real no cambie.
