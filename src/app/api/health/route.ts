import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** 健康检查：给 Docker healthcheck / 负载均衡用 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      service: "aiworkspace",
      time: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, service: "aiworkspace", error: error instanceof Error ? error.message : "db error" },
      { status: 503 },
    );
  }
}
