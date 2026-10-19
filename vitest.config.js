export default {
  // Mismo global de compilación que vite.config.js (queryPersister lo usa como
  // cache-buster); con un valor fijo basta para los tests.
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    include: [
      'src/utils/__tests__/**/*.test.js',
      'api/lib/__tests__/**/*.test.js',
      'api/handlers/__tests__/**/*.test.js',
      'scripts/lib/__tests__/codMainRelease.test.js',
      'scripts/lib/__tests__/invariantes.test.js',
      'src/components/despachos/__tests__/ConciliarCodModal.test.js',
      'src/components/inventario/__tests__/ProductoFormMetadatos.test.js',
    ],
    exclude: [
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/dist/**',
      '**/coverage/**',
      '**/docs/**',
    ],
  },
}
