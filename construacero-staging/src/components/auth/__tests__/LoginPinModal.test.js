// src/components/auth/__tests__/LoginPinModal.test.js
// Contrato anti-congelamiento del PIN: el estado "Verificando…" NUNCA puede
// quedarse congelado. Regresión del bug que dejaba el spinner girando para
// siempre cuando la verificación fallaba (PIN incorrecto, Worker caído,
// red estancada): el modal trataba cualquier objeto de error como éxito
// porque solo miraba si la respuesta era "truthy".
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const modal = fs.readFileSync(new URL('../LoginPinModal.jsx', import.meta.url), 'utf8')
const loginPage = fs.readFileSync(new URL('../../../modules/auth/LoginPage.jsx', import.meta.url), 'utf8')

describe('LoginPinModal — el "Verificando…" nunca se congela', () => {
  it('solo considera éxito un resultado ok EXPLÍCITO, nunca un objeto cualquiera', () => {
    expect(modal).toContain('const ok = res === true || res?.ok === true')
    // El bug original: tratar cualquier objeto de error como éxito
    expect(modal).not.toContain('const ok = await onSubmit(pin)')
  })

  it('libera la interfaz en finally, incluso si la promesa revienta', () => {
    expect(modal).toMatch(/finally\s*\{[\s\S]{0,200}setWorking\(false\)/)
  })

  it('tiene watchdog de 20s que libera la interfaz y cancela la verificación', () => {
    expect(modal).toContain('submissionId')
    expect(modal).toContain('}, 20000)')
    expect(modal).toContain('onCancelPending?.()')
  })

  it('explica el motivo del fallo en vez de girar en silencio', () => {
    expect(modal).toContain('res?.sessionExpired')
    expect(modal).toContain('res?.busy')
    expect(modal).toContain('res.error')
    expect(modal).toContain('La verificación tardó demasiado')
  })

  it('la página de acceso cancela las verificaciones pendientes al cerrar', () => {
    expect(loginPage).toContain('onCancelPending={cancelPendingPin}')
  })
})
