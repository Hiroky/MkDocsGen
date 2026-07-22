import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NavNode, Page } from "../../types.js";
import type { Plugin, PluginFactory } from "../types.js";

/**
 * Confluenceエクスポート組み込みプラグイン
 *
 * buildEndフックでBuildContextから全ページHTMLとナビ階層を受け取り、
 * Confluence REST API（Storage Format、Basic認証）へページを作成/更新する。
 * 同期は `mkdocsgen build --enable confluence-export` のときだけ実行する（フラグ無しのbuildではスキップ）。
 *
 * url / username / space / parentPageId は mkdocsgen.yml の options か
 * 環境変数のどちらでも指定できる（両方指定時は環境変数を優先）。
 * password のみ環境変数（またはmkdocsgen.ymlと同じフォルダの.env）からしか読まない。YAMLには書けない:
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
 *
 * 実行例:
 *   mkdocsgen build                              # サイト生成のみ（Confluence同期なし）
 *   mkdocsgen build --enable confluence-export   # サイト生成後にConfluenceへ同期
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
  body?: { storage?: { value?: string } };
  results?: ConfluenceContentResult[];
  /** コンテンツプロパティ取得時の値 */
  value?: unknown;
}

/** Confluenceコンテンツ検索結果のうち同期判定に使う情報 */
interface ConfluenceContentResult {
  id: string;
  version?: { number?: number };
  body?: { storage?: { value?: string } };
}

/** Confluenceへ同期したページのID・バージョン・実タイトル */
interface ConfluencePageInfo {
  pageId: string;
  version: number;
  title: string;
  bodyValue: string | undefined;
  bodyHash: string | null;
  bodyHashProperty: ConfluenceBodyHashProperty | null;
  isNew: boolean;
  bodyUpdated: boolean;
  uploadedImageCount: number;
  skippedImageCount: number;
}

/** Confluenceに保存する画像ハッシュプロパティの情報 */
interface ConfluenceImageHashProperty {
  id: string;
  version: number;
  hashes: Map<string, string>;
}

/** Confluenceに保存するページ本文ハッシュプロパティの情報 */
interface ConfluenceBodyHashProperty {
  id: string;
  version: number;
  hash: string;
}

