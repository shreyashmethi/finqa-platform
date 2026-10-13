// Vite config. In development the React app runs on :5173 and proxies /api to the FastAPI
// backend on :8000, so the browser only ever talks to one origin.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
