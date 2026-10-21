import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    screens: {
      xs: '375px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
    extend: {
      maxWidth: {
        content: '1200px',
      },
      width: {
        sidebar: '240px',
      },
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
          pressed: 'var(--brand-pressed)',
        },
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
        },
        border: 'var(--border)',
        text: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        info: 'var(--info)',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)',
      },
      transitionDuration: {
        fast: '120ms',
        normal: '200ms',
        slow: '320ms',
      },
      transitionTimingFunction: {
        eventora: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
