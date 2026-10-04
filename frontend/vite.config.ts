import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(id))
            return "charts";
          if (
            /node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)
          )
            return "motion";
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
      "/docs": "http://127.0.0.1:8000",
      "/openapi.json": "http://127.0.0.1:8000",
    },
  },
});
