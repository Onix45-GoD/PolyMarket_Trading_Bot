import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const envDir = resolve(__dirname, "..");
  const env = loadEnv(mode, envDir, "");

  const apiHost = env.VITE_API_HOST || "http://127.0.0.1:3001";

  return {
    plugins: [react()],
    envDir,
    server: {
      host: true,
      port: Number(env.VITE_DEV_PORT || 5173),
      proxy: {
        "/api": {
          target: apiHost,
          changeOrigin: true,
        },
      },
    },
  };
});
