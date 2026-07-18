#!/usr/bin/env node
import { createProgram } from "./program.js";

// CLIエントリポイント: コマンドライン引数を解析して各サブコマンドを実行する
createProgram().parse(process.argv);
