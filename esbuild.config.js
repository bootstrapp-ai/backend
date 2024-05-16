// build.js
import { build } from "esbuild";

build({
  entryPoints: ["index.sw.js"],
  bundle: true,
  outfile: "dist/index.js",
  format: "esm", // Output format as ES module
  sourcemap: true, // Optional: for source maps
}).catch(() => process.exit(1));