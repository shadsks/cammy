/* Tailwind preset for future Shoebox surfaces. Not required by the vanilla app. */
module.exports = {
  theme: {
    extend: {
      colors: {
        shoebox: {
          ink: '#1c1916',
          paper: '#f6f2ea',
          stamp: '#ffa133',
          muted: '#8a7f6c',
          guide: '#b9b09e',
        },
        film: {
          golden: '#f5b06a',
          pool: '#4f93a8',
          tungsten: '#7a3b22',
          static: '#5a5a5a',
          disco: '#7a3bd1',
          expired: '#6f7a4a',
          negative: '#ff8a3c',
        },
      },
      borderRadius: {
        manufactured: '10px',
        print: '4px',
      },
      boxShadow: {
        card: '0 14px 26px rgb(12 7 3 / .42), 0 3px 8px rgb(12 7 3 / .30)',
        insetPlastic: 'inset 0 1px 0 rgb(255 255 255 / .55), inset 0 -2px 4px rgb(80 55 25 / .24)',
        labGlow: '0 0 0 1px rgb(255 255 255 / .08), 0 10px 28px rgb(10 5 2 / .32)',
      },
      fontFamily: {
        lab: ['Space Grotesk', 'system-ui', 'sans-serif'],
        caption: ['Caveat', 'cursive'],
        stamp: ['VT323', 'monospace'],
      },
      backgroundImage: {
        'paper-fiber': 'linear-gradient(90deg, rgb(70 45 20 / .035) 1px, transparent 1px), linear-gradient(0deg, rgb(70 45 20 / .028) 1px, transparent 1px)',
        'stock-gradient': 'linear-gradient(135deg, var(--stock-a), var(--stock-b))',
        'edge-fog': 'radial-gradient(70% 30% at 6% 12%, color-mix(in srgb, var(--stock-b) 28%, transparent), transparent 70%)',
      },
      transitionTimingFunction: {
        lab: 'cubic-bezier(.2,.72,.18,1)',
      },
      containers: {
        card: '12rem',
      },
    },
  },
  plugins: [
    /* Analog utilities + app-state variants, mirroring shoebox-lab.css so any
       future Tailwind surface shares the vanilla app's vocabulary. */
    function ({ addUtilities, addVariant }) {
      addUtilities({
        '.fx-grain': { position: 'relative' },
        '.fx-vignette-sm': { boxShadow: 'inset 0 0 30px rgb(18 7 2 / .5)' },
        '.fx-vignette-lg': { boxShadow: 'inset 0 0 60px rgb(18 7 2 / .82)' },
        '.fx-halation': { filter: 'saturate(1.1) brightness(1.03)' },
        '.fx-paper-curl': { boxShadow: '0 12px 22px -8px rgb(12 7 3 / .5)', borderRadius: '4px' },
      });
      // e.g. golden-hour:ring-film-golden, busy:opacity-50, ejecting:animate-pulse
      addVariant('golden-hour', 'body.golden-now &');
      addVariant('busy', 'body.busy &');
      addVariant('live', 'body.live &');
      addVariant('lab-spatial', 'body.lab-spatial &');
      addVariant('exposing', 'body[data-transport="exposing"] &');
      addVariant('ejecting', 'body[data-transport="ejecting"] &');
    },
  ],
};
