// v3 全流程联调脚本：node scripts/verify-v3.mjs
// 需要服务已在 http://127.0.0.1:3100 运行；脚本会创建一个测试课题并完成提交/评价流程。
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";

let pass = 0;
let fail = 0;

function ok(name, condition, extra = "") {
  if (condition) {
    pass += 1;
    console.log(`OK   ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name} ${extra}`);
  }
}

function cookieFrom(res) {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const raw = setCookies.find((c) => c.startsWith("aw_session="));
  return raw ? raw.split(";")[0] : null;
}

async function req(method, path, { cookie, json, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body, redirect: "manual" });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, cookie: cookieFrom(res) };
}

async function login(loginId, password) {
  return req("POST", "/api/auth/login", { json: { loginId, password } });
}

// ---------- 健康检查 ----------
const health = await req("GET", "/api/health");
ok("health 200", health.status === 200 && health.data?.ok === true);

// ---------- 教师登录（邮箱 / 手机号格式） ----------
const t = await login("teacher@demo.edu", "demo1234");
ok("教师邮箱登录 200 + cookie", t.status === 200 && !!t.cookie, JSON.stringify(t.data));
const tc = t.cookie;

const me = await req("GET", "/api/me", { cookie: tc });
ok("教师 /api/me", me.status === 200 && me.data?.user?.role === "TEACHER");

const overview = await req("GET", "/api/teacher/overview", { cookie: tc });
ok("教师 overview 200", overview.status === 200, JSON.stringify(overview.data).slice(0, 160));

const topics = await req("GET", "/api/teacher/topics", { cookie: tc });
ok("教师课题列表 200", topics.status === 200 && Array.isArray(topics.data) && topics.data.length >= 1);

// ---------- 学生管理 ----------
const students = await req("GET", "/api/teacher/students", { cookie: tc });
ok("教师学生列表 200", students.status === 200 && Array.isArray(students.data) && students.data.length >= 1);
ok("学生列表不含密码哈希", !JSON.stringify(students.data).includes("scrypt$"));

const lookup = await req("GET", "/api/teacher/students/lookup?loginId=S001", { cookie: tc });
ok("lookup 已有学生 exists", lookup.status === 200 && lookup.data?.exists === true, JSON.stringify(lookup.data).slice(0, 160));

const conflict = await req("POST", "/api/teacher/students", {
  cookie: tc,
  json: { name: "李小明", loginId: "S001" },
});
ok("重复用户名创建 409 + conflict", conflict.status === 409 && !!conflict.data?.conflict, JSON.stringify(conflict.data).slice(0, 160));

// ---------- 教师创建联调测试课题 + 加入学生 ----------
const createTopic = await req("POST", "/api/teacher/topics", {
  cookie: tc,
  json: { title: "联调测试课题", descriptionMd: "## 联调\n\n这是自动化测试创建的课题。" },
});
ok("教师创建课题 201", createTopic.status === 201 && !!createTopic.data?.id, JSON.stringify(createTopic.data).slice(0, 160));
const topicId = createTopic.data?.id;

const addStudents = [
  await req("POST", `/api/teacher/topics/${topicId}/students`, { cookie: tc, json: { loginId: "S001" } }),
  await req("POST", `/api/teacher/topics/${topicId}/students`, { cookie: tc, json: { loginId: "S002" } }),
];
ok("课题加入学生 S001/S002", addStudents.every((r) => r.status === 200 || r.status === 201), JSON.stringify(addStudents.map((r) => r.status)));

const addAssistant = await req("POST", `/api/teacher/topics/${topicId}/assistants`, { cookie: tc, json: { loginId: "li@demo.edu" } });
ok("邀请助教 200/201", addAssistant.status === 200 || addAssistant.status === 201, JSON.stringify(addAssistant.data).slice(0, 160));

const addDim1 = await req("POST", `/api/teacher/topics/${topicId}/dimensions`, { cookie: tc, json: { name: "数据完整性", maxScore: 100 } });
const addDim2 = await req("POST", `/api/teacher/topics/${topicId}/dimensions`, { cookie: tc, json: { name: "分析质量", maxScore: 100 } });
ok("创建评价维度 ×2", [addDim1, addDim2].every((r) => r.status === 200 || r.status === 201), `${addDim1.status}/${addDim2.status}`);

const tDetail = await req("GET", `/api/teacher/topics/${topicId}`, { cookie: tc });
ok("课题详情含成员与维度", tDetail.status === 200 && tDetail.data?.students?.length === 2 && tDetail.data?.dimensions?.length === 2);

