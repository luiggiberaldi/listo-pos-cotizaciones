export default {
  test: {
    environment: 'node',
    include: [
      'src/utils/__tests__/**/*.test.js',
      'api/lib/__tests__/**/*.test.js',
      'api/handlers/__tests__/**/*.test.js',
      'src/components/despachos/__tests__/**/*.test.js',
      'src/components/auth/__tests__/**/*.test.js',
      'src/services/__tests__/**/*.test.js',
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
