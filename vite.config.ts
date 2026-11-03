import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dashboardPreviewPlugin } from "./server/src/dashboard/vite-preview.js";

export default defineConfig({
  plugins: [dashboardPreviewPlugin(), react(), tailwindcss()],
  server: {
    proxy: {
      "/api/demo-studio": {
        target: "http://127.0.0.1:4318",
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
});
