import fs from "node:fs";
import * as esbuild from "esbuild";

/**
 * dist/markdown/highlight.js（tsc出力）を、実際に使う言語/テーマだけを含む
 * 自己完結バンドルへ差し替える。mvコマンドに頼らずesbuildのJS APIで完結させ、
 * Windows等どのOSでも同じように動くようにする
 */
async function main(): Promise<void>
{
  const entryPath = "dist/markdown/highlight.js";
  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    platform: "node",
    format: "esm",
    minify: true,
    write: false
  });
  const bundled = result.outputFiles[0];
  if (!bundled) {
    throw new Error("esbuildの出力が空です");
  }
  fs.writeFileSync(entryPath, bundled.contents);
}

main();
