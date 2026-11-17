import type { Config } from 'tailwindcss';

const v = (n: string) => `var(--${n})`;

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),
        card: v('card'),
        elevated: v('elevated'),
        track: v('track'),
        segpill: v('seg-pill'),
        ink: { DEFAULT: v('text'), 2: v('text2') },
        hairline: v('hairline'),
        glass: v('glass'),
        none: v('none'),
        blue: { DEFAULT: v('blue'), text: v('blue-text'), tint: v('blue-tint') },
        green: { DEFAULT: v('green'), text: v('green-text'), tint: v('green-tint') },
        amber: { DEFAULT: v('amber'), text: v('amber-text'), tint: v('amber-tint') },
        neutral: { DEFAULT: v('neutral'), text: v('neutral-text'), tint: v('neutral-tint') },
        red: { DEFAULT: v('red'), text: v('red-text'), tint: v('red-tint') },
        orange: { DEFAULT: v('orange'), tint: v('orange-tint') },
        indigo: { DEFAULT: v('indigo'), text: v('indigo-text'), tint: v('indigo-tint') },
        action: { DEFAULT: v('action'), on: v('on-action') },
        focus: v('focus'),
      },
      borderRadius: { card: '20px', input: '12px', seg: '12px' },
      boxShadow: { card: 'var(--shadow-card)', pill: 'var(--shadow-pill)', sheet: 'var(--shadow-sheet)' },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          'Inter',
          'system-ui',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      transitionTimingFunction: { ios: 'cubic-bezier(0.25, 1, 0.5, 1)' },
      transitionDuration: { DEFAULT: '200ms' },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
      screens: { md: '768px' },
    },
  },
  plugins: [],
} satisfies Config;