// ---------- 学生登录（无密码） ----------
const s = await login("S001", "");
ok("学生无密码登录 200", s.status === 200 && !!s.cookie, JSON.stringify(s.data).slice(0, 160));
const sc = s.cookie;

const sOverview = await req("GET", "/api/student/overview", { cookie: sc });
ok("学生 overview 200", sOverview.status === 200, JSON.stringify(sOverview.data).slice(0, 160));

const sDetail = await req("GET", `/api/student/topics/${topicId}`, { cookie: sc });
ok("学生看到新课题详情", sDetail.status === 200 && sDetail.data?.title === "联调测试课题");
ok("学生详情的 evaluation 含 teacher 字段（无评价时为空）", (sDetail.data?.myEvaluations ?? []).length === 0 || JSON.stringify(sDetail.data.myEvaluations).includes('"teacher"'));

// ---------- 学生提交（多文件 multipart） ----------
const form = new FormData();
form.append("textContent", "气象站 11 月观测记录：温度 12.3°C，湿度 68%，风向东北。");
form.append("files", new Blob(["record,value\n1,12.3\n2,68\n"], { type: "text/csv" }), "weather-11.csv");
form.append("files", new Blob(["note"], { type: "text/plain" }), "说明.txt");
const submit = await req("POST", `/api/student/topics/${topicId}/submission`, { cookie: sc, form });
ok("学生提交（文本+2 文件）200", submit.status === 200, JSON.stringify(submit.data));

const afterSubmit = await req("GET", `/api/student/topics/${topicId}`, { cookie: sc });
ok("提交后 mySubmission 含 2 个文件", afterSubmit.data?.mySubmission?.files?.length === 2, JSON.stringify(afterSubmit.data?.mySubmission).slice(0, 200));

const fileId = afterSubmit.data?.mySubmission?.files?.[0]?.id;
const fileRes = await fetch(`${BASE}/api/student/files/${fileId}`, { headers: { cookie: sc } });
const fileText = await fileRes.text();
ok("学生下载附件 200 且内容一致", fileRes.status === 200 && fileText.includes("record,value"));

// ---------- 教师评价 ----------
const subId = afterSubmit.data?.mySubmission?.id;
const subDetail = await req("GET", `/api/teacher/submissions/${subId}`, { cookie: tc });
ok("教师查看提交详情 200", subDetail.status === 200, JSON.stringify(subDetail.data).slice(0, 160));

const dims = (await req("GET", `/api/teacher/topics/${topicId}/dimensions`, { cookie: tc })).data ?? [];
const scores = dims.map((d) => ({ dimensionId: d.id, score: Math.min(d.maxScore, 88) }));
const evalResp = await req("POST", `/api/teacher/submissions/${subId}/evaluations`, {
  cookie: tc,
  json: { comment: "记录完整，分析部分可再补充结论。", scores },
});
ok("教师多维评价 200/201", evalResp.status === 200 || evalResp.status === 201, JSON.stringify(evalResp.data).slice(0, 160));

// ---------- 已评价后重新提交应被拒绝 ----------
const form2 = new FormData();
form2.append("textContent", "试图覆盖提交");
const resubmit = await req("POST", `/api/student/topics/${topicId}/submission`, { cookie: sc, form: form2 });
ok(
  "已评价后重新提交 400",
  resubmit.status === 400 && String(resubmit.data?.error ?? "").includes("评价"),
  `${resubmit.status} ${JSON.stringify(resubmit.data)}`,
);

const afterEval = await req("GET", `/api/student/topics/${topicId}`, { cookie: sc });
ok("学生可见评价（维度分数+评语）", (afterEval.data?.myEvaluations ?? []).length >= 1 && JSON.stringify(afterEval.data.myEvaluations).includes("数据完整性"));

// ---------- 评价汇总 ----------
const tEvals = await req("GET", "/api/teacher/evaluations", { cookie: tc });
ok("教师评价汇总 200", tEvals.status === 200 && Array.isArray(tEvals.data) && tEvals.data.length >= 1);
const sEvals = await req("GET", "/api/student/evaluations", { cookie: sc });
ok("学生评价汇总 200", sEvals.status === 200 && Array.isArray(sEvals.data) && sEvals.data.length >= 1);

// ---------- 权限 ----------
ok("学生访问教师接口 403", (await req("GET", "/api/teacher/overview", { cookie: sc })).status === 403);
ok("教师访问学生接口 403", (await req("GET", "/api/student/overview", { cookie: tc })).status === 403);
ok("未登录访问 401", (await req("GET", "/api/me")).status === 401);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
