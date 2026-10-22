// scripts/free-dev-ports.mjs
// Libera los puertos de desarrollo de staging (5174 interfaz, 8789 Worker)
// ANTES de arrancar los servicios.
//
// Problema que resuelve: cuando el entorno se cae sin apagado limpio
// (Ctrl+C forzado, reinicio del PC/IDE, corte de luz), los procesos
// workerd.exe de Wrangler quedan vivos "fantasma" escuchando en el puerto
// 8789. Al volver a arrancar, el Worker nuevo convive con el fantasma y las
// peticiones se quedan colgadas sin respuesta: la app se queda en
// "Verificando…" para siempre (bug de octubre 2026).
//
// Este script mata cualquier proceso que esté escuchando en los puertos
// indicados. Se ejecuta solo en el arranque del entorno local de staging;
// no toca nada fuera de estos puertos.
//
// Uso: node scripts/free-dev-ports.mjs [puerto...]   (por defecto 5174 8789)
import { execSync } from 'node:child_process'

const esWindows = process.platform === 'win32'
const puertos = process.argv.slice(2).map(Number).filter(Number.isInteger)
const lista = puertos.length ? puertos : [5174, 8789]

function pidsEscuchandoEn(puerto) {
  const pids = new Set()
  if (esWindows) {
    const salida = execSync('netstat -ano -p tcp', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    for (const linea of salida.split(/\r?\n/)) {
      // Formato: TCP  127.0.0.1:8789  0.0.0.0:0  LISTENING  1234
      const m = linea.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i)
      if (m && Number(m[1]) === puerto) pids.add(Number(m[2]))
    }
  } else {
    try {
      const salida = execSync(`lsof -nP -iTCP:${puerto} -sTCP:LISTEN -t`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      for (const pid of salida.split(/\s+/).filter(Boolean)) pids.add(Number(pid))
    } catch {
      // lsof sale con error si nadie escucha en el puerto: no hay nada que liberar
    }
  }
  return [...pids].filter(pid => pid > 0)
}

let liberados = 0
for (const puerto of lista) {
  for (const pid of pidsEscuchandoEn(puerto)) {
    try {
      if (esWindows) execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
      else process.kill(pid, 'SIGKILL')
      console.log(`[free-dev-ports] puerto ${puerto}: liberado (proceso fantasma ${pid})`)
      liberados++
    } catch {
      console.warn(`[free-dev-ports] puerto ${puerto}: no se pudo liberar el proceso ${pid}`)
    }
  }
}
if (liberados === 0) {
  console.log(`[free-dev-ports] puertos ${lista.join(', ')} ya estaban libres`)
}
