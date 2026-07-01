// Kit-scoped part-visual helpers (ARB-1). Pure, no React — the realistic bodies drawn on the
// breadboard use these; keeping the value→appearance math here makes it unit-testable.

// Resistor colour code, digits 0–9 (the band multiplier reuses the same table as powers of ten).
export const RES_COLORS = ['#1b1b1f', '#7a4a1e', '#d43a2f', '#e28a2b', '#e8d43a', '#3aa64a', '#2f6fd4', '#8a4fd6', '#8a8f96', '#e8e8ea']
export const RES_GOLD = '#c9a24b'
export const RES_SILVER = '#c8ccd0'

// The 4-band E-series colours for a resistor value: [digit1, digit2, multiplier, tolerance(gold)].
// A teaching bonus — students can read the bands off the board. Empty for a non-positive value.
export function resistorBands(ohms: number): string[] {
  if (!(ohms > 0)) return []
  let v = ohms, exp = 0
  while (v >= 100) { v /= 10; exp++ }
  while (v < 10) { v *= 10; exp-- }
  const d = Math.round(v)
  const mult = exp >= 0 && exp <= 9 ? RES_COLORS[exp] : exp === -1 ? RES_GOLD : exp === -2 ? RES_SILVER : '#cfcfcf'
  return [RES_COLORS[Math.floor(d / 10)] ?? '#1b1b1f', RES_COLORS[d % 10] ?? '#1b1b1f', mult, RES_GOLD]
}

// LED lens colour from its forward voltage (red ~1.8, amber ~2.1, green ~2.2, blue ~3 V).
export function ledColor(vf?: number): string {
  const v = vf ?? 2
  return v < 2.0 ? '#ff4433' : v < 2.4 ? '#ffb020' : v < 2.9 ? '#33dd55' : '#4488ff'
}
