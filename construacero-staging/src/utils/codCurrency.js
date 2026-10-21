function decimalToUnits(value, decimals) {
  const text = String(value).trim()
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[2] || '').length > decimals) return null
  const scale = 10n ** BigInt(decimals)
  return BigInt(match[1]) * scale + BigInt((match[2] || '').padEnd(decimals, '0') || '0')
}

/** Convert a cent-denominated Bs amount using PostgreSQL-compatible half-up cents. */
export function convertBsToUsd(montoBs, tasa) {
  const tasaNumero = Number(tasa)
  if (!Number.isFinite(tasaNumero) || tasaNumero <= 0 || tasaNumero > 1_000_000_000) return null

  const rateText = tasaNumero.toFixed(8)
  if (Number(rateText) !== tasaNumero) return null

  const bsCents = decimalToUnits(montoBs, 2)
  const rateUnits = decimalToUnits(rateText, 8)
  if (bsCents === null || bsCents <= 0n || rateUnits === null || rateUnits <= 0n) return null

  const usdCents = (bsCents * 100_000_000n + rateUnits / 2n) / rateUnits
  const usd = Number(usdCents) / 100
  return Number.isFinite(usd) ? usd : null
}
