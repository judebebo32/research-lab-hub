import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "LAB_"], // LAB_NAME is exposed to the browser (it's just the display name)
  build: { chunkSizeWarningLimit: 1500 },
});
