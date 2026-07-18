import type { ResolvedConfig } from "../config/schema.js";
import { ConfigError } from "../config/load.js";
import type { Logger } from "../logger.js";
import type { NavNode, PageRef } from "../types.js";
import type { PageSource } from "./scan.js";

/**
 * ディレクトリ構造を表す中間ノード
 */
interface TreeNode {
  kind: "section" | "page";
  /** ディレクトリ名 or ファイル名 */
  name: string;
  title: string;
  order: number | null;
  /** sectionの場合はindex.mdのPageSource（無ければnull） */
  page: PageSource | null;
  children: TreeNode[];
}

/**
 * ナビツリー構築の結果。ツリーとナビ順のフラットなページ列を返す
 */
export interface NavResult {
  nav: NavNode[];
  /** prev/next算出用のナビ順ページ列 */
  orderedPages: PageSource[];
  /** sourcePath → パンくず */
  breadcrumbsMap: Map<string, PageRef[]>;
}

/**
 * 仮想ルート配下へページを配置するためのコンテナを作る
 */
function createRoot(): TreeNode
{
  return {
    kind: "section",
    name: "",
    title: "",
    order: null,
    page: null,
    children: []
  };
}

/**
 * 親のchildrenから名前一致のセクションを探す。無ければ作って返す
 */
function ensureSection(parent: TreeNode, dirName: string): TreeNode
{
  // 既にあるセクションを再利用して、同じディレクトリが二重にならないようにする
  const existing = parent.children.find((child) => child.kind === "section" && child.name === dirName);
  if (existing) {
    return existing;
  }

  const section: TreeNode = {
    kind: "section",
    name: dirName,
    // index.mdが来るまではディレクトリ名を仮のタイトルにする
    title: dirName,
    order: null,
    page: null,
    children: []
  };
  parent.children.push(section);
  return section;
}

/**
 * PageSource一覧からディレクトリ構造のTreeNodeを組み立てる
 */
function buildAutoTree(sources: PageSource[]): TreeNode
{
  const root = createRoot();

  for (const source of sources) {
    // sourcePathを"/"で分割して階層をたどる
    const parts = source.sourcePath.split("/");
    const fileName = parts[parts.length - 1]!;
    let parent = root;

    // 最後のファイル名以外はディレクトリとしてセクションを用意する
    for (let i = 0; i < parts.length - 1; i++) {
      parent = ensureSection(parent, parts[i]!);
    }

    if (fileName === "index.md") {
      // index.mdは親セクションのpageに割り当て、セクションtitleを上書きする
      parent.page = source;
      parent.title = source.title;
      parent.order = source.order;
    } else {
      // 通常ページは親のchildrenへ追加する
      parent.children.push({
        kind: "page",
        name: fileName,
        title: source.title,
        order: source.order,
        page: source,
        children: []
      });
    }
  }

  return root;
}

/**
 * 同階層のノードを並び替える（index先頭 → order昇順 → 名前辞書順）
 */
function compareNodes(a: TreeNode, b: TreeNode): number
{
  // ルート直下のindex.mdページは常に先頭にする
  const aIsIndex = a.kind === "page" && a.name === "index.md";
  const bIsIndex = b.kind === "page" && b.name === "index.md";
  if (aIsIndex !== bIsIndex) {
    return aIsIndex ? -1 : 1;
  }

  // orderがあるものが先。両方あるなら数値昇順
  if (a.order !== null && b.order !== null && a.order !== b.order) {
    return a.order - b.order;
  }
  if (a.order !== null && b.order === null) {
    return -1;
  }
  if (a.order === null && b.order !== null) {
    return 1;
  }

  // 同順・order無しは名前の辞書順
  return a.name.localeCompare(b.name);
}

/**
 * ツリー全体を再帰的にソートする
 */
function sortTree(node: TreeNode): void
{
  node.children.sort(compareNodes);
  for (const child of node.children) {
    sortTree(child);
  }
}

/**
 * ルート直下からパスでノードを探し、見つかれば親から取り除いて返す
 */
