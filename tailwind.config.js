/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forge: {
          bg: '#0D0E12',
          panel: '#15171F',
          card: '#1C1F2B',
          border: '#2E3446',
          bronze: '#C89B54',
          gold: '#F5C451',
        }
      },
      keyframes: {
        pulseHazard: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.65', transform: 'scale(0.98)' },
        }
      },
      animation: {
        pulseHazard: 'pulseHazard 1.8s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}
