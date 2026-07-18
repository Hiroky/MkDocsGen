import { afterEach, describe, expect, it } from "vitest";
import { Renderer } from "../../src/render/renderer.js";
import { createRenderFixture, createTestContext, createTestPage } from "./helpers.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  // 一時ディレクトリをすべて削除する
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("Renderer", () => {
  it("組み込みテンプレートでページHTMLを生成する", () => {
    // オーバーライド無しでも組み込みテーマで描画できることを確認する
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage({ contentHtml: "<p>Body</p>" });
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page]));

    // サイトタイトルと本文が含まれること
    expect(html).toContain("Test Site");
    expect(html).toContain("<p>Body</p>");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("ネストページではrootに相対プレフィックスが付く", () => {
    // guide/setup.html ならアセット参照が ../assets/ になること
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage({
      sourcePath: "guide/setup.md",
      outputPath: "guide/setup.html",
      url: "/guide/setup.html",
      title: "Setup"
    });
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page]));

    expect(html).toContain('href="../assets/main.css"');
    expect(html).toContain('src="../assets/main.js"');
  });

  it("トップページではrootが空文字になる", () => {
    // index.html ならプレフィックス無しでassetsを参照する
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage();
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page]));

    expect(html).toContain('href="assets/main.css"');
    expect(html).not.toContain('href="../assets/main.css"');
  });

  it("footer.njkのみオーバーライドするとフッターだけ差し替わる", () => {
    // MkDocs方式の部分差し替えが効くことを確認する
    const fixture = createRenderFixture({
      overrides: {
        "partials/footer.njk": "<footer id=\"custom-footer\">Custom Footer</footer>"
      }
    });
    cleanups.push(fixture.cleanup);
    const page = createTestPage();
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page]));

    expect(html).toContain('id="custom-footer"');
    expect(html).toContain("Custom Footer");
    // ヘッダーなど他の部分は組み込みのまま残る
    expect(html).toContain("Test Site");
  });

  it("themeDefaultModeがdata属性またはインラインスクリプトに埋め込まれる", () => {
    // FOUC防止スクリプトが初期モードを参照できること
    const fixture = createRenderFixture({ defaultMode: "dark" });
    cleanups.push(fixture.cleanup);
    const page = createTestPage();
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page]));

    expect(html).toContain("dark");
  });

  it("ナビの現在ページにaria-currentが付く", () => {
    // サイドバーで現在ページを識別できること
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage({
      outputPath: "a.html",
      sourcePath: "a.md",
      title: "A",
      url: "/a.html"
    });
    const nav = [
      { title: "A", url: "a.html", children: [] },
      { title: "B", url: "b.html", children: [] }
    ];
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page], nav));

    expect(html).toMatch(/aria-current="page"/);
  });

  it("urlがnullのパンくずはリンクにしない", () => {
    // index無しセクションを誤ったhrefにしない
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const page = createTestPage({
      sourcePath: "guide/setup.md",
      outputPath: "guide/setup.html",
      title: "Setup",
      breadcrumbs: [
        { title: "guide", url: null },
        { title: "Setup", url: "guide/setup.html" }
      ]
    });
    const renderer = new Renderer(fixture.config);
    const html = renderer.renderPage(page, createTestContext(fixture.config, [page]));

    expect(html).toContain("guide");
    expect(html).not.toMatch(/<a href="(\.\.\/)?">guide<\/a>/);
    expect(html).toContain(">guide</span>");
  });

  it("headingsが2件以上のときだけ目次が出る", () => {
    // 仕様: 見出しが1以下ならTOC非表示
    const fixture = createRenderFixture();
    cleanups.push(fixture.cleanup);
    const withToc = createTestPage({
      headings: [
        { level: 2, text: "One", anchorId: "one" },
        { level: 2, text: "Two", anchorId: "two" }
      ]
    });
    const withoutToc = createTestPage({
      headings: [{ level: 2, text: "Only", anchorId: "only" }]
    });
    const renderer = new Renderer(fixture.config);

    const htmlWith = renderer.renderPage(withToc, createTestContext(fixture.config, [withToc]));
    const htmlWithout = renderer.renderPage(withoutToc, createTestContext(fixture.config, [withoutToc]));

    expect(htmlWith).toContain('class="toc"');
    expect(htmlWith).toContain("#one");
    expect(htmlWithout).not.toContain('class="toc"');
  });
});
