// 开发用：用本机 Edge/Chrome 无头模式给 v3 主要页面截图（文档与设计走查）
// 用法：node scripts/capture-screenshots.mjs
// 前置：应用已在 http://127.0.0.1:3100 运行（Docker 或本地 Go 服务），种子数据已写入。
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const once = (method) => new Promise((resolve) => events.set(method, [...(events.get(method) ?? []), resolve]));
  try {
    await fn({ send, once });
  } finally {
    ws.close();
  }
}

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
    // 浏览器启动中
  }
}
if (!targets) {
  child.kill();
  throw new Error("无法连接无头浏览器调试端口");
}
const page = targets.find((t) => t.type === "page") ?? targets[0];

fs.mkdirSync(OUT_DIR, { recursive: true });

await cdp(page.webSocketDebuggerUrl, async ({ send, once }) => {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const navigate = async (url) => {
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url: `${BASE}${url}` });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(1000);
  };

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result?.result?.value;
  };

  const login = async (loginId, password) => {
    await navigate("/login");
    const status = await evaluate(
      `fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({loginId:${JSON.stringify(loginId)},password:${JSON.stringify(password)}}),credentials:"same-origin"}).then(r=>r.status)`,
    );
    if (status !== 200) throw new Error(`登录失败 ${loginId}: ${status}`);
    await sleep(600);
  };

  const shot = async (name, url) => {
    await navigate(url);
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`saved ${name}.png <- ${url}`);
  };

  // 登录页 / 注册页（未登录态）
  await send("Network.clearBrowserCookies");
  await navigate("/login");
  {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT_DIR, "01-login.png"), Buffer.from(data, "base64"));
    console.log("saved 01-login.png <- /login");
  }
  await shot("01b-register", "/register");

  // 教师
  await login("teacher@demo.edu", "demo1234");
  await shot("02-teacher-dashboard", "/teacher");
  await shot("03-teacher-topics", "/teacher/topics");
  await shot("05-teacher-students", "/teacher/students");
  await shot("06-teacher-evaluations", "/teacher/evaluations");
  const teacherTopicId = await evaluate(
    `fetch("/api/teacher/topics",{credentials:"same-origin"}).then(r=>r.json()).then(xs=>xs[0]&&xs[0].id)`,
  );
  if (teacherTopicId) await shot("04-teacher-topic-detail", `/teacher/topics/${teacherTopicId}`);

  // 学生（S001 无密码）
  await login("S001", "");
  await shot("07-student-dashboard", "/student");
  await shot("08-student-topics", "/student/topics");
  await shot("10-student-evaluations", "/student/evaluations");
  const studentTopicId = await evaluate(
    `fetch("/api/student/topics",{credentials:"same-origin"}).then(r=>r.json()).then(xs=>xs[0]&&xs[0].id)`,
  );
  if (studentTopicId) await shot("09-student-topic-detail", `/student/topics/${studentTopicId}`);
});

child.kill();
await sleep(500);
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(`done: ${OUT_DIR}`);
