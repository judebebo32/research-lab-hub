import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "PLATFORM_"], // PLATFORM_NAME is exposed to the browser (display name only)
  build: { chunkSizeWarningLimit: 1500 },
});
