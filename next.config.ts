import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 镜像使用 standalone 产物（见 Dockerfile）
  output: "standalone",
  // Prisma 引擎是原生二进制，不能被 Next 打包
  serverExternalPackages: ["@prisma/client", "prisma"],
  // standalone 产物要把 Prisma 生成的客户端（含查询引擎）一起带上
  outputFileTracingIncludes: {
    "/**/*": ["./node_modules/.prisma/client/**/*"],
  },
  poweredByHeader: false,
};

export default nextConfig;
