import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const testerSource = fs.readFileSync(path.join(projectRoot, 'src/views/TesterFlowView.jsx'), 'utf8')

describe('contrato del cliente determinista', () => {
  it('busca y reutiliza el cliente dentro del tenant antes de insertar', () => {
    expect(testerSource).toContain('const { data: existingClient, error: lookupError }')
    expect(testerSource).toContain(".eq('rif_cedula', TEST.cliente.rif_cedula)")
    expect(testerSource).toContain(".eq('cuenta_id', user.id)")
    expect(testerSource).toContain('if (existingClient)')
    expect(testerSource).toContain('.update(clientPayload)')
    expect(testerSource).toContain('REUSE cliente existente')
  })

  it('reactiva y normaliza el fixture sin tocar otro tenant', () => {
    expect(testerSource).toContain('cuenta_id: user.id')
    expect(testerSource).toContain('activo: true')
    expect(testerSource).toContain('saldo_pendiente: 0')
    expect(testerSource).toContain(".eq('id', existingClient.id)")
  })

  it('el fixture crea sus clientes CON estado y ciudad (todo cliente es obligatorio)', () => {
    // Regla 2026-10-26: ningún cliente puede quedar sin estado/ciudad — ni siquiera
    // el fixture de pruebas (era el único registro sin estado en producción y
    // disparaba el antiguo selector de respaldo "Estado del destino").
    expect(testerSource).toMatch(/estado:\s*'Carabobo'/)
    expect(testerSource).toMatch(/ciudad:\s*'Valencia'/)
  })
})
