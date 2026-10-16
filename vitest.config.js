export default {
  test: {
    environment: 'node',
    include: [
      'src/utils/__tests__/**/*.test.js',
      'api/lib/__tests__/**/*.test.js',
      'api/handlers/__tests__/**/*.test.js',
      'scripts/lib/__tests__/codMainRelease.test.js',
      'scripts/lib/__tests__/invariantes.test.js',
      'src/components/despachos/__tests__/ConciliarCodModal.test.js',
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
