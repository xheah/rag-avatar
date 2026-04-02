/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-fast': 'pulse-fast 1s ease-in-out infinite',
        'wave': 'wave 1.5s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-20px) scale(1.05)' },
        },
        'pulse-fast': {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.1)', opacity: '1' },
        },
        wave: {
          '0%': { borderRadius: '50%', transform: 'rotate(0deg)' },
          '25%': { borderRadius: '45% 55% 45% 55%', transform: 'rotate(90deg)' },
          '50%': { borderRadius: '50%', transform: 'rotate(180deg)' },
          '75%': { borderRadius: '55% 45% 55% 45%', transform: 'rotate(270deg)' },
          '100%': { borderRadius: '50%', transform: 'rotate(360deg)' },
        }
      }
    },
  },
  plugins: [],
}
