# Positioning: the serverless twin and the path to real Scopy

## Two layers that are easy to confuse

The ADALM2000 ecosystem already has an emulator. Analog Devices' iio-emu stands in for the
hardware at the protocol level, so the real Scopy application connects to it as if a device were
plugged in. It is tempting to read a browser based twin as a weaker version of that. It is not.
The two operate at different layers and solve different problems.

iio-emu plus Scopy is a **device emulator**. It makes the production software believe a device is
present and streams it data. It is faithful to the instrument, but it knows nothing about circuits,
it teaches nothing on its own, and it still requires installing libiio, Scopy, and a local server.

The serverless twin is a **teaching instrument**. It runs entirely in a browser tab, it understands
circuits because it carries a SPICE engine, and it is built to teach the concepts a first year
student needs before a measurement means anything. The two are complementary, and the more
interesting story is how they connect.

## What the serverless twin uniquely delivers

**Zero friction at class scale.** It opens from a URL in any browser, on any operating system,
including the Chromebooks and locked down lab machines that dominate a first year course. No
drivers, no admin rights, no installs, no IT tickets. One link reaches an entire cohort on day one.
For a course that must onboard hundreds of students in week one, this is the decisive advantage, and
it is something a native emulator cannot match by construction.

**It teaches, it does not only measure.** The twin is not a Scopy clone with the serial number filed
off. Its Learning Mode makes the invisible visible: choose 4, 8, or 12 bit ADC depth and watch the
quantization noise floor move; change the FFT window and see the leakage tradeoff. Real Scopy and
real hardware show you a measurement. The twin shows you why the measurement looks the way it does.
That is the difference between an instrument and a tutor.

**It closes the loop without hardware.** Because the SPICE engine lives in the browser, a student
draws a circuit and immediately sees it measured: the filtered waveform on the scope, the harmonics
in the spectrum, the Bode curve in the network analyzer. Source, circuit, and instrument are unified
in one tab. Neither Scopy nor a bare emulator can do this alone, because neither contains a circuit.

**It bridges the gap where students actually fail.** The schematic to breadboard transfer, with a
Check that confirms the physical wiring is electrically the drawn circuit, targets the exact step
where first years stumble: turning an ideal schematic into a working board. No instrument and no
emulator addresses this, because it is a learning artifact, not a measurement.

**It is safe, deterministic, resettable, and gradeable.** Nothing smokes, every attempt resets
instantly, Practice and Bench modes separate learning from assessment, and deterministic results
make autograding possible. This scales to a real course in a way a shared rack of hardware does not.

**It has zero marginal cost and infinite parallelism.** One ADALM2000 per student is a budget line
and a logistics problem. One URL is free and serves thousands at once. This is not a competitor to
buying hardware. It is the cheapest possible way to get every student ready to use it.

## What it deliberately is not

The twin is the **ideal**, not the real device. It simulates clean, modeled behavior: exact math, a
calibrated ADC noise model, no thermal drift, no layout parasitics, no real world surprises. That is
a design choice, not a shortcoming. The twin teaches the ideal so that hardware can teach the
deviation from it. Being honest about this is part of the pedagogy, and it is exactly why the next
rung matters.

## The continuum: one circuit, three rungs

The right way to see the two approaches is not as rivals but as a single learning progression, with
the student's circuit and mental model carried unchanged from one rung to the next.

1. **Serverless twin.** Ideal concepts, zero friction, the whole class on day one. The front door.
2. **Real Scopy driven by the twin's simulation, through iio-emu.** The same circuit, now measured by
   Analog Devices' actual production software and authoritative device model, still with no hardware
   required. The bridge to the real toolchain.
3. **Real Scopy on the ADALM2000.** The bench. The destination, where the ideal meets the real.

A student climbs from concepts, to the real software, to the real hardware, without ever rebuilding
their understanding or their circuit. The twin lowers the activation energy for each step, which
means more students reach the hardware, and reach it better prepared.

## Why the merge is real, not just a slogan

The transition works because all three rungs share the same two things: the device model and the
circuit.

**G-A aligns the device model.** It binds the twin's numbers and nomenclature directly to Analog
Devices' own adalm2000 context, the same device description that drives iio-emu and real Scopy.
After that step the twin is not an approximation of an M2K. It is faithful to Analog Devices'
reference model of one.

**G-B uses iio-emu as the seam.** iio-emu's generic mode streams instrument channels from files.
Real Scopy generates a waveform on W1, a small bridge runs that waveform through ngspice on the very
circuit the student drew, and the result is handed back to Scopy's oscilloscope. The browser twin
and the native emulator are now running the same circuit through the same device model. The move
from rung one to rung two is a deployment choice, not a rewrite.

That is the merge: the serverless twin and the Scopy emulator are two presentations of one
underlying system, the device model plus the student's circuit, met at the libiio seam.

## Why this is the right story for Analog Devices

The serverless twin widens the top of the funnel to every first year on every Chromebook, at no cost
and no friction. iio-emu with real Scopy converts those students to Analog Devices' production
toolchain. The ADALM2000 closes it. Each rung makes the next easier and the ecosystem stickier. A
browser tool that gets thousands of students fluent in Scopy's workflow and hungry for the bench is
not a threat to hardware adoption. It is the most efficient on-ramp to it.

## In one line

The serverless twin is the zero install front door that teaches the ideal at class scale. iio-emu
and real Scopy are the bridge that carries the same circuit onto Analog Devices' real software and
then its hardware. Same device model, same circuit, three rungs, one path.
