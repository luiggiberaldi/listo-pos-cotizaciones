export default {
  test: {
    environment: 'node',
    include: [
      'src/utils/__tests__/**/*.test.js',
      'api/lib/__tests__/**/*.test.js',
      'api/handlers/__tests__/**/*.test.js',
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
