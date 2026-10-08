import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

export default defineConfig({
  root: ".",
  publicDir: false,
  plugins: [{
    name: "extension-manifest",
    generateBundle() {
      // Build from one manifest so permissions cannot drift between copies.
      this.emitFile({ type: "asset", fileName: "manifest.json", source: readFileSync("manifest.json", "utf8") });
    },
  }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: "src/popup/index.html", background: "src/background/index.ts", content: "src/content/index.ts" },
      output: {
        entryFileNames: (chunk) => chunk.name === "popup" ? "popup.js" : `${chunk.name}.js`,
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
