(() => {
  "use strict";

  const THEME_KEY = "mkdocsgen-theme";
  const MODES = ["light", "dark", "auto"];

  // Mermaid再描画の直列化用（テーマ連打時の競合防止）
  let mermaidRenderBusy = false;
  let mermaidQueuedTheme = null;

  /**
   * localStorageからテーマモードを読む
   */
  function readStoredMode() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (_error) {
      return null;
    }
  }

  /**
   * テーマモードをlocalStorageへ保存する
   */
  function writeStoredMode(mode) {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch (_error) {
      // プライベートモード等では保存できないことがあるので握りつぶす
    }
  }

  /**
   * autoを含めたモードを実際のlight/darkへ解決する
   */
  function resolveTheme(mode) {
    if (mode === "light" || mode === "dark") {
      return mode;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  /**
   * data属性とラベルを更新してテーマを反映する
   */
  function applyTheme(mode) {
    const resolved = resolveTheme(mode);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = mode;
    const label = document.querySelector("[data-theme-label]");
    if (label) {
      label.textContent = mode;
    }
    // Mermaid図もライト/ダークに合わせて再描画する
    renderMermaid(resolved);
  }

  /**
   * コードブロックのコピーボタンを初期化する
   */
  function initCodeCopy() {
    document.querySelectorAll("[data-code-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const code = button.getAttribute("data-code") || "";
        try {
          await navigator.clipboard.writeText(code);
        } catch (_error) {
          // clipboard APIが使えない環境では何もしない
          return;
        }
        // 一時的にCopied表示して元のラベルへ戻す
        const original = button.textContent;
        button.textContent = "Copied";
        button.disabled = true;
        window.setTimeout(() => {
          button.textContent = original;
          button.disabled = false;
        }, 1500);
      });
    });
  }

  /**
   * Mermaid図を現在のテーマで描画（または再描画）する
   */
  function renderMermaid(theme) {
    const mermaid = window.mermaid;
    if (!mermaid) {
      return;
    }
    const nodes = document.querySelectorAll("pre.mermaid");
    if (nodes.length === 0) {
      return;
    }

    // 描画中にテーマが連打されたら、最新テーマだけ後続で実行する
    if (mermaidRenderBusy) {
      mermaidQueuedTheme = theme;
      return;
    }
    mermaidRenderBusy = true;
    mermaidQueuedTheme = null;

    // 再描画のため、前回のSVGを消して定義テキストを復元する
    nodes.forEach((node) => {
      const source = node.getAttribute("data-mermaid-source");
      if (source !== null) {
        node.removeAttribute("data-processed");
        node.textContent = source;
      } else {
        // 初回描画前に定義を退避し、テーマ切替で再利用する
        node.setAttribute("data-mermaid-source", node.textContent || "");
      }
    });

    mermaid.initialize({
      startOnLoad: false,
      // Mermaidのテーマ名は default / dark
      theme: theme === "dark" ? "dark" : "default",
      securityLevel: "strict"
    });

    // 不正な図定義で unhandled rejection にしない（suppressErrors + catch）
    Promise.resolve(mermaid.run({
      nodes: Array.from(nodes),
      suppressErrors: true
    })).catch(() => {
      // suppressErrorsでも環境によってrejectする場合があるため握りつぶす
    }).finally(() => {
      mermaidRenderBusy = false;
      // 描画中にキューされた最新テーマがあれば再実行する
      if (mermaidQueuedTheme !== null) {
        const nextTheme = mermaidQueuedTheme;
        mermaidQueuedTheme = null;
        renderMermaid(nextTheme);
      }
    });
  }

  /**
   * テーマ切替ボタンを初期化する
   */
  function initThemeToggle() {
    const button = document.querySelector("[data-theme-toggle]");
    let mode = readStoredMode() || document.documentElement.dataset.themeMode || "auto";
    if (!MODES.includes(mode)) {
      mode = "auto";
    }
    // ボタン有無に関わらず現在テーマを確定し、Mermaidも初回描画する
    applyTheme(mode);

    if (button) {
      button.addEventListener("click", () => {
        const currentIndex = MODES.indexOf(mode);
        mode = MODES[(currentIndex + 1) % MODES.length];
        writeStoredMode(mode);
        applyTheme(mode);
      });
    }

    // autoモード中はOS設定の変化に追従する
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (mode === "auto") {
        applyTheme("auto");
      }
    });
  }

  /**
   * サイドバーのセクション展開/折りたたみを初期化する
   */
  function initSidebarToggles() {
    document.querySelectorAll("[data-nav-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const expanded = button.getAttribute("aria-expanded") === "true";
        const next = !expanded;
        button.setAttribute("aria-expanded", String(next));
        const children = button.closest(".nav-item")?.querySelector("[data-nav-children]");
        if (children) {
          children.hidden = !next;
        }
      });
    });
  }

  /**
   * モバイル用ドロワーを初期化する
   */
  function initDrawer() {
    const toggle = document.querySelector("[data-menu-toggle]");
    const overlay = document.querySelector("[data-sidebar-overlay]");
    if (!toggle) {
      return;
    }

    /**
     * ドロワーの開閉状態を反映する
     */
    function setOpen(open) {
      document.body.classList.toggle("sidebar-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      if (overlay) {
        overlay.hidden = !open;
      }
    }

    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      setOpen(open);
    });

    if (overlay) {
      overlay.addEventListener("click", () => setOpen(false));
    }

    // Escapeでドロワーを閉じる（キーボード操作の要件）
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
      }
    });

    // 幅が広がったらドロワー状態をリセットする
    window.matchMedia("(min-width: 769px)").addEventListener("change", (event) => {
      if (event.matches) {
        setOpen(false);
      }
    });
  }

  /**
   * IntersectionObserverで目次の現在セクションをハイライトする
   */
  function initTocSpy() {
    const links = Array.from(document.querySelectorAll("[data-toc-link]"));
    if (links.length === 0) {
      return;
    }

    const headings = links
      .map((link) => document.getElementById(link.getAttribute("data-anchor") || ""))
      .filter(Boolean);

    if (headings.length === 0) {
      return;
    }

    /**
     * 指定アンカーの目次リンクだけをactiveにし、aria-currentも同期する
     */
    function setActive(anchorId) {
      links.forEach((link) => {
        const active = link.getAttribute("data-anchor") === anchorId;
        link.classList.toggle("is-active", active);
        // 仕様4.6: 目次にもaria-currentを付与する
        if (active) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // 画面内に入っている見出しのうち、一番上のものを選ぶ
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActive(visible[0].target.id);
        }
      },
      {
        rootMargin: "-20% 0px -60% 0px",
        threshold: [0, 1]
      }
    );

    headings.forEach((heading) => observer.observe(heading));
    // 初期表示時は先頭見出しをハイライトする
    setActive(headings[0].id);
  }

  /**
   * 検索用にテキストをbigramトークンへ分解する
   * 注意: src/search/tokenize.ts と同じアルゴリズムを保つこと
   */
  function tokenizeBigrams(text) {
    const words = String(text).trim().split(/\s+/).filter((w) => w.length > 0);
    const tokens = [];
    for (const word of words) {
      if (/^[A-Za-z0-9]+$/.test(word)) {
        const lower = word.toLowerCase();
        tokens.push(lower);
        if (lower.length >= 2) {
          for (let i = 0; i < lower.length - 1; i++) {
            tokens.push(lower.slice(i, i + 2));
          }
        }
        continue;
      }
      if (word.length === 1) {
        tokens.push(word);
        continue;
      }
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.slice(i, i + 2));
      }
    }
    return tokens;
  }

  /**
   * scriptタグを動的に読み込む
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        // 成功済みだけ再利用する。失敗タグが残っていると未定義のまま即成功してしまう
        if (existing.dataset.loaded === "1") {
          resolve();
          return;
        }
        existing.remove();
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = "1";
        resolve();
      };
      script.onerror = () => {
        // 再試行できるように失敗タグは残さない
        script.remove();
        reject(new Error(`Failed to load script: ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * クエリ周辺の短い抜粋を作る
   */
  function makeSnippet(text, query) {
    const source = String(text || "");
    const q = String(query || "").trim();
    if (!source) {
      return "";
    }
    if (!q) {
      return source.slice(0, 80);
    }
    // 大小文字を無視して最初の出現位置を探す
    const lowerSource = source.toLowerCase();
    const lowerQuery = q.toLowerCase();
    let idx = lowerSource.indexOf(lowerQuery);
    // 完全一致が無い場合はクエリ先頭2文字などで再検索する
    if (idx < 0 && q.length >= 2) {
      idx = lowerSource.indexOf(lowerQuery.slice(0, 2));
    }
    if (idx < 0) {
      return source.slice(0, 80);
    }
    const start = Math.max(0, idx - 20);
    const end = Math.min(source.length, idx + q.length + 40);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < source.length ? "..." : "";
    return prefix + source.slice(start, end) + suffix;
  }

  /**
   * ヘッダー検索UIを初期化する
   */
  function initSearch() {
    const rootEl = document.querySelector("[data-search]");
    if (!rootEl) {
      return;
    }
    const input = rootEl.querySelector(".search-input");
    const resultsEl = rootEl.querySelector(".search-results");
    if (!input || !resultsEl) {
      return;
    }

    const pageRoot = rootEl.getAttribute("data-root") || "";
    // JSONのfetchはfile://で失敗するため、scriptとして読み込む
    const indexUrl = rootEl.getAttribute("data-index-url") || (pageRoot + "assets/search-index.js");
    const minisearchUrl = pageRoot + "assets/minisearch.min.js";

    let miniSearch = null;
    let loadPromise = null;
    let activeIndex = -1;

    /**
     * MiniSearchとインデックスを初回だけ遅延ロードする
     */
    function ensureReady() {
      if (miniSearch) {
        return Promise.resolve(miniSearch);
      }
      if (loadPromise) {
        return loadPromise;
      }
      loadPromise = (async () => {
        // UMDを読み込み、window.MiniSearchを使う
        await loadScript(minisearchUrl);
        const MiniSearchCtor = window.MiniSearch;
        if (!MiniSearchCtor) {
          throw new Error("MiniSearch is not available");
        }
        // サーバー不要のスタンドアロン閲覧のため、fetchではなくscriptでインデックスを読む
        await loadScript(indexUrl);
        const payload = window.__MKDOCSGEN_SEARCH_INDEX__;
        if (!payload || !Array.isArray(payload.documents)) {
          throw new Error("Search index is not available");
        }
        const documents = payload.documents.map((doc) => ({
          id: doc.id,
          title: doc.title || "",
          section: doc.section || "",
          // 配列のままではトークン化しづらいので空白結合する
          headings: Array.isArray(doc.headings) ? doc.headings.join(" ") : String(doc.headings || ""),
          text: doc.text || ""
        }));
        const engine = new MiniSearchCtor({
          fields: ["title", "headings", "text"],
          storeFields: ["title", "section", "text"],
          tokenize: tokenizeBigrams,
          searchOptions: {
            prefix: true,
            tokenize: tokenizeBigrams
          }
        });
        engine.addAll(documents);
        miniSearch = engine;
        return engine;
      })().catch((error) => {
        // 次回フォーカスで再試行できるようにリセットする
        loadPromise = null;
        throw error;
      });
      return loadPromise;
    }

    /**
     * 結果ドロップダウンを閉じる
     */
    function closeResults() {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    }

    /**
     * 選択中の結果へ遷移する
     */
    function goToResult(id) {
      if (!id) {
        return;
      }
      window.location.href = pageRoot + id;
    }

    /**
     * 検索結果を描画する
     */
    function renderResults(query, hits) {
      resultsEl.innerHTML = "";
      activeIndex = -1;
      if (!query) {
        closeResults();
        return;
      }
      if (hits.length === 0) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "該当するページが見つかりません";
        resultsEl.appendChild(empty);
        resultsEl.hidden = false;
        input.setAttribute("aria-expanded", "true");
        return;
      }
      hits.forEach((hit, index) => {
        const link = document.createElement("a");
        link.className = "search-result";
        link.href = pageRoot + hit.id;
        link.setAttribute("role", "option");
        link.setAttribute("aria-selected", "false");
        link.dataset.index = String(index);
        link.dataset.id = hit.id;

        const title = document.createElement("span");
        title.className = "search-result-title";
        title.textContent = hit.title || hit.id;
        link.appendChild(title);

        if (hit.section) {
          const section = document.createElement("span");
          section.className = "search-result-section";
          section.textContent = hit.section;
          link.appendChild(section);
        }

        const snippet = document.createElement("span");
        snippet.className = "search-result-snippet";
        snippet.textContent = makeSnippet(hit.text, query);
        link.appendChild(snippet);

        link.addEventListener("mousedown", (event) => {
          // blurより先に遷移させるためpreventDefaultする
          event.preventDefault();
          goToResult(hit.id);
        });

        resultsEl.appendChild(link);
      });
      resultsEl.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    /**
     * キーボード操作用に選択行を更新する
     */
    function setActiveIndex(nextIndex) {
      const items = resultsEl.querySelectorAll(".search-result");
      if (items.length === 0) {
        activeIndex = -1;
        return;
      }
      if (nextIndex < 0) {
        nextIndex = items.length - 1;
      } else if (nextIndex >= items.length) {
        nextIndex = 0;
      }
      items.forEach((item, i) => {
        item.setAttribute("aria-selected", i === nextIndex ? "true" : "false");
      });
      activeIndex = nextIndex;
      items[nextIndex].scrollIntoView({ block: "nearest" });
    }

    /**
     * 入力に応じて検索を実行する
     */
    async function runSearch() {
      const query = input.value.trim();
      if (!query) {
        closeResults();
        return;
      }
      try {
        const engine = await ensureReady();
        const hits = engine.search(query, { prefix: true }).slice(0, 10);
        renderResults(query, hits);
      } catch (_error) {
        closeResults();
      }
    }

    // 初回フォーカスでインデックスを遅延ロードする
    input.addEventListener("focus", () => {
      ensureReady().catch(() => {});
      if (input.value.trim()) {
        runSearch();
      }
    });

    input.addEventListener("input", () => {
      runSearch();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeResults();
        input.blur();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex(activeIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(activeIndex - 1);
        return;
      }
      if (event.key === "Enter") {
        const items = resultsEl.querySelectorAll(".search-result");
        if (items.length === 0) {
          return;
        }
        event.preventDefault();
        const target = activeIndex >= 0 ? items[activeIndex] : items[0];
        goToResult(target.dataset.id);
      }
    });

    // 検索ボックス外クリックで閉じる
    document.addEventListener("click", (event) => {
      if (!rootEl.contains(event.target)) {
        closeResults();
      }
    });

    // "/" キーで検索ボックスへフォーカスする（入力中は無効）
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const tag = (event.target && event.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      if (event.target && event.target.isContentEditable) {
        return;
      }
      event.preventDefault();
      input.focus();
    });
  }

  initThemeToggle();
  initSidebarToggles();
  initDrawer();
  initTocSpy();
  initCodeCopy();
  initSearch();
})();
