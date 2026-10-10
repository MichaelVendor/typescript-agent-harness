import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVE = "http://127.0.0.1:7420";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../cli/dist/web",
    emptyOutDir: true,
    // Served from localhost, so one bundle (React + Markdown + highlighting) is fine.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    proxy: {
      "/api": {
        target: SERVE,
        changeOrigin: true,
        // tah serve only accepts POSTs whose Origin is itself.
        configure: (proxy) => proxy.on("proxyReq", (req) => req.getHeader("origin") && req.setHeader("origin", SERVE)),
      },
    },
  },
});
