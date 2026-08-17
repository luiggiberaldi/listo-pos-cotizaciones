-- apply.sql
-- Paquete reconciliado del proyecto principal.
--
-- IMPORTANTE:
--   * No ejecutar desde este checkout compartido sin aprobación DBA.
--   * Usar únicamente una conexión SQL administrativa del proyecto principal,
--     con backup/PITR y rollback aprobados.
--   * Confirmar manualmente el ref oyfyuszgjwcepjpngclv antes de conectar.
--   * Este paquete NO reaplica 206-226, 231, 232 ni 234: sus objetos ya fueron
--     observados en el catálogo principal.
--   * No incluye la tasa Euro: la lógica de src/hooks/useTasaCambio.js del
--     proyecto principal permanece intacta y no se sincroniza desde staging.
--
-- Uso propuesto, solo después de GO explícito:
--   psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -f apply.sql
--
-- El runner usa \ir, por lo que debe ejecutarse con psql y no pegarse como SQL
-- parcial en un editor que no soporte comandos meta de psql.

\set ON_ERROR_STOP on
\echo 'PRECHECK: proyecto principal — solo lectura'
\ir 00_preflight.sql

\echo 'APPLY: abrir transacción con límites de seguridad'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

\echo 'APPLY: completar configuración global sin sobrescribir valores aprobados'
\ir 01_configuracion_global.sql

\echo 'APPLY: instalar regla de comisión fuera de Carabobo'
\ir ../../migrations/235_comision_flete_fuera_carabobo.sql

\echo 'APPLY: eliminar overloads históricos de RPC de productos'
\ir ../../migrations/233_unificar_rpc_productos.sql

COMMIT;

\echo 'POSTCHECK: verificar catálogo y valores sin mutaciones'
\ir 99_postflight.sql
\echo 'FIN: paquete reconciliado aplicado; revisar salida postflight y registrar aprobación'
