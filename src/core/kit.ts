// ADALP2000 Analog Parts Kit — passive value catalog (SCH-10). Pure, no React/DOM/SPICE.
//
// Hardware-faithful principle (same as SCH-8/SCH-9): a passive can only carry a value that
// physically exists in the kit. These are the exact discrete kit values from the Analog Devices
// ADALP2000 product-highlights sheet (wiki.analog.com/ADALP2000) — NOT a computed E-series — so
// they are hardcoded. Values are stored in SI base units (ohms, farads, henries); `formatValue`
// is the single place engineering units are rendered, so the inspector and labels stay consistent.
//
// Scope (SCH-10): value availability only — no tolerance/Monte-Carlo, no BOM enforcement. The
// `count` field is carried for a future availability check, not enforced now. The Analysis union,
// netlist directives, and ngspice element emission are untouched.

export type PassiveKind = 'resistor' | 'capacitor' | 'inductor' | 'potentiometer'

export interface KitPart {
  value: number        // SI base units: ohms, farads, henries
  label: string        // engineering display, e.g. "4.7 kΩ", "100 nF", "10 µH"
  partNumber?: string  // e.g. "RFB0807-100L"
  count: number        // how many in the kit (for a future BOM/availability check)
  note?: string        // e.g. "10 W power resistor"
}

// ── engineering-unit formatting (single source of truth) ──────────────────────────
const SYMBOL: Record<PassiveKind, string> = {
  resistor: 'Ω', capacitor: 'F', inductor: 'H', potentiometer: 'Ω',
}
// Largest-first so the first prefix whose magnitude fits gives a mantissa in [1, 1000).
const PREFIX: [string, number][] = [
  ['M', 1e6], ['k', 1e3], ['', 1], ['m', 1e-3], ['µ', 1e-6], ['n', 1e-9], ['p', 1e-12],
]

// Engineering notation + unit, e.g. formatValue('resistor', 4700) → "4.7 kΩ".
export function formatValue(kind: PassiveKind, value: number): string {
  if (!Number.isFinite(value) || value === 0) return `0 ${SYMBOL[kind]}`
  const a = Math.abs(value)
  let chosen = PREFIX[PREFIX.length - 1]
  for (const p of PREFIX) { if (a >= p[1]) { chosen = p; break } }
  const mant = +(value / chosen[1]).toFixed(3)
  return `${mant} ${chosen[0]}${SYMBOL[kind]}`
}

// ── verified ADALP2000 catalogs (SI base units) ───────────────────────────────────
// Resistors, 1/4 W, 20 values × 5 each.
const R_VALUES = [
  1.1, 10, 47, 68, 100, 470, 1e3, 1.5e3, 2.2e3, 4.7e3, 6.8e3, 1e4, 2e4, 4.7e4,
  6.8e4, 1e5, 2e5, 4.7e5, 1e6, 5e6,
]
// The kit also ships ONE 6.2 Ω 10 W power resistor. It is kept OUT of the normal picklist (and out
// of isKitValue / nearestKitValue) so a generic 1/4 W resistor is never auto-snapped to it; it is
// exported separately for a future power-component feature.
export const POWER_RESISTOR: KitPart = { value: 6.2, label: '6.2 Ω', count: 1, note: '10 W power resistor' }

// Capacitors, 13 values × 2 each (220 µF ×1).
const C_VALUES = [
  39e-12, 100e-12, 1e-9, 4.7e-9, 10e-9, 47e-9, 100e-9, 1e-6, 4.7e-6, 10e-6, 22e-6, 47e-6, 220e-6,
]
// Inductors, Coilcraft RFB0807, 5 values × 2 each (with kit part numbers).
const L_PARTS: { value: number; partNumber: string }[] = [
  { value: 1e-6, partNumber: 'RFB0807-1R0L' },
  { value: 10e-6, partNumber: 'RFB0807-100L' },
  { value: 100e-6, partNumber: 'RFB0807-101L' },
  { value: 1e-3, partNumber: 'RFB0807-102L' },
  { value: 10e-3, partNumber: 'RFB0807-103L' },
]
// Potentiometers — 3 values. (No potentiometer schematic component exists yet, so the inspector
// picker doesn't surface these; the catalog is carried here for completeness and a future phase.)
const POT_VALUES = [5e3, 10e3, 50e3]

export const KIT: Record<PassiveKind, KitPart[]> = {
  resistor: R_VALUES.map((v) => ({ value: v, label: formatValue('resistor', v), count: 5 })),
  capacitor: C_VALUES.map((v) => ({ value: v, label: formatValue('capacitor', v), count: v === 220e-6 ? 1 : 2 })),
  inductor: L_PARTS.map((p) => ({ value: p.value, label: formatValue('inductor', p.value), partNumber: p.partNumber, count: 2 })),
  potentiometer: POT_VALUES.map((v) => ({ value: v, label: formatValue('potentiometer', v), count: 1 })),
}

// ── helpers ───────────────────────────────────────────────────────────────────────

// The pick list for a passive kind (excludes the special power resistor).
export function kitValues(kind: PassiveKind): KitPart[] {
  return KIT[kind]
}

// True if `value` matches a catalog value within a relative tolerance (absorbs float
// representation of values like 0.0047 µF). 0.5% is far tighter than any kit decade gap.
const REL_TOL = 0.005
export function isKitValue(kind: PassiveKind, value: number): boolean {
  return kitValues(kind).some((p) => Math.abs(value - p.value) <= REL_TOL * Math.abs(p.value))
}

// Closest catalog part by LOG distance (ratio), so 1.2 kΩ → 1 kΩ and 3 kΩ → 2.2 kΩ are judged
// correctly across decades rather than by raw difference. Non-positive input → the smallest part.
export function nearestKitValue(kind: PassiveKind, value: number): KitPart {
  const parts = kitValues(kind)
  if (!(value > 0)) return parts[0]
  return parts.reduce((best, p) =>
    Math.abs(Math.log(value / p.value)) < Math.abs(Math.log(value / best.value)) ? p : best,
  )
}