function takeNode(rootChildren: TreeNode[], entryPath: string): TreeNode | null
{
  const isSection = entryPath.endsWith("/");
  const pathKey = isSection ? entryPath.slice(0, -1) : entryPath;

  // ルート直下を優先的に探す（ハイブリッドマージの主対象）
  for (let i = 0; i < rootChildren.length; i++) {
    const node = rootChildren[i]!;
    if (isSection) {
      if (node.kind === "section" && node.name === pathKey) {
        rootChildren.splice(i, 1);
        return node;
      }
    } else if (node.kind === "page" && node.page?.sourcePath === pathKey) {
      rootChildren.splice(i, 1);
      return node;
    } else if (node.kind === "section" && node.page?.sourcePath === pathKey) {
      // セクションのindex.mdを単独ページとして取り出す場合、セクション本体は残す
      const pageNode: TreeNode = {
        kind: "page",
        name: "index.md",
        title: node.page.title,
        order: node.page.order,
        page: node.page,
        children: []
      };
      node.page = null;
      // タイトルはディレクトリ名へ戻す（indexを剥がしたため）
      node.title = node.name;
      node.order = null;
      return pageNode;
    }
  }

  // ネストしたページ指定（例: guide/setup.md）を深掘りして取り出す
  if (!isSection) {
    return takeNestedPage(rootChildren, pathKey);
  }

  // ネストしたセクション指定（例: api/v1/）を深掘りして取り出す
  return takeNestedSection(rootChildren, pathKey);
}

/**
 * ネストしたページを親から取り除いて返す
 */
function takeNestedPage(nodes: TreeNode[], pathKey: string): TreeNode | null
{
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.kind === "page" && node.page?.sourcePath === pathKey) {
      nodes.splice(i, 1);
      return node;
    }
    if (node.kind === "section") {
      if (node.page?.sourcePath === pathKey) {
        const pageNode: TreeNode = {
          kind: "page",
          name: "index.md",
          title: node.page.title,
          order: node.page.order,
          page: node.page,
          children: []
        };
        node.page = null;
        node.title = node.name;
        node.order = null;
        return pageNode;
      }
      const found = takeNestedPage(node.children, pathKey);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * ネストしたセクションを親から取り除いて返す
 */
function takeNestedSection(nodes: TreeNode[], pathKey: string): TreeNode | null
{
  const parts = pathKey.split("/");
  if (parts.length === 0) {
    return null;
  }

  // 先頭セグメントがルート直下のセクション名と一致するか見る
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.kind !== "section" || node.name !== parts[0]) {
      continue;
    }
    if (parts.length === 1) {
      nodes.splice(i, 1);
      return node;
    }
    // 残りパスを子から探す
    return takeNestedSection(node.children, parts.slice(1).join("/"));
  }
  return null;
}

/**
 * config.navによるハイブリッドマージを行う
 */
function mergeNav(autoChildren: TreeNode[], navEntries: ResolvedConfig["nav"], logger: Logger): TreeNode[]
{
  // 破壊的に取り出すため、ルート直下だけ浅いコピーする（子配列は共有）
  const remaining = [...autoChildren];
  const merged: TreeNode[] = [];

  for (const entry of navEntries) {
    const taken = takeNode(remaining, entry.path);
    if (!taken) {
      // 存在しないパスはビルドエラー（該当パスをメッセージに含める）
      throw new ConfigError(`navに存在しないパスが指定されています: ${entry.path}`);
    }

    // title指定があれば表示名を上書きする
    if (entry.title !== undefined) {
      taken.title = entry.title;
    }
    merged.push(taken);
    logger.debug(`navマージ: ${entry.path} → ${taken.title}`);
  }

  // 列挙されなかったルート直下ノードは自動ソート順のまま末尾に追加する
  merged.push(...remaining);
  return merged;
}

/**
 * TreeNodeを公開用のNavNodeへ変換する
 */
function toNavNode(node: TreeNode): NavNode
{
  if (node.kind === "page") {
    return {
      title: node.title,
      url: node.page?.outputPath ?? null,
      children: []
    };
  }

  // セクションはindexがあればそのurl、無ければnull
  return {
    title: node.title,
    url: node.page?.outputPath ?? null,
    children: node.children.map(toNavNode)
  };
}

