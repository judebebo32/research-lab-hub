import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Writes manifest.webmanifest at build time so the installed app uses this platform's name.
function webManifest(name) {
  const manifest = {
    name,
    short_name: name.length > 12 ? "Lab Hub" : name,
    description: "Protocols, inventory and lab activity for research groups, plus a private tenure & promotion record.",
    id: "/",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f5f1",
    theme_color: "#1f4d3a",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New protocol", url: "/protocols/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Inventory", url: "/inventory", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Protocols", url: "/protocols", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
  return {
    name: "web-manifest",
    transformIndexHtml(html) {
      return html.replaceAll("%PLATFORM_NAME%", name);
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(manifest, null, 2) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["PLATFORM_"]);
  const name = process.env.PLATFORM_NAME || env.PLATFORM_NAME || "Research Lab Hub";
  return {
    plugins: [react(), webManifest(name)],
    envPrefix: ["VITE_", "PLATFORM_"], // PLATFORM_NAME is exposed to the browser (display name only)
    build: { chunkSizeWarningLimit: 1500 },
  };
});
