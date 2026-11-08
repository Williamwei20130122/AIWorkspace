import { PrismaClient } from "@prisma/client";

/**
 * Prisma 客户端单例。
 * Next.js 开发模式下模块会被热更新反复执行，挂到 globalThis 上避免连接数爆炸。
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
