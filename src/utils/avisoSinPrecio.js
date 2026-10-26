// src/utils/avisoSinPrecio.js
// Aviso "sin precio" (2026-10-26): cuando alguien intenta meter al carrito un
// producto sin precio mayor que 0 (regla src/utils/precioVenta.js), el sistema
// lo bloquea y además AVISA con sonido de fallo + aviso visible (toast), para
// que el usuario entienda por qué no se agregó.
import { showToast } from '../components/ui/Toast'

// Sonido de FALLO ("denegado"): dos pulsos graves descendentes sintetizados
// con el navegador (sin archivos de audio, funciona también sin conexión).
let _audioCtx = null

function reproducirSonidoFallo() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    if (!_audioCtx) _audioCtx = new Ctx()
    const ctx = _audioCtx
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const t0 = ctx.currentTime
    const pulso = (inicio, freq, dur) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(freq, inicio)
      gain.gain.setValueAtTime(0.0001, inicio)
      gain.gain.exponentialRampToValueAtTime(0.14, inicio + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, inicio + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(inicio)
      osc.stop(inicio + dur + 0.05)
    }
    pulso(t0, 190, 0.14)        // primer golpe grave
    pulso(t0 + 0.18, 130, 0.22) // segundo golpe más grave: "fallo/denegado"
  } catch { /* silencioso */ }
}

// Muestra el aviso de "no se puede vender porque el precio es $0".
// Acepta un producto (objeto), un nombre (string), o una lista de ambos.
export function mostrarAvisoSinPrecio(producto) {
  const lista = Array.isArray(producto) ? producto : [producto]
  const nombres = lista
    .map(x => (typeof x === 'string' ? x.trim() : String(x?.nombre ?? '').trim()))
    .filter(Boolean)

  const mensaje = nombres.length > 1
    ? `⛔ No se pueden agregar ${nombres.length} productos: su precio es $0 (${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? '…' : ''}). Asígnale un precio en Inventario para poder venderlos.`
    : nombres.length === 1
      ? `⛔ No se puede agregar "${nombres[0]}": su precio es $0. Asígnale un precio en Inventario para poder venderlo.`
      : '⛔ No se puede agregar el producto: su precio es $0. Asígnale un precio en Inventario para poder venderlo.'

  reproducirSonidoFallo()
  showToast(mensaje, 'error', 5000)
}
