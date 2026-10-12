import { defineConfig } from "vite";
export default defineConfig({
  build: { sourcemap: true },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/extension": "http://127.0.0.1:3001",
      "/help": "http://127.0.0.1:3001",
      "/api": "http://127.0.0.1:3001",
      "/media": "http://127.0.0.1:3001",
      "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
    },
  },
});
