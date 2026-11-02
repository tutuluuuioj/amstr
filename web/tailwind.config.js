/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        amstr: {
          bg: '#0E0D0B',
          surface: '#1A1815',
          border: '#2A2620',
          text: '#EDE6DA',
          muted: '#8C8478',
          copper: '#C8763A',
          gold: '#E3C07A',
          green: '#5FA88A',
          red: '#C2483D',
        }
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Inter Tight"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '4px',
        md: '6px',
        lg: '6px',
        xl: '6px',
        '2xl': '6px',
      }
    },
  },
  plugins: [],
}
