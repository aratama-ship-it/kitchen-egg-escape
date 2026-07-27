import { defineConfig } from "vite";

// GitHub Pages ではリポジトリ名のサブパス（/kitchen-egg-escape/）配下に置かれる。
// 相対パスで出力しておけば、ローカルのプレビューでもそのまま動く。
export default defineConfig({
  base: "./",
});
