// 开发用：用本机 Edge/Chrome 无头模式给主要页面截图（用于文档与设计走查）
// 用法（本地 dev server）：node scripts/capture-screenshots.mjs
// 用法（Docker 容器）：设置 CAPTURE_BASE / CAPTURE_AUTH_SECRET / CAPTURE_TEACHER_ID /
//   CAPTURE_STUDENT_ID / CAPTURE_CLASS_ID / CAPTURE_ASSIGNMENT_ID 后执行。
// 依赖：本机安装 Edge 或 Chrome；目标服务需已运行（默认 http://127.0.0.1:3100）。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = process.env.CAPTURE_BASE ?? "http://127.0.0.1:3100";
const OUT_DIR = path.resolve(process.env.CAPTURE_OUT_DIR ?? "docs/screenshots");
const PORT = 9333;

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

function readEnv() {
  if (!fs.existsSync(".env")) return {};
  const env = {};
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i)] = line.slice(i + 1).replace(/^"(.*)"$/, "$1");
  }
  return env;
}

function makeToken(secret, userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdp(wsUrl, fn) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      const listeners = events.get(msg.method) ?? [];
      listeners.forEach((fn) => fn(msg.params));
      events.delete(msg.method);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const once = (method) =>
    new Promise((resolve) => events.set(method, [...(events.get(method) ?? []), resolve]));
  try {
    await fn({ send, once });
  } finally {
    ws.close();
  }
}

// 本地开发默认从 .env + 本地 SQLite 取账号/ID；Docker 场景用 CAPTURE_* 环境变量覆盖
const env = readEnv();
let teacherId = process.env.CAPTURE_TEACHER_ID;
let studentId = process.env.CAPTURE_STUDENT_ID;
let classId = process.env.CAPTURE_CLASS_ID;
let assignmentId = process.env.CAPTURE_ASSIGNMENT_ID;
const secret = process.env.CAPTURE_AUTH_SECRET ?? env.AUTH_SECRET;

if (!teacherId || !studentId || !classId || !assignmentId) {
  process.env.DATABASE_URL = env.DATABASE_URL;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const teacher = await prisma.user.findUnique({ where: { email: "teacher@demo.edu" } });
  const student = await prisma.user.findUnique({ where: { email: "student@demo.edu" } });
  const klass = await prisma.class.findFirst({ where: { joinCode: "MATH01" } });
  const assignment = await prisma.assignment.findFirst({ orderBy: { createdAt: "asc" } });
  await prisma.$disconnect();
  teacherId ??= teacher.id;
  studentId ??= student.id;
  classId ??= klass.id;
  assignmentId ??= assignment.id;
}

if (!secret) throw new Error("缺少 AUTH_SECRET（或 CAPTURE_AUTH_SECRET）");

const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!edge) throw new Error("未找到 Edge/Chrome");

const userDataDir = path.join(process.env.TEMP ?? "/tmp", `aw-capture-${Date.now()}`);
const child = spawn(
  edge,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let targets = null;
for (let i = 0; i < 50; i += 1) {
  await sleep(300);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    targets = await res.json();
    if (Array.isArray(targets) && targets.length > 0) break;
  } catch {
    // 浏览器还在启动
  }
}
if (!targets) {
  child.kill();
  throw new Error("无法连接无头浏览器调试端口");
}
const page = targets.find((t) => t.type === "page") ?? targets[0];

fs.mkdirSync(OUT_DIR, { recursive: true });

const shots = [
  { name: "01-login", url: "/login", role: null },
  { name: "02-teacher-dashboard", url: "/teacher", role: "teacher" },
  { name: "03-teacher-classes", url: "/teacher/classes", role: "teacher" },
  { name: "04-teacher-class-detail", url: `/teacher/classes/${classId}`, role: "teacher" },
  { name: "05-teacher-assignments", url: "/teacher/assignments", role: "teacher" },
  { name: "06-teacher-assignment-detail", url: `/teacher/assignments/${assignmentId}`, role: "teacher" },
  { name: "07-student-dashboard", url: "/student", role: "student" },
  { name: "08-student-assignments", url: "/student/assignments", role: "student" },
  { name: "09-student-assignment-detail", url: `/student/assignments/${assignmentId}`, role: "student" },
  { name: "10-student-grades", url: "/student/grades", role: "student" },
];

await cdp(page.webSocketDebuggerUrl, async ({ send, once }) => {
  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (const shot of shots) {
    if (shot.role) {
      const userId = shot.role === "teacher" ? teacherId : studentId;
      await send("Network.setCookie", {
        name: "aw_session",
        value: makeToken(secret, userId),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
      });
    } else {
      await send("Network.clearBrowserCookies");
    }
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url: `${BASE}${shot.url}` });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(900);
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT_DIR, `${shot.name}.png`), Buffer.from(data, "base64"));
    console.log(`saved ${shot.name}.png <- ${shot.url}`);
  }
});

child.kill();
await sleep(500);
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(`done: ${OUT_DIR}`);
