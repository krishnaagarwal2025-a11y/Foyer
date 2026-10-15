import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export default defineConfig({
  root: `${projectRoot}/client`,
  publicDir: `${projectRoot}/public`,
  envDir: projectRoot,
  cacheDir: `${projectRoot}/node_modules/.vite`,
  resolve: { alias: { "/src": `${projectRoot}/src` } },
  build: {
    outDir: `${projectRoot}/dist`,
    emptyOutDir: true,
    sourcemap: process.env.FOYER_SOURCEMAPS === "1",
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    fs: { allow: [projectRoot] },
    proxy: {
      "/extension": "http://127.0.0.1:3001",
      "/help": "http://127.0.0.1:3001",
      "/api": "http://127.0.0.1:3001",
      "/media": "http://127.0.0.1:3001",
      "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
    },
  },
});
