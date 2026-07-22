import type { NavNode, Page } from "../../types.js";
import type { Plugin, PluginFactory } from "../types.js";

/**
 * Confluenceエクスポート組み込みプラグイン
 *
 * buildEndフックでBuildContextから全ページHTMLとナビ階層を受け取り、
 * Confluence REST API（Storage Format、Basic認証）へページを作成/更新する。
 *
 * url / username / space / parentPageId は mkdocsgen.yml の options か
 * 環境変数のどちらでも指定できる（両方指定時は環境変数を優先）。
 * password のみ環境変数（または docs_dir/.env）からしか読まない。YAMLには書けない:
 *   CONFLUENCE_URL             … 例: https://example.atlassian.net/wiki
 *   CONFLUENCE_USERNAME        … Basic認証のユーザー名
 *   CONFLUENCE_PASSWORD        … Basic認証のパスワード（YAML不可、env専用）
 *   CONFLUENCE_SPACE           … スペースキー（任意。options.spaceでも可）
 *   CONFLUENCE_PARENT_PAGE_ID  … ルートの親ページID（任意。options.parentPageIdでも可）
 *
 * mkdocsgen.yml 例:
 *   plugins:
 *     - builtin: confluence-export
 *       options:
 *         url: https://example.atlassian.net/wiki   # 任意。envが無ければこちらを使う
 *         username: alice                            # 任意。envが無ければこちらを使う
 *         space: DOCS
 *         parentPageId: "123456"   # 任意。ルートの親ページID
 *         dryRun: true             # trueならAPIを呼ばずログのみ
 */

/** エクスポート計画1件（ナビノード1つに対応） */
interface PlanItem {
  key: string;
  parentKey: string | null;
  title: string;
  url: string | null;
}

/** Confluence REST APIのレスポンス（使用するフィールドのみ） */
interface ConfluenceApiResponse {
  id?: string;
  version?: { number?: number };
  results?: Array<{ id: string; version?: { number?: number } }>;
}

/**
 * 環境変数優先でオプション値を解決する。どちらも無ければnull
 */
function resolveSetting(envValue: string | undefined, optionValue: unknown): string | null
{
  if (typeof envValue === "string" && envValue !== "") {
    return envValue;
  }
  if (typeof optionValue === "string" && optionValue !== "") {
    return optionValue;
  }
  return null;
}

/**
 * プラグインファクトリ
 */
