/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
const esbuild = require("esbuild");
// ... rest of file
const production = process.argv.includes("--production");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "out/extension.js",
    external: ["vscode"],
    logLevel: "info",
  });

  if (process.argv.includes("--watch")) {
    await ctx.watch();
    console.log("👀 Watching...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("✅ Build complete");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