/**
 * ツリーを深さ優先で走査し、orderedPagesとbreadcrumbsMapを作る
 */
function flattenTree(
  nodes: TreeNode[],
  parentCrumbs: PageRef[],
  orderedPages: PageSource[],
  breadcrumbsMap: Map<string, PageRef[]>
): void
{
  for (const node of nodes) {
    if (node.kind === "page" && node.page) {
      // トップページ(index.md)はパンくずを空にする。それ以外は親セクション列+自身
      // PageRef.urlはテンプレートでroot連結するためoutputPath（相対）を入れる
      if (node.page.sourcePath === "index.md") {
        breadcrumbsMap.set(node.page.sourcePath, []);
      } else {
        const crumbs = [...parentCrumbs, { title: node.page.title, url: node.page.outputPath }];
        breadcrumbsMap.set(node.page.sourcePath, crumbs);
      }
      orderedPages.push(node.page);
      continue;
    }

    if (node.kind === "section") {
      // セクション参照（index無ければurlはnullで非リンクにする）
      const sectionRef: PageRef = {
        title: node.title,
        url: node.page?.outputPath ?? null
      };

      if (node.page) {
        // セクションのindexも「親セクション列 + 自身」をパンくずにする
        breadcrumbsMap.set(node.page.sourcePath, [...parentCrumbs, sectionRef]);
        orderedPages.push(node.page);
      }

      // 子のパンくずにはこのセクションを含める
      const childCrumbs = [...parentCrumbs, sectionRef];
      flattenTree(node.children, childCrumbs, orderedPages, breadcrumbsMap);
    }
  }
}

/**
 * ナビツリーを構築し、順序付きページ列とパンくずマップを返す
 */
export function buildNav(sources: PageSource[], config: ResolvedConfig, logger: Logger): NavResult
{
  // 1. ディレクトリツリーを構築する
  const root = buildAutoTree(sources);

  // 2. 各階層をソートする
  sortTree(root);

  // 3. ルートのindex.mdはセクションpageではなく、先頭のページノードとして扱う
  //    （仮想ルートのpageに載っている場合、トップレベルへ昇格させる）
  let topLevel = root.children;
  if (root.page) {
    const indexNode: TreeNode = {
      kind: "page",
      name: "index.md",
      title: root.page.title,
      order: root.page.order,
      page: root.page,
      children: []
    };
    topLevel = [indexNode, ...root.children];
    // index先頭ルールを再適用する
    topLevel.sort(compareNodes);
  }

  // 4. config.navがあればハイブリッドマージする
  if (config.nav.length > 0) {
    topLevel = mergeNav(topLevel, config.nav, logger);
  }

  // 5. NavNodeへ変換する
  const nav = topLevel.map(toNavNode);

  // 6. 深さ優先でorderedPagesとbreadcrumbsMapを作る
  const orderedPages: PageSource[] = [];
  const breadcrumbsMap = new Map<string, PageRef[]>();
  flattenTree(topLevel, [], orderedPages, breadcrumbsMap);

  return { nav, orderedPages, breadcrumbsMap };
}

/**
 * ナビ順のページ列からprev/nextを割り当てる
 */
export function assignPrevNext(
  orderedPages: PageSource[]
): Map<string, { prev: PageRef | null; next: PageRef | null }>
{
  const result = new Map<string, { prev: PageRef | null; next: PageRef | null }>();

  for (let i = 0; i < orderedPages.length; i++) {
    const current = orderedPages[i]!;
    // 先頭はprev無し、末尾はnext無し
    const prevPage = i > 0 ? orderedPages[i - 1]! : null;
    const nextPage = i < orderedPages.length - 1 ? orderedPages[i + 1]! : null;

    // urlはテンプレートのroot連結用にoutputPathを渡す（base_url込みのPage.urlとは別）
    result.set(current.sourcePath, {
      prev: prevPage ? { title: prevPage.title, url: prevPage.outputPath } : null,
      next: nextPage ? { title: nextPage.title, url: nextPage.outputPath } : null
    });
  }

  return result;
}