export const createConfluenceExportPlugin: PluginFactory = (options): Plugin => {
  // passwordはYAMLに書けない（秘密情報の誤コミット防止）。env専用
  if (options.password !== undefined) {
    throw new Error(
      "options.password はYAMLに書けません。" +
      " CONFLUENCE_PASSWORD 環境変数（または docs_dir/.env）で指定してください"
    );
  }

  const url = (resolveSetting(process.env.CONFLUENCE_URL, options.url) ?? "").replace(/\/$/, "");
  const username = resolveSetting(process.env.CONFLUENCE_USERNAME, options.username);
  const space = resolveSetting(process.env.CONFLUENCE_SPACE, options.space) ?? "";
  const parentPageId = resolveSetting(process.env.CONFLUENCE_PARENT_PAGE_ID, options.parentPageId);
  const dryRun = options.dryRun === true;
  // trueならルートインデックス(Home)を実際の親ページにし、他のトップレベル項目をその子にする
  const homeAsRoot = options.homeAsRoot === true;

  return {
    name: "confluence-export",

    /**
     * 全ページ出力完了後にConfluenceへ同期する
     */
    async buildEnd(context)
    {
      // 必須オプションの検証
      if (!space) {
        throw new Error("space が未設定です（options.space か CONFLUENCE_SPACE でスペースキーを指定してください）");
      }

      // passwordはbuildEnd実行時点の環境変数から読む（YAML不可）
      const password = process.env.CONFLUENCE_PASSWORD ?? null;

      if (!dryRun) {
        const missing: string[] = [];
        if (!url) missing.push("url (options.url / CONFLUENCE_URL)");
        if (!username) missing.push("username (options.username / CONFLUENCE_USERNAME)");
        if (!password) missing.push("password (CONFLUENCE_PASSWORD)");
        if (missing.length > 0) {
          throw new Error(
            `Confluence認証情報が不足しています: ${missing.join(", ")}` +
            "。dryRun: true で試すこともできます"
          );
        }
      }

      // ナビ階層を辿り、親子関係付きのエクスポート計画を作る
      const plan = buildExportPlan(context.nav, context.pages, { homeAsRoot });
      console.info(
        `[confluence-export] space=${space} pages=${plan.length}` +
        ` dryRun=${dryRun} parentPageId=${parentPageId ?? "(none)"}`
      );

      // dryRun時は計画を表示するだけ（APIは呼ばない）
      if (dryRun) {
        for (const item of plan) {
          console.info(
            `[confluence-export] dryRun: title=${item.title}` +
            ` url=${item.url ?? "(section)"} parent=${describeParentForLog(plan, item.parentKey)}`
          );
        }
        return;
      }

      // 実際のAPI呼び出し（参考実装のため最小限の骨格）
      const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
      /** 計画キー → 作成済みConfluenceページID */
      const createdIds = new Map<string, string>();

      for (const item of plan) {
        // セクション（url無し）は本文なしの親ページとして作る
        // item.urlはNavNode.url（outputPath形式）なので、比較はPage.outputPathで行う
        const page = item.url
          ? context.pages.find((p) => p.outputPath === item.url)
          : undefined;
        const bodyHtml = page ? page.contentHtml : `<p>${escapeHtml(item.title)}</p>`;
        const parentId = item.parentKey
          ? createdIds.get(item.parentKey) ?? parentPageId
          : parentPageId;

        const pageId = await upsertConfluencePage({
          baseUrl: url,
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
};

/**
 * ナビツリーを深さ優先で走査し、親子キー付きのエクスポート計画を作る
 */
function buildExportPlan(
  nav: NavNode[],
  pages: Page[],
  options: { homeAsRoot: boolean }
): PlanItem[]
{
  const plan: PlanItem[] = [];
  let seq = 0;

  /**
   * ノードを再帰的に計画へ追加する
   */
  function walk(nodes: NavNode[], parentKey: string | null): void
  {
    for (const node of nodes) {
      const key = `n${seq++}`;
      plan.push({
        key,
        parentKey,
        title: node.title,
        url: node.url
      });
      if (node.children.length > 0) {
        walk(node.children, key);
      }
    }
  }

  // homeAsRoot: ルートインデックス(index.html)をトップレベルから取り出し、
  // それを親として他のトップレベル項目をぶら下げる
  const homeIndex = options.homeAsRoot ? nav.findIndex((node) => node.url === "index.html") : -1;
  if (homeIndex !== -1) {
    const home = nav[homeIndex]!;
    const siblings = [...nav.slice(0, homeIndex), ...nav.slice(homeIndex + 1)];
    const homeKey = `n${seq++}`;
    plan.push({ key: homeKey, parentKey: null, title: home.title, url: home.url });
    walk([...home.children, ...siblings], homeKey);
  } else {
    if (options.homeAsRoot) {
      // index.htmlが見つからない場合は通常構成（フラット）にフォールバックする
      console.info("[confluence-export] homeAsRoot: index.htmlが見つからないため通常構成でエクスポートします");
    }
    walk(nav, null);
  }

  // ナビに載らない孤立ページがあれば末尾に追加する（保険）
  // item.urlはNavNode.url（outputPath形式）なので、比較はPage.outputPathで行う
  // （Page.urlはbase_url込みのため文字列形式が異なり、そのまま比較すると常に不一致になる）
  const plannedOutputPaths = new Set(plan.map((item) => item.url).filter((url): url is string => url !== null));
  for (const page of pages) {
    if (plannedOutputPaths.has(page.outputPath)) {
      continue;
    }
    plan.push({
      key: `orphan-${page.sourcePath}`,
      parentKey: null,
      title: page.title,
      url: page.outputPath
    });
  }

  return plan;
}

/**
 * ログ表示用に親を分かりやすい文字列にする（内部キーではなく親の見出しを表示する）
 */
function describeParentForLog(plan: PlanItem[], parentKey: string | null): string
{
  if (parentKey === null) {
    return "(root)";
  }
  const parent = plan.find((item) => item.key === parentKey);
  return parent ? parent.title : parentKey;
}

/**
 * Confluenceページをタイトルで検索し、あれば更新・なければ作成する
 */
async function upsertConfluencePage(args: {
  baseUrl: string;
  authHeader: string;
  space: string;
  title: string;
  bodyHtml: string;
  parentId: string | null;
}): Promise<string>
{
  const { baseUrl, authHeader, space, title, bodyHtml, parentId } = args;

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
    return updated.id ?? "";
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
  return created.id ?? "";
}

/**
 * Confluence REST APIへJSONリクエストを送る
 */
async function confluenceFetch(
  url: string,
  authHeader: string,
  init: RequestInit = {}
): Promise<ConfluenceApiResponse>
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
  return response.json() as Promise<ConfluenceApiResponse>;
}

/**
 * HTMLテキスト用に特殊文字をエスケープする
 */
function escapeHtml(text: string): string
{
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
