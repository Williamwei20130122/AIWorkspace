import { PrismaClient } from "@prisma/client";
import { seed } from "./seed.mjs";

/**
 * 容器启动时使用：数据库为空（一个用户都没有）才灌入演示数据，
 * 已有数据时什么都不做，避免重启覆盖真实数据。
 */
const prisma = new PrismaClient();

try {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.log("检测到空数据库，写入演示数据…");
    await prisma.$disconnect();
    await seed();
  } else {
    console.log(`数据库已有 ${userCount} 个用户，跳过演示数据初始化（SEED_ON_START=1）。`);
  }
} catch (error) {
  console.error("ensure-seed 失败（可忽略，应用仍会启动）：", error);
} finally {
  await prisma.$disconnect().catch(() => {});
}
