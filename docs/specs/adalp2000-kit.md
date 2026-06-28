# Spec — ADALP2000 parts kit (the twin's component library)

Authoritative parts list for the on-screen component library (ROADMAP SCH-8 / SCH-9 / SCH-10), so a
student's parts on screen match the physical **ADALP2000 Analog Parts Kit** that ships with the M2K.
Design with what you have, then transfer to the breadboard.

Source: `wiki.analog.com/university/tools/adalp2000/parts-index` (verify against the current kit BOM
at implementation time; values below were confirmed from the parts index / andre, 2026-06-28).

## Passives

### Resistors — 1/8 W axial (20 values)

`1.1 Ω · 10 Ω · 47 Ω · 68 Ω · 100 Ω · 470 Ω · 1 kΩ · 1.5 kΩ · 2.2 kΩ · 4.7 kΩ · 6.8 kΩ · 10 kΩ ·
20 kΩ · 47 kΩ · 68 kΩ · 100 kΩ · 200 kΩ · 470 kΩ · 1 MΩ · 5 MΩ`

Note: these are **1/8 W** (smaller body than the usual 1/4 W). If the breadboard min-lead-spacing
(`MIN_RESISTOR_HOLES`, currently 4) ever feels too strict, the 1/8 W body is the reason to revisit it.

### Capacitors

- **Ceramic disc** (non-polarized): `39 pF · 100 pF · 0.001 µF (1 nF) · 0.0047 µF (4.7 nF) ·
  0.01 µF (10 nF) · 0.047 µF (47 nF) · 0.1 µF (100 nF)`
- **Electrolytic can** (**polarized**): `1 µF · 4.7 µF · 10 µF · 22 µF · 47 µF · 220 µF`

Notes:
- Electrolytics are polarized → the twin's capacitor part likely needs a polarized variant (orientation
  + a reverse-voltage flag) once these are stocked, distinct from the ceramic (non-polarized) part.
- **No film capacitors in the base kit.** Lab 8's RC-filter film caps (e.g. 330 nF polyester) are
  ordered separately (see `CapacitorOrder_EEC1_Spring2026.md`); the library should label cap dielectric
  (ceramic / electrolytic / film) and not imply the kit stocks film.

### Inductors — 5 mm radial (5 values)

`1 µH · 10 µH · 100 µH · 1 mH · 10 mH`

### Variable / sensor passives

- Potentiometers: `5 kΩ · 10 kΩ · 50 kΩ` (3-terminal variable R)
- Thermistor (1; value/type per BOM)

## Actives (from the parts index)

- **Op-amps:** `ADTL082` (JFET dual), `AD8542` (CMOS RRIO dual), `OP27` (precision bipolar),
  `OP37` (precision bipolar, decompensated, gain ≥ 5), `OP97` (precision µpower),
  `OP482` (JFET quad), `OP484` (RRIO quad).
- **Instrumentation amp:** `AD8226` (plus the `INA125` used in Lab 8).
- **Comparator:** `AD8561`. **Current-shunt amp:** `AD8210`.
- **Transistors:** BJT `2N3904` / `2N3903` (NPN), `2N3906` (PNP); MOSFET `ZVN2110A` / `ZVN3310A` (N),
  `ZVP2110A` (P).
- **Diodes:** `1N914` / `1N3064` (signal), `1N4001` (rectifier), `1N4735` (~6.2 V Zener),
  `1N4729` (~3.6 V Zener). (Zener voltages approximate; verify.)

### Out of scope for the circuit twin

Specialized kit parts not part of the analog-circuit teaching: `AD584` (voltage ref),
`LT3080` / `LT3092` (LDO regulators), `AD592` (temp sensor), `AD654` (V-to-F), `AD5626` (DAC),
`AD7920` (ADC), `LTC6992` (timer/PWM), `LTC1043`, `LT1054` (charge pump), `LTC1485` / `LTC1541`,
`AD2210` / `AD2215`.

## Mapping to the twin today

- Resistor / capacitor / inductor kinds exist (free-value); SCH-10 adds the kit-value palette + the
  polarized-electrolytic and pot/thermistor parts.
- Diode / LED / Zener kinds exist; the kit diodes map onto them directly.
- Op-amp is LMC662-only today; SCH-9 adds the kit op-amps as behavioral models of real parts.
- INA125 exists (Lab 8); AD8226 is the kit's second in-amp.
- Transistors are SCH-8 (new 3-terminal discrete class).