/** 本文中から抽出したローカル画像1件（添付ファイルアップロード用） */
interface LocalImageRef {
  /** Confluence添付ファイル名（パス区切りを含まない安全な名前） */
  filename: string;
  /** 画像ファイルの絶対パス */
  absPath: string;
  /** 画像ファイルのSHA-256。読み取れない場合はnull */
  hash: string | null;
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
      " CONFLUENCE_PASSWORD 環境変数（またはmkdocsgen.ymlと同じフォルダの.env）で指定してください"
    );
  }

  const url = (resolveSetting(process.env.CONFLUENCE_URL, options.url) ?? "").replace(/\/$/, "");
  const username = resolveSetting(process.env.CONFLUENCE_USERNAME, options.username);
  const space = resolveSetting(process.env.CONFLUENCE_SPACE, options.space) ?? "";
  const parentPageId = resolveSetting(process.env.CONFLUENCE_PARENT_PAGE_ID, options.parentPageId);
  const dryRun = options.dryRun === true;
  // trueならルートインデックス(Home)を実際の親ページにし、他のトップレベル項目をその子にする
  const homeAsRoot = options.homeAsRoot === true;
  // Confluenceへエクスポートするルートページだけ、YAMLのoptions.rootPageTitleで表示名を上書きできる
  const rootPageTitle = typeof options.rootPageTitle === "string" && options.rootPageTitle.trim().length > 0
    ? options.rootPageTitle.trim()
    : null;

  return {
    name: "confluence-export",

    /**
     * 全ページ出力完了後にConfluenceへ同期する
     */
    async buildEnd(context)
    {
      // --enable に自プラグイン名が無い通常のbuildでは同期しない（ローカル検証で誤アップロードしないため）
      if (!context.enabledPlugins?.includes("confluence-export")) {
        console.info(
          "[confluence-export] スキップしました（同期するには mkdocsgen build --enable confluence-export）"
        );
        return;
      }

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
      const plan = buildExportPlan(context.nav, context.pages, { homeAsRoot, rootPageTitle });
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
      /** 計画キー → 同期済みページ情報（後段のリンク変換で使用する） */
      const pageInfos = new Map<string, ConfluencePageInfo>();
      /** 同期後に本文リンクを書き換える対象の元データ */
      const exportedBodies: Array<{ item: PlanItem; page: Page | undefined; bodyHtml: string }> = [];

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
        // タイトルが偶然重複する無関係な既存ページを誤って上書きしないための識別キー
        const sourceKey = buildSourceKey(item, plan);
        // 通常は元タイトルを使い、同名衝突時だけ親階層やソースパスを付けた候補へ切り替える
        const titleCandidates = buildTitleCandidates(item, plan, sourceKey, page?.sourcePath ?? null);

        const upserted = await upsertConfluencePage({
          baseUrl: url,
          authHeader,
          space,
          title: item.title,
          titleCandidates,
          bodyHtml,
          parentId,
          sourceKey,
          docsDirAbs: context.config.docsDirAbs,
          sourcePath: page ? page.sourcePath : null
        });
        createdIds.set(item.key, upserted.pageId);
        pageInfos.set(item.key, upserted);
        exportedBodies.push({ item, page, bodyHtml });
      }

      // 全ページのIDが確定した後、サイト内相対リンクをConfluenceのページURLへ変換する
      const pageIdsByOutputPath = new Map<string, string>();
      for (const item of plan) {
        if (item.url === null) {
          continue;
        }
        const pageInfo = pageInfos.get(item.key);
        if (pageInfo !== undefined) {
          pageIdsByOutputPath.set(item.url, pageInfo.pageId);
        }
      }

      for (const exported of exportedBodies) {
        if (exported.item.url === null) {
          continue;
        }
        const pageInfo = pageInfos.get(exported.item.key);
        if (pageInfo === undefined) {
          continue;
        }
        const rewrittenBody = rewriteConfluenceLinks(
          exported.bodyHtml,
          exported.item.url,
          pageIdsByOutputPath,
          url
        );
        const finalBodyValue = (await prepareConfluenceBody(
          rewrittenBody,
          context.config.docsDirAbs,
          exported.page?.sourcePath ?? null
        )).value;
        const finalBodyHash = createHash("sha256").update(finalBodyValue).digest("hex");
        if (pageInfo.bodyHash !== finalBodyHash &&
            normalizeConfluenceBodyForComparison(finalBodyValue) !== normalizeConfluenceBodyForComparison(pageInfo.bodyValue ?? "")) {
          pageInfo.version = await updateConfluencePageBody({
            baseUrl: url,
            authHeader,
            pageId: pageInfo.pageId,
            title: pageInfo.title,
            bodyHtml: rewrittenBody,
            version: pageInfo.version,
            docsDirAbs: context.config.docsDirAbs,
            sourcePath: exported.page?.sourcePath ?? null
          });
          pageInfo.bodyUpdated = true;
        }
        pageInfo.bodyValue = finalBodyValue;
        if (pageInfo.bodyHash !== finalBodyHash) {
          pageInfo.bodyHashProperty = await setBodyHashProperty(
            url,
            authHeader,
            pageInfo.pageId,
            finalBodyHash,
            pageInfo.bodyHashProperty
          );
          pageInfo.bodyHash = finalBodyHash;
        }
      }

      // ページごとの最終結果を明示する。従来のupserted表示では、PUTを省略したページも
      // 更新したように見えてしまうため、作成・更新・スキップを分けて表示する
      for (const item of plan) {
        const pageInfo = pageInfos.get(item.key);
        if (pageInfo === undefined) {
          continue;
        }
        const action = pageInfo.isNew ? "created" : pageInfo.bodyUpdated ? "updated" : "skipped";
        console.info(
          `[confluence-export] ${action}: ${pageInfo.title} -> ${pageInfo.pageId}` +
          ` imagesUploaded=${pageInfo.uploadedImageCount}` +
          ` imagesSkipped=${pageInfo.skippedImageCount}`
        );
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
  options: { homeAsRoot: boolean; rootPageTitle: string | null }
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
        title: node.url === "index.html" && options.rootPageTitle !== null
          ? options.rootPageTitle
          : node.title,
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
    plan.push({
      key: homeKey,
      parentKey: null,
      title: options.rootPageTitle ?? home.title,
      url: home.url
    });
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
 * ナビ上の位置から一意なソースキーを作る。
 * Confluence側はタイトルだけでは同一性を判定できないため、
 * コンテンツプロパティに保存して「本当に同じソースから作られたページか」を確認するのに使う
 */
function buildSourceKey(item: PlanItem, plan: PlanItem[]): string
{
  // 実ページはoutputPathがサイト内で一意なのでそのまま使える
  if (item.url !== null) {
    return `page:${item.url}`;
  }

  // 本文の無いセクションはoutputPathを持たないため、祖先タイトルの並びをキーにする
  const titles: string[] = [item.title];
  let parentKey = item.parentKey;
  while (parentKey !== null) {
    const parent = plan.find((candidate) => candidate.key === parentKey);
    if (!parent) {
      break;
    }
    titles.unshift(parent.title);
    parentKey = parent.parentKey;
  }
  return `section:${titles.join("/")}`;
}

/**
 * Confluenceで同名ページが見つかった場合に試す、決定的なタイトル候補を作る。
 * 親階層を優先し、同じ親階層でも衝突する場合はソースパスで識別する
 */
function buildTitleCandidates(
  item: PlanItem,
  plan: PlanItem[],
  sourceKey: string,
  sourcePath: string | null
): string[]
{
  const candidates = [item.title];
  const ancestorTitles: string[] = [];
  let parentKey = item.parentKey;

  while (parentKey !== null) {
    const parent = plan.find((candidate) => candidate.key === parentKey);
    if (!parent) {
      break;
    }
    ancestorTitles.unshift(parent.title);
    parentKey = parent.parentKey;
  }

  if (ancestorTitles.length > 0) {
    candidates.push(`${item.title}（${ancestorTitles.join(" > ")}）`);
  }

  const sourceLabel = sourcePath ?? sourceKey.replace(/^(page|section):/, "");
  candidates.push(`${item.title}（${sourceLabel}）`);
  return [...new Set(candidates)];
}

/** ページの同一性を保存するコンテンツプロパティのキー */
const SOURCE_KEY_PROPERTY = "mkdocsgen-source-key";
/** 画像添付の差分判定に使うコンテンツプロパティのキー */
const IMAGE_HASHES_PROPERTY = "mkdocsgen-image-hashes";
/** 生成済みStorage Format本文の差分判定に使うコンテンツプロパティのキー */
const BODY_HASH_PROPERTY = "mkdocsgen-body-hash";

/**
 * 本文をConfluence Storage Format用のXHTMLへ整形し、添付対象画像も抽出する
 */
async function prepareConfluenceBody(
  bodyHtml: string,
  docsDirAbs: string,
  sourcePath: string | null
): Promise<{ value: string; images: LocalImageRef[] }>
{
  // allow_htmlで通過したHTML風の記述には、XHTML属性として不正な独自タグが
  // 含まれることがある。Confluenceへ送る前に、そのタグだけを文字列へ戻す
  const safeBodyHtml = escapeMalformedHtmlTags(bodyHtml);
  const { html: imagesRewrittenHtml, images } = sourcePath
    ? rewriteLocalImages(safeBodyHtml, docsDirAbs, sourcePath)
    : { html: safeBodyHtml, images: [] as LocalImageRef[] };
  let htmlWithImageMetadata = imagesRewrittenHtml;

  // 画像本体を読み、次回以降の差分判定に使うSHA-256を計算する
  for (const [index, image] of images.entries()) {
    image.hash = await hashLocalImage(image.absPath);
    const placeholder = `__MKDOCSGEN_IMAGE_HASH_${index}__`;
    const metadata = image.hash === null
      ? ""
      : `<!-- mkdocsgen-image-meta:${Buffer.from(image.filename, "utf8").toString("hex")}:${image.hash} -->`;
    htmlWithImageMetadata = htmlWithImageMetadata.replace(placeholder, metadata);
  }

  return { value: toXhtmlVoidElements(htmlWithImageMetadata), images };
}

/** 属性構文が不正なHTML風タグをエスケープし、ConfluenceのXHTMLパースエラーを防ぐ */
function escapeMalformedHtmlTags(html: string): string
{
  const malformedTagNames = new Set<string>();
  const tagPattern = /<(\/?)\s*([A-Za-z][A-Za-z0-9:_-]*)([^>]*)>/g;
  return html.replace(tagPattern, (match, slash: string, tagName: string, attrs: string) => {
    const normalizedTagName = tagName.toLowerCase();
    if (slash !== "") {
      if (malformedTagNames.delete(normalizedTagName)) {
        return escapeHtml(match);
      }
      return match;
    }
    if (isValidXhtmlAttributes(attrs)) {
      return match;
    }
    if (!/\/\s*$/.test(attrs)) {
      malformedTagNames.add(normalizedTagName);
    }
    return escapeHtml(match);
  });
}

/** XHTML属性列が名前と値の組み合わせとして正しいか判定する */
function isValidXhtmlAttributes(attrs: string): boolean
{
  return /^(?:\s+[A-Za-z_:][A-Za-z0-9:._-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))*\s*\/?\s*$/.test(attrs);
}

/** ローカル画像のSHA-256を計算する。ファイルを読めない場合はnullを返す */
async function hashLocalImage(absPath: string): Promise<string | null>
{
  try {
    const fileBuffer = await readFile(absPath);
    return createHash("sha256").update(fileBuffer).digest("hex");
  } catch {
    return null;
  }
}

/** 本文に埋め込んだ画像メタデータを添付ファイル名とハッシュの対応表へ戻す */
function extractImageHashes(bodyHtml: string): Map<string, string>
{
  const imageHashes = new Map<string, string>();
  const metadataPattern = /<!--\s*mkdocsgen-image-meta:([0-9a-f]+):([0-9a-f]{64})\s*-->/gi;
  for (const match of bodyHtml.matchAll(metadataPattern)) {
    const encodedFilename = match[1]!;
    if (encodedFilename.length % 2 !== 0) {
      continue;
    }
    const filename = Buffer.from(encodedFilename, "hex").toString("utf8");
    imageHashes.set(filename, match[2]!.toLowerCase());
  }
  return imageHashes;
}

/** Confluenceが保存時に除去する画像管理コメントを本文比較から除外する */
function normalizeConfluenceBodyForComparison(bodyHtml: string): string
{
  return bodyHtml
    .replace(/<!--\s*mkdocsgen-image-meta:[0-9a-f]+:[0-9a-f]{64}\s*-->/gi, "")
    // Confluenceの保存時に見出しのid属性が除去されるため、比較時だけ無視する
    .replace(/(<h[1-6])\s+id="[^"]*"/gi, "$1");
}

/**
 * ConfluenceページをsourceKeyで検索し、一致するページだけを更新し、
 * 一致するページが無ければ同名ページがあっても新規作成する。
 * Confluenceではタイトルはページの同一性を表さないため、タイトルだけで更新対象を決めない
 */
async function upsertConfluencePage(args: {
  baseUrl: string;
  authHeader: string;
  space: string;
  title: string;
  titleCandidates: string[];
  bodyHtml: string;
  parentId: string | null;
  sourceKey: string;
  docsDirAbs: string;
  sourcePath: string | null;
}): Promise<ConfluencePageInfo>
{
  const { baseUrl, authHeader, space, title, titleCandidates, bodyHtml, parentId, sourceKey, docsDirAbs, sourcePath } = args;

  // 本文中のローカル画像をConfluence添付ファイル参照（ac:image）に差し替える
  const { value: storageValue, images } = await prepareConfluenceBody(bodyHtml, docsDirAbs, sourcePath);

  const storageBody = {
    representation: "storage",
    // Confluence Storage FormatはXHTML準拠のためimg/br/hr等のvoid要素は
    // 自己終了タグでなければならない（markdown-itの出力は非自己終了）。
    // toXhtmlVoidElements()で最小限の補正のみ行う
    value: storageValue
  };

  // 元タイトルから順番に検索し、同一sourceKeyのページがあればその実タイトルで更新する。
  // 同一sourceKeyが無く、空いている候補が見つかった時点で新規作成タイトルを確定する
  const uniqueTitleCandidates = [...new Set([title, ...titleCandidates])];
  let existing: ConfluenceContentResult | undefined;
  let effectiveTitle = title;

  for (const candidateTitle of uniqueTitleCandidates) {
    const found = await searchConfluencePages(baseUrl, authHeader, space, candidateTitle);

    // 同名候補を全件調べ、sourceKeyが一致するページだけを更新対象にする。
    // 別ソースのページや、導入前に作られてsourceKeyを持たないページは触らない
    for (const candidate of found.results ?? []) {
      const candidateKey = await getSourceKeyProperty(baseUrl, authHeader, candidate.id);
      if (candidateKey === sourceKey) {
        // タイトル検索APIはexpandを指定しても本文を省略する環境があるため、
        // sourceKey一致後にページID取得APIでStorage Format本文を確実に取得する
        existing = candidate.body?.storage?.value === undefined
          ? await getConfluencePage(baseUrl, authHeader, candidate)
          : candidate;
        effectiveTitle = candidateTitle;
        break;
      }
    }

    if (existing || (found.results ?? []).length === 0) {
      effectiveTitle = existing ? effectiveTitle : candidateTitle;
      break;
    }
  }

  let pageId: string;
  let pageVersion: number;
  let pageBodyValue: string | undefined;
  let existingImageHashes: Map<string, string> | null = null;
  let existingImageHashProperty: ConfluenceImageHashProperty | null = null;
  let existingBodyHashProperty: ConfluenceBodyHashProperty | null = null;
  let isNew = false;
  let bodyUpdated = false;
  let uploadedImageCount = 0;
  let skippedImageCount = 0;

  if (existing) {
    // sourceKeyが一致したページは、現在の本文を保持して後段の差分判定へ回す。
    // 全ページのIDが揃うまで相対リンクをConfluence URLへ変換できないため、ここで
    // 更新すると、リンク変換前後の2回更新になる。本文を取得できる場合は更新を
    // 後段に一本化し、変更がなければPUT自体を省略する
    pageId = existing.id;
    pageVersion = existing.version?.number ?? 1;
    pageBodyValue = existing.body?.storage?.value;
    existingImageHashes = pageBodyValue === undefined ? null : extractImageHashes(pageBodyValue);
    existingBodyHashProperty = await getBodyHashProperty(baseUrl, authHeader, pageId);
    if (images.length > 0) {
      // HTMLコメントがConfluence側で正規化・除去されても差分判定できるよう、
      // 画像ハッシュはコンテンツプロパティにも保存しておく
      existingImageHashProperty = await getImageHashesProperty(baseUrl, authHeader, pageId);
      if (existingImageHashProperty !== null) {
        existingImageHashes = existingImageHashProperty.hashes;
      }
    }

    if (pageBodyValue === undefined) {
      // 古いAPIや権限で本文を取得できない場合は、従来どおり安全側に倒して更新する
      const updateUrl = `${baseUrl}/rest/api/content/${existing.id}`;
      const payload = {
        id: existing.id,
        type: "page",
        title: effectiveTitle,
        space: { key: space },
        body: { storage: storageBody },
        version: { number: pageVersion + 1 }
      };
      const updated = await confluenceFetch(updateUrl, authHeader, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      pageId = updated.id ?? pageId;
      pageVersion = updated.version?.number ?? pageVersion + 1;
      pageBodyValue = storageValue;
      bodyUpdated = true;
    }
  } else {
    // sourceKeyが一致するページが無かった場合は、空いている候補タイトルで新規作成する。
    // 親ページがあればancestorsに載せる
    const payload = {
      type: "page",
      title: effectiveTitle,
      space: { key: space },
      body: { storage: storageBody },
      ...(parentId ? { ancestors: [{ id: parentId }] } : {})
    };
    const created = await confluenceFetch(`${baseUrl}/rest/api/content`, authHeader, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    pageId = created.id ?? "";
    pageVersion = created.version?.number ?? 1;
    pageBodyValue = storageValue;
    isNew = true;
    bodyUpdated = true;
    await setSourceKeyProperty(baseUrl, authHeader, pageId, sourceKey);
  }

  // 既存本文に同じハッシュが記録されている画像は、添付ファイルの更新を省略する。
  // ハッシュが無い既存ページや画像を読み取れない場合は、互換性と安全性を優先して送る
  for (const image of images) {
    if (existingImageHashes !== null && image.hash !== null && existingImageHashes.get(image.filename) === image.hash) {
      skippedImageCount++;
      continue;
    }
    await uploadAttachmentFile(baseUrl, authHeader, pageId, image.filename, image.absPath);
    uploadedImageCount++;
  }

  // 画像のハッシュをページプロパティへ保存し、次回以降は本文コメントに依存せず判定できるようにする
  const generatedImageHashes = new Map(
    images
      .filter((image): image is LocalImageRef & { hash: string } => image.hash !== null)
      .map((image) => [image.filename, image.hash])
  );
  if (images.length > 0 && generatedImageHashes.size === images.length &&
      (existingImageHashProperty === null || !imageHashMapsEqual(existingImageHashProperty.hashes, generatedImageHashes))) {
    await setImageHashesProperty(
      baseUrl,
      authHeader,
      pageId,
      generatedImageHashes,
      existingImageHashProperty
    );
  }

  return {
    pageId,
    version: pageVersion,
    title: effectiveTitle,
    bodyValue: pageBodyValue,
    bodyHash: existingBodyHashProperty?.hash ?? null,
    bodyHashProperty: existingBodyHashProperty,
    isNew,
    bodyUpdated,
    uploadedImageCount,
    skippedImageCount
  };
}

/**
 * Confluenceスペース内の指定タイトルのページを、バージョン情報付きで検索する
 */
async function searchConfluencePages(
  baseUrl: string,
  authHeader: string,
  space: string,
  title: string
): Promise<ConfluenceApiResponse>
{
  const searchUrl =
    `${baseUrl}/rest/api/content` +
    `?spaceKey=${encodeURIComponent(space)}` +
    `&title=${encodeURIComponent(title)}` +
    `&expand=version,body.storage` +
    `&limit=100`;
  return confluenceFetch(searchUrl, authHeader);
}

/** ページIDからバージョンとStorage Format本文を取得する */
async function getConfluencePage(
  baseUrl: string,
  authHeader: string,
  candidate: ConfluenceContentResult
): Promise<ConfluenceContentResult>
{
  const response = await confluenceFetch(
    `${baseUrl}/rest/api/content/${candidate.id}?expand=version,body.storage`,
    authHeader
  );
  const version = response.version ?? candidate.version;
  return {
    id: response.id ?? candidate.id,
    ...(version ? { version } : {}),
    ...(response.body ? { body: response.body } : {})
  };
}

/**
 * 同期済みページの本文を、相対リンクを変換した内容で更新する
 */
async function updateConfluencePageBody(args: {
  baseUrl: string;
  authHeader: string;
  pageId: string;
  title: string;
  bodyHtml: string;
  version: number;
  docsDirAbs: string;
  sourcePath: string | null;
}): Promise<number>
{
  const { baseUrl, authHeader, pageId, title, bodyHtml, version, docsDirAbs, sourcePath } = args;
  const storageValue = (await prepareConfluenceBody(bodyHtml, docsDirAbs, sourcePath)).value;
  const payload = {
    id: pageId,
    type: "page",
    title,
    body: {
      storage: {
        representation: "storage",
        value: storageValue
      }
    },
    version: { number: version + 1 }
  };
  const updated = await confluenceFetch(`${baseUrl}/rest/api/content/${pageId}`, authHeader, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return updated.version?.number ?? version + 1;
}

/**
 * 本文中のサイト内相対ページリンクをConfluenceページURLへ変換する。
 * 画像や未登録の静的ファイルへのリンクは、ページIDが無いためそのまま残す
 */
function rewriteConfluenceLinks(
  html: string,
  fromOutputPath: string,
  pageIdsByOutputPath: Map<string, string>,
  baseUrl: string
): string
{
  return html.replace(
    /(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']*)(\2)/gi,
    (match, prefix: string, quote: string, href: string) => {
      const confluenceHref = resolveConfluenceHref(href, fromOutputPath, pageIdsByOutputPath, baseUrl);
      if (confluenceHref === null) {
        return match;
      }
      return `${prefix}${quote}${escapeHtml(confluenceHref)}${quote}`;
    }
  );
}

/**
 * 1本の相対hrefを、対応するConfluenceページURLへ解決する
 */
function resolveConfluenceHref(
  href: string,
  fromOutputPath: string,
  pageIdsByOutputPath: Map<string, string>,
  baseUrl: string
): string | null
{
  // 外部URL、サイト絶対URL、メールリンクなどは変換対象外
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("/")) {
    return null;
  }

  const hashIndex = href.indexOf("#");
  const rawPathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  let pathPart = rawPathPart;
  try {
    // 日本語などがパーセントエンコードされたリンクでもoutputPathと照合できるようにする
    pathPart = decodeURIComponent(rawPathPart);
  } catch {
    // 不正なエンコードは元の文字列で照合し、対象外ならリンクを変更しない
  }
  const anchor = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
  const fromDir = path.posix.dirname(fromOutputPath);
  const joinedPath = pathPart.length === 0
    ? fromOutputPath
    : path.posix.join(fromDir === "." ? "" : fromDir, pathPart);
  let targetPath = path.posix.normalize(joinedPath).replace(/^\.\//, "");
  if (targetPath.endsWith(".md")) {
    targetPath = targetPath.replace(/\.md$/, ".html");
  }

  const pageId = pageIdsByOutputPath.get(targetPath);
  if (pageId === undefined) {
    return null;
  }
  const targetUrl = `${baseUrl}/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
  return anchor.length > 0 ? `${targetUrl}#${anchor}` : targetUrl;
}

/**
 * ページに保存済みのsourceKeyプロパティを取得する。未設定なら null を返す
 */
async function getSourceKeyProperty(
  baseUrl: string,
  authHeader: string,
  pageId: string
): Promise<string | null>
{
  const response = await fetch(
    `${baseUrl}/rest/api/content/${pageId}/property/${SOURCE_KEY_PROPERTY}`,
    { headers: { Authorization: authHeader, Accept: "application/json" } }
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Confluence API ${response.status}: ${text}`);
  }
  const data = await response.json() as { value?: unknown };
  return typeof data.value === "string" ? data.value : null;
}

/**
 * ページにsourceKeyプロパティを保存する
 */
async function setSourceKeyProperty(
  baseUrl: string,
  authHeader: string,
  pageId: string,
  sourceKey: string
): Promise<void>
{
  await confluenceFetch(`${baseUrl}/rest/api/content/${pageId}/property`, authHeader, {
    method: "POST",
    body: JSON.stringify({ key: SOURCE_KEY_PROPERTY, value: sourceKey })
  });
}

/** ページに保存済みの画像ハッシュプロパティを取得する。未設定ならnullを返す */
async function getImageHashesProperty(
  baseUrl: string,
  authHeader: string,
  pageId: string
): Promise<ConfluenceImageHashProperty | null>
{
  const response = await fetch(
    `${baseUrl}/rest/api/content/${pageId}/property/${IMAGE_HASHES_PROPERTY}`,
    { headers: { Authorization: authHeader, Accept: "application/json" } }
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Confluence API ${response.status}: ${text}`);
  }
  const data = await response.json() as {
    id?: string;
    value?: unknown;
    version?: { number?: number };
  };
  if (typeof data.id !== "string") {
    return null;
  }
  return {
    id: data.id,
    version: data.version?.number ?? 1,
    hashes: parseImageHashValue(data.value)
  };
}

/** APIから返った画像ハッシュプロパティ値をMapへ変換する */
function parseImageHashValue(value: unknown): Map<string, string>
{
  const hashes = new Map<string, string>();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return hashes;
  }
  for (const [filename, hash] of Object.entries(value)) {
    if (typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash)) {
      hashes.set(filename, hash.toLowerCase());
    }
  }
  return hashes;
}

/** 2つの画像ハッシュMapが同一内容か比較する */
function imageHashMapsEqual(left: Map<string, string>, right: Map<string, string>): boolean
{
  if (left.size !== right.size) {
    return false;
  }
  for (const [filename, hash] of left) {
    if (right.get(filename) !== hash) {
      return false;
    }
  }
  return true;
}

/** ページへ画像ハッシュプロパティを新規作成または更新する */
async function setImageHashesProperty(
  baseUrl: string,
  authHeader: string,
  pageId: string,
  hashes: Map<string, string>,
  existing: ConfluenceImageHashProperty | null
): Promise<void>
{
  const value = Object.fromEntries(hashes);
  if (existing === null) {
    await confluenceFetch(`${baseUrl}/rest/api/content/${pageId}/property`, authHeader, {
      method: "POST",
      body: JSON.stringify({ key: IMAGE_HASHES_PROPERTY, value })
    });
    return;
  }

  await confluenceFetch(
    `${baseUrl}/rest/api/content/${pageId}/property/${IMAGE_HASHES_PROPERTY}`,
    authHeader,
    {
      method: "PUT",
      body: JSON.stringify({
        key: IMAGE_HASHES_PROPERTY,
        value,
        version: { number: existing.version + 1 }
      })
    }
  );
}

/** ページに保存済みの生成本文ハッシュプロパティを取得する。未設定ならnullを返す */
async function getBodyHashProperty(
  baseUrl: string,
  authHeader: string,
  pageId: string
): Promise<ConfluenceBodyHashProperty | null>
{
  const response = await fetch(
    `${baseUrl}/rest/api/content/${pageId}/property/${BODY_HASH_PROPERTY}`,
    { headers: { Authorization: authHeader, Accept: "application/json" } }
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Confluence API ${response.status}: ${text}`);
  }
  const data = await response.json() as {
    id?: string;
    value?: unknown;
    version?: { number?: number };
  };
  if (typeof data.id !== "string" || typeof data.value !== "string" || !/^[0-9a-f]{64}$/i.test(data.value)) {
    return null;
  }
  return {
    id: data.id,
    version: data.version?.number ?? 1,
    hash: data.value.toLowerCase()
  };
}

/** ページへ生成本文ハッシュプロパティを新規作成または更新する */
async function setBodyHashProperty(
  baseUrl: string,
  authHeader: string,
  pageId: string,
  hash: string,
  existing: ConfluenceBodyHashProperty | null
): Promise<ConfluenceBodyHashProperty>
{
  if (existing === null) {
    const created = await confluenceFetch(`${baseUrl}/rest/api/content/${pageId}/property`, authHeader, {
      method: "POST",
      body: JSON.stringify({ key: BODY_HASH_PROPERTY, value: hash })
    });
    return { id: created.id ?? "", version: created.version?.number ?? 1, hash };
  }

  await confluenceFetch(
    `${baseUrl}/rest/api/content/${pageId}/property/${BODY_HASH_PROPERTY}`,
    authHeader,
    {
      method: "PUT",
      body: JSON.stringify({
        key: BODY_HASH_PROPERTY,
        value: hash,
        version: { number: existing.version + 1 }
      })
    }
  );
  return { id: existing.id, version: existing.version + 1, hash };
}

/**
 * 本文HTML中のローカル画像参照(<img src="...">)を、Confluence添付ファイル参照
 * （<ac:image><ri:attachment /></ac:image>）に差し替える。外部URLの画像はそのまま残す
 */
function rewriteLocalImages(
  html: string,
  docsDirAbs: string,
  sourcePath: string
): { html: string; images: LocalImageRef[] }
{
  // img自体が無ければdocsDirAbs等に触れる必要が無い（テスト用の空configでも安全に通す）
  if (!/<img\b/i.test(html)) {
    return { html, images: [] };
  }

  // 外部URLのみのページでdocsDirAbsに触れずに済むよう、実際にローカル画像が
  // 見つかった時点で初めて解決する
  let baseDirAbs: string | null = null;
  const images: LocalImageRef[] = [];
  const imageIndexes = new Map<string, number>();

  const rewritten = html.replace(/<img\b([^>]*)>/gi, (match, attrs: string) => {
    const src = extractAttr(attrs, "src");
    if (src === null || !isLocalImageSrc(src)) {
      return match;
    }
    baseDirAbs ??= path.join(docsDirAbs, path.dirname(sourcePath));

    // クエリ・アンカーを除いたパス部分だけをファイルパスとして解決する
    const pathPart = (src.split(/[?#]/)[0] ?? src);
    const absPath = path.resolve(baseDirAbs, decodeURIComponent(pathPart));
    // 添付ファイル名はdocsDirAbsからの相対パスを連結して作る。
    // フォルダを跨いだ同名ファイル（例: 複数フォルダのscreenshot.png）の衝突を避けるため
    const filename = path.relative(docsDirAbs, absPath).split(path.sep).join("_");

    let imageIndex = imageIndexes.get(filename);
    if (imageIndex === undefined) {
      imageIndex = images.length;
      imageIndexes.set(filename, imageIndex);
      images.push({ filename, absPath, hash: null });
    }

    const alt = extractAttr(attrs, "alt");
    const altAttr = alt ? ` ac:alt="${escapeHtml(alt)}"` : "";
    return `__MKDOCSGEN_IMAGE_HASH_${imageIndex}__<ac:image${altAttr}><ri:attachment ri:filename="${escapeHtml(filename)}" /></ac:image>`;
  });

  return { html: rewritten, images };
}

/** 外部URL・プロトコル相対・サイト絶対パスではない（＝ローカルファイル参照の）srcかを判定する */
function isLocalImageSrc(src: string): boolean
{
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    // http:, https:, data: など
    return false;
  }
  if (src.startsWith("//") || src.startsWith("/")) {
    return false;
  }
  return true;
}

/** HTML属性文字列から指定した属性値（ダブルクォート囲み）を取り出す */
function extractAttr(attrs: string, name: string): string | null
{
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match ? match[1]! : null;
}

/**
 * Confluenceページに画像ファイルを添付する。
 * 同名の添付ファイルが既にあれば新しいバージョンとして更新する
 */
async function uploadAttachmentFile(
  baseUrl: string,
  authHeader: string,
  pageId: string,
  filename: string,
  absPath: string
): Promise<void>
{
  let fileBuffer: Buffer;
  try {
    fileBuffer = await readFile(absPath);
  } catch {
    console.warn(`[confluence-export] 画像ファイルが見つからないためスキップします: ${absPath}`);
    return;
  }

  const existingId = await findAttachmentId(baseUrl, authHeader, pageId, filename);
  const form = new FormData();
  // Buffer型のままだとBlobPartの型と噛み合わないため、素のUint8Arrayに変換する
  form.append("file", new Blob([Uint8Array.from(fileBuffer)]), filename);
  form.append("minorEdit", "true");

  const uploadUrl = existingId
    ? `${baseUrl}/rest/api/content/${pageId}/child/attachment/${existingId}/data`
    : `${baseUrl}/rest/api/content/${pageId}/child/attachment`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      // Confluence REST APIの添付ファイルアップロードはXSRFチェック回避のため必須
      "X-Atlassian-Token": "no-check"
    },
    body: form
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Confluence添付ファイルのアップロードに失敗しました ${response.status}: ${text}`);
  }
}

/**
 * ファイル名から既存の添付ファイルIDを探す。無ければ null
 */
async function findAttachmentId(
  baseUrl: string,
  authHeader: string,
  pageId: string,
  filename: string
): Promise<string | null>
{
  const url =
    `${baseUrl}/rest/api/content/${pageId}/child/attachment` +
    `?filename=${encodeURIComponent(filename)}`;
  const found = await confluenceFetch(url, authHeader);
  return found.results?.[0]?.id ?? null;
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

/** XHTMLで自己終了タグが必須なvoid要素（HTML Living Standard準拠） */
const VOID_ELEMENTS = [
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "source", "track", "wbr"
];

/**
 * markdown-itが出力する非自己終了のvoid要素（<img ...>や<br>等）を
 * XHTML（Confluence Storage Format）が要求する自己終了タグ（<img ... />）に変換する。
 * 既に自己終了しているタグはそのまま維持する
 */
function toXhtmlVoidElements(html: string): string
{
  const voidTagPattern = new RegExp(
    `<(${VOID_ELEMENTS.join("|")})((?:\\s[^>]*)?[^/>])?>`,
    "gi"
  );
  return html.replace(voidTagPattern, (_match, tagName: string, attrs: string | undefined) => {
    return `<${tagName}${attrs ?? ""} />`;
  });
}
