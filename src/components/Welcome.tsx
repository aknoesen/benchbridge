// Welcome / landing screen — brand front door shown on first visit; "Launch" enters the twin.
// Click the sidebar logo any time to return here.
// Colour-branded to UC Davis: Aggie Blue (#022851) + Aggie Gold (#FFBF00) per the UC Davis
// Brand Communications Guide (blue + gold are the dominant palette).
//
// Layout: a scrollable flex column — a flex:1 hero that centres in the available space, and a
// flow footer pinned below it. On a short screen the page reflows/scrolls instead of the hero
// colliding with an absolutely-positioned footer (the small-laptop congestion bug). Fonts + gaps
// use clamp() so they shrink gracefully on smaller viewports.

interface Props { onEnter: () => void; onQuickstart: () => void }

const AGGIE_BLUE = '#022851'
const AGGIE_GOLD = '#FFBF00'

export default function Welcome({ onEnter, onQuickstart }: Props) {
  const base = import.meta.env.BASE_URL
  return (
    <div style={{
      position: 'fixed', inset: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column',
      background: AGGIE_BLUE, color: 'var(--text-primary)',
    }}>
      {/* hero — centres in the available height, shrinks gracefully on small screens */}
      <div style={{
        flex: '1 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 'clamp(12px, 2.6vh, 26px)', padding: 'clamp(20px, 4vh, 40px) 24px',
        textAlign: 'center',
      }}>
        <img src={`${base}benchbridge-lockup.svg`} alt="BenchBridge"
          style={{ width: 'min(560px, 82vw)', maxHeight: 'clamp(96px, 22vh, 180px)' }} />

        <p style={{ maxWidth: 680, fontSize: 'clamp(14px, 2.1vw, 16px)', lineHeight: 1.65, color: 'rgba(255,255,255,0.82)', margin: 0 }}>
          Learn electronics by doing. Design a circuit, measure it on a full instrument bench, and build it on
          a solderless breadboard, all in your browser. No hardware, nothing to install.
        </p>

        <p style={{ maxWidth: 660, fontSize: 'clamp(12px, 1.7vw, 13.5px)', lineHeight: 1.6, color: 'rgba(255,255,255,0.62)', margin: 0 }}>
          A fast in-browser simulation, real SPICE under the hood, faithful to a real electronics bench, so it
          behaves like the hardware and your skills transfer straight over. A place to design, learn, and
          prepare, not a replacement for the bench.
        </p>

        <div style={{ display: 'flex', gap: 'clamp(12px, 3vw, 28px)', flexWrap: 'wrap', justifyContent: 'center', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
          <span><b style={{ color: AGGIE_GOLD }}>Draw</b> a circuit</span>
          <span><b style={{ color: AGGIE_GOLD }}>Measure</b> it: scope, spectrum, Bode, meter, supply</span>
          <span><b style={{ color: AGGIE_GOLD }}>Build</b> it on a virtual breadboard</span>
          <span><b style={{ color: AGGIE_GOLD }}>Verify</b> it against your schematic</span>
        </div>

        <button onClick={onEnter} style={{
          marginTop: 4, padding: '12px 32px', fontSize: 15, fontWeight: 700, color: AGGIE_BLUE,
          background: AGGIE_GOLD, border: 'none', borderRadius: 8, cursor: 'pointer',
          boxShadow: '0 0 26px rgba(255,191,0,0.45)',
        }}>
          Launch BenchBridge →
        </button>

        <button onClick={onQuickstart} style={{
          padding: '4px 14px', fontSize: 13, fontWeight: 600, color: AGGIE_GOLD,
          background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline',
        }}>
          New here? Start with the Quickstart →
        </button>
      </div>

      {/* footer — in normal flow (never overlaps the hero), UC Davis co-brand centred below the credits */}
      <div style={{
        flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        padding: '12px 24px 18px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8 }}>
          Currently models the Analog Devices{' '}
          <a href="https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm2000.html"
            target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.78)', textDecoration: 'underline' }}>ADALM2000</a>{' '}
          bench + ADALP2000 parts kit<br />
          Open source · Apache-2.0 ·{' '}
          <a href="https://github.com/aknoesen/benchbridge" target="_blank" rel="noopener noreferrer" style={{ color: AGGIE_GOLD }}>GitHub</a>
        </div>
        <img src={`${base}ucdavis-wordmark.png`} alt="UC Davis"
          style={{ width: 'min(140px, 34vw)', height: 'auto', opacity: 0.9 }} />
      </div>
    </div>
  )
}
