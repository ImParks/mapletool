import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        maple: {
          orange: "#f5851f",
          dark: "#1a1c2b",
          card: "#23263a",
          border: "#33374f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
