// 开发用：用本机 Edge/Chrome 无头模式给主要页面截图（用于文档与设计走查）
// 用法：node scripts/capture-screenshots.mjs
// 前置：应用已在 http://127.0.0.1:3100 运行（Docker 或本地 Go 服务均可）。
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

const teacherShots = [
  ["02-teacher-dashboard", "/teacher"],
  ["03-teacher-classes", "/teacher/classes"],
  ["05-teacher-assignments", "/teacher/assignments"],
];
const studentShots = [
  ["07-student-dashboard", "/student"],
  ["08-student-assignments", "/student/assignments"],
  ["10-student-grades", "/student/grades"],
];

await cdp(page.webSocketDebuggerUrl, async ({ send, once }) => {
  await send("Page.enable");
  await send("Runtime.enable");
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
    await sleep(900);
  };

  const login = async (email) => {
    await navigate("/login");
    // 同源 fetch 登录，浏览器会保存 HttpOnly Cookie
    const result = await send("Runtime.evaluate", {
      expression: `fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:${JSON.stringify(
        email,
      )},password:"demo1234"}),credentials:"same-origin"}).then(r=>r.status)`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result?.result?.value !== 200) {
      throw new Error(`登录失败：${JSON.stringify(result?.result?.value ?? result)}`);
    }
    await sleep(600);
  };

  const screenshot = async (name, url) => {
    await navigate(url);
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`saved ${name}.png <- ${url}`);
  };

  // 登录页（未登录态）
  await navigate("/login");
  await send("Network.clearBrowserCookies");
  await navigate("/login");
  {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT_DIR, "01-login.png"), Buffer.from(data, "base64"));
    console.log("saved 01-login.png <- /login");
  }

  await login("teacher@demo.edu");
  await screenshot("02-teacher-dashboard", "/teacher");
  await screenshot("03-teacher-classes", "/teacher/classes");
  await screenshot("05-teacher-assignments", "/teacher/assignments");

  await login("student@demo.edu");
  await screenshot("07-student-dashboard", "/student");
  await screenshot("08-student-assignments", "/student/assignments");
  await screenshot("10-student-grades", "/student/grades");
});

child.kill();
await sleep(500);
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(`done: ${OUT_DIR}`);
