import { defineConfig } from "vite";

// GitHub Pages ではリポジトリ名のサブパス（/kitchen-egg-escape/）配下に置かれる。
// 相対パスで出力しておけば、ローカルのプレビューでもそのまま動く。
export default defineConfig({
  base: "./",
  // Rapierのwasmグルーを事前バンドルさせない。開発サーバーで二重に読み込まれると、
  // 初期化されていない側が使われて __wbindgen_export_0 の参照で落ちる。
  // 本番ビルドは1つに束ねられるため元から起きないが、開発中に検証できないのは困る。
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d"],
  },
});
