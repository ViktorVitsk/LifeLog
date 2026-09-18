import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxy = env.VITE_API_PROXY || process.env.VITE_API_PROXY || "http://localhost:8001";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      watch: {
        usePolling: true,
      },
      proxy: {
        "/api": { target: apiProxy, changeOrigin: true },
        "/health": { target: apiProxy, changeOrigin: true },
        "/docs": { target: apiProxy, changeOrigin: true },
        "/openapi.json": { target: apiProxy, changeOrigin: true },
      },
    },
  };
});
