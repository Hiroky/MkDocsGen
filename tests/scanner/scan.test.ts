import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanPages } from "../../src/scanner/scan.js";
import { createCapturingLogger, createDocsFixture, createSilentLogger } from "./helpers.js";

/** 各テストで作った一時ディレクトリの後始末用 */
const cleanups: Array<() => void> = [];

afterEach(() => {
  // テスト終了ごとに一時ファイルを消す
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("scanPages", () => {
  it("docs配下の.mdを走査し、POSIX相対パスで列挙する", () => {
    // ネストしたMarkdownも相対パスとして拾えることを確認する
    const fixture = createDocsFixture({
      "index.md": "# Home\n",
      "guide/setup.md": "# Setup\n"
    });
    cleanups.push(fixture.cleanup);

    const sources = scanPages(fixture.config, createSilentLogger());
    const paths = sources.map((s) => s.sourcePath).sort();

    expect(paths).toEqual(["guide/setup.md", "index.md"]);
    // Windowsでも区切りはPOSIXのままにする
    expect(sources.every((s) => !s.sourcePath.includes("\\"))).toBe(true);
  });

  it("excludeのglobに一致するファイルは走査しない", () => {
    // drafts/** を除外指定すると、その配下は一覧に出ない
    const fixture = createDocsFixture(
      {
        "index.md": "# Home\n",
        "drafts/x.md": "# Draft\n",
        "guide/a.md": "# A\n"
      },
      { exclude: ["drafts/**"] }
    );
    cleanups.push(fixture.cleanup);

    const sources = scanPages(fixture.config, createSilentLogger());
    expect(sources.map((s) => s.sourcePath).sort()).toEqual(["guide/a.md", "index.md"]);
  });

  it("draft: trueのページはビルド対象から除外する", () => {
    // frontmatterのdraftフラグで除外する（excludeとは別経路）
    const fixture = createDocsFixture({
      "index.md": "# Home\n",
      "secret.md": "---\ndraft: true\n---\n# Secret\n"
    });
    cleanups.push(fixture.cleanup);

    const sources = scanPages(fixture.config, createSilentLogger());
    expect(sources.map((s) => s.sourcePath)).toEqual(["index.md"]);
  });

  it("タイトルはfrontmatter → 先頭h1 → ファイル名の優先順位で決まる", () => {
    // 3通りのタイトル決定経路を同時に検証する
    const fixture = createDocsFixture({
      "from-fm.md": "---\ntitle: From Frontmatter\n---\n# Ignored H1\n",
      "from-h1.md": "# Heading Title\n\nbody\n",
      "from-name.md": "本文だけ\n"
    });
    cleanups.push(fixture.cleanup);

    const sources = scanPages(fixture.config, createSilentLogger());
    const byPath = Object.fromEntries(sources.map((s) => [s.sourcePath, s.title]));

    expect(byPath["from-fm.md"]).toBe("From Frontmatter");
    expect(byPath["from-h1.md"]).toBe("Heading Title");
    expect(byPath["from-name.md"]).toBe("from-name");
  });

  it("descriptionとorderをfrontmatterから取り、非数値orderは警告してnullにする", () => {
    // orderは数値のみ有効。文字列は無視して警告を出す
    const fixture = createDocsFixture({
      "ok.md": "---\ndescription: desc\norder: 2\n---\n# Ok\n",
      "bad.md": "---\norder: soon\n---\n# Bad\n"
    });
    cleanups.push(fixture.cleanup);
    const { logger, warnings } = createCapturingLogger();

    const sources = scanPages(fixture.config, logger);
    const ok = sources.find((s) => s.sourcePath === "ok.md");
    const bad = sources.find((s) => s.sourcePath === "bad.md");

    expect(ok?.description).toBe("desc");
    expect(ok?.order).toBe(2);
    expect(bad?.order).toBeNull();
    expect(warnings.some((w) => w.includes("bad.md"))).toBe(true);
    expect(logger.getWarnCount()).toBe(1);
  });

  it("outputPathは.mdを.htmlに、urlはbase_url込みで算出する", () => {
    // 出力パスと公開URLの二本立てを確認する
    const fixture = createDocsFixture(
      { "guide/setup.md": "# Setup\n" },
      { baseUrl: "/docs/" }
    );
    cleanups.push(fixture.cleanup);

    const [source] = scanPages(fixture.config, createSilentLogger());
    expect(source?.outputPath).toBe("guide/setup.html");
    expect(source?.url).toBe("/docs/guide/setup.html");
    expect(source?.absPath).toBe(path.join(fixture.docsDir, "guide/setup.md"));
    // frontmatter除去後の本文がmarkdownに入る
    expect(source?.markdown.trim()).toBe("# Setup");
  });

  it("base_url末尾スラッシュ無しでも正しく結合する", () => {
    // "/" と "/docs" の両方で二重スラッシュや欠落が起きないこと
    const fixture = createDocsFixture(
      { "a.md": "# A\n" },
      { baseUrl: "/docs" }
    );
    cleanups.push(fixture.cleanup);

    const [source] = scanPages(fixture.config, createSilentLogger());
    expect(source?.url).toBe("/docs/a.html");
  });
});
