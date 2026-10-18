#!/usr/bin/env node
// scripts/test-cod.mjs
// Gate de los tests COD: exige el manifest COMPLETO de archivos antes de correr vitest.
//
// Motivo: `vitest run <archivos>` trata los argumentos como FILTROS. Si un archivo
// no existe pero los demas si, vitest corre MENOS tests y sale en verde (caso real
// observado: 45 -> 42 tests PASS con codCurrency.test.js ausente). Un PASS con
// archivos faltantes no es un PASS valido para el release.
//
// Uso: npm run test:cod

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Debe coincidir exactamente con los filtros de "test:cod" en package.json.
const TESTS_COD = [
  'api/handlers/__tests__/cod.test.js',
  'src/components/despachos/__tests__/ConciliarCodModal.test.js',
  'src/utils/__tests__/codCurrency.test.js',
  'scripts/lib/__tests__/codMainRelease.test.js',
]

const faltantes = TESTS_COD.filter((rel) => !existsSync(join(ROOT, rel)))
if (faltantes.length > 0) {
  console.error('test:cod ABORTADO - faltan archivos de test del manifest:')
  for (const rel of faltantes) console.error('  [FALTA] ' + rel)
  console.error('Restaure los archivos antes de validar. Correr con menos tests no es valido.')
  process.exit(1)
}

const child = spawn('npx', ['vitest', 'run', ...TESTS_COD], {
  stdio: 'inherit',
  shell: true,
  cwd: ROOT,
})
child.on('error', (err) => {
  console.error('No se pudo invocar vitest: ' + err.message)
  process.exit(1)
})
// El codigo de salida de vitest es el codigo de salida de test:cod: no se reinterpreta.
child.on('close', (code) => process.exit(code ?? 1))
