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
     * 指定アンカーの目次リンクだけをactiveにする
     */
    function setActive(anchorId) {
      links.forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("data-anchor") === anchorId);
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

  initThemeToggle();
  initSidebarToggles();
  initDrawer();
  initTocSpy();
  initCodeCopy();
})();
