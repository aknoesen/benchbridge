import { describe, it, expect } from 'vitest'
import {
  KIT, POWER_RESISTOR, kitValues, isKitValue, nearestKitValue, formatValue, type PassiveKind,
} from './kit'

describe('catalog exactness', () => {
  it('has the exact verified ADALP2000 resistor values (20, 1/4 W, ×5)', () => {
    expect(KIT.resistor.map((p) => p.value)).toEqual([
      1.1, 10, 47, 68, 100, 470, 1e3, 1.5e3, 2.2e3, 4.7e3, 6.8e3, 1e4, 2e4, 4.7e4,
      6.8e4, 1e5, 2e5, 4.7e5, 1e6, 5e6,
    ])
    expect(KIT.resistor.every((p) => p.count === 5)).toBe(true)
  })

  it('has the exact capacitor values (13; 220 µF ×1, rest ×2)', () => {
    expect(KIT.capacitor.map((p) => p.value)).toEqual([
      39e-12, 100e-12, 1e-9, 4.7e-9, 10e-9, 47e-9, 100e-9, 1e-6, 4.7e-6, 10e-6, 22e-6, 47e-6, 220e-6,
    ])
    expect(KIT.capacitor.find((p) => p.value === 220e-6)!.count).toBe(1)
    expect(KIT.capacitor.filter((p) => p.value !== 220e-6).every((p) => p.count === 2)).toBe(true)
  })

  it('has the 5 Coilcraft inductor values with part numbers', () => {
    expect(KIT.inductor.map((p) => p.value)).toEqual([1e-6, 10e-6, 100e-6, 1e-3, 10e-3])
    expect(KIT.inductor.map((p) => p.partNumber)).toEqual([
      'RFB0807-1R0L', 'RFB0807-100L', 'RFB0807-101L', 'RFB0807-102L', 'RFB0807-103L',
    ])
  })

  it('has the 3 potentiometer values', () => {
    expect(KIT.potentiometer.map((p) => p.value)).toEqual([5e3, 10e3, 50e3])
  })

  it('keeps the 6.2 Ω power resistor out of the resistor pick list', () => {
    expect(kitValues('resistor').some((p) => p.value === 6.2)).toBe(false)
    expect(POWER_RESISTOR.value).toBe(6.2)
    expect(POWER_RESISTOR.note).toMatch(/power/i)
    // and it is never auto-snapped to
    expect(nearestKitValue('resistor', 6.2).value).not.toBe(6.2)
  })
})

describe('isKitValue', () => {
  it('is true for catalog members (incl. float-y caps) and false for near-misses', () => {
    expect(isKitValue('resistor', 4700)).toBe(true)
    expect(isKitValue('resistor', 1.1)).toBe(true)
    expect(isKitValue('capacitor', 0.0047e-6)).toBe(true)   // 4.7 nF stored float
    expect(isKitValue('inductor', 10e-3)).toBe(true)
    expect(isKitValue('resistor', 1200)).toBe(false)        // 1.2 kΩ — not stocked
    expect(isKitValue('resistor', 22000)).toBe(false)       // 22 kΩ — not stocked (2.2 kΩ is)
    expect(isKitValue('inductor', 0.1)).toBe(false)         // 100 mH — above kit max
  })

  it('absorbs sub-tolerance float drift but rejects a 1% miss', () => {
    expect(isKitValue('resistor', 1000 * 1.004)).toBe(true)  // <0.5%
    expect(isKitValue('resistor', 1000 * 1.01)).toBe(false)  // 1%
  })
})

describe('nearestKitValue (log distance)', () => {
  const v = (val: number) => nearestKitValue('resistor', val).value
  it('snaps correctly within and across decades', () => {
    expect(v(1200)).toBe(1e3)    // 1.2 kΩ → 1 kΩ
    expect(v(3000)).toBe(2.2e3)  // 3 kΩ → 2.2 kΩ (log, not linear)
    expect(v(1300)).toBe(1.5e3)  // 1.3 kΩ → 1.5 kΩ
    expect(v(900)).toBe(1e3)
    expect(v(3e6)).toBe(5e6)     // top decade
    expect(nearestKitValue('inductor', 0.1).value).toBe(10e-3) // 100 mH → kit max 10 mH
  })
})

describe('formatValue', () => {
  const cases: [PassiveKind, number, string][] = [
    ['resistor', 1.1, '1.1 Ω'],
    ['resistor', 4700, '4.7 kΩ'],
    ['resistor', 200000, '200 kΩ'],
    ['resistor', 5e6, '5 MΩ'],
    ['capacitor', 39e-12, '39 pF'],
    ['capacitor', 1e-9, '1 nF'],
    ['capacitor', 100e-9, '100 nF'],
    ['capacitor', 1e-6, '1 µF'],
    ['capacitor', 220e-6, '220 µF'],
    ['inductor', 1e-6, '1 µH'],
    ['inductor', 100e-6, '100 µH'],
    ['inductor', 10e-3, '10 mH'],
  ]
  it('renders engineering units correctly', () => {
    for (const [k, val, want] of cases) expect(formatValue(k, val)).toBe(want)
  })

  it('every catalog label matches formatValue', () => {
    for (const kind of Object.keys(KIT) as PassiveKind[])
      for (const p of KIT[kind]) expect(p.label).toBe(formatValue(kind, p.value))
  })
})
