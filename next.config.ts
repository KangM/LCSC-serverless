import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @libsql/client 带原生绑定（libsql），必须作为服务端外部包加载：
  // 若被打进 Turbopack bundle，原生 .node 绑定会失效，
  // file: 本地库会静默退化成内存库（dev 重启数据即丢）。
  // 生产使用 TURSO_DATABASE_URL（远程 HTTP）本不受影响，但保留此配置无副作用。
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
