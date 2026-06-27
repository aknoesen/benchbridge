# ADALM2000 reference specs (from Analog Devices' iio-emu source)

Authoritative M2K device parameters, taken from Analog Devices' own emulator source so the twin can
be checked against ADI's reference model rather than memory. Source: `analogdevicesinc/iio-emu`,
`iiod/context/adalm2000/` (`devices/m2k_adc.cpp`, `devices/m2k_dac.cpp`, `adalm2000.xml`).

## ADC — oscilloscope inputs (1+/1-, 2+/2-)

- 2 channels, IIO names `voltage0` / `voltage1`, samples are `int16` carrying a 12-bit value.
- **12-bit** resolution (`convertRawToVolts...` divides by `1 << 12` = 4096).
- **Two input ranges**, selected by a per-channel gain attribute:
  - high gain (`0.21229`) ≈ **±2.5 V** full scale,
  - low gain (`0.02017`) ≈ **±25 V** full scale.
- Native **100 MSa/s**; selectable effective rates are the filter-compensation keys:
  **{1k, 10k, 100k, 1M, 10M, 100M} Sa/s**.

## DAC / AWG — generator outputs (W1, W2)

- 2 channels, **12-bit**. `vlsb = 10.0 / ((1<<12) - 1) = 10/4095`, so the digital span is **10 Vpp**.
- 16-bit sample container with the 12-bit value MSB-aligned (`raw >> 4`).
- Native **75 MSa/s**; selectable rates **{750, 7.5k, 75k, 750k, 7.5M, 75M} Sa/s**.
- **Output stage (Rev C schematic):** buffer is an **AD8000YCPZ** current-feedback op-amp (A7) on
  ±6 V rails, configured as a **×−11** gain stage. The DAC's ±0.496 V maps to ∓5.456 V, so the true
  output range is ≈ **±5.46 V**. A **49.9 Ω series resistor (R132)** sets the AWG **output impedance
  ≈ 50 Ω**. The AD8000 datasheet rates **linear output current ≈ 100 mA** (a strong driver), so the
  "do not power a circuit from W1/W2" rule is *not* about a weak stage: it is because the 50 Ω series
  resistance divides the amplitude into low-ohm loads, and the AWG is a signal driver, not a
  regulated supply. (AD8000 datasheet, Rev. D: "High output current: 100 mA".)

## Pins / supplies

- `W1` / `W2` AWG outputs; `1±` / `2±` differential scope inputs; `V+` / `V-` programmable supplies
  (0..+5 V / 0..-5 V, ~**50 mA per rail** — the regulated power source); `GND`. These match the
  breadboard/schematic pin names already used in the twin.

---

## Reconciliation with the twin (G-A)

| Parameter | ADI M2K (source) | Twin | Status |
|-----------|------------------|------|--------|
| ADC resolution | 12-bit | Learning Mode 4 / 8 / 12-bit | **Match** (12 = real; 4/8 are pedagogical comparisons) |
| ADC range, high gain | ±2.5 V | `adcRangeV = 5` (±2.5 V); 0 dBFS = 2.5 V | **Match** |
| ADC range, low gain | ±25 V | not modeled | Simplified — single range (see enhancement) |
| Sample rate | {1k…100M}, incl. 100k | default 100 kSa/s | **Match** (100 kSa/s is a real M2K rate) |
| Scope channels | `voltage0/1` = 1±/2± | `1+ 1- 2+ 2-` | **Match** (silkscreen names) |
| AWG output range | ±5 V (≈ ±5.46 V at the AD8000 stage) | amplitude now ±5 V, offset ±5 V | **Aligned in G-A** |
| AWG output impedance | ≈ 50 Ω (R132 = 49.9 Ω) | **49.9 Ω series on W1/W2 in toCircuit** | **Match (modeled)** |
| AWG channels | W1 / W2 | W1 / W2 | **Match** |
| Supplies | 0..+5 / 0..-5 V, ~50 mA/rail | PSU 0..+5 / -5..0 V; **live per-rail current vs 50 mA** | **Match + PSU-2** |

**Takeaway:** the twin already matches the M2K's high-gain teaching configuration on resolution,
scope range, a real sample rate, and channel nomenclature. G-A widened the generator to the M2K's
true ±5 V output.

**Done:** the **AWG ~50 Ω output impedance** is modeled — `toCircuit` emits each W1/W2 as an ideal
source plus a 49.9 Ω series resistor (R132), so loading the generator with a low resistance visibly
divides the amplitude down, exactly as on the bench. "Do not power a circuit from W1/W2" is now
something the student can *see*.

**Noted fidelity enhancement (future):** model the M2K's *two* scope input ranges (±2.5 V high /
±25 V low) with a range selector, so the dBFS reference follows the selected range. The AWG can
generate the full ±5 V, viewed on the ±25 V range on real hardware.

Source: Analog Devices iio-emu — https://github.com/analogdevicesinc/iio-emu (ADIBSD).
