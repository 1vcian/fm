import plugin from 'tailwindcss/plugin.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    {
      pattern: /(text|bg|border)-(age|rarity)-.+/,
    }
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0d0d12',
          secondary: '#13131a',
          card: 'rgba(20, 20, 30, 0.9)',
          'card-hover': 'rgba(30, 30, 45, 0.95)',
          input: 'rgba(10, 10, 15, 0.8)',
        },
        accent: {
          primary: '#f59e0b',    // Amber-500
          secondary: '#ef4444',  // Red-500
          tertiary: '#8b5cf6',   // Violet-500
          glow: 'rgba(245, 158, 11, 0.25)',
        },
        text: {
          primary: '#f5f5f5',
          secondary: '#a1a1aa',
          muted: '#71717a',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          hover: 'rgba(245, 158, 11, 0.4)',
        },
        rarity: {
          common: 'var(--age-primitive)',
          rare: 'var(--age-medieval)',
          epic: 'var(--age-early-modern)',
          legendary: 'var(--age-modern)',
          ultimate: 'var(--age-space)',
          mythic: 'var(--age-interstellar)',
        },
        age: {
          primitive: 'var(--age-primitive)',
          medieval: 'var(--age-medieval)',
          earlymodern: 'var(--age-early-modern)',
          modern: 'var(--age-modern)',
          space: 'var(--age-space)',
          interstellar: 'var(--age-interstellar)',
          multiverse: 'var(--age-multiverse)',
          quantum: 'var(--age-quantum)',
          underworld: 'var(--age-underworld)',
          divine: 'var(--age-divine)',
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
      },
      animation: {
        'hammer-swing': 'hammerSwing 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'float': 'particleFloat 20s infinite ease-in-out',
      },
      keyframes: {
        hammerSwing: {
          '0%, 100%': { transform: 'rotate(-8deg)' },
          '50%': { transform: 'rotate(8deg)' },
        },
        fadeIn: {
          'from': { opacity: '0' },
          'to': { opacity: '1' },
        },
        slideUp: {
          'from': { opacity: '0', transform: 'translateY(20px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        particleFloat: {
          '0%, 100%': { transform: 'translateY(100vh) scale(0)', opacity: '0' },
          '10%': { opacity: '0.3' },
          '50%': { transform: 'translateY(50vh) scale(1)', opacity: '0.4' },
          '90%': { opacity: '0.2' },
        }
      }
    },
  },
  plugins: [
    // Tailwind 3.4 ships no pointer variant, so `pointer-coarse:` silently compiled to nothing.
    // Cards that get denser still have to be pressable with a thumb, which needs the real query.
    plugin(({ addVariant }) => {
      addVariant('pointer-coarse', '@media (pointer: coarse)');
      addVariant('pointer-fine', '@media (pointer: fine)');
    }),
  ],
}
