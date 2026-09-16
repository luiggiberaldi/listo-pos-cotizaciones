// Builds an allowlisted source snapshot with synthetic public configuration, never .env.
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = fssync.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
const run = path.join(root, 'scratch', 'dashboard-role-audit', `build-${Date.now()}`)
const output = path.join(root, 'outputs', 'auditoria-inicio-roles')
await fs.mkdir(run, { recursive: true })
await fs.mkdir(output, { recursive: true })
await fs.mkdir(path.join(run, 'empty-env'))
const sourceDirs = ['src', 'api', 'public']
for (const dir of sourceDirs) await fs.cp(path.join(root, dir), path.join(run, dir), { recursive: true, filter: source => !path.basename(source).startsWith('.env') })
for (const file of ['index.html', 'package.json', 'vite.config.js', 'tailwind.config.js', 'postcss.config.js', 'worker.js']) await fs.copyFile(path.join(root, file), path.join(run, file))
await fs.symlink(path.join(root, 'node_modules'), path.join(run, 'node_modules'), 'junction')
const env = { ...process.env, VITE_SUPABASE_URL: 'https://dashboard-qa.test.invalid', VITE_SUPABASE_ANON_KEY: 'qa-public-key-no-real-credentials', VITE_WORKER_ORIGIN: '' }
for (const key of Object.keys(env)) if (/^(SUPABASE_|VITE_.*(?:KEY|TOKEN|SECRET|URL|ORIGIN)|FINANZAS_|SYNC_SECRET)/.test(key) && !['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_WORKER_ORIGIN'].includes(key)) delete env[key]
const worker = `
import { build } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)};
await build({ root:${JSON.stringify(run)}, configFile:${JSON.stringify(path.join(run, 'vite.config.js'))}, envDir:${JSON.stringify(path.join(run, 'empty-env'))}, build:{outDir:'dist',emptyOutDir:false} });
`
let log = ''
const child = spawn(process.execPath, ['--input-type=module', '-e', worker], { cwd: run, env, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.on('data', chunk => { log += chunk; process.stdout.write(chunk) })
child.stderr.on('data', chunk => { log += chunk; process.stderr.write(chunk) })
const code = await new Promise(resolve => { child.on('error', error => { log += error.stack; resolve(1) }); child.on('exit', resolve) })
await fs.writeFile(path.join(output, 'build.log'), log)
const evidence = { status: code === 0 ? 'passed' : 'failed', exitCode: code, node: process.version, root: run, dist: path.join(run, 'dist'), isolation: 'Allowlisted source snapshot; empty envDir; synthetic public keys; no deployment; original dist preserved.' }
await fs.writeFile(path.join(output, 'build-verification.json'), JSON.stringify(evidence, null, 2))
if (code === 0) await fs.writeFile(path.join(root, 'scratch', 'dashboard-role-audit', 'latest-build.json'), JSON.stringify(evidence, null, 2))
process.exitCode = code ?? 1
