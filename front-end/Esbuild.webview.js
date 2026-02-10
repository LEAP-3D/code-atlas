/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
const esbuild = require("esbuild");

const production = process.argv.includes("--production");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/webview/roadmap/main.ts"],
    bundle: true,
    format: "iife", // Browser-д зориулсан
    minify: production,
    sourcemap: !production,
    platform: "browser",
    outfile: "out/webview/roadmap.js",
    logLevel: "info",
    tsconfig: "tsconfig.webview.json", // Webview tsconfig ашиглах
  });

  if (process.argv.includes("--watch")) {
    await ctx.watch();
    console.log("👀 Watching webview...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("✅ Webview build complete");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
