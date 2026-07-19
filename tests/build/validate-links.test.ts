import { describe, expect, it } from "vitest";
import { validateLinks } from "../../src/build/validate-links.js";
import { Logger } from "../../src/logger.js";
import { createTestPage } from "../render/helpers.js";

/**
 * 警告を収集するロガーを作る
 */
function capturingLogger(): { logger: Logger; warnings: string[] }
{
  const warnings: string[] = [];
  const logger = new Logger(false, {
    stdout: () => {},
    stderr: (line) => warnings.push(line.replace(/^.*?warn:\s*/, ""))
  });
  return { logger, warnings };
}

describe("validateLinks", () => {
  it("存在する相対リンクは警告しない", () => {
    const pages = [
      createTestPage({
        sourcePath: "index.md",
        links: ["guide.md"],
        anchorIds: ["home"]
      }),
      createTestPage({
        sourcePath: "guide.md",
        outputPath: "guide.html",
        title: "Guide",
        links: [],
        anchorIds: ["setup"]
      })
    ];
    const { logger, warnings } = capturingLogger();

    validateLinks(pages, logger);

    expect(warnings).toEqual([]);
  });

  it("存在しないページへのリンクはリンク切れ警告にする", () => {
    const pages = [
      createTestPage({
        sourcePath: "index.md",
        links: ["missing.md"],
        anchorIds: []
      })
    ];
    const { logger, warnings } = capturingLogger();

    validateLinks(pages, logger);

    expect(warnings).toEqual(["リンク切れ: index.md -> missing.md"]);
  });

  it("パーセントエンコードされた日本語アンカーを正しく照合する", () => {
    // markdown-itは非ASCIIアンカーをエンコードするが、anchorIdsは生slugのまま
    const encoded = encodeURIComponent("はじめに");
    const pages = [
      createTestPage({
        sourcePath: "index.md",
        links: [`#${encoded}`],
        anchorIds: ["はじめに"]
      })
    ];
    const { logger, warnings } = capturingLogger();

    validateLinks(pages, logger);

    expect(warnings).toEqual([]);
  });

  it("エンコード済み日本語アンカーが存在しないときはアンカー切れにする", () => {
    const encoded = encodeURIComponent("はじめに");
    const pages = [
      createTestPage({
        sourcePath: "index.md",
        links: [`#${encoded}`],
        anchorIds: ["別の見出し"]
      })
    ];
    const { logger, warnings } = capturingLogger();

    validateLinks(pages, logger);

    expect(warnings).toEqual([`アンカー切れ: index.md -> #${encoded}`]);
  });

  it("不正なパーセントエンコードは生文字のまま照合する", () => {
    // decodeURIComponentが失敗してもビルドを落とさず生文字で比較する
    const pages = [
      createTestPage({
        sourcePath: "index.md",
        links: ["#%E0%A4%A"],
        anchorIds: ["%E0%A4%A"]
      })
    ];
    const { logger, warnings } = capturingLogger();

    validateLinks(pages, logger);

    expect(warnings).toEqual([]);
  });
});
