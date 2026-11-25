// Corre SOLO la prueba de OP-2026-069 contra la base de STAGING (nunca producción).
// Uso (desde la raíz del repo):
//   npx vitest run --config docs/operaciones/OP-2026-069_scripts/vitest.staging.config.js
export default {
  test: {
    environment: 'node',
    root: new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    include: ['docs/operaciones/OP-2026-069_scripts/*.staging.test.js'],
    testTimeout: 60000,
  },
}
