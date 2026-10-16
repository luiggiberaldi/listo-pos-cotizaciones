export default {
  test: {
    environment: 'node',
    include: [
      'scripts/lib/__tests__/codMigration.test.js',
      'scripts/lib/__tests__/comisionNetaBucketMigration.test.js',
      'scripts/lib/__tests__/resumenFinancieroMigration.test.js',
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
