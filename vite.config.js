import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { buildChangelog } from "./scripts/build-changelog.mjs";

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

const currentBuildId = buildId();
const changelogEnvironment = process.env.VITE_BETA === "1" ? "Beta" : "Produkce";

function changelogPlugin() {
  let outDir = "dist";
  return {
    name: "meshcore-changelog",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      buildChangelog(outDir, { buildId: currentBuildId, environment: changelogEnvironment });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  define: {
    __BUILD_ID__: JSON.stringify(currentBuildId),
  },
  plugins: [changelogPlugin()],
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
