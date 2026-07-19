/**
 * Confluenceエクスポート参考実装（コアのテスト対象外）
 *
 * buildEndフックでBuildContextから全ページHTMLとナビ階層を受け取り、
 * Confluence REST API（Storage Format）へページを作成/更新する想定の骨格。
 *
 * 認証情報は環境変数からのみ読み、YAMLには書かない:
 *   CONFLUENCE_BASE_URL  … 例: https://example.atlassian.net/wiki
 *   CONFLUENCE_EMAIL     … APIトークンに紐づくメール
 *   CONFLUENCE_API_TOKEN … Atlassian APIトークン
 *
 * mkdocsgen.yml 例:
 *   plugins:
 *     - path: ./examples/plugins/confluence-export.mjs
 *       options:
 *         space: DOCS
 *         parentPageId: "123456"   # 任意。ルートの親ページID
 *         dryRun: true            # trueならAPIを呼ばずログのみ
 */

/**
 * プラグインファクトリ（MkDocsGenがdefault exportとして呼び出す）
 */
export default function createConfluenceExportPlugin(options = {})
{
  const space = typeof options.space === "string" ? options.space : "";
  const parentPageId = typeof options.parentPageId === "string" ? options.parentPageId : null;
  const dryRun = options.dryRun === true;

  return {
    name: "confluence-export",

    /**
     * 全ページ出力完了後にConfluenceへ同期する
     */
    async buildEnd(context)
    {
      // 必須オプションの検証
      if (!space) {
        throw new Error("options.space が未設定です（Confluenceスペースキーを指定してください）");
      }

      // 認証は環境変数のみ（YAMLへ書かない）
      const baseUrl = (process.env.CONFLUENCE_BASE_URL ?? "").replace(/\/$/, "");
      const email = process.env.CONFLUENCE_EMAIL ?? "";
      const apiToken = process.env.CONFLUENCE_API_TOKEN ?? "";

      if (!dryRun && (!baseUrl || !email || !apiToken)) {
        throw new Error(
          "Confluence認証情報が不足しています。" +
          " CONFLUENCE_BASE_URL / CONFLUENCE_EMAIL / CONFLUENCE_API_TOKEN を設定するか、" +
          " options.dryRun: true で試してください"
        );
      }

      // ナビ階層を辿り、親子関係付きのエクスポート計画を作る
      const plan = buildExportPlan(context.nav, context.pages, parentPageId);
      console.info(
        `[confluence-export] space=${space} pages=${plan.length}` +
        ` dryRun=${dryRun} parentPageId=${parentPageId ?? "(none)"}`
      );

      // dryRun時は計画を表示するだけ（APIは呼ばない）
      if (dryRun) {
        for (const item of plan) {
          console.info(
            `[confluence-export] dryRun: title=${item.title}` +
            ` url=${item.url ?? "(section)"} parent=${item.parentKey ?? "(root)"}`
          );
        }
        return;
      }

      // 実際のAPI呼び出し（参考実装のため最小限の骨格）
      const authHeader = "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
      /** 計画キー → 作成済みConfluenceページID */
      const createdIds = new Map();

      for (const item of plan) {
        // セクション（url無し）は本文なしの親ページとして作る
        const page = item.url
          ? context.pages.find((p) => p.url === item.url)
          : null;
        const bodyHtml = page ? page.contentHtml : `<p>${escapeHtml(item.title)}</p>`;
        const parentId = item.parentKey
          ? createdIds.get(item.parentKey) ?? parentPageId
          : parentPageId;

        const pageId = await upsertConfluencePage({
          baseUrl,
          authHeader,
          space,
          title: item.title,
          bodyHtml,
          parentId
        });
        createdIds.set(item.key, pageId);
        console.info(`[confluence-export] upserted: ${item.title} -> ${pageId}`);
      }
    }
  };
}

/**
 * ナビツリーを深さ優先で走査し、親子キー付きのエクスポート計画を作る
 */
function buildExportPlan(nav, pages, _rootParentId)
{
  const plan = [];
  let seq = 0;

  /**
   * ノードを再帰的に計画へ追加する
   */
  function walk(nodes, parentKey)
  {
    for (const node of nodes) {
      const key = `n${seq++}`;
      plan.push({
        key,
        parentKey,
        title: node.title,
        url: node.url
      });
      if (node.children && node.children.length > 0) {
        walk(node.children, key);
      }
    }
  }

  walk(nav, null);

  // ナビに載らない孤立ページがあれば末尾に追加する（保険）
  const plannedUrls = new Set(plan.map((item) => item.url).filter(Boolean));
  for (const page of pages) {
    if (plannedUrls.has(page.url)) {
      continue;
    }
    plan.push({
      key: `orphan-${page.sourcePath}`,
      parentKey: null,
      title: page.title,
      url: page.url
    });
  }

  return plan;
}

/**
 * Confluenceページをタイトルで検索し、あれば更新・なければ作成する
 */
async function upsertConfluencePage({
  baseUrl,
  authHeader,
  space,
  title,
  bodyHtml,
  parentId
})
{
  // 同名ページをスペース内で探す
  const searchUrl =
    `${baseUrl}/rest/api/content` +
    `?spaceKey=${encodeURIComponent(space)}` +
    `&title=${encodeURIComponent(title)}` +
    `&expand=version`;
  const found = await confluenceFetch(searchUrl, authHeader);
  const existing = found.results?.[0];

  const storageBody = {
    representation: "storage",
    // 参考実装のため本文HTMLをそのままStorage Formatとして送る
    // 本番利用時はHTML→Storage変換を挟むこと
    value: bodyHtml
  };

  if (existing) {
    // 既存ページはversionを上げて更新する
    const updateUrl = `${baseUrl}/rest/api/content/${existing.id}`;
    const payload = {
      id: existing.id,
      type: "page",
      title,
      space: { key: space },
      body: { storage: storageBody },
      version: { number: (existing.version?.number ?? 1) + 1 }
    };
    const updated = await confluenceFetch(updateUrl, authHeader, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    return updated.id;
  }

  // 新規作成。親ページがあればancestorsに載せる
  const payload = {
    type: "page",
    title,
    space: { key: space },
    body: { storage: storageBody },
    ...(parentId ? { ancestors: [{ id: parentId }] } : {})
  };
  const created = await confluenceFetch(`${baseUrl}/rest/api/content`, authHeader, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return created.id;
}

/**
 * Confluence REST APIへJSONリクエストを送る
 */
async function confluenceFetch(url, authHeader, init = {})
{
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Confluence API ${response.status}: ${text}`);
  }
  return response.json();
}

/**
 * HTMLテキスト用に特殊文字をエスケープする
 */
function escapeHtml(text)
{
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
