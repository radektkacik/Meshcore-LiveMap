import { execSync } from "node:child_process";
import { defineConfig } from "vite";

function buildId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
  try {
    const hash = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return hash ? `${stamp}-${hash}` : stamp;
  } catch {
    return stamp;
  }
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  server: {
    proxy: {
      "/api": {
        target: "https://analyzer.meshcore.cz",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
