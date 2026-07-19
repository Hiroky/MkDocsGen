import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModuleResolveError, resolvePythonModule } from "../../src/pydoc/resolve.js";

/** 各テストで作った一時ディレクトリの掃除用 */
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/**
 * 一時ディレクトリを作り、終了時に削除する
 */
function createTempDir(): string
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkdocsgen-pydoc-resolve-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

describe("resolvePythonModule", () => {
  it("mypackage.mymodule を mypackage/mymodule.py へ解決する", () => {
    // source_dirs 起点で .py ファイルを探す
    const root = createTempDir();
    const src = path.join(root, "src");
    fs.mkdirSync(path.join(src, "mypackage"), { recursive: true });
    const filePath = path.join(src, "mypackage", "mymodule.py");
    fs.writeFileSync(filePath, "# ok\n", "utf-8");

    const resolved = resolvePythonModule("mypackage.mymodule", [src]);
    expect(resolved).toBe(filePath);
  });

  it("パッケージディレクトリの __init__.py へ解決する", () => {
    // .py が無い場合は __init__.py を試す
    const root = createTempDir();
    const src = path.join(root, "src");
    fs.mkdirSync(path.join(src, "mypackage", "mymodule"), { recursive: true });
    const filePath = path.join(src, "mypackage", "mymodule", "__init__.py");
    fs.writeFileSync(filePath, "# package\n", "utf-8");

    const resolved = resolvePythonModule("mypackage.mymodule", [src]);
    expect(resolved).toBe(filePath);
  });

  it(".py が優先され、同名パッケージより先に選ばれる", () => {
    // 両方ある場合は .py を先に試す仕様
    const root = createTempDir();
    const src = path.join(root, "src");
    fs.mkdirSync(path.join(src, "mypackage", "mymodule"), { recursive: true });
    const pyPath = path.join(src, "mypackage", "mymodule.py");
    const initPath = path.join(src, "mypackage", "mymodule", "__init__.py");
    fs.writeFileSync(pyPath, "# file\n", "utf-8");
    fs.writeFileSync(initPath, "# package\n", "utf-8");

    expect(resolvePythonModule("mypackage.mymodule", [src])).toBe(pyPath);
  });

  it("解決できない場合は探索パス一覧付きで ModuleResolveError を投げる", () => {
    // ビルドエラーメッセージに探索パスを含めるため
    const root = createTempDir();
    const srcA = path.join(root, "a");
    const srcB = path.join(root, "b");
    fs.mkdirSync(srcA, { recursive: true });
    fs.mkdirSync(srcB, { recursive: true });

    expect(() => resolvePythonModule("missing.mod", [srcA, srcB])).toThrow(ModuleResolveError);
    try {
      resolvePythonModule("missing.mod", [srcA, srcB]);
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleResolveError);
      const err = error as ModuleResolveError;
      expect(err.modulePath).toBe("missing.mod");
      expect(err.searchedPaths).toEqual([
        path.join(srcA, "missing", "mod.py"),
        path.join(srcA, "missing", "mod", "__init__.py"),
        path.join(srcB, "missing", "mod.py"),
        path.join(srcB, "missing", "mod", "__init__.py")
      ]);
      expect(err.message).toContain("missing.mod");
      expect(err.message).toContain(path.join(srcA, "missing", "mod.py"));
    }
  });

  it("source_dirs が空の場合も探索失敗としてエラーにする", () => {
    // pydoc.source_dirs 未設定でのディレクティブ利用を明確に失敗させる
    expect(() => resolvePythonModule("any.mod", [])).toThrow(ModuleResolveError);
  });
});
