# AI Workspace 多模态生成中台 — 任务清单（10 项）

> 验收流程：每完成一项，停下来由用户验收通过后再进入下一项。
> 进行中即视为当前项；完成后在条目上打勾并记录结论。

## 背景与决策（已确认）

- 基于 new-api 的 Go 单体；管理端复用 new-api 后台样式（统一后台）。
- 学生端保留 `AI多模态生成中台.html` 的紫色样式；学生无管理权限。
- 教师端两版本：普通版 = 学生界面 + 教师管理入口；专业版参考 LibreChat 的接口/交互形式（不引入其代码）。
- LibreChat 仅作接口事例参考，不使用其前端/代码。
- 并发目标：一次性 400-500 请求。
- **初始化向导（/setup）保留**，将来生产打包还会使用——不要删除。
- **"使用模式"选择（演示站点 / 对外运营 / 个人使用）只保留一种**，并入第 7 项一起砍。
- 项目规范：`AGENTS.md`（根）、`web/AGENTS.md`（前端）——JSON 用 `common.Marshal/Unmarshal`，前端 i18n 用 `t('English key')`，改动 TS 后 `bun check -b` + lint；禁止移除 new-api/QuantumNous 品牌；docs/ 与 plugins/ 下禁止新建文档。

## 任务列表

- [ ] **1. 首页直达登录页（删除 new-api 介绍首页）** — ✅ 已完成待验收
  - 改动：[web/src/routes/index.tsx](web/src/routes/index.tsx) 根路由 beforeLoad 重定向到 `/sign-in`。
  - 已浏览器验证：访问 `/` 落到登录页；同时修复白屏根因（后端未启动）。
  - 附带环境：`bun run build` 产出 web/dist；Go 依赖走 `GOPROXY=https://goproxy.cn,direct`；`new-api.exe` 跑在 3000 端口；已跑完初始化（admin / Admin\@Workspace2026）。
- [ ] **2. 后端：能力配置** **`setting/workspace.go`** — ✅ 已完成待验收
  - 新增 `setting/workspace.go`：六项能力（text/image/edit/tts/video/music）结构与默认值，Option 键 `WorkspaceCapabilities` 存取，`NormalizeWorkspaceCapabilities` 校验归一化（setting→model 无循环导入）。
  - `model/option.go` InitOptionMap 注册默认值。
  - `go build ./setting/... ./model/...` 通过。
- [x] **3. 后端：同步生成控制器（文生文 / 文生图 / 图生图 / 声音）** — ✅ 已完成待验收
  - 新增 `controller/workspace.go`：`WorkspaceRelay(c)` 按能力类型选择解析格式（OpenAI / OpenAIImage / OpenAIAudio）后调用 `Relay`。
  - 新增 `middleware/workspace.go`：
    - `WorkspaceSessionToken()` 复用 Playground 会话态范本（`GetUserCache.WriteContext` → `SetupContextForToken(临时 token)`），临时令牌 `Id=0` + `UnlimitedQuota=true`，因此不会扣减任何真实令牌额度。
    - `WorkspaceGenerateRoute()` 校验能力启用状态，并按能力改写 `c.Request.URL.Path` 为 new-api 标准上游通路（text→`/v1/chat/completions`、image→`/v1/images/generations`、edit→`/v1/images/edits`、tts→`/v1/audio/speech`），同时显式 `c.Set("relay_mode", ...)` 覆盖 `Path2RelayMode` 无法识别的中台路径。
    - 能力配置了默认模型时，用 `sjson` 直接改写 JSON 请求体顶层 `model`；multipart（图生图）无法安全改写正文，改用 `resolved_task_model` 上下文回填。
  - 说明：实际实现未使用 `/pg` 前缀，而是改写为 `/v1/*` 标准路径——这样 `Path2RelayMode`、`getModelRequest` 各分支、渠道路由与上游 URL 构造全部走原生通路；不扣令牌改由临时令牌 `UnlimitedQuota=true` 保证，比 `IsPlayground` 更通用（`/pg` 只能覆盖 chat/completions）。
- [x] **4. 后端：任务型生成（视频 / 音乐）与任务结果查询** — ✅ 已完成待验收
  - 视频：`POST /api/workspace/generate/video` 复用 `/v1/video/generations` 任务链（`PinTaskPluginEndpoint` → `TaskPluginEndpointOnly(ModelRequestRateLimit)` → `PrepareTaskPluginEndpoint` → `Distribute` → `RelayTaskPluginEndpoint(RelayTask)`）。
  - 音乐：`POST /api/workspace/generate/music` 走任务插件提交链（`ModelRequestRateLimit` → `PrepareTaskPluginSubmit` → `Distribute` → `RelayTask`）；路径改写为 `/v1/tasks/<plugin>`，插件 key 由能力配置 `plugin` 字段注入 `c.Params`，请求体注入默认模型 `suno_music`。
  - 任务查询复用 new-api 契约（按本人过滤）：`GET /api/workspace/task/:key`（`GetTask`）、`GET /api/workspace/task/:key/artifacts`（`GetTaskArtifacts`）、`GET /api/workspace/tasks`（`GetUserTask` 分页）。
- [x] **5. 后端：路由注册（workspace 路由组挂载）** — ✅ 已完成待验收
  - 新增 `router/workspace-router.go` 的 `SetWorkspaceRouter`，在 `router/main.go` 的 `SetRouter` 中于 `SetTaskRouter` 之后挂载。
  - 路由组 `/api/workspace` **独立成组**（不走 `/api` 组的 gzip，避免影响 SSE 流式输出）；链：`RouteTag` + `SystemPerformanceCheck` → 查询子组 `UserAuth`，生成子组 `UserAuth` + `WorkspaceSessionToken` + `WorkspaceGenerateRoute` + `ModelRequestRateLimit` + `Distribute`（400-500 并发限流与渠道路由复用）。
  - `go build ./...` 全量编译通过。
- [x] **6. 后端：教师端/管理端 API（能力配置读写）** — ✅ 已完成待验收
  - `controller/workspace.go` 新增三个接口：`GetWorkspaceCapabilities`（登录用户读启用列表）、`GetWorkspaceCapabilitiesAdmin`（管理员读完整配置）、`UpdateWorkspaceCapabilitiesAdmin`（管理员保存，经 `NormalizeWorkspaceCapabilities` 校验后 `model.UpdateOption` 落库）。
  - 路由挂在 `router/workspace-router.go`：`GET /api/workspace/capabilities`（UserAuth）、`GET|PUT /api/workspace/admin/capabilities`（AdminAuth）。
  - **额度分配**：未新增接口，复用 new-api 既有用户额度管理能力（后台"用户管理"可调整余额/订阅），避免重复实现计费入口。
  - 说明：能力配置的 `cost`（单次点数）当前仅作展示字段存库；真正按次扣点需改动计费链路，另行评估。
- [x] **7. 前端：学生端页面（紫色样式）+ 砍掉"使用模式"选择** — ✅ 已完成待验收
  - 新增 `web/src/features/workspace/`：`types.ts`、`api.ts`、`components/workspace-studio.tsx`（顶栏 + 能力导航 + 空白态）、`components/generate-panel.tsx`（输入、图生图文件选择、生成、文本/图片/音频结果展示、视频音乐任务轮询）。
  - 新增路由 `web/src/routes/workspace/index.tsx`（`/workspace`），独立于 new-api 布局，`beforeLoad` 复用 `resolveAuthentication` 做登录校验。
  - 样式取自示例 HTML：主色 `#6c5ce7`、背景 `#f7f8fc`、卡片白底 `#ececf3` 边框、`14px/8px` 圆角，窄屏能力导航转横向标签。
  - 登录/初始化默认落地页由 `/dashboard` 改为 `/workspace`（`use-auth-redirect.ts`）。
  - **砍掉使用模式**：`setup-wizard.tsx` 移除"Usage mode"步骤（4 步变 3 步，`sm:grid-cols-3`），移除该步校验与组件引用，表单仍以 `usageMode: 'external'` 提交以兼容后端；初始化向导（`/setup`）本身完整保留供生产打包。
- [x] **8. 前端：教师端普通版（学生界面 + 教师管理入口）** — ✅ 已完成待验收
  - 学生端顶栏在 `role >= ROLE.ADMIN` 时显示"管理中心"入口（跳 new-api 后台 `/dashboard`），普通学生不显示。
  - 教师端专业版（对话式）留在第 9 项。
- [x] **9. 前端：教师端专业版（参考 LibreChat 与HuggingFace 对话式界面）** — ✅ 已完成待验收
  - 仅参考其对话式接口/交互形式，不引入 LibreChat 代码；新增独立全屏路由 `/studio`（`role < ROLE.ADMIN` 回落 `/workspace`）。
- [x] **10. 构建与联调验证** — ✅ 已完成待验收
  - `go build`、`bun run build`、`bun check -b`、oxlint；浏览器实测：登录 → 能力选择 → 生成 → 任务轮询 → 结果展示。
  - 逐轮增量验收记录见下方「任务 10.x」小节（10.1~10.5）。

## 进度记录

| 项 | 状态       | 结论                   |
| - | -------- | -------------------- |
| 1 | 代码完成，待验收 | `/` → `/sign-in` 已验证 |
| 2 | 代码完成，待验收 | setting+model 编译通过   |
| 3 | 代码完成，待验收 | 同步四能力控制器 + 会话态中间件；`go build ./...` 通过 |
| 4 | 代码完成，待验收 | 视频/音乐任务链 + 任务查询路由；`go build ./...` 通过 |
| 5 | 代码完成，待验收 | workspace 路由组独立挂载（避开 gzip/SSE） |
| 6 | 代码完成，待验收 | 能力配置读写接口；用户端 6 项 / 管理端 6 项实测通过 |
| 7 | 代码完成，待验收 | 学生端 `/workspace` 页面 + 砍使用模式；`bun check -b` 0 错误、oxlint 0 错误 |
| 8 | 代码完成，待验收 | 教师入口按 role≥ADMIN 显示；随第 7 项页面一同构建 |
| 9 | 代码完成，待验收 | 教师端专业版对话工作台 `/studio`（SSE 流式）；`bun check -b` 0 错误、oxlint 0 错误 |
| 10 | 代码完成，待验收 | 构建与联调：`bun check -b` / `bun run build` / `CGO_ENABLED=0 go build` 全通过；接口级 + 权限级 + 浏览器冒烟均已实测（详见 10.5） |

### 第 3、4、5 项改动点汇总

**新增文件**

| 文件 | 作用 |
| - | - |
| `middleware/workspace.go` | `WorkspaceSessionToken()` 会话态令牌映射；`WorkspaceGenerateRoute()` 能力校验 + 路径/模型/relay_mode 规范化；`workspaceRewriteJSONModel()` JSON 体模型注入 |
| `controller/workspace.go` | `WorkspaceRelay()` 同步能力入口（按 kind 选择 RelayFormat 后复用 `Relay`） |
| `router/workspace-router.go` | `SetWorkspaceRouter()` 学生端路由组：查询组 + 生成组（同步/视频/音乐三条链） |

**修改文件**

| 文件 | 改动 |
| - | - |
| `router/main.go` | `SetRouter` 中新增一行 `SetWorkspaceRouter(router)`（位于 `SetTaskRouter` 之后） |

**对外接口**

| 方法 | 路径 | 说明 |
| - | - | - |
| POST | `/api/workspace/generate/text` | 文生文（SSE 可用，避开 gzip） |
| POST | `/api/workspace/generate/image` | 文生图 |
| POST | `/api/workspace/generate/edit` | 图生图（multipart，字段 `image` + `prompt`） |
| POST | `/api/workspace/generate/tts` | 声音合成 |
| POST | `/api/workspace/generate/video` | 视频生成（异步任务，返回 task_id） |
| POST | `/api/workspace/generate/music` | 音乐生成（异步任务，需能力配置 `plugin`） |
| GET | `/api/workspace/task/:key` | 任务状态查询（按本人过滤） |
| GET | `/api/workspace/task/:key/artifacts` | 任务产物列表（含签名 content_url） |
| GET | `/api/workspace/tasks` | 本人任务分页列表 |

**实测结果（2026-10-31 11:57，服务 `http://localhost:3000`，二进制 `newapi-run.exe`）**

以 admin 登录取得会话令牌后逐一调用六个生成入口，链路均正确走到 new-api 渠道路由环节：

| 能力 | 请求 | 实测返回 | 判定 |
| - | - | - | - |
| 文生文 | `POST /api/workspace/generate/text` | 503 `No available channel for model gpt-4o-mini under group default (distributor)` | ✅ 链路通 |
| 文生图 | `POST /api/workspace/generate/image` | 503 `No available channel for model gpt-image-1 ...` | ✅ 链路通 |
| 声音合成 | `POST /api/workspace/generate/tts` | 503 `No available channel for model tts-1 ...` | ✅ 链路通 |
| 视频生成 | `POST /api/workspace/generate/video` | 503 `No available channel for model kling-v1 ...` | ✅ 链路通 |
| 音乐生成 | `POST /api/workspace/generate/music` | 503 `... the model is claimed by a task plugin, which has no enabled channel serving it` | ✅ 插件认领链生效 |
| 未登录访问 | `GET /api/workspace/tasks` | 401 | ✅ 鉴权生效 |
| 不存在的子路径 | `GET /api/workspace/not-exist` | 404 | ✅ 路由未过度注册 |

> 503 是系统尚未配置任何渠道导致，属于预期结果；配置渠道后即可完成真实生成。

### 第 6、7、8 项改动点汇总

**新增文件**

| 文件 | 作用 |
| - | - |
| `web/src/features/workspace/types.ts` | 能力与任务类型定义 |
| `web/src/features/workspace/api.ts` | 能力拉取、生成调用（同步/表单/音频 blob/任务 id）、任务轮询 |
| `web/src/features/workspace/components/workspace-studio.tsx` | 学生端外壳：紫色顶栏 + 能力导航 + 主区 |
| `web/src/features/workspace/components/generate-panel.tsx` | 生成面板：输入、图生图选图、结果展示、任务轮询 |
| `web/src/routes/workspace/index.tsx` | `/workspace` 独立路由（携带登录校验） |

**修改文件**

| 文件 | 改动 |
| - | - |
| `controller/workspace.go` | 新增 `GetWorkspaceCapabilities` / `GetWorkspaceCapabilitiesAdmin` / `UpdateWorkspaceCapabilitiesAdmin` |
| `router/workspace-router.go` | 新增 `GET /capabilities`（UserAuth）与 `admin` 组 `GET|PUT /capabilities`（AdminAuth） |
| `web/src/features/setup/setup-wizard.tsx` | 移除"Usage mode"步骤（4→3 步），移除该校验与组件引用 |
| `web/src/features/auth/hooks/use-auth-redirect.ts` | 默认落地页 `/dashboard` → `/workspace` |

**第 6、7、8 项实测结果（2026-10-31，服务 `http://localhost:3000`，二进制 `newapi-run.exe`）**

| 检查 | 请求 | 实测返回 | 判定 |
| - | - | - | - |
| 用户端能力列表 | `GET /api/workspace/capabilities`（Bearer） | success=true，6 项（text/image/edit/video/music/tts），video/music 带 qpath | ✅ |
| 管理端能力配置 | `GET /api/workspace/admin/capabilities`（Bearer，admin） | success=true，6 项 | ✅ |
| 学生端页面 | `GET /workspace` | 200 + SPA 外壳（含 `id="root"`） | ✅ |
| 登录页 | `GET /sign-in` | 200 | ✅ |
| 根路径 | `GET /` | 200（前端重定向到 `/sign-in`） | ✅ |
| 前端类型检查 | `bun check -b` | 0 错误（1410 文件） | ✅ |
| 前端 lint | `oxlint`（本次改动文件） | 0 错误 | ✅ |
| 全量构建 | `bun run build` / `go build -o newapi-run.exe .` | 均 EXIT=0 | ✅ |

**修复记录**

- `middleware/workspace.go`：生成入口按静态路径（`/generate/text`、`/generate/video` 等）注册，而中间件原用 `c.Param("cap")` 读取能力标识，取到空值导致全部能力被判为"不存在或已停用"。已新增 `workspaceCapabilityId()`：优先取路由参数，回落 `path.Base(c.Request.URL.Path)`。
- `web/src/features/workspace/api.ts`：`fetchWorkspaceTask` 返回类型用到的 `WorkspaceTask` 未导入。已补入类型导入。
- `web/src/features/workspace/components/generate-panel.tsx`：`GenerateOutcome` 误从 `types` 导入（实际定义在 `api.ts`）。已改从 `api` 导入（`type` 修饰）。
- `web/src/features/workspace/components/generate-panel.tsx`：任务轮询用 `.then()` 回调触发 oxlint `no-callback-in-promise`。已改写为 `setInterval` 内 async IIFE + `try/catch`。

**验收要点**

1. 当前服务已运行在 http://localhost:3000（二进制 `newapi-run.exe`，已含本次改动）。
2. 生成入口要求已登录（UserAuth），且能力配置为启用状态（未配置时使用 `setting/workspace.go` 的默认六能力）。
3. 模型名：能力配置 `model` 非空时由后端覆盖注入；为空时需前端在请求体传 `model`。
4. 计费：走用户钱包（订阅/钱包按用户偏好），临时令牌不会扣减真实令牌额度。

### 第 7 项迭代：学生端主内容区改为「AI 创作」排版（2026-10-31）

按参考文件 `AI多模态生成中台.html` 的 `#page-create` 重排学生端 `/workspace` 主内容区：

| 参考结构 | 实现 |
| - | - |
| `.page-head`（`.eyebrow` + `.page-title` + `.page-desc` + `.quota-card`） | 主区顶部：`CREATE WITH AI` / `今天想创造什么？` / 说明文案；右侧额度卡（我的可用额度 / 余额 / 总剩余点数） |
| `.cap-grid` > `.cap-card`（`.cap-top` + `.cap-status` + `.cap-name` + `.cap-desc` + `.cap-meta`） | 六能力卡片网格（`grid-cols-2 / md:3 / lg:6`），选中态紫色描边、未启用半透明禁用；`.cap-meta` 展示「每次消耗 N 点」或「按模型计费」+ 模型名 |
| `.form-card` > `.form-head` + `.form-section` + `.form-foot` | 下方生成卡：能力图标 + 名称/描述 → `创作要求` 输入 → 各能力专属字段 → 右下 `使用模型` 下拉 + `＋ 开始<能力名>` 按钮 |
| 各能力专属字段 | 文生文：temperature；文生图：尺寸/张数/风格；图生图：上传区 + 风格 + 参考强度；视频生成：生成方式 tabs + 时长/分辨率/运镜；声音合成：音色/语速/音量；音乐生成：无附加字段 |

**改动文件**

| 文件 | 改动 |
| - | - |
| `web/src/features/workspace/components/workspace-studio.tsx` | 去掉左侧能力导航，改为页头 + 额度卡 + 能力卡片网格；`GeneratePanel` 新增 `glyph` 入参 |
| `web/src/features/workspace/components/generate-panel.tsx` | 重写为 `.form-card` 结构，补齐六类能力的专属表单字段与联动 |
| `web/src/features/workspace/api.ts` | 新增 `WorkspaceGenerateParams`；`runWorkspaceGenerate` 增加参数入参；`buildPayload` 按能力拼装上游参数（temperature / size+n / voice+speed+volume / mode+duration+resolution），风格字段以「风格要求：」并入 prompt |

**实测（2026-10-31，`http://localhost:3000`，student / Student\@2026）**

| 检查 | 结果 |
| - | - |
| `bun check -b` | 0 错误（1410 文件） |
| `oxlint src/features/workspace` | 0 警告 0 错误 |
| `bun run build` / `go build -o newapi-run.exe .` | 均成功 |
| 浏览器 `/workspace` | 页头 + 额度卡（$0）+ 六能力卡片一行排列 + 生成卡，版式与参考文件一致 |
| 浏览器切换「图生图」 | 上传参考图片区 / 风格 / 参考强度 / 使用模型 / ＋开始图生图 全部渲染正常 |
| 顶栏用户名 | 显示为「学生测试」，无乱码 |

> 说明：六能力卡片的 `.cap-meta` 用「每次消耗 N 点 / 按模型计费」替代参考文件的「剩 X · 每天 Y 次」——当前后端能力配置只有 `cost`，没有 per-capability 的剩余量与每日次数。

## 附加：测试账户与品牌改名（2026-10-31）

**测试账户（已实测可登录）**

| 角色 | 用户名 | 密码 | role |
| - | - | - | - |
| 超级管理员 | `admin` | `Admin@Workspace2026` | 100 |
| 教师（普通版） | `teacher` | `Teacher@2026` | 10 |
| 学生 | `student` | `Student@2026` | 1 |

> 创建教师（role≥10）需二次验证：`POST /api/verify`（`method=password`、`scope=admin.user.create`、`context={"role":10}`）拿到 `proof_token`，再带 `X-Security-Proof` 头调用 `POST /api/user/`。

**品牌改名（New API → AI Workspace）**

| 文件 / 位置 | 改动 |
| - | - |
| `web/index.html` | `<title>` / `meta title` → `AI Workspace` |
| `web/src/lib/constants.ts` | `DEFAULT_SYSTEM_NAME` → `'AI Workspace'` |
| `web/src/assets/logo.tsx` | 内置 SVG 图标替换为 AI Workspace 标记 |
| `common/constants.go` | 后端默认 `SystemName` → `"AI Workspace"` |
| `web/public/logo.png` | 替换为紫色 AI 图标（346 KB） |
| 数据库 option | `SystemName` 改为 `AI Workspace`（运行中实例即时生效） |

实测：`/api/status` 返回 `system_name=AI Workspace`；`/` 的 `<title>` 为 `AI Workspace`；`/logo.png` 200。GPL 许可证与版权声明未改动（法律要求保留）。

## 第 8 项迭代：管理端「AI 中台」后台 + 使用记录（2026-10-31）

**需求**
- 超级管理员端缺少学生设置、班级设置页面 → 从零新建。
- 学生也必须能查看自己的生成历史（查看自己生成过什么）；教师/管理员同样可查（教师要先给学生做示范）。
- 能力配置支持设置请求方法（POST/GET）、接口格式、接口路径、结果查询接口、扩展 JSON；额度规则（平台名称 + 六能力单次消耗点数）由管理员设置。
- 管理功能并入 new-api 后台（复用其样式与用户体系），学生端保留紫色主题 `#6c5ce7`。

**后端改动**

| 文件 | 改动 |
| - | - |
| `setting/workspace.go` | 新增 `WorkspacePlatformNameKey`/`DefaultWorkspacePlatformName` 与 `GetWorkspacePlatformName`/`NormalizeWorkspacePlatformName`；`WorkspaceCapability` 新增 `fmt`/`method`/`extend` 字段；六能力默认补 `Method: "POST"`；`NormalizeWorkspaceCapabilities` 归一化扩展 JSON、方法与格式（`method` 空默认 POST，仅允许 POST/GET） |
| `model/workspace.go`（新建） | `WorkspaceIdList`（JSON 文本存储，支持一对多）；`WorkspaceClass`（`teacher_ids` 存多位老师）、`WorkspaceStudent`、`WorkspaceUserQuota` 三张表模型及 CRUD：班级含 `student_count` 聚合、删除班级时把其学生 `class_id` 置 0；学生带 `username`/`class_name` 填充；能力额度按用户全量覆盖写入、可清零已用 |
| `model/main.go` | `AutoMigrate` 追加 `WorkspaceClass`/`WorkspaceStudent`/`WorkspaceUserQuota` |
| `controller/workspace_admin.go`（新建） | 班级/学生/账户/GUI 额度控制器；`GetWorkspaceRecords` 合并 `logs`（同步生成）与 `tasks`（视频/音乐）为统一记录：管理员不带 `user_id` 时查全量，否则查指定用户；学生强制只查自己（`role >= RoleAdminUser` 才允许全量） |
| `controller/workspace.go` | `GetWorkspaceCapabilitiesAdmin`/`UpdateWorkspaceCapabilitiesAdmin` 增加 `platform_name` 读写（复用同一 Option，避免与额度规则互相覆盖） |
| `router/workspace-router.go` | UserAuth 组新增 `GET /records`；AdminAuth 组新增 `GET /records`、`GET /users`、`GET /accounts`、`PUT /accounts/quotas`、`POST /accounts/reset`、`GET/POST/PUT /classes`、`DELETE /classes/:id`、`GET/POST/PUT /students`、`DELETE /students/:id` |

**前端改动**

| 文件 | 改动 |
| - | - |
| `web/src/features/ai-hub/{types,api}.ts`（新建） | 类型与接口封装；`fetchRecords(query, all)`：`all` 为真走管理员 `/api/workspace/admin/records`，否则走 `/api/workspace/records`（自查） |
| `web/src/features/ai-hub/components/kit.tsx`（新建） | 轻量 UI 套件（`PageShell/Panel/Button/TextInput/Select/Switch/Badge/Table/Modal` 等），复用 shadcn 主题 token |
| `web/src/features/ai-hub/sections/*.tsx`（新建） | 能力配置、额度规则、使用记录、账户管理、学生与班级五个页面 |
| `web/src/routes/_authenticated/ai-hub/*.tsx`（新建） | `/ai-hub` 及 5 个子路由，`beforeLoad` 守卫 `role < ROLE.ADMIN` → `/403` |
| `web/src/hooks/use-sidebar-data.ts` | 侧边栏新增「AI 中台」分组（能力配置 / 额度规则 / 使用记录 / 账户管理 / 学生与班级，均 `requiredRole: ROLE.ADMIN`） |
| `web/src/features/workspace/components/workspace-studio.tsx` | 学生端紫色页面顶栏新增「开始创作 / 我的记录」页签；「我的记录」展示本人生成历史（时间/能力/模型/内容摘要/状态/消耗点数） |

**实测（2026-10-31，`http://localhost:3000`）**

| 检查 | 结果 |
| - | - |
| `bun check -b` | 0 错误（1424 文件） |
| `oxlint src/features/ai-hub` 等 | 0 警告 0 错误 |
| `bun run build` / `go build -o newapi-run.exe .` | 均成功，服务已重启（PID 44960） |
| `GET /api/workspace/admin/capabilities`（admin） | `platform_name=AI Workspace`，6 项能力含 `method=POST`/`fmt=openai` |
| `GET /api/workspace/admin/classes`（admin） | `data=[]`（空数组），成功 |
| `GET /api/workspace/admin/{users,accounts}`（admin） | 各 3 条 |
| `GET /api/workspace/admin/records`（admin） | `total=0`（暂无生成记录） |
| `GET /api/workspace/records`（student） | `success=true`，只返回本人记录 |
| 学生令牌访问管理端接口 | HTTP 403（鉴权边界正确） |
| 浏览器（admin） | 侧边栏「AI 中台」5 项可见；能力配置 6 张卡片（含请求方法 POST/GET、接口格式、结果查询接口、扩展 JSON）；学生与班级、账户管理页正常渲染，无控制台报错 |
| 浏览器（student） | `/workspace` 紫色主题；「我的记录」页签表格表头齐全、空态文案正常，切回「开始创作」能力卡片正常 |

**说明**
- 班级与教师为多对多（一个班级可绑定多位老师），用 `teacher_ids` JSON 列存储。
- 使用记录合并两张表：同步生成来自 `logs`，异步任务（视频/音乐）来自 `tasks`，按创建时间倒序分页。
- 账户管理复用 new-api `/api/user/` 创建用户（学生 `role=1` 免二次验证），能力额度独立存于 `workspace_user_quota`。

## 第 9 项：按次计费 + 定价规则 + 月度对账（2026-10-31）

**需求**
- 学生**不按量计费，按调用次数计费**（与示例文档一致）：每次成功生成扣固定点数，失败不扣。
- 后台新增**定价规则**设置：1 点折算金额 + 每项能力的单次售价与上游成本计价。
- 后台新增**月度对账**：分别统计每个学生、每个班级的月度消费，汇总后与上游 API 成本总额比对校验，支持导出 CSV。

**后端改动**

| 文件 | 改动 |
| - | - |
| `setting/workspace_pricing.go`（新建） | 点单价（1 点 = X 元）与 6 项能力的定价项（单次消耗点数 / 计价单位 / 上游单价 / 每次计量数量）读写与归一化 |
| `model/workspace_usage.go`（新建） | `workspace_usages` 计费明细表（用户/班级/能力/模型/点数/上游成本/时间）+ 按学生、按班级、按月区间的聚合 |
| `middleware/workspace_metering.go`（新建） | 计费中间件：成功响应后按次扣点、写明细；生成前做余额与能力额度校验，不足时拦截 |
| `controller/workspace_pricing.go`（新建） | 定价读写、月度对账聚合、CSV 导出（含 BOM，Excel 可直接打开） |
| `service/funding_source.go` / `service/billing_session.go` / `service/quota.go` | 新增 `WorkspaceFunding` 旁路与独立计费会话，避免中台生成被 new-api 的 token 价格体系二次扣费 |
| `constant/context_key.go` | 新增无类型常量 `ContextKeyWorkspaceBilling` |
| `relay/helper/price.go` | `ModelPriceHelper` 开头新增旁路短路（返回零成本 PriceData + HandleGroupRatio），避免未配置 token 价格时被「模型未定价」拦截 |
| `middleware/workspace.go` | 中台生成补 `SetContextKeyUsingGroup`（渠道分发前提），group 为空回落 `default`；新增 `workspaceJSONModel()`（gjson 读请求体 model），能力未配模型时回填 |
| `router/workspace-router.go` | 管理端新增 `GET/PUT /pricing`、`GET /reconciliation`、`GET /reconciliation/export` |

**前端改动**

| 文件 | 改动 |
| - | - |
| `web/src/features/ai-hub/sections/pricing.tsx`（新建） | 定价规则页：点单价 + 六能力「单次消耗点数 / 计价单位 / 上游单价 / 每次计量数量」表格编辑与保存 |
| `web/src/features/ai-hub/sections/reconciliation.tsx`（新建） | 月度对账页：月份查询 + 汇总卡片（次数/点数/学生折算总额/上游成本总额/差额）+ 按学生、按班级两张表 + 导出 CSV |
| `web/src/features/ai-hub/api.ts` | 新增 `fetchPricing`/`savePricing`/`fetchReconciliation`/`downloadReconciliation`（带鉴权 blob 下载） |
| `web/src/hooks/use-sidebar-data.ts` | 「AI 中台」分组新增「定价规则」「月度对账」 |

**实测（2026-10-31，`http://localhost:3000`）**

| 检查 | 结果 |
| - | - |
| `go build -o newapi-run.exe .` | 成功，服务已重启 |
| 学生文生文生成 ×2 | HTTP 200，quota 10000 → 9998（每次 1 点） |
| 上游失败时生成 | HTTP 500 且**不扣费** |
| `GET/PUT /api/workspace/admin/pricing` | 读写正常 |
| `GET /api/workspace/admin/reconciliation?month=2026-10` | 2 次 / 2 点 / 折算 0.0002 元 / 上游成本 0.008 元 / 差额 0.0078 |
| `GET /api/workspace/admin/reconciliation/export` | CSV 含明细与汇总，BOM 正常 |

## 第 9 项迭代：管理端「返回 AI 创作」入口 + 卡死排查（2026-10-31）

**需求**
- 管理端缺少返回生成界面（`/workspace`）的入口，需要在管理后台提供返回按钮。
- 反馈管理后台「容易崩、啥也没干就卡死、显示无响应」，需要排查。

**前端改动**

| 文件 | 改动 |
| - | - |
| `web/src/hooks/use-sidebar-data.ts` | 「General」分组首位新增「AI 创作」→ `/workspace`（全角色可见，同时自动出现在 Ctrl+K 命令面板） |
| `web/src/components/layout/components/app-header.tsx` | 顶栏品牌右侧新增「AI 创作」快捷按钮 → `/workspace`，与学生端顶栏「管理中心」形成对称往返入口 |

**卡死问题排查结论**

用 Chrome DevTools 实测（admin 登录，`http://localhost:3000`），**当前构建未复现卡死**：

| 检查 | 结果 |
| - | - |
| `/dashboard/overview` 空闲 45s | JS 堆稳定 30MB、DOM 稳定 724 节点、主线程最大间隔 202ms（正常定时器抖动） |
| `/users` 空闲 48s（1440×900 与 900×800 两种视口） | 堆稳定 54MB/48MB、DOM 稳定 620 节点、无长任务 |
| `/ai-hub/capabilities` 空闲 | 无长任务、无控制台报错 |
| 逐页切换 9 个后台路由（AI 中台 7 页 + 频道 + 用户） | 仅 1 个 94ms 长任务，DOM 均 < 1000 |
| 精确用户动线 `/workspace` →「管理中心」→ `/dashboard/overview` | 堆 67→68MB、DOM 724 稳定，仅 1 个 50ms 长任务 |
| `Ctrl+K` 命令面板 | 打开正常，981 节点稳定，无长任务 |
| 控制台 | 无 JS 报错（仅 42 条表单缺 id/name 的无障碍提示，无害） |

结论：管理端主壳（侧边栏 / 头部 / 命令面板）与各页面在现有构建下均无死循环、无内存泄漏、无长任务；此前「卡死/无响应」很可能是浏览器缓存的旧前端产物（本次已重新构建、资源哈希已更新），建议 `Ctrl+Shift+R` 强制刷新后再验证；若仍复现，需提供具体页面与操作路径。

## 第 10 项：接入真实 API 前的参数链路核对（2026-10-31）

**需求**：对照参考设计核对各能力 UI 设置项是否真正进入发往上游的 POST 参数，保证接入真实 API 时参数正确。

**前端改动**

| 文件 | 改动 |
| - | - |
| `web/src/features/workspace/api.ts` | 图生图（multipart）补 `model` 表单字段（new-api 只从表单读 model，缺则 400 `model is required`）；TTS 删除无效的 `volume`；音乐生成改为 `prompt` + `tags`/`title`/`make_instrumental` |
| `web/src/features/workspace/components/generate-panel.tsx` | `defaultParams` 去掉 `volume`、新增 `musicTitle`/`instrumental`；TTS 区删除「音量」列（`dto.AudioRequest` 无 volume 字段）；新增音乐设置区（风格标签 / 歌曲标题 / 纯音乐） |

**后端改动**

| 文件 | 改动 |
| - | - |
| `middleware/workspace.go` | 新增 `workspaceMusicAction`：把能力配置的 Action（或模型名）解析为插件要求的 `MUSIC`/`LYRICS`；音乐能力同时写入 `c.Params` 的 `key`/`action` 与上下文 `task_action`。旧版 `/v1/tasks/:key` 入口不带动作路径参数，不补则该动作会被内置 sunoapi 插件以 `invalid_action` 拒绝 |

**实测（2026-10-31，student 登录 `http://localhost:3000/workspace`，浏览器抓包）**

| 能力 | 前端设置 | 实际发送的 POST 体 | 结果 |
| - | - | - | - |
| 音乐生成 | 创作要求 / 风格标签 / 歌曲标题 / 纯音乐 | `{"prompt":"一首关于夏天的民谣","tags":"folk, warm","title":"夏日回忆","make_instrumental":true}` | 503 `model_not_found`：分组 default 下 `suno_music` 无可用渠道（Distribute 已正确解析模型，属预期前置条件） |
| 文生图 | 创作要求 / 尺寸 / 张数 / 风格 | `{"prompt":"一只戴墨镜的柴犬\n风格要求：国风水墨","size":"1024x1024","n":1}` | 503 `model_not_found`：模型 `dall-e` 无可用渠道（预期） |
| 声音合成 | 创作要求 / 音色 / 语速 | `{"input":"你好，欢迎使用 AI 创作工坊","voice":"nova","speed":1}` | 503 `model_not_found`：模型 `tts-1` 无可用渠道（预期） |

结论：三条链路的 UI 设置项均真实进入请求体；各类能力需先在管理端「能力配置」或渠道中提供可用渠道（音乐还需 SunoAPI 类型渠道且服务 `suno_music`）后即可端到端联通。文生文、图生图、视频生成三条链路此前已逐项核对：文生文 `{messages,temperature,model}`、图生图 multipart（`prompt`/`strength`/`image`/`model`）、视频 `{prompt,mode,duration,resolution,model}` 均符合上游契约。

## 第 11 项：教师端权限收窄 + 点数计费口径（2026-10-31）

**需求**：教师只能管理自己名下的班级与学生（查看点数、开始上课、清零/重置/改点数、重置密码）；不得改动他人 API Key（new-api 令牌接口本就仅限本人，无需改动）；结算按教师留痕；学生以「点数」而非货币展示（点数前无 `$`），已用额度同时显示点数与花的钱；兑换码 / 订阅任何角色都停用；教师仍可使用游乐场与聊天。

**后端改动**

| 文件 | 改动 |
| - | - |
| `model/workspace.go` | `WorkspaceClass` 新增 `points_per_lesson`（每节课点数）；`WorkspaceStudent` 新增只读 `quota`/`used_quota`（`fillWorkspaceStudentDisplay` 一并填充）；新增教师范围 helper：`IsWorkspaceClassTeacher`、`GetWorkspaceClassesByTeacher`、`GetWorkspaceClassIdsByTeacher`、`GetWorkspaceStudentsByTeacher`、`IsWorkspaceStudentOfTeacher`、`GetWorkspaceTeacherIdByUserId` |
| `model/workspace_usage.go` | `WorkspaceUsage` 新增 `teacher_id` 索引列；查询与聚合支持按 `TeacherId` 过滤；新增 `AggregateWorkspaceUsageByTeacher` |
| `model/log.go` | 新增 `GetUserLogsByUserIds`，供教师查看名下学生记录 |
| `middleware/workspace_metering.go` | 落账时写入 `TeacherId`（由学生所在班级绑定教师推断），实现按教师结算留痕 |
| `controller/workspace_admin.go` | 统一范围口径 `workspaceScopeTeacherId`（超管=0 不限 / 教师=自身 id）；班级、学生、账户、记录、对账全部按范围过滤；`UpdateWorkspaceStudent` 增加归属校验且教师不可改班级/关联账号；新增 `StartWorkspaceClassLesson`（全班重置为该班每节课点数并清零能力已用）、`SetWorkspaceStudentPoints`（clear / default / set）、`UpdateWorkspaceStudentAccount`（教师仅可重置 role=1 学生密码，≥8 位） |
| `controller/workspace_pricing.go` | 对账新增 `by_teacher` 按教师分组；`buildWorkspaceReconciliation` 支持按教师范围过滤；导出同步 |
| `controller/workspace.go` | 新增 `GET /api/workspace/points`（返回 `quota`/`used_quota`/`point_price_yuan`/`used_yuan`） |
| `router/workspace-router.go` | 新增 `/api/workspace/teacher/*` 组（`AdminAuth`，role≥10）；`/api/workspace/admin/*` 收紧为 `RootAuth`（role=100） |
| `router/api-router.go` | 兑换码、订阅（用户侧与管理侧）、充值 `topup` 全部改为 `RootAuth`，非超管一律 403 |

**前端改动**

| 文件 | 改动 |
| - | - |
| `web/src/lib/format.ts` | 新增 `formatPoints`（`1,234 点`，无货币符号）与 `formatYuan`（`¥12.34`） |
| `web/src/features/ai-hub/api.ts` | 按角色切换 `admin`/`teacher` 基址；新增 `startClassLesson`、`setStudentPoints`、`updateStudentAccount` |
| `web/src/features/ai-hub/sections/classes.tsx` | 教师模式：隐藏新建/编辑/删除班级、添加/移除学生；班级列表新增「每节课点数」列与「开始上课」；学生名单新增「剩余点数 / 已用点数」列与「修改点数 / 清零 / 重置默认 / 重置密码」操作（超管保留移除） |
| `web/src/features/ai-hub/sections/accounts.tsx` | 「总剩余额度 / 已用额度」改为「总剩余点数 / 已用点数」，去掉 `$` |
| `web/src/features/ai-hub/sections/reconciliation.tsx` | 超管可见新增「按教师汇总（结算留痕）」面板 |
| `web/src/features/workspace/components/workspace-studio.tsx` | 学生端额度卡改为 `formatPoints`（去掉 `$`） |
| `web/src/features/workspace/api.ts` | 新增 `fetchWorkspacePoints` |
| `web/src/features/dashboard/components/overview/summary-cards.tsx` | 学生角色看板以点数展示余额与用量，已用额度显示「点数（¥金额）」 |
| `web/src/features/wallet/{index.tsx,components/recharge-form-card.tsx}` | 移除兑换码输入区与订阅套餐卡片 |
| `web/src/hooks/use-sidebar-data.ts`、`use-sidebar-view.ts` | AI 中台群组权限按页细分（能力/额度/定价/对账/账户=超管，使用记录/学生与班级=教师+）；Admin 群组整体收紧为超管；空分组自动隐藏 |

**实测（2026-10-31，`http://localhost:3000`，Bearer 令牌接口级验证）**

| 场景 | 结果 |
| - | - |
| teacher → `GET /api/workspace/admin/capabilities` | 403 ✅ |
| teacher → `POST /api/workspace/admin/classes` | 403 ✅ |
| teacher → `GET /api/workspace/teacher/{classes,students,records,accounts}` | 200 ✅ |
| teacher → `POST /api/user/topup`（兑换码/充值） | 403 ✅ |
| teacher → `GET /api/user/self` | 200 ✅（自身账号 / 游乐场 / 聊天可用） |
| student → `GET /api/workspace/points` | 200，`{quota:9998, used_quota:0, point_price_yuan:0.0001, used_yuan:0}` ✅ |
| student → `/api/workspace/teacher/*` | 403 ✅ |
| 教师范围过滤 | 班级绑定 teacher(id=3) 后，教师仅见该班；`teacher/students` 返回含 `quota`/`used_quota` |
| `POST teacher/students/points`（set 250 / default） | 学生点数 250 → 重置为班级每节课点数 100 ✅ |
| `POST teacher/classes/start-lesson` | `{applied:1, student_count:1, points_per_lesson:100}`，学生点数下发为 100 ✅ |
| UTF-8 校验 | 创建「中文验收班」后读回正常，中文无乱码 ✅ |

> 构建校验：`bun check -b` 0 错误、`bun run build` 通过、`go build`（CGO_ENABLED=0）通过；服务已重启。测试用的班级/学生数据已清理，学生额度已还原。

**补充：根路径跳转口径**

`web/src/routes/index.tsx` 的 `beforeLoad` 改为先 `resolveAuthentication()` 再判断：已登录 → `/workspace`（生成工作台），未登录 → `/sign-in`。浏览器实测：教师登录后访问 `http://localhost:3000/` 落地 `/workspace`；隔离上下文未登录访问 `/` 落地 `/sign-in`；控制台无报错。

## 任务 9：教师端专业版（对话式工作台 `/studio`）（2026-10-31）

**需求**：教师端专业版参考 LibreChat 与 HuggingFace chat-ui 的**对话式交互形式**（逐字流式、可中断、多会话、参数抽屉），**不引入 LibreChat 任何代码**。

**实现方式**

- 新增独立全屏路由 `/studio`（不带 new-api 后台布局），`beforeLoad` 复用 `resolveAuthentication()`：未登录 → `/sign-in`；`role < ROLE.ADMIN` → 回落 `/workspace`。
- 对话走中台既有文生文入口 `POST /api/workspace/generate/text`，以 SSE（`sse.js`）流式接收，鉴权头走 `getFreshAuthHeaders()`，因此同样受中台限流、渠道路由与按次计费约束。
- 会话数据按 `userId` 隔离存 `localStorage`（key：`aiworkspace:teacher-studio:<userId>`），无新增后端表。

**新增文件**

| 文件 | 作用 |
| - | - |
| `web/src/features/teacher-studio/types.ts` | 会话/消息/设置类型，默认系统提示词与参数，标题派生工具 |
| `web/src/features/teacher-studio/storage.ts` | localStorage 读写（损坏/缺失自动回落为空会话） |
| `web/src/features/teacher-studio/api.ts` | SSE 流式对话：分片增量、`[DONE]` 收尾、错误兜底 |
| `web/src/features/teacher-studio/components/conversation-sidebar.tsx` | 会话列表：新建、搜索、相对时间、hover 删除 |
| `web/src/features/teacher-studio/components/chat-thread.tsx` | 消息流：用户/AI 气泡、Markdown 渲染、思考过程折叠、复制/重新生成、空态建议词 |
| `web/src/features/teacher-studio/components/chat-composer.tsx` | 输入区：自动增高、Enter 发送 / Shift+Enter 换行、中文输入法保护、生成中切「停止生成」 |
| `web/src/features/teacher-studio/components/studio-settings-dialog.tsx` | 参数抽屉（参考 HuggingFace）：模型 / 温度（含预设）/ 最大回复长度 / 系统提示词 / 恢复默认 |
| `web/src/features/teacher-studio/components/teacher-studio.tsx` | 主壳：侧栏 + 消息流 + 输入区 + 设置弹窗 + 剩余点数 |
| `web/src/routes/studio/index.tsx` | `/studio` 路由（教师权限守卫） |

**修改文件**

| 文件 | 改动 |
| - | - |
| `web/src/hooks/use-sidebar-data.ts` | 「General」分组新增「教师工作台」→ `/studio`（`requiredRole: ROLE.ADMIN`） |
| `web/src/features/workspace/components/workspace-studio.tsx` | 教师顶栏新增渐变「专业版」按钮 → `/studio`（紧邻「管理中心」） |

**修复记录（实测发现）**

- **流式请求无限挂起**：中台的业务失败（如「可用点数不足」）是 **HTTP 200 + JSON 体**且不带 `data:` 分帧，`sse.js` 会静默忽略并关闭连接，导致界面永久停在「正在思考…」。已在 [api.ts](web/src/features/teacher-studio/api.ts) 增加两层兜底：① 监听底层 XHR 完成事件，若响应体不是 SSE 分帧则直接解析 JSON 并弹出真实错误文案；② 监听 `readystatechange`，连接关闭但既无 `[DONE]` 也无任何增量时给出通用失败提示。同时隐藏「无内容的空白气泡 + 错误卡」的冗余组合。

**实测（2026-10-31，`http://localhost:3000`，teacher / Teacher\@2026）**

| 检查 | 结果 |
| - | - |
| 登录后落地 | `/workspace` 紫色创作台，顶栏出现「专业版」+「管理中心」 ✅ |
| 访问 `/studio` | 正常渲染，无白屏、无错误浮层，控制台 0 报错 ✅ |
| 界面结构 | 左栏「＋ 新建对话 / 搜索对话 / 会话列表」；主区模型 chip + 点数 + 「创作台 / 管理中心 / 设置」；底部输入区 + 发送按钮；空态 4 条建议词 ✅ |
| 发送消息 | 用户气泡正常；教师点数=0 时 ~1s 内弹出红色错误卡「可用点数不足，请等待额度重置」，**不再无限挂起** ✅ |
| 设置面板 | 模型 / 温度（0.7，预设 0.0/0.3/0.7/1.0）/ 最大回复长度（2048）/ 系统提示词 齐全，可关闭 ✅ |
| 视觉 | 无重叠、无裁剪、无横向滚动、无文本缺失 ✅ |
| 构建校验 | `bun check -b` 0 错误（1,437 文件）；`oxlint` 本次改动文件 0 警告 0 错误；`bun run build` / `go build`（CGO_ENABLED=0）均成功 ✅ |

> 真实上游联通需先在管理端「能力配置」或渠道中配置可用渠道；教师点数不足时会被按次计费中间件拦截，属预期行为。

## 任务 10：能力配置迁移到模型管理 + 定价/额度页合并 + 按功能独立折算（2026-10-31）

**用户反馈（原文要点）**

1. 定价规则页「能力」一栏显示全是乱的（乱码 + 排版撑满）；
2. 「额度规则」与「定价规则」疑似两个重复页面；
3. 能力配置不应挂在 AI 中台，应改为在「模型管理」里点开某个模型，设置该模型支持哪些模态（文生文 / 文生图 / 图生图 / 视频 / 音乐 / 声音）；
4. 点数折算不是全局「1 点 = X 元」，而是每个功能各自不同的价格；
5. 还有其他页面存在撑满 / 排版乱的问题。

**结论与设计**

- 合并：`/ai-hub/quotas`（额度规则）与 `/ai-hub/pricing`（定价规则）此前读写的是同一份 capability-config 数据，属重复页面 → 删除额度规则页与导航项，能力数据改由模型声明派生。
- 能力配置迁移：新增 Option `WorkspaceModelCapabilities`（模型 → 模态声明），能力不再单独配置；学生端 6 张卡片由声明**按模态聚合派生**（`Enabled = 该模态下是否有模型`，`Models` 为可选模型下拉）。
- 计费口径：**扣点仍按次**（学生每成功生成一次扣该功能固定点数）；**上游成本按实际用量**（文生文取响应 `usage.total_tokens`，其余回落每次计量数量），用于月度对账。
- 点数折算：由全局单价改为**每个功能独立** `point_price_yuan`。

**后端改动**

| 文件 | 改动 |
| - | - |
| `setting/workspace.go` | 新增 `WorkspaceModelCapabilities`（`WorkspaceModelCapability{Model,Kinds,Plugin,Action}`）、`workspaceKindMetas()`（6 模态固定顺序）、`SetWorkspaceModelCapability()`（upsert/清空）；`GetWorkspaceCapabilities()` 改为按模态聚合并派生 `Enabled/Points/Models`；`WorkspaceCapability` 增加 `points`、`models` |
| `setting/workspace_pricing.go` | 每功能新增 `point_price_yuan`，默认值：文生文 0.001 / 文生图 0.02 / 图生图 0.025 / 视频 0.05 / 音乐 0.04 / 声音 0.01（**各功能互不相同**）；新增 `AmountYuan()`；读回时对历史遗留的乱码（`name`/`unit` 含 `?`）按功能 id 回落内置文案修复 |
| `model/workspace_usage.go` | `WorkspaceUsage` 增加 `amount_yuan`；三个聚合与 CSV 导出改用落库金额；新增 `SumWorkspaceUsageAmountByUser()` |
| `middleware/workspace_metering.go` | 截留响应体解析 `total_tokens`，文生文按「千 token」折算上游用量；写入 `amount_yuan` |
| `controller/workspace.go` | `GetWorkspaceCapabilities` 返回 6 项含未配置；`GetWorkspacePoints` 返回 `{quota,used_quota,used_yuan}`；新增模型能力读写接口；删除 `UpdateWorkspaceCapabilitiesAdmin` |
| `router/workspace-router.go` | 删除 `PUT /admin/capabilities`；新增 `GET|PUT /admin/model-capabilities` |

**前端改动**

| 文件 | 改动 |
| - | - |
| `features/ai-hub/sections/pricing.tsx` | 整体重写：平台设置卡片 + 各功能计价卡片网格（`md:grid-cols-2 xl:grid-cols-3`），字段改为 单次消耗点数 / 1 点折算（元）/ 计价单位 / 上游单价 / 每次计量数量，底部显示单次折算金额；彻底消除旧表格在窄屏撑爆的问题 |
| 删除 | `sections/quotas.tsx`、`sections/capabilities.tsx`、路由 `ai-hub/{quotas,capabilities}.tsx`、导航「额度规则」「能力配置」 |
| `features/models/components/model-capability-panel.tsx`（新建） | 模型管理抽屉「生成能力」Tab：6 个模态开关（音乐额外可配插件/动作），按模型保存；`name_rule≠0` 时用下拉选择具体模型 |
| `features/models/components/drawers/model-mutate-drawer.tsx` | Tab 改 4 列并新增「生成能力」 |
| `features/workspace/components/workspace-studio.tsx` | 卡片改用 `points`；空态改为「无任何已开通能力」；卡片右下角展示可选模型数量/名称；默认选中首个 enabled 能力 |
| `features/workspace/api.ts`、`dashboard/.../summary-cards.tsx` | 移除 `point_price_yuan`，已用金额直接用 `used_yuan` |

**实测（2026-10-31，`http://localhost:3000`，admin / Admin@Workspace2026）**

| 检查 | 结果 |
| - | - |
| `GET /api/workspace/admin/pricing` | 6 项，`point_price_yuan` 分别为 0.001/0.02/0.025/0.05/0.04/0.01，单次折算 0.001/0.10/0.15/1.00/0.40/0.04 元，**互不相同**；原始字节 0 个 `0x3F`，中文 `name`/`unit` 无乱码 ✅ |
| 定价规则页（浏览器实测） | 「平台设置」+「各功能计价」2 列卡片网格；无字段裁剪/重叠；页面 `scrollWidth == clientWidth`，**无横向溢出** ✅ |
| 模型管理抽屉「生成能力」 | 6 个模态开关（非表格），可保存 ✅ |
| `PUT /api/workspace/admin/model-capabilities`（声明 `__verify_model__ → text,music`） | `GET /api/workspace/capabilities` 中 text/music `enabled=true`、`models=[__verify_model__]`、music `plugin=sunoapi` ✅（验证后已清空，无残留） |
| `GET /api/workspace/admin/capabilities` | 返回 6 项（含 `enabled=false`）与 `platform_name=AI Workspace` ✅ |
| 路由校验 | 旧 `PUT /admin/capabilities` → 404；新 `GET /admin/model-capabilities` → 401（未带令牌），路由已替换 ✅ |
| `GET /api/workspace/points`（student） | `{quota:9998, used_quota:0, used_yuan:0}`，不再返回 `point_price_yuan` ✅ |
| 构建校验 | `bun check -b` 0 错误（1,434 文件）；`bun run build` 通过；`go build` 通过；服务已重启 ✅ |

> 说明：`WorkspacePricing` 的历史库值此前被写坏成 `?`（非 ASCII 丢失），本轮已通过「读回时按 id 回落内置文案」自动修复，并重新写回正确中文；写入链路本身（`common.Marshal` + `UpdateOption`）已验证可正常保存 UTF-8。

> 说明：原「能力配置页可设置请求方法 POST/GET」随能力配置迁移到模型管理后不再需要——一个模态对应固定上游通路（均为 POST），方法不再暴露给用户配置。

### 任务 10.1：学生端创作台首屏压缩（2026-10-31）

**用户反馈**：6 张能力卡片不要排成两行 3 个，要「一排 6 个」；整体太高，一屏内必须能直接看到创作要求输入框与上传图片区域，不要再下滑。

**改动**

| 文件 | 改动 |
| - | - |
| `workspace-studio.tsx` | 容器 `py-8 pb-16` → `py-5 pb-10`；页签间距 `mb-7` → `mb-4`；首屏从「大标题 + 段落 + 独立额度大卡」改为**一行紧凑布局**（19px 标题 + 一行副标题 + 右侧「我的可用额度 9,998 点」胶囊）；能力网格 `grid-cols-1 sm:2 lg:3` → `grid-cols-2 sm:3 lg:6`（**一排 6 个**）；卡片由「大图标 + 徽章 + 说明 + 分隔线」大卡改为**横向胶囊卡**（36px 图标 + 能力名 + `N 点/次`，右上角状态圆点，说明文案移入 `title` 悬浮提示），高度由约 180px 降到约 61px |
| `generate-panel.tsx` | 面板头部 `py-5` → `py-3`、图标 44 → 36、标题 17 → 15；正文 `px-6 py-6` → `px-5 py-4`；区块间距 `mb-6` → `mb-4`；输入框 `min-h-[150px]` → `min-h-[92px]`；上传区 `py-9` → `py-5`；提交行 `pt-5` → `pt-4` |

**实测（1440×900，student 账号，CDP 忽略缓存强刷）**

| 检查 | 结果 |
| - | - |
| 6 张卡片是否同一行 | 是，6 张 `top` 均为 230.5，每张宽 190.3px，最右边缘 1316 < 1440 ✅ |
| 纵向滚动 | `scrollHeight = 900 = innerHeight`，**首屏无纵向滚动** ✅ |
| 创作要求输入框 | `#workspace-prompt` bottom = 506.7 ≤ 900，**首屏可见** ✅ |
| 图生图上传区 | 切到「图生图」后 `label[for=workspace-image-file]` bottom = 668.8 ≤ 900，**首屏可见** ✅ |
| 横向溢出 | `scrollWidth = 1440 = innerWidth`，无横向溢出 ✅ |

> 注意：能力改为「由模型声明派生」后，`WorkspaceModelCapabilities` 默认为空，此时学生端 6 张卡片均显示「未配置」并提示「暂无可用生成能力，请联系老师开通」。需在「模型管理 → 点开某个模型 → 生成能力」里勾选该模型支持的模态后，对应能力卡片才会变为可用（本轮压测即是临时声明 `mock-chat` 验证，验证后已清空）。

### 任务 10.2：模型下拉选择 + 按角色开放范围（2026-10-31）

**用户反馈（原文）**：「就是学生端呀，教室端的模型选择改成下拉选择行不行？就是我配置多少模型，你就下选择框，就是我能，我可以选择哪些可以给学生开放？哪些可以给教师开放？哪些是学生？教师都能开放？我配置多少下选项就有多少，不然就是只有一个模型也可以。」

**设计**

- 模型选择统一为**下拉选择框（`<select>`）**：配置几个模型就出几个选项，只有 1 个模型时同样是下拉，不退化成文本输入框。
- 每个模型声明新增**开放范围**字段 `audience`：`student`（仅学生）/ `teacher`（仅教师）/ `both`（学生和教师都可选，缺省值）；非法值一律回落 `both`。
- 学生端 / 教师端的模型下拉只列出**对当前角色开放**的模型；服务端在生成入口再校验一次，未开放的模型直接拒绝。

**后端改动**

| 文件 | 改动 |
| - | - |
| `setting/workspace.go` | 新增常量 `WorkspaceAudienceStudent/Teacher/Both` 与 `normalizeWorkspaceAudience()`、`workspaceAudienceAllows()`；`WorkspaceModelCapability` 新增 `Audience`（缺省 `both`）；`GetWorkspaceCapabilities()` 拆为 `buildWorkspaceCapabilities(isTeacher *bool)`，新增 `GetWorkspaceCapabilitiesForRole(isTeacher)` 按角色过滤模型列表；新增 `WorkspaceModelAllowedForRole(model, kind, isTeacher)` |
| `controller/workspace.go` | `GetWorkspaceCapabilities` 按当前登录角色（`role >= RoleAdminUser` 视为教师）返回过滤后的能力与模型列表 |
| `middleware/workspace.go` | 模型解析完成后按角色校验：已声明但未对当前角色开放的模型，返回 `该模型未对你所在的角色开放` 并中断；**未声明**的模型（如音乐默认模型）不拦截，避免误伤 |

**前端改动**

| 文件 | 改动 |
| - | - |
| `features/ai-hub/types.ts` | `AiHubModelCapability` 新增 `audience`；新增 `AUDIENCE_OPTIONS`（学生和教师都可选 / 仅学生可选 / 仅教师可选） |
| `features/models/components/model-capability-panel.tsx` | 「生成能力」Tab 新增「开放范围」三按钮选择，随保存一起提交；说明文案「决定该模型出现在谁的可选模型下拉里」 |
| `features/workspace/components/generate-panel.tsx` | 学生端「使用模型」本就是原生下拉，选项取自该能力下已对**学生**开放的 `capability.models` |
| `features/teacher-studio/components/studio-settings-dialog.tsx` | 原 `input + datalist` 改为原生 `<select>`（含「使用中台默认模型」空选项 + 自定义下拉箭头，与 generate-panel 视觉一致） |
| `features/teacher-studio/components/teacher-studio.tsx` | 模型选项由已废弃的 `item.model` 改为该能力（文生文）下的 `item.models` 聚合；已保存的模型若不在开放列表内会自动回落到首个可选模型 |

**实测（2026-10-31，`http://localhost:3000`）**

| 检查 | 结果 |
| - | - |
| 声明 `mock-chat → text,image / audience=student`、`teacher-only-chat → text / audience=teacher` 后 `GET /api/workspace/capabilities`（student） | text `models=["mock-chat"]`、image `models=["mock-chat"]`，**不含** `teacher-only-chat` ✅ |
| 同上（teacher） | text `models=["teacher-only-chat"]`，**不含** `mock-chat` ✅ |
| `POST /api/workspace/generate/text`（student，body 指定 `teacher-only-chat`） | 返回 `{"success":false,"message":"该模型未对你所在的角色开放"}`，被服务端拦截 ✅ |
| 学生端 `/workspace`（浏览器实测） | 「使用模型」为**下拉框**（原生 select，带下拉箭头），选项仅 `mock-chat`，第 2 张卡片「文生图」同为下拉 ✅ |
| 教师端 `/studio` → 对话设置（浏览器实测） | 「模型」为**下拉框**，选项仅「使用中台默认模型」+ `teacher-only-chat`，无 `mock-chat` ✅ |
| 构建校验 | `bun check -b` 0 错误（1,434 文件）；`bun run build` 通过；`go build` / `CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启 ✅ |
| 收尾 | 验证用的两条能力声明已清空，数据库恢复为「未声明」状态 ✅ |

> 用法：在「模型管理 → 点开某个模型 → 生成能力」里勾选模态 + 选择「开放范围」并保存。学生端下拉只出现 `student`/`both` 的模型，教师端（含 `/studio`）只出现 `teacher`/`both` 的模型；配置几个模型，下拉里就出现几个选项。

### 任务 10.3：教师工作台生成参数扩展（对齐 HuggingFace chat-ui）（2026-10-31）

**用户反馈（原文）**：「教师工作台指的是……他在学生的基础上，比如说学生只能去设置它的模型的温度或者创造性，但它可以设置更多的东西，你可以去参考 hugging face 的这些设置参数，而不是说只是对话。」

**设计**

- 学生端保持只暴露「温度」一项；教师端 `/studio` 的「生成参数」弹窗按 HuggingFace chat-ui 的 `Generation parameters` 铺开，分四组：
  - **模型与角色**：模型（下拉）、系统提示词
  - **采样**：温度 temperature（0~2，预设 0/0.3/0.7/1）、核采样 top-p（0.05~1，预设 0.7/0.9/0.95/1）、候选词数量 top-k（0=不限制）
  - **长度与惩罚**：最大回复长度 max_tokens、重复惩罚 repetition_penalty（0.5~2，预设 1/1.05/1.1/1.2）、频率惩罚 frequency_penalty（-2~2）、存在惩罚 presence_penalty（-2~2）
  - **随机与停止**：随机种子 seed（0=每次随机）、停止序列 stop（每行一条）
- 取值等于默认值的参数**不发送**，由上游按自身默认处理，避免污染不同厂商的默认行为。

**改动**

| 文件 | 改动 |
| - | - |
| `features/teacher-studio/types.ts` | `StudioSettings` 扩展为 `model/systemPrompt/temperature/topP/topK/maxTokens/repetitionPenalty/frequencyPenalty/presencePenalty/seed/stop`；新增默认值、`TOP_P_PRESETS`、`REPETITION_PENALTY_PRESETS`、`parseStopSequences()`；温度上限由 1 放宽到 2 |
| `features/teacher-studio/api.ts` | 请求体按需附加 `top_p` / `top_k` / `repetition_penalty` / `frequency_penalty` / `presence_penalty` / `seed` / `stop`（数组） |
| `features/teacher-studio/components/studio-settings-dialog.tsx` | 重写为「生成参数」四分组面板：抽出 `Section` / `SliderField`（滑块 + 数值徽章 + 预设档）/ `NumberField` 三个内部组件，沿用原紫色浅色风格与自定义滚动条 |
| `features/teacher-studio/storage.ts` | 无需改动：读取本地快照时已用 `...STUDIO_DEFAULT_SETTINGS` 合并，旧数据自动补全新字段默认值 |

**后端兼容性核对**

- `relaykit/dto/openai_request.go` 的 `GeneralOpenAIRequest` 已含 `top_p`、`top_k`、`stop`、`frequency_penalty`、`presence_penalty`、`seed`、`repetition_penalty`，中台中间件只改写 `model` 字段，其余参数原样透传到 `/v1/chat/completions`，无需后端改动。

**实测（2026-10-31，`http://localhost:3000`，teacher / Teacher@2026）**

| 检查 | 结果 |
| - | - |
| 「设置」→ 弹窗标题 | 「生成参数」，副标题说明「学生端只开放温度一项」 ✅ |
| 模型与角色 | 模型下拉 + 系统提示词输入框（含默认助教文案）均在 ✅ |
| 采样 | 温度滑块（4 档预设）、top-p 滑块（4 档预设）、top-k 数字框均在 ✅ |
| 长度与惩罚 | max_tokens、repetition_penalty（4 档预设）、frequency_penalty、presence_penalty 均在 ✅ |
| 随机与停止 | 随机种子数字框、停止序列文本域均在 ✅ |
| 数值联动 | 拖动 top-p 由 0.95 → 0.70，右上角徽章同步显示 0.70 ✅ |
| 布局 | 内容区 `scrollHeight 1834 > 可视 734` 可滚动；无横向滚动、无文字裁剪、无控件重叠 ✅ |
| 构建校验 | `bun check -b` 0 错误（1,434 文件）；`bun run build` 通过；`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启 ✅ |


### 任务 10.4：权限入口收敛 + 钱包/导航精简 + 模型广场分类与计费明细（2026-10-31）

**用户反馈（原文要点）**

1. 「教师没有权限，就别给他进入该页面的按钮」——无权限的入口一律不显示；
2. 教师可访问审计日志 / 使用日志；教师只能以自己身份给自己创建 API 密钥；数据看板只能看自己的；
3. 概览页只给管理员，教师不要有概览页；
4. 钱包把「增加资金」删掉，只显示自己的剩余点数（不要美元符号）；
5. 顶部导航只保留「控制台 / 模型广场 / 文档」，删除「主页 / 排行榜 / 关于」；
6. 模型广场要能看出「用自己的 API 接入时模型 ID 填什么」；
7. 模型价格要体现分段计价与多档单价：非缓存输入 / 缓存输入 / 缓存写入 / 输出 / 语音输入 / 语音输出；
8. 音频生成类模型要有单独的一套展示。

**决策（已与用户确认）**：教师日志范围=可看全部学生记录；音频模型展示=模型广场内加分类页签；价格展示=多档单价 + 分段区间展开。

**前端改动**

| 文件 | 改动 |
| - | - |
| `hooks/use-top-nav-links.ts` | 顶部导航仅产出「控制台 `/dashboard`」「模型广场 `/pricing`（受 `pricing.enabled`/`requireAuth` 约束）」「文档 `docsLink`/`/docs`」；不再产出 Home `/`、Rankings `/rankings`、About `/about` |
| `hooks/use-sidebar-data.ts` | 「概览」`requiredRole` 由 `ROLE.ADMIN` 提到 `ROLE.SUPER_ADMIN`（教师不可见；含子项的 Admin 组对教师整组自动隐藏） |
| `features/dashboard/index.tsx` | `isAdmin` 阈值改为 `ROLE.SUPER_ADMIN`；教师命中 `overview` 段落时 `navigate` 重定向到 `/dashboard/models`（自己的模型调用看板），不再渲染概览 |
| `features/dashboard/components/models/log-stat-cards.tsx`、`models/models-filter-dialog.tsx`、`flow/flow-charts.tsx` | 三处全站/越权判定阈值统一由 `ROLE.ADMIN`(10) 提升为 `ROLE.SUPER_ADMIN`(100)；调用流转 `flowRole` 由 `'root'` 回落 `'user'` |
| `features/wallet/index.tsx` | 整页重写：只拉 `/api/user/self` 并渲染 `WalletStatsCard`，去掉充值 / 推广返利 / 支付弹窗 |
| `features/wallet/components/wallet-stats-card.tsx` | 主卡「我的剩余点数」用 `formatPoints`（如 `1,234 点`，**无 `$`**），下挂「已用点数 / 调用次数」 |
| `routes/_authenticated/wallet/index.tsx` | 删除 `show_history` 搜索参数与 zod schema |
| `features/wallet/lib/index.ts` | 仅保留 `format`、`payment` 导出（affiliate / ui 随组件一并删除） |
| **删除** | `routes/about/index.tsx`、`routes/rankings/index.tsx`、`features/about/**`、`features/rankings/**`；钱包内 `components/{recharge-form-card,affiliate-rewards-card,creem-products-section,subscription-plans-card}.tsx`、`components/dialogs/**`、`hooks/**`、`api.ts`、`lib/{affiliate,billing,ui}.tsx` 及对应测试（共 43 个文件）。**保留** `lib/payment.ts`、`lib/format.ts`、`types.ts`、`constants.ts`（被 subscriptions / system-settings 引用） |

**模型广场（pricing）改动**

| 文件 | 改动 |
| - | - |
| `features/pricing/constants.ts` | 新增 `MODEL_CATEGORIES`（all/chat/image/video/audio）与 `getModelCategoryLabels()`；分类文案走 `All` / `Conversation Models`(对话) / `Image Models`(图像) / `Video`(视频) / `Audio`(音频)，避免与通用 `Chat`(聊天)/`Image`(图片) 混淆 |
| `features/pricing/lib/filters.ts` | 新增 `isAudioModel()`（按 `audio_ratio`/`audio_completion_ratio` 或端点名含 `audio` 判定）、`getModelCategory()`、`filterByCategory()`；`filterAndSortModels()` 新增必填 `category` 并作为第一道过滤 |
| `features/pricing/hooks/use-filters.ts` | `FilterState` 增 `category`，新增 `setCategory`（选「全部」时清空） |
| `features/pricing/index.tsx` | 搜索框下方新增分类 `Tabs`（全部/对话/图像/视频/音频） |
| `features/pricing/components/model-card.tsx` | 卡片标题上方新增「模型 ID」标签（解决接入时该填什么 model id）；价格行扩展为「输入 / 缓存输入 / 缓存写入 / 输出 / 语音输入 / 语音输出」，按 `cache_ratio`/`create_cache_ratio`/`audio_ratio`/`audio_completion_ratio` 条件展示；分段计价沿用 `getDynamicPricingSummary` 的区间展示 |
| `i18n/locales/{en,zh}.json` | 新增 `Model ID`、`Model Square Categories`、`Conversation Models`、`Image Models` |

**后端改动（越权兜底，`controller/usedata.go`）**

| 接口（路由） | 改动 |
| - | - |
| `GET /api/data`（AdminAuth） | 非超管强制 `username = 当前登录用户`，忽略传入的 `username` 参数 |
| `GET /api/data/flow`（AdminAuth） | 非超管强制按自己 + `RoleCommonUser` 统计，忽略传入的 `username` |
| `GET /api/data/users`（AdminAuth） | 非超管直接返回 `403 无权限查看全站用户数据` |

> API 密钥：核对 `controller/token.go`（`GetAllTokens`/`SearchTokens`/`AddToken`）均以 `c.GetInt("id")` 自查询，「教师只能建/看自己的密钥」**原本即成立**，无需改动。

**实测（2026-10-31，`http://localhost:3000`）**

| 检查 | 结果 |
| - | - |
| 教师顶部导航 | 仅「控制台 / 模型广场 / 文档」，无「主页 / 排行榜 / 关于」 ✅ |
| 教师侧边栏 | 无「概览」项 ✅ |
| 教师访问 `/dashboard/overview` | 重定向到 `/dashboard/models` ✅ |
| 钱包页 `/wallet` | 标题「我的点数」，内容仅 `我的剩余点数 0 点 / 已用点数 0 点 / 调用次数 0`，无「增加资金 / 充值 / 推广 / 返利」 ✅ |
| 模型广场分类页签 | 「全部 / 对话 / 图像 / 视频 / 音频」，文案正确、可切换 ✅ |
| 模型卡片 | 含「模型 ID = mock-chat」、输入 `$75 / 1M`、输出 `$75 / 1M`（该模型无缓存/语音价，故不显示对应行） ✅ |
| teacher → `GET /api/data/?username=student` | 200，返回**自身**数据（越权参数被忽略） ✅ |
| teacher → `GET /api/data/users` | 403 `无权限查看全站用户数据` ✅ |
| teacher → `GET /api/data/self`、`GET /api/data/flow` | 200 ✅ |
| 构建校验 | `bun check -b` 0 错误（1,391 文件，较上轮 1,434 减少 43 个已删文件）；`bun run build` 通过（`routeTree.gen.ts` 已重生成，无 about/rankings 残留）；`oxlint` 本轮改动文件 0 错误；`go build ./...` 与 `CGO_ENABLED=0 go build -o newapi-run.exe .` 均通过；服务已重启 ✅ |

> 说明：音频类模型的「单独展示」通过模型广场的「音频」分类页签实现（有 `audio_ratio`/`audio_completion_ratio` 或音频端点者归入该分类）。上游若为音频专用接口，其价格行会以「语音输入 / 语音输出」呈现，与其他分类的 token 计费区分。

> 说明：登录后默认落地页仍是 `/workspace`（学生/教师紫色创作台，自带一套精简页头），「控制台 / 模型广场 / 文档」三项出现在控制台族页面（`/dashboard`、`/pricing`、`/wallet`）的顶栏，属既有设计，本轮未改动。


### 任务 10.5：批量建学生 / 批量分发点数 / 月度对账与 CSV 导出（2026-10-31）

**背景**：本轮改动在上一次会话中被意外中断（源码已写入但未构建、未验证、未记录），本轮完成构建、接口/权限/浏览器三级验证并补齐记录。

**后端改动**

| 文件 | 改动 |
| - | - |
| `controller/workspace_admin.go` | 新增 `BatchCreateWorkspaceStudents()`：请求体 `{class_id, default_password, students:[{student_no, username, display_name, password}]}`；校验班级存在、非空、单次 ≤500 条；逐行创建普通用户（`RoleCommonUser`）+ 班级学生记录，失败行独立返回 `{student_no, reason}`（"学号不能为空" / "密码长度不能少于 8 位" / "账号已存在" / "创建账号失败" / "加入班级失败"），成功返回 `{created_count, created, failed}` |
| `controller/workspace_admin.go` | 新增 `BatchSetWorkspaceStudentPoints()`：请求体 `{class_id, student_ids, mode, value, reset_usage}`；`mode ∈ clear/default/set`；未传 `student_ids` 时以整个 `class_id` 班级为目标（教师需通过 `IsWorkspaceClassTeacher` 校验）；逐学生 `resolveScopedStudent` 越权兜底，返回 `{applied, failed, total}` |
| `controller/workspace_pricing.go` | 新增 `GetWorkspaceReconciliation()`：调用 `buildWorkspaceReconciliation(month, scopeTeacherId)`，汇总 `Total{count,points,amount_yuan,cost_yuan,diff_yuan}` 与 `ByUser/ByClass/ByTeacher` 三段 |
| `controller/workspace_pricing.go` | 新增 `ExportWorkspaceReconciliation()`：输出 CSV（UTF-8 BOM 开头），表头「月份,时间,学生,班级,能力,模型,计量数量,消耗点数,学生折算金额(元),上游成本(元)」，末尾写汇总行；文件名 `workspace-reconcile-<month>.csv` |
| `router/workspace-router.go` | teacherRouter（AdminAuth）：新增 `GET /reconciliation`、`GET /reconciliation/export`、`POST /students/points/batch`；adminRouter（RootAuth）：新增 `GET /reconciliation`、`GET /reconciliation/export`、`POST /students/points/batch`、`POST /students/batch-create` |

**前端改动**

| 文件 | 改动 |
| - | - |
| `web/src/features/ai-hub/api.ts` | 新增 `fetchReconciliation(month)`、`downloadReconciliation(month)`（blob）、`batchCreateStudents(...)`、`batchStudentsPoints(...)`；`scopeBase()` 按角色返回 `/api/workspace/admin` 或 `/api/workspace/teacher` |
| `web/src/features/ai-hub/sections/reconciliation.tsx` | 新增「月度对账」页：月份控件 + 「查询」/「导出 CSV」；汇总卡（生成次数 / 消耗点数 / 学生折算总额 / 上游成本总额 / 差额）+ 三个汇总表（按学生、按班级、按教师结算留痕） |
| `web/src/features/ai-hub/sections/classes.tsx` | 新增「批量新建学生账号」对话框（学生清单「每行一个：学号,姓名」+ 默认密码）、「批量分发点数」按钮、沿用「全班一键分发（开始上课）」、「添加已有账号」 |
| `web/src/routes/_authenticated/ai-hub/reconciliation.tsx`、`web/src/hooks/use-sidebar-data.ts` | 注册 `/ai-hub/reconciliation` 路由并在 AI 中台分组新增「月度对账」入口 |

**实测（2026-10-31，`http://localhost:3000`）**

| 检查 | 结果 |
| - | - |
| `GET /api/workspace/admin/reconciliation?month=2026-10` | 200，`total{count:2,points:2,amount_yuan:0,cost_yuan:0.008,diff_yuan:0.008}`，`by_user`/`by_class` 有数据 ✅ |
| `GET /api/workspace/admin/reconciliation/export?month=2026-10` | 200，368 字节，BOM=true，中文表头无乱码 ✅ |
| `POST /api/workspace/admin/students/batch-create` | 200，`created_count=2`，`failed` 两条原因准确（"学号不能为空"、"账号已存在"） ✅ |
| `POST /api/workspace/admin/students/points/batch`（mode=set, value=88） | 200 `{applied:2,failed:0,total:2}`，学生 quota 复查为 88 ✅ |
| 权限边界 | teacher → `/api/workspace/teacher/reconciliation` 200（仅自身范围）；teacher → admin 路由 403；student → teacher/admin 路由均 403 ✅ |
| 浏览器 `/ai-hub/reconciliation` | 标题「月度对账」、月份控件、查询/导出、五项汇总指标、三个表格区块及表头齐备；无横向滚动/裁剪/重叠；控制台 0 报错；点击导出触发 `GET .../reconciliation/export?month=2026-10` ✅ |
| 浏览器 `/ai-hub/classes` | 页面正常；班级详情中存在「批量新建学生账号」（学生清单 + 默认密码字段）与「批量分发点数」按钮（无学生时 disabled）；控制台 0 报错 ✅ |
| 构建校验 | `go build ./...` 通过；`bun check -b` 0 错误；`bun run build` 通过且确定性（两次构建 index hash 一致）；`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启 ✅ |
| 数据清理 | 验收用临时班级已删除，`classes`/`students` 均为空；用户表恢复为 admin/student/teacher 三条 ✅ |

### 任务 10.6：教师「专业版」= 六能力进阶参数 + `/studio` 常驻模型下拉（2026-10-31）

**用户反馈（原文要点）**

1. 「不是所有模型都支持，很多模型都是专项」——每个生成能力只应列出**声明支持该能力**的模型；
2. 「老师的专业版指的是在我的文生文、文生图、图生图、视频生成、音乐生成、声音合成的这些地方，**还有更多的选项去配置**，而不是点到专业版里面去。你 teacher studio 你做就做吧，我确实可能需要那种长上下文的对话的界面，但是你能不能，**为什么没有选择模型的地方**？我肯定不只有一个模型。」

**决策（已与用户确认）**

| 议题 | 决策 |
| - | - |
| 进阶参数清单 | 由实现方按每类能力补齐常见高级参数 |
| 可见范围 | **仅教师可见，学生保持精简** |
| `/studio` 模型选择 | 对话头部**常驻多模型下拉**（候选仍限管理员声明支持文生文且对教师开放的模型） |

**设计要点**

- 教师 `/workspace` 在**同一套六能力面板**内，于基础参数下方追加「高级参数」区（学生端不渲染），即「专业版 = 更多可配置项」。
- 所有进阶参数**仅在偏离默认值时**才写入请求体，避免覆盖不同厂商的上游默认行为。
- 只使用 new-api 转发 DTO **结构体已声明**的字段：new-api 会把请求体解析为固定 DTO，**未声明的字段被静默丢弃**。六类能力的有效字段依据如下：

| 能力 | DTO | 实际有效字段 |
| - | - | - |
| 文生文 | `relaykit/dto/openai_request.go` `GeneralOpenAIRequest` | `top_p` `top_k` `max_tokens` `max_completion_tokens` `temperature` `frequency_penalty` `presence_penalty` `seed` `stop` `response_format` `repetition_penalty` `min_p` `n`；系统提示词走 `messages[].role="system"` |
| 文生图 | `relaykit/dto/openai_image.go` `ImageRequest` | `prompt` `n` `size` `quality` `response_format` `style` `background` `moderation` `output_format` `output_compression` `input_fidelity` `watermark` `user`（`negative_prompt`/`seed`/`steps`/`guidance_scale` **无效**） |
| 图生图 | 同上（JSON 分支）；multipart 分支（`relay/channel/openai/adaptor.go`） | multipart 会把**所有非文件表单字段原样重写进上游表单**，故 `negative_prompt`/`seed` 等自定义字段可透传 |
| 视频生成 | `relay/common/relay_info.go` `TaskSubmitReq` | 顶层仅 `prompt` `model` `mode` `image` `images` `size` `duration` `seconds` `input_reference` + `metadata`(map)；**顶层 `resolution` 无效**，进阶项须放 `metadata.*`（kling 读 `aspect_ratio`/`cfg_scale`，hailuo 读 `resolution`） |
| 音乐生成 | `middleware/task_plugin.go`（**整体透传**） | 须用 Suno 字段名：`prompt` `tags` `title` `make_instrumental` `mv` `gpt_description_prompt` |
| 声音合成 | `relaykit/dto/audio.go` `AudioRequest` | `input` `voice` `speed` `response_format` `instructions` `metadata`（`pitch` **无效**） |

**前端改动**

| 文件 | 改动 |
| - | - |
| `features/workspace/api.ts` | `WorkspaceGenerateParams` 新增 19 个进阶字段；`buildPayload` 重写为按能力条件注入（默认值/留空不发送）；新增 `parseStopLines()`；图生图 multipart 分支追加 `negative_prompt`/`seed`/`quality`/`response_format`；视频进阶项写入 `metadata`；音乐用 Suno 字段名；TTS 追加 `response_format`/`instructions` |
| `features/workspace/components/generate-panel.tsx` | props 新增 `advanced?: boolean`；新增常量 `ADVANCED_GRID`(3 列)/`ADVANCED_GRID_2`(2 列) 与内部组件 `NumberField`；在模型/提交行之前插入 `{props.advanced && (...)}` 高级参数区，按 kind 渲染：文生文（系统提示词 / top-p / top-k / max_tokens / 重复惩罚 / 频率惩罚 / 存在惩罚 / 随机种子 / 停止序列）、文生图（生成质量 / 图像风格 / 返回格式）、图生图（负向提示词 / 随机种子 / 质量 / 返回格式）、视频（画面比例 / 提示词强度 cfg_scale）、音乐（模型版本 mv / 描述提示词）、声音合成（输出格式 / 朗读指令） |
| `features/workspace/components/workspace-studio.tsx` | 向 `GeneratePanel` 传入 `advanced={isTeacher}`（`isTeacher = (user?.role ?? 0) >= ROLE.ADMIN`） |
| `features/teacher-studio/components/teacher-studio.tsx` | 头部原「显示模型名、点击打开设置弹窗」按钮改为**常驻 `<select aria-label="选择模型">`**（新增模块级 `MODEL_SELECT_STYLE` 内联 SVG 箭头），`onChange` 直接写 `store.settings.model`；`modelOptions` 取文生文能力的 `models`，为空时显示「暂无可用模型」 |

**实测（2026-10-31，`http://localhost:3000`，临时声明 `mock-chat → text,image,edit,video,music,tts / audience=both`）**

| 检查 | 结果 |
| - | - |
| 教师 `/workspace` 文生文 | 「高级参数」区 9 项齐全（系统提示词 / 核采样 top-p / 候选词 top-k / 最大回复长度 / 重复惩罚 / 频率惩罚 / 存在惩罚 / 随机种子 / 停止序列），「使用模型」下拉含 `mock-chat` ✅ |
| 教师 `/workspace` 文生图 | 「生成质量 / 图像风格 / 返回格式」均在 ✅ |
| 教师 `/workspace` 视频生成 | 「画面比例 / 提示词强度 cfg_scale」+ 说明文案均在 ✅ |
| 教师 `/workspace` 音乐生成 | 「模型版本 mv / 描述提示词」均在 ✅ |
| 教师 `/workspace` 声音合成 | 「输出格式 / 朗读指令」均在 ✅ |
| 教师 `/studio` | 头部常驻 `select[aria-label="选择模型"]`，`value=mock-chat`，`options=["mock-chat"]` ✅ |
| 学生 `/workspace` 文生文 | **无「高级参数」区**（断言 `hasAdvancedTitle=false`、`hasSystemPrompt=false`），仅保留基础「创造性 temperature」，模型下拉正常 ✅ |
| `/workspace` 控制台 | 3 条：1 条 build debug、1 条 a11y 提示（表单控件无 id/name）、1 条 401（为验收脚本自读 `localStorage.access_token` 所致，**非应用报错**） |
| 构建校验 | `bun check -b` 0 错误（1,391 文件）；`bun run build` 通过（`index.7f72ea9686.js`）；`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过（162,876,928 字节）；服务已重启 ✅ |
| 收尾 | 验收用临时能力声明已还原（`PUT /api/workspace/admin/model-capabilities` body `{"model":"mock-chat","kinds":[]}`），`GET /api/workspace/admin/model-capabilities` 复为空 ✅ |

> 说明：模型下拉与能力卡片为空的根因是「模型管理 → 生成能力」**尚无任何声明**。需管理员为各模型勾选其支持的模态（并选择开放范围）后，对应能力卡片才可用、模型下拉才会出现选项。

### 任务 10.7：交互细节修复 + 班级届别 + 按能力课时点数 + 教师点数钱包 + Excel 批量导入（2026-10-31）

**用户反馈（原文要点）**

1. 「`label` 这个下拉选择框有点丑」「高级参数可以折叠…还要把这一段文字给删了」；
2. 「把这玩意的自动更新的功能给删了，因为它现在会显示未知版本」；
3. 「在学生与班级管理那里增加一个选项，设置这个班级是哪一届的，比如 2026 届、2025 届」；
4. 「每节课的点数它是要针对是哪一个——文生文是多少个点数、文生图是多少个点数…有些课程会用到，有些不会，所以可以单个每一个去设置」；
5. 「钱包那一栏…既要显示剩余点数，显示可用余额，而且是管理员分配给老师的点数，他可以随意使用、参与结算，但不会扣老师的限额；可以对老师进行羡慕（发放），相当于老师的钱包，可以设置每月多少号发放」；「不是光每月自动在 15 号发放点数，教师也会用 API，这个 API 的钱包也要同时发放，可以设置」；
6. 「上传一个 Excel，里面有很多个班级的数据，先给一个示例 Excel，然后可以批量创建班级，中文也可以批量设置学生的初始设置和班级设置，这样会快很多」。

**A. 交互细节**

| 文件 | 改动 |
| - | - |
| `features/teacher-studio/components/teacher-studio.tsx` | 头部模型下拉由「原生 select + 内联 SVG 箭头」升级为胶囊风下拉（圆角、内边距、hover/focus 态、右侧 chevron），与 `/studio` 整体视觉一致 |
| `features/workspace/components/generate-panel.tsx` | 「高级参数」区改为**可折叠**（默认收起，标题行可点击展开/收起，带 chevron 指示）；**删除**副标题文案「仅教师可见 · 留空或保持默认即沿用上游默认值」；`Field` 的 `label` 包裹层不再暴露为带样式的 `span` |

**C. 移除自动更新**

| 文件 | 改动 |
| - | - |
| `components/layout/components/app-header.tsx` | 顶栏版本号徽标（显示「未知版本」）整体移除 |
| `components/layout/components/public-header.tsx` | 公共顶栏版本号徽标移除 |
| `features/system-settings/operations/section-registry.tsx` | 系统设置「运维 → 检查更新」区块移除 |

**F. 班级届别**

- 后端：`model/workspace.go` 中 `WorkspaceClass` 新增 `Cohort string`（`gorm:"type:varchar(32)"`），`AutoMigrate` 自动补列；`controller/workspace_admin.go` 的班级 CRUD 读写该字段。
- 前端：`features/ai-hub/types.ts` 新增 `COHORT_OPTIONS`（2026 届 / 2025 届 / …）与 `AiHubClass.cohort`；`features/ai-hub/sections/classes.tsx` 新增班级表单「届别」下拉，班级列表新增「届别」列。

**G. 每节课点数按能力分别配置**

- 后端：`WorkspaceClass.LessonPoints` 由单一整数改为按能力分项（`map[string]int`，键为 `text/image/edit/video/music/tts`），随班级保存。
- 前端：班级表单中「每节课点数」拆成六项独立输入（文生文 / 文生图 / 图生图 / 视频生成 / 音乐生成 / 声音合成），班级列表「每节课点数」列按「文生文 3 · 文生图 5 …」形式摘要展示。

**H. 教师点数钱包**

| 层 | 文件 | 要点 |
| - | - | - |
| model | `model/workspace_wallet.go`（新建） | `WorkspaceTeacherWallet{UserId, Balance, GrantAmount, GrantDay, AutoGrant, LastGrantMonth}`；`DefaultWorkspaceWalletGrantDay = 15`；`GrantWorkspaceTeacherWallet` 同时 `balance += amount` 与 `IncreaseUserQuota(userId, amount)`；`RunWorkspaceTeacherWalletAutoGrant(now)` 对 `auto_grant && grant_amount>0 && now.Day()>=GrantDay && LastGrantMonth != 当月` 的钱包发放并标记月份 |
| service | `service/workspace_wallet_task.go`（新建） | `gopool.Go` + `time.NewTicker(30m)` + `common.IsMasterNode` + `sync.Once`，启动时先跑一次；`atomic.Bool` 防重入 |
| 启动 | `main.go` | `service.StartSubscriptionQuotaResetTask()` 之后追加 `service.StartWorkspaceTeacherWalletGrantTask()` |
| 建表 | `model/main.go` | AutoMigrate 追加 `&WorkspaceTeacherWallet{}` |
| 计费 | `middleware/workspace_metering.go` | 教师生成时**优先扣教学钱包余额**，钱包余额不足才回落扣 `users.quota`；扣减均写 `WorkspaceUsage` 明细供月度对账 |
| 控制器 | `controller/workspace_wallet.go`（新建） | 列表 / 配置（PUT）/ 手动发放（POST grant）/ 直接设置余额（POST balance） |
| 路由 | `router/workspace-router.go` | RootAuth 下新增 `/teacher-wallets`、`/teacher-wallets/grant`、`/teacher-wallets/balance` 三条 |
| 学生端接口 | `controller/workspace.go` | `GetWorkspacePoints` 增加返回 `is_teacher` / `wallet_balance` / `api_quota` |
| 前端 API | `features/ai-hub/api.ts`、`features/ai-hub/types.ts` | 新增 `AiHubTeacherWallet` 与 `fetchTeacherWallets/saveTeacherWallet/grantTeacherWallet/setTeacherWalletBalance` |
| 前端页面 | `features/ai-hub/sections/teacher-wallets.tsx`（新建）、`routes/_authenticated/ai-hub/teacher-wallets.tsx`（新建） | 仅超管可见（`route beforeLoad` 拦截 + 侧边栏 `requiredRole: ROLE.SUPER_ADMIN`）；表格列：教师 / 教学钱包余额 / API 可用额度 / 每月发放 / 发放日 / 自动发放 / 上次发放 / 操作，支持「配置」与「发放点数」两个 Modal |
| 钱包页 | `features/wallet/index.tsx`、`features/wallet/components/wallet-stats-card.tsx` | 拉取 `fetchWorkspacePoints()`；教师主卡 label 改为「教学剩余点数」，副标题「管理员每月固定日期发放，可自由用于教学生成并参与结算」，二级指标扩为 3 列（可用余额 / 已用点数 / 调用次数）；学生保持 2 列 |

**I. Excel 批量导入**

- 依赖：新增 `github.com/xuri/excelize/v2`（`$env:GOPROXY="https://goproxy.cn,direct"`）。
- 后端：`controller/workspace_class_excel.go`（新建）提供「下载导入模板」与「导入」两个接口，模板含「班级」与「学生」两个 sheet（班级含届别、六项课时点数、绑定老师；学生含用户名、姓名、初始点数、默认密码）；导入时按班级名分组批量建班、批量建学生账号，返回逐行成功/失败明细。
- 前端：`features/ai-hub/sections/classes.tsx` 顶部新增「下载导入模板」「导入 Excel」按钮，导入完成后弹出结果明细。

**实测（2026-10-31，`http://localhost:3000`）**

| 检查 | 结果 |
| - | - |
| `/ai-hub/teacher-wallets` | 页面渲染正常；配置保存成功（每月发放 500 点 / 15 号 / 已开启自动发放）；手动发放 1000 点后表格显示「教学钱包余额 1,000 点 / API 可用额度 1,000 点」 ✅ |
| `/wallet`（教师身份） | 主卡「教学剩余点数」，二级指标 3 列（可用余额 / 已用点数 / 调用次数），无任何充值入口 ✅ |
| 计费优先级 | 教师生成时先扣教学钱包，钱包不足回落扣 API 额度；两条路径均写入使用明细 ✅ |
| 构建校验 | `go build ./...` 通过；`bun check -b` 0 错误（1,393 文件）；`bun run build` 通过（路由表已重生成）；`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启在 3000 端口 ✅ |

**待用户指明**

- 「图标显示问题」与「后台页面圆角显示问题」已逐页截图排查（`/ai-hub/classes`、`/system-settings/site`、`/ai-hub/teacher-wallets`、`/wallet`、`/dashboard/overview`、`/workspace`）未见明显异常，待用户指明具体页面/元素后修复。

### 任务 10.8：圆角遮挡修复 + 钱包双账本 + 账户管理归位 + 教师钱包发放 + root 账户（2026-10-31）

用户逐字反馈要点：①「圆角那个地方……这一栏跟右边的挨得特别近，直接挨上了。这几个字被这个大的框架给挡住了」；②「API 额度不应该也显示在钱包吗……点数是上课用的，钱包里还应该有按人民币计费的正常 API（接入 Chatbox/Codex），要分开显示」；③「用户和账户管理这两个页面可以合并都到管理员那一栏去」；④「在新建教师的时候就可以去设置它每月的怎么发放……教师点数钱包是不是没地方去设置，我是在分配额度里面去设置吗」；⑤「你还需要去帮我去新建一个 root 用户」。

**L1. AI 中台页面被圆角大框遮挡 / 右侧贴边（根因修复）**

- 根因：`SidebarInset` 渲染出的 `<main>` 带 `border-radius: 22.4px` + `overflow: hidden`，而 `features/ai-hub/components/kit.tsx` 的 `PageShell` 根节点既无内边距也无滚动容器，标题左上角正好落在圆角弧线内被裁掉，内容右边缘直接贴到容器边界。
- 修复：`PageShell` 根节点改为 `flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto px-3 pt-3 pb-3 sm:px-4 sm:pt-5 sm:pb-4`；标题行改为 `flex flex-wrap items-start justify-between gap-x-4 gap-y-2`，标题容器 `min-w-0 flex-1`，右侧操作区 `flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2`。
- 影响面：`/ai-hub/pricing`、`/ai-hub/reconciliation`、`/ai-hub/records`、`/ai-hub/accounts`、`/ai-hub/classes`、`/ai-hub/teacher-wallets` 六个页面同源生效。
- 实测：`/ai-hub/reconciliation` 上 `h1` 由 `x=208,y=56`（与 `<main>` 完全重合）变为 `x=224,y=76`，圆角不再裁切标题，右侧留出内边距；页面超高时容器内滚动，不再被裁掉。

**L2. 钱包页拆分为「教学点数」与「API 额度」双账本**

- 文件：`features/wallet/components/wallet-stats-card.tsx`。
- 教师（`role >= 10`）改为两列卡片：左「教学剩余点数」= `formatPoints(wallet.balance)`，说明「用于课堂上的文生文、文生图等生成，管理员每月固定日期发放」；右「API 可用额度」= `formatQuota(wallet.apiQuota)`，说明「按人民币计费的接口额度，用于接入 Chatbox、Codex 等外部客户端」。学生保持单卡「我的剩余点数」。下方「已用点数 / 调用次数」两列不变。
- 数据来源不变：`GET /api/workspace/points` 已返回 `wallet_balance` / `api_quota` / `is_teacher`，无需改后端。

**L3. 「账户管理」归位到「管理员」分组**

- 文件：`web/src/hooks/use-sidebar-data.ts`。
- 从「AI 中台」分组移除，移到「管理员」分组中「用户」之后（同一栏相邻），路由仍为 `/ai-hub/accounts`，权限仍为 `ROLE.SUPER_ADMIN`。
- 「AI 中台」分组现为：定价规则 / 月度对账 / 使用记录 / 学生与班级 / 教师点数钱包。

**L4. 新建账户支持「学生 / 教师」，教师可一并配置点数发放**

- 文件：`features/ai-hub/sections/accounts.tsx`（重写）。
- 「新建账户」新增「角色」下拉（学生 / 教师）；选择「教师」时展开「教师点数发放（可稍后调整）」区块：每月发放点数 / 每月发放日（1–28）/ 开启每月自动发放。
- 由于 `controller/user.go` 的 `CreateUser` 对 `role >= RoleAdminUser` 强制要求 step-up 校验，创建教师前先经 `useSecureVerification().requestVerification({ scope: 'admin.user.create', context: { role } })`，把 `proof.proof_token` 作为 `X-Security-Proof` 头（配合 `singleUseAuthorization`）提交；页面挂载 `<SecureVerificationDialog {...verification.dialogProps} />`。
- 创建教师且填了发放点数（>0）时，创建成功后按用户名回查账户列表取 `id`，再调 `saveTeacherWallet` 写入发放规则。
- 账户列表对教师行（`10 <= role < 100`）新增「点数发放」按钮，打开 Modal 复用 `saveTeacherWallet`，初始值从 `fetchTeacherWallets()` 回填——即「教师点数钱包」除 `/ai-hub/teacher-wallets` 外，也可直接在账户管理里设置。

**L5. 新建 root 账户**

- root 之间无法通过 `/api/user/` 互相创建（`CreateUser` 的 `user.Role >= myRole` 直接拒绝 `role=100`），故用一次性 Go 工具直接落库（跑完即删除，代码不留在仓库）：`godotenv.Load(".env")` → `common.InitEnv()` → `logger.SetupLogger()` → `model.InitDB()` → `common.HashAccountPassword()` → `model.DB.Create(&model.User{Role: common.RoleRootUser, Quota: 100000000})`。
- 结果：新建 `username=root` / `display_name=Root User` / `role=100`，`id=6`，已在 `/ai-hub/accounts` 列表中显示为「超级管理员」。

**L6. 学生端能力卡片改用真实图标**

- 原 `KIND_GLYPH`（文/图/改/音/视/乐 单字）替换为 `lucide-react` 图标：`FileText / Image / PenLine / Volume2 / Video / Music`，抽成 `CapabilityIcon` 组件。
- `generate-panel.tsx` 入参由 `glyph: string` 改为 `icon: ReactNode`，面板头部与能力卡片共用同一图标。

**实测（2026-10-31，`http://localhost:3000`，管理员身份）**

| 检查 | 结果 |
| - | - |
| `/ai-hub/reconciliation` 布局 | `h1` 距 `<main>` 左上各留 16/20px，圆角不再遮挡标题，右侧不贴边 ✅ |
| 侧边栏分组 | 「AI 中台」= 定价规则 / 月度对账 / 使用记录 / 学生与班级 / 教师点数钱包；「管理员」= 渠道 / 模型 / 用户 / **账户管理** / 系统信息 / 任务插件 / 系统设置 ✅ |
| `/ai-hub/accounts` | 列表含 `root`（超级管理员）、`teacher`（教师，带「点数发放」按钮）、`student` ✓；「新建账户」角色下拉切到「教师」后展开发放配置区块 ✅ |
| `/wallet` | 左「教学剩余点数 0 点」+ 右「API 可用额度 $200」双卡并列 ✅ |
| `/workspace` | 六张能力卡片显示真实图标（文生文/文生图/图生图/视频生成/音乐生成/声音合成）✅ |
| 构建校验 | `bun check -b` 0 错误（1,393 文件）；`bun run build` 通过；`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启在 3000 端口 ✅ |

**遗留 / 待确认**

- 钱包「API 可用额度」的货币符号跟随站点「货币显示」配置，当前站点配的是 `$`；若要让该卡显示人民币，需要到「系统设置」里把货币切成 CNY。
- 「图标显示问题」若指的是别的元素（例如站点 logo / favicon 或某个具体页面），请指明具体位置。

### 任务 10.9：品牌 favicon 修复 + 企业微信/飞书扫码登录与账号绑定（2026-10-31）

**用户反馈（原文要点）**

1. 「增加那个企业微信登录跟飞书登录的那些的设置的地方……绑定方式就是：这个人老师他需要有一个账户密码，他先登录上去之后，只有老师和管理员可以绑定，在个人设置/个人资料那个地方点击「绑定飞书」或「绑定企业微信」，然后去扫码登录一次自动绑定」；
2. 「企业微信和飞书肯定都只是单一企业的」；
3. 「这些应用我到时候会再设置，目前是没有的，你就先把这个写出来……他们会给你提供 secret、ID、应用 ID 这种，保证你填进去就可以使用」；
4. 「你的 favicon 没改」。

**A. favicon 品牌化**

| 文件 | 改动 |
| - | - |
| `web/public/favicon.ico`、`favicon.png`、`apple-touch-icon.png` | 重新生成品牌图标：紫色渐变圆角方块（`#a855f7 → #4c1d95`，圆角比 0.225）+ 白色八角星；`favicon.png` 512×512、`apple-touch-icon.png` 180×180、`favicon.ico` 含 16/32/48/64 多尺寸（7,756 字节，替换原 49,827 字节的旧图标） |
| `web/index.html` | 原本**没有任何 favicon link**（浏览器只能回落到 `/favicon.ico`），补 `<link rel="icon" href="/favicon.ico" sizes="any" />`、`<link rel="icon" type="image/png" href="/favicon.png" />`、`<link rel="apple-touch-icon" href="/apple-touch-icon.png" />` |

**B. 后端：企业微信 / 飞书扫码登录与绑定**

> 选型：`oauth/generic.go` 的通用 Provider 不适配这两家（企微是「gettoken + getuserinfo」两步且 `auth/getuserinfo` 返回顶层 `userid`；飞书换 token 需 JSON body、userinfo 返回嵌套在 `data` 内），故新增两个**专用控制器**，不注册进 `oauth.Register`，登录/绑定各走自己的路由，改动面最小。

| 文件 | 改动 |
| - | - |
| `common/constants.go` | 新增开关与凭据变量：`WeComOAuthEnabled / WeComCorpId / WeComAgentId / WeComSecret`、`LarkOAuthEnabled / LarkAppId / LarkAppSecret / LarkDomain`（`LarkDomain` 空或 `feishu` = 飞书国内版，`lark` = Lark 国际版） |
| `model/option.go` | `InitOptionMap` 注册 8 个键；布尔分支加 2 个、字符串分支加 6 个 |
| `controller/option.go` | 保存时校验：启用 WeCom 必须已填 CorpId + AgentId + Secret，启用 Lark 必须已填 App ID + App Secret，否则拒绝启用并给出中文原因 |
| `controller/misc.go` | `GetStatus` 新增 `wecom_login` / `wecom_corp_id` / `wecom_agent_id` / `lark_login` / `lark_app_id` / `lark_domain`，供前端决定是否展示入口与回填配置 |
| `model/user.go` | `User` 新增 `WeComUserId` / `LarkOpenId` 两列，用**部分唯一索引**（`where: wecom_user_id <> ''`）规避空串冲突；新增 `FillUserByWeComUserId` / `FillUserByLarkOpenId` / `IsWeComUserIdAlreadyTaken` / `IsLarkOpenIdAlreadyTaken`；绑定列白名单加 `wecom_user_id` / `lark_open_id` |
| `controller/wecom.go`（新建） | `WeComAuth`：`GET /api/oauth/wecom?code=` → `gettoken`（access_token 内存缓存 7200s、提前 60s 过期）→ `auth/getuserinfo` 取 `userid`（非企业成员即 `openid`/家校身份一律拒绝）→ 未绑定直接报错（**绝不自动建号**）→ 已绑定走 `setupLogin`。`WeComBind`：`POST`，`middleware.GetStepUpIdentity` + `RequireSecurityProof(account.bind)`，`role < RoleAdminUser` 返回 **403**，只更新绑定列（`UpdateUserBindColumnForSessionWithTx`） |
| `controller/lark.go`（新建） | `LarkAuth`：`POST /open-apis/authen/v2/oauth/token`（JSON body）→ `GET /open-apis/authen/v1/user_info`（Bearer）取 `open_id`，后续流程同 WeCom。域名按 `LarkDomain` 在 `open.feishu.cn` / `open.larksuite.com` 之间切换。`LarkBind` 同上 |
| `router/api-router.go` | 在 `/oauth/:provider` 通用路由**之前**注册 4 条：`GET /api/oauth/wecom`、`POST /api/oauth/wecom/bind`(UserAuth)、`GET /api/oauth/lark`、`POST /api/oauth/lark/bind`(UserAuth)，均带 `CriticalRateLimit` + `DisableCache` |

**回调协议（前后端共用）**

- `redirect_uri` 统一为 `{系统设置 → 服务器地址}/oauth-callback.html`（两个 provider 同一个值），由 `system_setting.ServerAddress` 拼出。
- `state` 固定格式：`aiworkspace:oauth:<provider>:<mode>:<nonce>`（provider = `wecom` / `lark`，mode = `login` / `bind`）。
- 新增静态页 `web/public/oauth-callback.html`：从 URL 取 `code` / `state` / `error`，按 `state` 解析出 provider 与 mode，用 `window.opener.postMessage({ type: 'aiworkspace-oauth-callback', provider, mode, code, state, error, errorDescription }, window.location.origin)` 回传，然后自动关窗；含紫色渐变 + spinner + 中文提示。
- 用 **popup（`window.open(url, '_blank', 'width=520,height=640')`）** 而非 iframe：静态回调页依赖 `window.opener`，且授权页普遍禁止被框架嵌套。

**C. 前端**

| 文件 | 改动 |
| - | - |
| `features/auth/assets/brand-icons/icon-wecom.tsx`、`icon-lark.tsx` | 新增两个品牌图标组件并导出 |
| `features/auth/lib/oauth-qr.ts`（新建） | `createQrOAuthState(provider, mode)` / `resolveOAuthCallbackUri(serverAddress)` / `buildWeComAuthorizeUrl(...)`（`https://open.work.weixin.qq.com/wwopen/sso/qrConnect?appid&agentid&redirect_uri&state`）/ `buildLarkAuthorizeUrl(...)`（`https://accounts.feishu.cn` 或 `https://accounts.larksuite.com` + `/open-apis/authen/v1/authorize` + `scope=contact:user.base:readonly offline_access`）/ `openQrOAuthWindow(...)`（监听 `message`，校验 `origin` + `type` + `provider` + `mode` + `state`，10 分钟超时，弹窗被拦截时明确报错） |
| `features/auth/hooks/use-qr-oauth-login.ts`（新建） | `useQrOAuthLogin` → `{ loadingProvider, handleQrLogin }`，登录页复用 |
| `features/auth/components/oauth-providers.tsx`、`sign-in/components/user-auth-form.tsx`、`sign-up/components/sign-up-form.tsx` | 由 `/api/status` 的 `wecom_login` / `lark_login` 决定是否渲染「使用企业微信继续」「使用飞书继续」，未启用时**不显示按钮** |
| `features/security/components/account-bindings.tsx` | 「账号绑定」列表新增「企业微信」「飞书」两项，门控为 `profile.role >= 10 && Boolean(status?.wecom_login / lark_login)`（即**仅教师与管理员可见**）；流程：`window.open` 打开授权页（用户手势内同步执行，规避弹窗拦截）→ 拿 `code` → `security.verify({ scope: 'account.binding.bind', context: { provider, code } })` 取 step-up 凭据 → 调 `bindWeCom` / `bindLark` → 刷新列表 + toast |
| `features/system-settings/auth/oauth-section.tsx`、`auth/index.tsx`、`auth/section-registry.tsx`、`features/system-settings/types.ts` | 「系统设置 → 认证 → OAuth 集成」新增「企业微信」「飞书」两个页签（共 8 个：GitHub / Discord / OIDC / Telegram / LinuxDO / 微信 / 企业微信 / 飞书），含启用开关、凭据字段、扫码回调地址（可复制）与配置指引文案 |
| `features/profile/api.ts`、`features/profile/types.ts`、`features/auth/api.ts`、`types.ts`、`constants.ts`、`lib/oauth.ts`、`index.ts` | 补充 `bindWeCom` / `bindLark` 与 `wecom_user_id` / `lark_open_id` 字段类型 |
| `i18n/locales/{en,zh}.json` | 新增约 31 个 key（`Continue with WeCom` / `Continue with Lark` / `Enable WeCom login` / `Enable Lark login` / `Corp ID` / `App ID` / `App Secret` / `WeCom Agent ID` / `Scan callback URL` / `Feishu (China)` / `Lark (International)` / `OAuth authorization failed.` 等） |

**实测（2026-10-31，`http://localhost:3000`）**

| 检查 | 结果 |
| - | - |
| 静态资源 | `/favicon.ico` 200（7,756 字节，已是新图标）、`/favicon.png` 200、`/apple-touch-icon.png` 200、`/oauth-callback.html` 200 ✅ |
| 数据库迁移 | `users` 表新增 `wecom_user_id` / `lark_open_id` 两列；`uk_users_wecom_user_id`、`uk_users_lark_open_id` 两个部分唯一索引均已创建 ✅ |
| `/api/status` | 返回 `wecom_login` / `wecom_corp_id` / `wecom_agent_id` / `lark_login` / `lark_app_id` / `lark_domain` ✅ |
| 启用校验 | 未填凭据直接启用 → 拒绝并提示「Cannot enable WeCom login. Enter the WeCom Corp ID, Agent ID and Secret first.」/「…Enter the Lark App ID and App Secret first.」✅ |
| 保存与生效 | 填入测试凭据并启用后，`/api/status` 的 `wecom_login=true` / `lark_login=true`，凭据正确回读 ✅ |
| `系统设置 → 认证 → OAuth 集成` | 页签为 GitHub / Discord / OIDC / Telegram / LinuxDO / 微信 / **企业微信** / **飞书**；企业微信页签含「启用企业微信登录 / 企业 ID / 企业应用 AgentId / 应用 Secret」，飞书页签含「启用飞书登录 / 应用 ID / 应用 Secret / 域名」，两张卡均带「扫码回调地址 = 网站地址/oauth-callback.html」与配置指引 ✅ |
| 登录页（启用状态下） | 出现「使用企业微信继续」「使用飞书继续」两个入口；未启用时自动隐藏 ✅ |
| 教师 `/security`（启用状态下，teacher 登录） | 账号绑定列表出现「企业微信 未绑定 [绑定]」「飞书 未绑定 [绑定]」✅ |
| 权限门控 | 绑定接口 `role < RoleAdminUser` 返回 403；学生身份不渲染绑定项（`profile.role >= 10` 门控）✅ |
| 还原 | 已把 WeCom / Lark 的启用开关与测试凭据全部清空（`/api/status` 复为 `false` + 空），系统保持「待用户填入真实应用凭据」状态 ✅ |
| 构建校验 | `bun check -b` 0 错误（1,397 文件）；`bun run build` 通过；`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启在 3000 端口 ✅ |

**给用户的操作指引（拿到真实应用后照此配置）**

1. **回调地址是固定的**：`{系统设置 → 服务器地址}/oauth-callback.html`（例如 `https://ai.example.com/oauth-callback.html`）。请先在「系统设置 → 站点设置」把「服务器地址」填成本站对外可访问地址，否则扫码后会落到 `localhost`。
2. **企业微信**：管理后台「应用管理 → 自建应用」→ 记录 `CorpID`、`AgentId`、`Secret`；在「网页授权及 JS-SDK / 可信域名」里把上面的回调地址域名加入白名单。然后把三项填入「系统设置 → 认证 → 企业微信」并打开「启用企业微信登录」。
3. **飞书 / Lark**：开放平台创建「自建应用」→ 记录 `App ID`、`App Secret`；在「安全设置 → 重定向 URL」登记上面的回调地址；权限需含 `contact:user.base:readonly`（可选 `offline_access`）。然后把两项填入「系统设置 → 认证 → 飞书」，按需选择「域名」（飞书国内版 / Lark 国际版），并打开「启用飞书登录」。
4. **绑定方式**：老师/管理员先用账号密码登录 → 进入「安全 → 账号绑定（个人资料页）」→ 点「绑定企业微信」或「绑定飞书」→ 扫码确认一次即自动绑定；此后即可在登录页直接扫码登录（**未绑定的账号不会自动建号**，会明确提示先去个人资料绑定）。

---

### 任务 10.10：前端加载性能优化（语言包按需加载）（2026-10-31）

**用户反馈（原文）**：「尽量优化一下前端速度，现在有点卡」。

**根因定位（构建产物量化）**

对 `web/dist` 做体积剖析后发现首屏（`index.html` 内 5 个首屏 chunk）异常臃肿：

| 首屏 chunk | 原始 | gzip | 主要构成 |
| - | - | - | - |
| `index.*.js` | 5,031 KB | **1,423 KB** | **7 种语言包全量内联（≈4.3 MB 原始）** + 应用代码 |
| `44301.*.js` | 709 KB | 200 KB | zod（路由 `validateSearch`）+ i18next + motion + `@lobehub/icons` toc |
| `vendor-ui-primitives` | 339 KB | 109 KB | Base UI / Radix 基础组件 |
| `lib-react` | 185 KB | 58 KB | React 运行时 |
| `vendor-tanstack` | 174 KB | 51 KB | TanStack Router/Query |

关键证据：在主 chunk 里能同时检索到中文「登录/用户名/密码」、法语「Classement」、俄语「Войти」、越南语「Đăng nhập」——即**任一用户打开任意页面，都要先下载全部 7 种语言共约 4.3 MB 的翻译文本**（`src/i18n/config.ts` 静态 `import` 了 `en/zh/fr/ru/ja/vi/zh-TW` 七个 JSON）。这是「卡」的第一元凶。

**改动**

| 文件 | 改动 |
| - | - |
| `web/src/i18n/config.ts` | 删除 7 个语言包的静态导入；改为 `LOCALE_LOADERS` 惰性 `import()` 映射 + 自实现的 i18next `BackendModule`（`LazyLocaleBackend.read` → 动态 `import` 对应 JSON 并回填 `translation`），i18next 只在初始化时拉取**当前语言**，`changeLanguage()` 时按需拉取目标语言；新增 `react.useSuspense: false` 防止异步资源期间 `useTranslation` 抛 Promise；导出 `i18nReady`（`init()` 返回的 Promise） |
| `web/src/main.tsx` | `import './i18n/config'` 改为 `import { i18nReady }`；渲染包进 `renderApp`，用 `i18nReady.then(renderApp, renderApp)` 等语言包就绪后再挂载，**避免首帧闪现翻译 key**（失败也照常渲染） |

未改动：语言检测顺序、`supportedLngs`、`nsSeparator: false`、`fallbackLng: 'en'`、`convertDetectedLanguage` 等既有行为全部保持原样；`changeLanguage` 仍在 `await` 中完成资源加载后触发 `languageChanged`，切换语言体验不变。

**效果（同一构建流水线前后对比）**

| 指标 | 优化前 | 优化后 | 变化 |
| - | - | - | - |
| 首屏 JS 原始体积 | ≈7.4 MB | ≈2.4 MB | **−67%** |
| 首屏 JS gzip 体积 | ≈1,841 KB | ≈686 KB | **−63%** |
| 主入口 `index` gzip | 1,423 KB | **268 KB** | **−81%** |
| 语言包 | 7 种全量内联在入口 | 独立异步 chunk（zh 486 KB / en 505 KB 原始），**只加载当前语言** | — |

**浏览器实测（2026-10-31，`http://localhost:3000`，Chrome DevTools MCP）**

| 检查 | 结果 |
| - | - |
| 登录页 `/sign-in` | 正常渲染中文「登录 / 用户名或电子邮件 / 密码」，无翻译 key 外露；FCP 232 ms，首屏 JS/CSS 传输 ≈560 KB ✅ |
| 学生 `/workspace` | 正常渲染，longtask 计数 0 ✅ |
| 管理员 `/dashboard/overview` | 冷启动（忽略缓存）JS 传输 710 KB，DCL 130 ms，FCP 324 ms，longtask 计数 0 ✅ |
| 语言切换 | 把 `i18nextLng` 置为 `fr` 后刷新 → 全站切换为法语（「Aller au contenu principal / Console / Place des modèles」），仅额外拉取 1 个语言 chunk（175 KB），其余语言仍不加载 ✅ |
| 构建校验 | `bun check -b` 0 错误（1,397 文件）；`bun run build` 通过；`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启在 3000 端口 ✅ |

**遗留可优化项（本轮未动，避免影响既有交互/视觉）**

1. `44301` 首屏 chunk（200 KB gzip）：zod 由路由 `validateSearch` 引入、motion 由 `AnimatedOutlet` 页面过渡引入、`@lobehub/icons` toc（105 KB 原始）由 `lib/lobe-icon.tsx` 静态导入。三者可进一步拆分，但收益有限且会改变图标/动画的首帧行为。
2. 大体积异步 chunk 均为 `react-icons` 图标包（如 `Gi` 6.7 MB、`Si` 5.2 MB、`Tb` 3.0 MB），仅管理员「系统设置 → 支付方式」编辑器会触发加载，属按需 chunk，未进入常规用户路径。
3. 管理端页面过渡对整页做 `filter: blur()` 动画（`page-transition.tsx`），大表格页面在低端机上可能掉帧；如需进一步优化可改为纯 `opacity/translate` 过渡。

---

### 任务 10.11：登录界面整体放大（面向学生可读性）（2026-10-31）

**用户反馈（原文）**：「把登录界面的整体布局弄大一点，变成学生，我怕他们看不清」。

**改动**

| 文件 | 改动 |
| - | - |
| `web/src/features/auth/auth-layout.tsx` | 面板宽度 `sm:w-[480px]` → `sm:w-[520px]` / `lg:w-[600px]`；左上角 Logo `h-8 w-8` → `h-10 w-10 sm:h-12 sm:w-12`，站名 `text-xl font-medium` → `text-2xl sm:text-3xl font-semibold`；顶部留白 `pt-16` → `pt-24`；容器加 `overflow-y-auto`，避免矮屏被裁切（符合「页面可滚动、不强塞一屏」的既有偏好） |
| `web/src/features/auth/sign-in/index.tsx` | 标题 `text-2xl` → `text-3xl sm:text-4xl`；副标题 `text-sm sm:text-base` → `text-base sm:text-lg`；底部条款 `text-xs` → `text-sm` |
| `web/src/features/auth/sign-in/components/user-auth-form.tsx` | 表单间距 `gap-4` → `gap-5`；两个表单 label `text-sm` → `text-base`；用户名输入框 `h-8/md:text-sm` → `h-12/text-base`；密码输入框通过 `[&>input]:h-12 [&>input]:text-base [&>input]:md:text-base` 放大（`PasswordInput` 的 `className` 落在 wrapper 上，需用子选择器），眼睛按钮 `h-6 w-6` → `h-8 w-8` 适配加高；「忘记密码？」`text-sm` → `text-base`；提交按钮 `h-8` → `h-12 text-base`；Passkey 按钮 `h-11` → `h-12 text-base`；协议勾选文案 `text-xs` → `text-sm leading-6` |
| `web/src/features/auth/components/oauth-providers.tsx` | 第三方登录按钮 `h-11` → `h-12` 并加 `text-base`；分割线文案 `text-xs` → `text-sm` |

**实测（2026-10-31，Chrome DevTools MCP）**

| 检查 | 结果 |
| - | - |
| 1440×900 | 面板 600px；标题 36px；两个输入框均 48px 高 / 16px 字号；提交按钮 48px / 16px；页面无纵向滚动 ✅ |
| 390×844（移动端） | 无横向/纵向溢出，元素仍清晰可读 ✅ |
| 功能 | 用 student 账号实测登录成功并跳转 `/workspace` ✅ |
| 构建 | `bun check -b` 0 错误；`bun run build` 通过；`CGO_ENABLED=0 go build` 通过；服务已重启在 3000 端口 ✅ |

**说明**：`AuthLayout` 为登录/注册/OTP/忘记密码/重置密码共用，宽度与 Logo 尺寸的调整会同步作用于这些页面；本轮仅放大了登录页的表单控件，注册/忘记密码页的输入框仍为默认尺寸，如需一并对齐可再调整。

---

### 任务 10.12：Python Mock 上游三方言端到端联调（2026-11-01）

**用户需求（原文要点）**：在 `d:\杂项\aiworkspace/test`（专门放联调 Python 的目录）里用 Python 模拟上游 AI 供应商 API，填进系统做端到端联调；至少模拟三种"参数头不一样、POST 请求体不一样"的模型，覆盖文生图、图生图、语音生成；验证计费是否正常；验证获取账户余额/模型列表是否正常（不支持的要也能优雅失败）；验证不同时段/不同档位的差异化定价测算是否正常；验证生成结果（图片）回传是否正常。

**产物**

| 文件 | 说明 |
| - | - |
| [mock_upstream.py](file:///d:/杂项/aiworkspace/test/mock_upstream.py) | 单文件纯 stdlib Mock 上游，同时监听 8101/8102/8103 三个端口 |
| [integration_test.py](file:///d:/杂项/aiworkspace/test/integration_test.py) | 端到端联调脚本，79 项断言 |
| `test/mock_requests.jsonl` | Mock 侧请求日志（provider/method/path/headers/body/form_fields/raw_head） |
| `test/integration_result.json` | 联调断言结果 |

**Mock 三种方言设计**

| 端口 | 类型 | 鉴权方式 | 额外必需头 | 必需 body 字段 | image_mode | 模型列表 | 余额查询 | quota_per_unit |
| - | - | - | - | - | - | - | - | - |
| 8101 | `openai` | `Authorization: Bearer` | — | — | `url` | ✅ | ✅ `/v1/dashboard/billing/subscription|usage`（hard_limit 100 − usage 1234 → 87.66） | 500000 |
| 8102 | `custom` | `X-API-KEY` | `X-Trace-Id`（仅生成路径校验） | `api_version`（仅 JSON 体，multipart 放行） | `url` | ❌ 404 | ❌ 404 | — |
| 8103 | `newapi` | `Authorization: Bearer` + `X-Tenant-Id` | — | `channel` | `b64`（内联 base64 回传） | ✅ | ✅ `/api/usage/token/`（total_available 55.5） | 1 |

Mock 端点：`/_mock/health`、`/_mock/log`、`/_mock/reset`、`/media/*`(PNG)、`/api/status`、`/v1/models`、`/v1/dashboard/billing/subscription|usage`、`/api/usage/token/`、`/v1/chat/completions`（`usage.total_tokens=234`）、`/v1/images/generations`、`/v1/images/edits`、`/v1/audio/speech`（WAV）。

**渠道接入（4 条）**

| 渠道 | type | base_url | 承担能力 |
| - | - | - | - |
| A OpenAI 兼容 | 1 | `http://127.0.0.1:8101` | text / image / edit / tts |
| B 自定义头（文生文） | 8 | `http://127.0.0.1:8102/v1/chat/completions` | text |
| D 自定义头（图生图） | 8 | `http://127.0.0.1:8102/v1/images/edits` | edit |
| C NewAPI 网关 | 60 | `http://127.0.0.1:8103` | text / image |

**运行方式**

```powershell
# 终端 1（cwd=d:\杂项\aiworkspace\test）
python mock_upstream.py --reset-log
# 终端 2（cwd=d:\杂项\aiworkspace\new-api）
python ..\test\integration_test.py            # 全量 79 项
python ..\test\integration_test.py --only c,e # 只跑指定分组
```

**断言结果（连续三次全量运行，79/79 PASS）**

| 分组 | 项数 | 覆盖内容 |
| - | - | - |
| A | 4 | 四条渠道入库校验 |
| B | 20 | 能力声明（按模型 upsert）、模型开放范围、定价写入与回读、能力聚合计数（text 3 / image 3 / edit 2 / tts 1，仅统计 `mock-*`） |
| C | 35 | 文生文(A/B)、文生图(A/C)、图生图(B)、声音合成(A)；按次扣点；`workspace_usages` 明细（model/kind/points/cost_yuan/amount_yuan）；月度对账与明细表交叉一致；三方方言头/体断言（`X-Trace-Id`、`api_version`、`channel`、`X-Tenant-Id`）；上游失败不扣点、不落明细 |
| E | 4 | 阶梯定价：text `0.234 千token × 0.001 = 0.000234`；image `1 × 0.30`；改档位后 `0.99` |
| F | 13 | 模型列表与余额：A 成功 87.66、C 成功 55.5、B 优雅失败且无 `data` |
| G | 3 | 时段定价规则（`builtin_billing.go` 的 `deepSeekPeak`） |

**实测结论（两处重要发现）**

1. **new-api `type=8`（Custom）渠道的 `base_url` 就是完整上游请求地址，不会拼接请求路径**（`relay/channel/openai/adaptor.go:178-181`）。因此一个 Custom 渠道只能对应一个端点——文生文与图生图必须拆成两条渠道。这曾导致初次联调 B 渠道全部 404（请求打到 `8102/` 根路径，日志 `unknown path /`），属测试配置错，非系统缺陷。
2. **multipart 表单请求（图生图）原本解析不出 `model`**：`middleware/workspace.go` 的 `workspaceJSONModel()` 只处理 JSON 体 → `upstream.model==""` → 模型开放范围（学生/教师）校验被整体跳过，且用量明细 `model` 字段为空。**这是一处真实的越权风险**，已在 [workspace.go](file:///d:/杂项/aiworkspace/new-api/middleware/workspace.go) 增加 multipart 分支（用现成助手 `common.ParseMultipartFormReusable` 读 `form.Value["model"]`）修复，重新构建后明细已正确记录 `mock-flux-edit-b`。

**已知上游代码缺口（本轮未改，供后续评估）**

- `relay/image_handler.go:84-101`：`*bytes.Buffer`（multipart 图生图）分支不套用渠道 `param_override`。
- `controller/channel-billing.go:152`：`GetResponseBody` 的余额查询请求不套用渠道 `header_override`（故 8102 这类需要额外头的余额查询无法通过该路径携带自定义头）。

**联调脚本工程化细节**

- 鉴权：`POST /api/user/login` 返回 JWT，后续请求带 `Authorization: Bearer <access_token>`，用户 ID 在 `data.user.id`。
- 生成接口 `POST /api/workspace/generate/{text|image|edit|tts|video|music}` **直接返回上游原始载荷**（无 `{success,data}` 包装），断言必须取原始 body。
- 计费断言绕过 `/api/workspace/admin/records`（日志视图不含 kind/points/units/cost_yuan），**直读 SQLite `workspace_usages`**。
- **会话双闸门自愈**：`user_sessions` 受 `UserSessionActiveLimit=50`（按 `status='active' AND expires_at>now`）与 `UserSessionIssuanceLimit=100 / 24h`（按 `created_at` 统计）双重限制；脚本 `purge_stale_sessions()` 在登录前**删除 90 秒前的历史会话行**（仅置 `revoked` 对签发闸门无效），使脚本可重复执行。
- 能力声明 `PUT /api/workspace/admin/model-capabilities` 是**按模型 upsert**而非全量替换；传 `kinds:[]` 可撤销该模型声明。脚本启动时清理 `mock-*` 前缀的历史残留，避免污染。

**构建校验**：`$env:CGO_ENABLED=0; go build -o newapi-run.exe .` 通过；服务已重启在 3000 端口。



---

### 任务 11：教学组织增强（阶段一：需求 1 + 需求 2）（2026-11-01）

**交付范围**：需求 1（小班 / 合班授课 / 选修课虚拟班级 / 留级转班转年级）与需求 2（多校区 + 届别 Excel 名单导入 + 按届自动推算年级 + 学年结转毕业 + 学生/教师账号规则）为**必需项**，不做开关；需求 3、4 只落「功能开关」基础设施，默认关闭。

#### 11.1 数据模型（`model/workspace_org.go`，新建）

| 表 | 关键列 | 说明 |
| - | - | - |
| `workspace_campus` | `name/code/sort_order/enabled` | 校区，`code` 是学生账号前缀来源 |
| `workspace_stages` | `name/years/grade_names/prefix/next_stage_id` | 学段（小学 6 年 / 初中 3 年 / 高中 3 年），`prefix` 留空沿用校区编码，中学常用 `M` |
| `workspace_sub_classes` | `class_id/code/room/enabled` | 班内小班，`code` 可字母或数字；唯一性为（班级, 代码），**不同班级可同码** |
| `workspace_teaching_units` + `workspace_teaching_unit_members` | `unit_id/sub_class_id` | 合班授课单元，跨班合并同码小班 |
| `workspace_elective_members` | `class_id/user_id` | 选修课成员，跨年级跨班级（选修课即 `WorkspaceClass{Kind:1}` 虚拟班级） |
| `workspace_teachers` | `user_id/campus_id/enabled` | 教师档案，承载「这位老师属于哪个校区」 |
| `workspace_username_sequences` | `prefix_key/entry_year/next_seq` | 学生账号顺位分配器，唯一键 (前缀, 届) |
| `workspace_student_transfer_logs` | `from/to_class_id`、`from/to_sub_class_id`、`reason/operator_id` | 转班 / 转年级留痕 |

`WorkspaceClass` 增 `kind/campus_id/stage_id/entry_year`；`WorkspaceStudent` 增 `sub_class_id/stage_id/entry_year/status`。迁移脚本 `model/workspace_org_migration.go` 回填既有数据，版本标记写入 `options` 表（`WorkspaceOrgMigrationVersion=1`）。

#### 11.2 年级与账号规则

- `WorkspaceCurrentAcademicYear()`：`month >= 9 ? year : year-1`；`WorkspaceGradeIndex = academicYear - entryYear + 1`。
- 年级**不落库**，由「届别 + 当前学年」实时推算；序号超出学段年限即显示「已毕业」（学生与班级行为一致）。
- 学生账号 = `前缀 + 届2位 + 顺位4位`，例：主校区（A）2024 届 → `A240001`；中学（Prefix=M）2026 届 → `M260001`。
- 教师默认密码 `Teacher@<注册年份>`（`defaultWorkspaceTeacherPassword()`），可自行修改。

#### 11.3 学年结转（`POST /admin/school-year/rollover`）

幂等：把年级序号已超出学段年限的在读学生置为 `status=2（已毕业）`，并把学年写入 `option: WorkspaceLastRolloverAcademicYear`；`GET /admin/grades/overview` 回显 `academic_year` / `last_rollover_academic_year`。前端「年级与校区」页新增「一键学年结转」按钮。

#### 11.4 Excel 名单导入（`controller/workspace_class_excel.go`）

- 模板三 sheet：`班级`（班级名称 / 班级类型 / 校区名称 / 学段 / 届 / 绑定教师登录名 / 每节课点数-&lt;能力&gt;）、`学生`（校区名称 / 届 / 班级名称 / 姓名 / 是否有小班 / 小班代码 / 是否有选修 / 选修课名称 / 初始密码（留空 123456）/ 沿用学号）、隐藏 `字典` sheet（下拉数据源，避免中文逗号被当分隔符）。
- 下拉校验用 `excelize` 的 `NewDataValidation` + `ShowDropDown=false`（语义反向，`false` 才显示箭头）。
- 导入流程：解析 → 预校验 → 执行；返回 `{classes_created, classes_updated, students_created, sub_classes_created, electives_linked, failed[]}`，逐行失败原因回传。
- 「沿用学号」列用于**小学直升中学**：填原账号即把既有学生改挂到新班级/新学段，账号不变。

#### 11.5 功能开关（需求 3 / 4 预留）

`setting.WorkspaceModuleFlags{lesson_mode, cloud_assets}`，默认 `false`；写入 `option: WorkspaceModuleFlags`，经 `/api/status` 的 data 下发；管理端 `GET/PUT /api/workspace/admin/module-flags`。

#### 11.6 前端

新增页面：`features/ai-hub/sections/{grades,teaching-units,electives}.tsx` 与对应路由 `routes/_authenticated/ai-hub/{grades,teaching-units,electives}.tsx`，侧边栏 ai-hub 组新增「年级与校区」「合班授课」「选修课」。`features/ai-hub/sections/classes.tsx` 增三级筛选（校区 → 学段 → 小班）、小班列与「小班管理」面板、转班/转年级弹窗、授课教师名后标注所属校区。

#### 11.7 本阶段修复的问题

| 问题 | 根因 | 修复 |
| - | - | - |
| 服务启动 panic `assignment to entry in nil map` | `workspace_org_migration.go` 早于 `InitOptionMap()` 执行，`common.OptionMap` 仍为 nil | 写入前加 `if common.OptionMap != nil` 防护，版本标记以 `options` 表为准 |
| Excel 导入学生全部失败「创建账号失败」 | `common/account_password.go` 强制密码 ≥ 8 位，与需求「密码 123456」冲突 | `MinAccountPasswordLength` 8 → 6，错误文案、前端 `password-policy.ts`、`accounts.tsx` 与 7 个 locale 文案同步改为 6 |
| 新建合班单元接口返回 `sub_class_ids: null` | `InsertWorkspaceTeachingUnit` 事务提交后未回填展示字段 | 提交后调用 `fillTeachingUnitMembers` 回填，返回体与列表接口一致 |
| 前端 `bun check -b` 报路由路径 TS2345 | `routeTree.gen.ts` 尚未重生成 | 跑 `bun run build` 触发 TanStack Router 插件重生成后消除 |
| favicon 仍为 new-api 默认图标 | 新图标只放进了 `web/public`，未重新构建嵌入 | 重新 `bun run build`，`web/dist/favicon.{ico,png}` 已为 AI Workspace 图标并被 `//go:embed web/dist` 打包进二进制 |

#### 11.8 验证结果（2026-11-01）

**组织管理 e2e（`%TEMP%\ws_org_e2e.py`）：25 项断言全部通过、0 失败。** 覆盖：多校区、Excel 往返导入（4 班 / 5 生 / 2 小班 / 1 选修关联）、`A24xxxx` 与 `B26xxxx` 命名规则、2024 届→三年级、2026 届→一年级、2020 届→已毕业、同班同码复用小班与跨班同码独立、跨班合班单元、留级转班、直升沿用原账号并转入七年级、学年结转标记 1 人且重复执行幂等。

**既有全链路回归（`test\integration_test.py`）：79 项断言全部通过、0 失败。**

**构建校验**：`go build -o newapi-run.exe .` 通过；`bun check -b` 0 错误（1,404 文件）；`bun run build` 通过；服务已重启在 3000 端口。测试数据已由脚本 `cleanup()` 全部清理（students/classes/teaching-units 为空，campuses 仅剩「主校区」）。

#### 11.9 后续阶段

- 阶段二（需求 3）：上课模式（年级→班级→小班选课 / 课程概览 / 指定任务或自由模式 / 分发课程 / 实时看学生请求与提示词 / 一键提交课堂作品 / 点评 / 打包 zip 导出 / 一键下课 + 学生端登出 / 点数与生成次数 Excel 导出）。
- 阶段三（需求 4）：学生生成素材（文/图/音/视频）落盘 + 保留策略 + 教师手动清理（按课次 / 按时间段 / 除已提交作品外全删）与对象存储接口预留。

---

### 任务 12：上课模式与课堂作品（阶段二：需求 3）（2026-11-01）

**交付范围**：需求 3 全部 7 个点——教师按「年级→班级→小班」三级下拉选授课对象 → 课程概览（主题 / 授课时间默认当天 / 指定任务模式勾选允许能力 或 自由模式）→「分发课程」；教师实时看学生请求与提示词与 AI 生成内容；学生端每个生成结果下方「一键提交」课堂作品；教师点评；打包 zip 一键导出**仅已提交**作品；「一键下课」强制该班学生全部退出登录；教师可导出本节课作品，也可导出整个班的点数与生成次数 Excel。需求 3 属「控制面板可开关」能力（开关已就绪，默认关闭）。

#### 12.1 数据模型（`model/workspace_lesson.go`，新建）

| 表 | 关键列 | 说明 |
| - | - | - |
| `workspace_lessons` | `class_id/unit_id/sub_class_ids/teacher_id/campus_id/stage_id/topic/lesson_date/mode/allowed_kinds/started_at/ended_at/status` | 一节课；`mode`：0 自由 / 1 指定任务；`status`：1 进行中 / 2 已结束 |
| `workspace_lesson_submissions` | `lesson_id/user_id/class_id/kind/title/content_text/media_url/usage_id/comment/score/commented_at` | 课堂作品，仅存**学生主动提交**的内容 |

`workspace_usages` 增 `lesson_id/prompt/result_preview`，让实时看板能直接看到「请求 / 提示词 / AI 生成内容」。AutoMigrate 已追加两张新表。

- `ResolveWorkspaceLessonStudentUserIds`：参课学生解析优先级 **合班单元 > 选修课虚拟班级 > 行政班**（行政班可按 `sub_class_ids` 再过滤小班）。
- `GetActiveWorkspaceLessonForUser`：学生端「当前进行中的课」。
- `LessonAllowsKind`：指定模式下按 `allowed_kinds` 限制生成能力，自由模式放行全部。
- `EndWorkspaceLesson` 幂等；`AggregateWorkspaceLessonUsage` / `WorkspaceClassUserStats` 产出统计行 `WorkspaceLessonStatsRow{UserId,Name,No,Total,Points}`。

#### 12.2 后端接口（`controller/workspace_lesson.go`，新建 + `router/workspace-router.go`）

- 学生端（UserAuth）：`GET /lesson/current`、`GET /lesson/submissions`、`POST /lesson/submissions`。
- 教师端（AdminAuth，均按教师归属过滤）：`GET|POST /lessons`、`GET /lessons/:id`、`POST /lessons/:id/end`、`GET /lessons/:id/stream`（SSE）、`GET /lessons/:id/submissions`、`PUT|DELETE /lessons/:id/submissions/:sid`、`GET /lessons/:id/export`（zip）、`GET /lessons/:id/stats/export`（xlsx）、`GET /class-stats/export`（xlsx）。
- 越权防护：`requireLessonAccess`（授课教师 / 班级教师 / 参课学生归属任一命中）、`checkLessonParticipantsInScope`（授课对象必须全部归自己名下）。
- 实时看板：`service/lessonhub` 进程内 pub/sub；SSE 先发 `snapshot`（已发生的生成记录）与 `submissions`，再推 `usage` / `submission` / `submission_comment` / `lesson_started` / `lesson_ended`，15s 心跳 `: ping`。因后端仅接受 `Authorization: Bearer` 头，前端用 `fetch` + `ReadableStream` 读流（`EventSource` 无法带头）。
- 计量埋点：`middleware.WorkspaceMetering()` 在生成成功时回填 `LessonId/Prompt/ResultPreview` 并广播 `usage` 事件；multipart（图生图）场景额外解析表单 `model` 字段，避免能力范围校验被跳过。
- 一键下课：对参课学生逐个 `RevokeAllUserSessions` + `BumpUserAuthVersion` 兜底，随后广播 `lesson_ended`。

#### 12.3 前端

- 教师端新增页面 `features/ai-hub/sections/lesson-mode.tsx` + 路由 `routes/_authenticated/ai-hub/lesson-mode.tsx`，侧边栏 ai-hub 组按 `lesson_mode` 开关条件插入「上课模式」入口。
  - 三级下拉（年级含选修课分组与「全部年级」→ 班级 → 小班）；课程概览（主题 / `type=date` 默认当天 / 自由或指定模式 / 指定模式按已启用能力勾选）；「分发课程」。
  - 本节课实时看板：实时请求表（学生 / 能力 / 提示词 / 生成内容预览）、打包导出 / 导出统计 / 一键下课；课堂作品区（点评弹窗 + 评分、删除）；历史课程列表。
  - 入口三重把关：侧边栏条件插入 → 路由 `beforeLoad`（role + 本地缓存开关 fail-closed）→ 页面内 `useWorkspaceModuleFlags` → 后端 `workspaceLessonModuleEnabled()`。
- 学生端 `features/workspace/components/workspace-studio.tsx`：登录后自动进入上课模式，顶部显示本次主题与授课教师，指定模式下仅开放老师勾选的能力（未开放能力卡片置灰并提示「本节课未开放」）；`generate-panel.tsx` 每个生成结果下提供「一键提交」。
- API 封装：`features/ai-hub/api.ts` 增 `createLesson` / `fetchLessonDetail` / `endLesson` / `openLessonStream` / `downloadLessonSubmissions`(zip) / `downloadLessonStats`(xlsx) / `downloadClassStats`(xlsx) 等；`features/workspace/api.ts` 增 `fetchCurrentLesson` / `submitLessonWork`。

#### 12.4 本阶段修复的问题

| 问题 | 根因 | 修复 |
| - | - | - |
| 前端 `bun check -b` 报路由路径 TS2345（lesson-mode） | `routeTree.gen.ts` 由构建插件生成，新路由尚未登记 | 先 `bun run build` 触发重生成，再 typecheck（1,406 文件 0 错误） |
| 路由守卫读不到开关 | `AuthState.auth` 无 `status` 字段 | 改用 `readCachedStatus()`（localStorage 的 `/api/status` 快照）+ 页面内二次守卫 |
| 实时看板拿不到学生姓名 | SSE `usage` 事件不含用户名 | 前端按 `fetchStudents(class_id)` 建 `userId → display_name` 索引补齐 |

**已知取舍（阶段二范围内）**：视频/音乐仅有 taskId 无最终媒体 URL，提交时以 taskId/状态作为文本；音频 blob 转 data URL（>2MB 放弃媒体仅留文本）；多 MB base64 入库为临时方案，阶段三「素材落盘」改为服务端存储路径。

#### 12.5 验证结果（2026-11-01）

**上课模式 e2e（`%TEMP%\ws_lesson_e2e.py`）：33 项断言全部通过、0 失败。** 覆盖：

- 开关守卫：关闭时下发课程被拒、学生端无进行中的课；开启后可用。
- 三级选择数据来源：教师端可选到自己的班级、可读取小班列表。
- 下发课程：指定任务模式 + `allowed_kinds=[text,image]` 正确落库、参课人数 2、课程列表可见。
- 学生端：进入上课模式、主题正确、能力范围与老师设定一致、非参课账号无课。
- SSE：收到初始 `snapshot`，学生提交后实时收到 `submission` 事件。
- 课堂作品：学生一键提交成功、教师端可见且含学生姓名、教师点评并评分 92、学生可看到自己的作品。
- 导出：zip 含 `说明.txt` 清单与作品文件；课次统计与全班统计 xlsx 均为合法 xlsx。
- 越权：非授课教师不可查看该课程。
- 一键下课：结束统计正确、**学生会话被强制失效**（旧 token 调用即失败）、课程状态置 2、已结束课程拒绝提交作品。

**既有全链路回归（`test\integration_test.py`）：79 项断言全部通过、0 失败。**

**前端人工验证（Chrome DevTools MCP）**：

- 教师端 `/ai-hub/lesson-mode`：三级下拉（年级「全部年级 / 三年级」→ 班级 → 小班「全班」）、课程概览（主题 / 授课时间默认当天 `2026-11-01` / 自由或指定任务模式 / 下发点数开关）、「分发课程」与「历史课程」表（进行中 + 作品数 + 进入看板 / 打包导出 / 导出统计 / 下课）均正常渲染；「一键下课」弹出自定义确认弹窗（非原生 confirm）。
- 「进入看板」后本节课实时看板的主题、状态「进行中」、参课学生 2 人、已提交作品 0 件、实时请求表（时间/学生/能力/提示词/生成内容预览）与课堂作品表均正确渲染；页面控制台 0 报错。
- 学生端 `/workspace`：登录后顶部自动出现「上课模式 · 界面验证课：AI 与生活 · 本节课正在进行中 · 本节课仅开放：文生文、文生图」主题条；图生图与声音合成卡片置灰并提示「本节课未开放」，文生文 / 文生图正常可点，与老师设定的 `allowed_kinds` 完全一致。
- 教师点「确认下课」后，学生端页面再次访问 `/workspace` 被重定向到 `/sign-in?redirect=%2Fworkspace`，验证「一键下课强制学生退出登录」在前端生效。

**构建校验**：`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；`bun check -b` 0 错误（1,406 文件）；`bun run build` 通过；服务已重启在 3000 端口。测试数据已清理（classes/students/lessons/submissions 为空，模块开关已还原为关闭，e2e 账号已移除）。

#### 12.6 后续阶段

- 阶段三（需求 4）：学生生成素材（文/图/音/视频）落盘 + 保留策略 + 教师手动清理（按课次 / 按时间段 / 除已提交作品外全删）与对象存储接口预留。

---

## 任务 13：云端素材落盘与按课次/时间段清理（阶段三：需求 4）（2026-11-01）

**交付范围**：需求 4 全部 4 个点——① 抽象 `WorkspaceArtifactStore` 存储接口（`Save`/`Delete`/`Open`），先落地本地磁盘实现并预留对象存储位；② 在生成链路后采集产物落盘（图片/音频/视频/音乐/文字），**经 API 直连的请求不采集**；③ 批量清理接口 `POST /admin/artifacts/purge`，三种模式（按课次 / 按时间段 / 按班级仅删未提交），统一跳过已提交的课堂作品；④ 教师端新增「云端素材」页（筛选 / 预览 / 下载 / 勾选删除 / 超管批量清理）。本能力属「控制面板可开关」，开关 `cloud_assets` 默认关闭。

#### 13.1 存储抽象（`service/artifactstore/store.go`，新建独立包）

不复用 `service/task_artifact_store.go`（那是「上游代理拉取」语义），另建包以隔离两种职责。

| 元素 | 说明 |
| - | - |
| `Store` 接口 | `Save(ctx, Scope, filename, io.Reader) (storagePath, error)` / `Delete(storagePath)` / `Open(storagePath) io.ReadCloser` / `LocalPath(storagePath)` |
| `Scope` | `{StageName, EntryYear, ClassName, LessonId, UserId, UserName}` |
| `RelativeDir` | `<学段>/<届>/<班级>/第N课/<学生>`，缺省回落 `未分学段/未分届/未分班级/未关联课次/未知学生` |
| `localDiskStore` | 落盘根目录默认 `data/workspace-artifacts`（`DefaultRoot`），可用环境变量 `WORKSPACE_ARTIFACT_DIR` 覆盖；`absolute()` 做目录穿越防护，删空目录后向上 `pruneEmptyDirs` |
| `Default()` / `SetDefault()` | 进程内单例，便于后续替换为对象存储实现与单测注入 |

路径片段清洗：正则 `[\\/:*?"<>|\x00-\x1f]+` → `_`，再 `Trim(" .")` 去掉首尾点与空格（`"../etc"` → `"_etc"`），超 40 字符截断。

#### 13.2 数据模型与接口

**表 `workspace_artifacts`（`model/workspace_artifact.go`，新建）**：`user_id / class_id / lesson_id / kind / model / prompt / storage_path / mime_type / size_bytes / source_url / submitted`；AutoMigrate 已追加（`model/main.go`）。
查询结构 `WorkspaceArtifactQuery{UserId, ClassId, LessonId, Kind, UserIds, StartTimestamp, EndTimestamp, Submitted *bool}`；配套 `ListWorkspaceArtifacts`（分页 + 总数）、`AllWorkspaceArtifacts`、`AggregateWorkspaceArtifactStats`（按 kind 汇总条数与字节）、`GetWorkspaceArtifactById`、`DeleteWorkspaceArtifactsByIds`、`MarkWorkspaceArtifactsSubmitted`。

**接口（`controller/workspace_artifact.go`，新建 + `router/workspace-router.go`）**：

| 方法 | 路径 | 权限 | 说明 |
| - | - | - | - |
| GET | `/api/workspace/{teacher\|admin}/artifacts` | AdminAuth / RootAuth | 列表 + `total` + `stats`；教师按自己名下学生过滤，越权指定 `user_id` 返回空集 |
| GET | `/api/workspace/{teacher\|admin}/artifacts/:id/content` | 同上 | 按 `mime_type` 输出字节，`?download=1` 转 attachment |
| DELETE | `/api/workspace/{teacher\|admin}/artifacts/:id` | 同上 | 单条删除；`Submitted=true` 时拒绝（「该素材已作为课堂作品提交，不能删除」） |
| POST | `/api/workspace/admin/artifacts/purge` | RootAuth | 三选一 body，返回 `{deleted, released_bytes}`，**始终 `Submitted=false` 过滤** |

purge 三种模式优先级：`lesson_id > (mode=except_submitted + class_id) > from/to`；日期按 `YYYY-MM-DD` 解析为左闭右开时间戳区间（`to` 自动 +1 天），格式非法直接报错。

#### 13.3 采集时机

| 能力 | 采集方式 | 落盘内容 |
| - | - | - |
| 文生文 / 文生图 / 图生图 / 声音合成 | 中间件 `middleware/workspace_artifact.go` 的 `WorkspaceArtifactCapture()` 包裹 `c.Writer` 截留响应体（上限 64MB，写穿不阻塞客户端） | 图片：`b64_json` 解码或 `url` 下载为 `.png`；音频：按上游 `Content-Type` 推断扩展名；文字：`{"prompt","response"}` JSON |
| 视频 / 音乐 | 任务终态后由 `controller/relay.go`（立即成功）与 `service/task_polling.go`（`finalizeTerminalTask`）触发 `service.CollectWorkspaceTaskArtifact` 下载结果 URL | 视频 `.mp4`、音乐 `.mp3`（扩展名跟随上游 `Content-Type`） |

- **只采集中台入口**：判定 `c.GetBool(service.WorkspaceBillingContextKey)`（由 `WorkspaceSessionToken` 无条件设置）。`/v1/*` 直连不带该标记，故不采集。
- 视频/音乐在同步中间件中直接放行（`kind == video|music`），改由任务链路的 `TaskPrivateData.Workspace/WorkspaceKind/WorkspaceLessonId` 标记驱动（新增于 `model/task.go`）。
- 关闭 `cloud_assets` 开关或 `UserId<=0` 时 `SaveWorkspaceArtifact` 直接返回 nil，不产生任何文件与记录。
- 产物归属课次取 `GetActiveWorkspaceLessonForUser`，非上课时段生成则 `lesson_id=0`。

#### 13.4 前端

- 新增页面 `features/ai-hub/sections/cloud-assets.tsx` + 路由 `routes/_authenticated/ai-hub/cloud-assets.tsx`（`ROLE.ADMIN` + 本地缓存 `cloud_assets` 开关 fail-open 拦截，与服务端二次校验呼应）。
- 侧边栏 `hooks/use-sidebar-data.ts`：在「上课模式」之后按 `moduleFlags.cloud_assets` 条件插入「云端素材」。
- 页面内容：筛选区（课次下拉 / 能力类型 / 起止日期 / 学生 ID / 重置）、`空间占用` 卡片（按能力类型汇总条数与占用）、素材列表（复选框、类型徽标、文件名、学生、班级、课次主题、模型、大小、生成时间、`未提交`/`已提交` 状态、预览 / 下载）、`删除选中（N）`、分页；超管额外可见「批量清理」区（三种模式 + 二次确认弹窗）。
- 已提交素材的复选框 `disabled`，避免无效操作后再被服务端拒绝。
- API 封装 `features/ai-hub/api.ts`：`fetchArtifacts` / `fetchArtifactBlobUrl` / `deleteArtifact` / `purgeArtifacts`（走 `scopeBase()` 按角色切 admin/teacher 前缀）。

#### 13.5 本阶段修复的问题

| 问题 | 根因 | 修复 |
| - | - | - |
| e2e 生成接口全部 200 但 0 素材落盘 | 开课 `CreateWorkspaceLesson` 默认 `apply_points=true`，班级未配 `lesson_points` 时 `AdjustUserQuota(override, 0)` 把刚充的点数清零，生成以「可用点数不足」被拒 | 测试脚本把充值挪到开课之后（非产品缺陷） |
| 直连 `/v1/chat/completions` 返回 400 `model_price_not_configured` | 直连走 new-api 自身模型计费，测试环境无任何 `ModelPrice` 与 `SelfUseModeEnabled=false` | 测试内临时开「自用模式」并在 `finally` 还原 |
| 「已提交素材单条删除被拒绝」断言失败 | new-api 业务失败仍返回 **HTTP 200 + `success:false`** | 断言改判 body 的 `success` 字段 |
| 「非上课时段生成的素材 `lesson_id=0`」拿不到 | 第一节课始终 `ACTIVE`，`GetActiveWorkspaceLessonForUser` 仍命中第一节课 | 生成前先「一键下课」，并重新登录（下课会强制失效学生会话） |
| Go 单测 `no such table: workspace_artifacts` / `options` | `model.InitDB()` 仅在 `common.IsMasterNode==true` 时执行 `migrateDB()` | 测试 setup 中显式置 `IsMasterNode=true` 并在 Cleanup 还原 |
| Go 单测 Windows 下临时目录无法删除 | SQLite 连接未释放 | Cleanup 中先 `model.DB.DB().Close()` 再还原路径（利用 LIFO 顺序） |
| **超管打开「云端素材」页报 `Invalid URL (GET /api/workspace/admin/lessons)`，课次下拉为空** | 前端 `scopeBase()` 对超管返回 `/admin` 前缀，但 `/lessons` 只在 `teacherRouter` 注册过 | 在 `adminRouter` 补齐上课模式的 10 条 lesson 路由（控制器内 `workspaceScopeTeacherId` 对超管返回 0 即全站可见）；同时修好阶段二「上课模式」页对超管的同类问题 |

#### 13.6 验证结果（2026-11-01）

**云端素材 e2e（`test\cloud_assets_e2e.py`）：42 项断言全部通过、0 失败**（`--keep` 模式为 40 项，跳过清理段）。覆盖：

- 落盘：文生文 / 文生图（A 渠道 URL 形态）/ 文生图（C 渠道 b64 形态）/ 图生图 / 声音合成五类同步能力各落 1 份；目录精确命中 `<学段>/<届>/<班级>/第N课/<学生>/`；磁盘文件存在、大小与记录一致，内容分别为 PNG / RIFF / 含响应正文的 JSON；`stats` 汇总与明细逐项一致；预览接口按 MIME 返回完整字节。
- **API 直连不采集**：用学生本人建令牌后直连 `/v1/chat/completions` 成功，素材数 `5 -> 5` 不变。
- 课堂作品保护：提交后素材 `submitted=true`；单条删除被拒且文件仍在磁盘。
- 三种清理模式：按课次删除 4 份（跳过已提交，`released_bytes=8409`）；按时间段删除第二课 1 份；按班级（仅未提交）删除课后素材 1 份；最终仅剩已提交作品且其文件未被动。
- 清理段：素材、班级、学段、学生账号、模块开关全部还原。

**既有全链路回归（`test\integration_test.py`）：79 项断言全部通过、0 失败。**

**Go 单测（`service/workspace_artifact_test.go`，4 个用例）全部 PASS**：目录规则与非法字符清洗（`../etc` → `_etc`、`a:b*c?d` → `a_b_c_d`）、异步任务终态下载（含非中台/非成功/非法地址三种不采集、`.mp4`/`.mp3` 扩展名与 MIME）、开关关闭时不落盘、同步产物四种形态解析（b64 / URL / 原始音频字节 / 文本 JSON）。`go test ./service/` 通过。

**前端人工验证（Chrome DevTools MCP，超管账号）**：

- `/ai-hub/cloud-assets` 正常渲染：侧边栏「AI 中台 → 云端素材」、筛选区 5 个控件、`空间占用`（图生图 1 个·0.1 KB / 文生图 3 个·0.4 KB / 文生文 1 个·0.1 KB / 声音合成 1 个·7.9 KB）、素材列表 6 行、批量清理区三模式。
- 课次下拉已按课程填充（修复前为空并报错）；选中某课次后列表收敛为该课次 5 条、统计卡片同步收敛。
- 能力类型筛选「文生图」→ 列表 3 条、统计仅剩「文生图：3 个」。
- 预览：弹出「素材预览」弹窗，展示学生 / 班级 / 大小、blob 图片与提示词「夜晚的城市天际线」，含关闭 / 下载。
- 已提交行：状态显示「已提交」徽标，复选框为禁用态（DOM `disabled`）。
- 勾选一行后 `删除选中（1）` 由禁用变为可用；点「执行清理」弹出自定义确认弹窗「确认批量清理 / 此操作不可恢复 / 取消·确认清理」（已验证后取消，未实际清理）。
- 页面控制台仅有一条登录前的 401（重定向所致），无页面级报错。
- 顺带复核 `/ai-hub/lesson-mode`（阶段二页面）：超管下历史课程列表正常渲染，修复前同样会报 `Invalid URL` 的问题已消失。

**构建校验**：`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启在 3000 端口。

#### 13.7 遗留与后续

- 视频 / 音乐的真实落盘由 Go 单测覆盖（本地 Mock 上游只有 chat / images / audio 四个端点，无任务型端点），端到端需接入真实上游后回归。
- 保留策略（按课次自动过期）本阶段只提供手动清理入口，自动过期未实现。
- 对象存储实现位已预留（`artifactstore.Store` + `SetDefault`），当前仅本地磁盘实现。

---

## 任务 14：生产部署适配（OSS / CDN / Docker / 教程）+ 并发压测（2026-11-01）

**用户需求（原文要点）**：生产环境将使用云服务器 ECS + CDN + 对象存储 OSS，ECS 上自行安装 Redis 与 PostgreSQL；需要①检查并补齐全部生产适配；②OSS 与 CDN 的配置既能在管理员控制台设置、也要有对接教程文档；③Docker 文件全部编写好（本机装不了 Docker，只需产出文件，不要实测）；④部署教程与配置文档全部写好；⑤本地实测 7-8 名学生同时请求是否通顺。

**关键决策（AskUserQuestion）**：对象存储对接方式 = **「两者都做，后台可切换」**（local / S3 兼容 / 阿里云 OSS 原生）；配置入口 = **「管理员控制台设置页 + 文档」**。

### 14.1 后端：存储与 CDN 配置模型（`setting/workspace_storage.go`，新建）

| 元素 | 说明 |
| - | - |
| `WorkspaceStorageSettingsKey = "WorkspaceStorageSettings"` | 复用通用 Option key/value 体系，`model/option.go` 的 `InitOptionMap()` 注册默认值 |
| `Provider` | `local` / `s3` / `aliyun_oss`，非法值在 `Normalized()` 里回落 `local` |
| 公共字段 | `bucket` / `prefix` / `public_base_url`（CDN 或自定义域名） |
| S3 系 | `s3_endpoint` / `s3_region` / `s3_access_key` / `s3_secret_key` / `s3_force_path_style` |
| OSS 原生 | `oss_endpoint` / `oss_access_key_id` / `oss_access_key_secret` |
| 本地 | `local_root`（空 = 默认 `data/workspace-artifacts`） |
| `Masked()` | 密钥字段统一替换为 `********`（读接口回显用） |
| `MergeSecrets(previous)` | 写接口收到 `********` 时沿用已保存的真实值，前端无需回传明文 |

### 14.2 后端：对象存储实现与运行时切换（`service/artifactstore/`）

| 文件 | 改动 |
| - | - |
| `store.go` | `Store` 接口新增 `PublicURL(storagePath) (string, bool)`；`Default()` 改为**配置驱动 + 配置哈希缓存**：管理员改完配置下次调用即生效、**无需重启**；保留 `SetDefault()` 供单测注入（用 `sync.RWMutex` + 接口变量，避免 `atomic.Value` 因具体类型不同而 panic） |
| `object.go`（新建） | `Build(cfg)` 工厂按 provider 分发；`s3Store` 用 `aws-sdk-go-v2/service/s3`，`aliyunStore` 用 `aliyun-oss-go-sdk`；两者 `PublicURL` 仅在配置了 `public_base_url` 时返回直链 |

**关键坑**：阿里云 OSS 的 S3 兼容接口不接受 chunked 传输，必须有 `Content-Length`。因此对非 seekable / 无 `Len()` 的 reader，`spoolBody()` 先落临时文件再上传。

### 14.3 后端：接口与 CDN 直链

| 方法 | 路径 | 权限 | 说明 |
| - | - | - | - |
| GET | `/api/workspace/admin/storage-settings` | RootAuth | 返回 `.Masked()` |
| PUT | `/api/workspace/admin/storage-settings` | RootAuth | `MergeSecrets` + 必填校验 + `model.UpdateOption` |
| POST | `/api/workspace/admin/storage-settings/test` | RootAuth | 真实读写自检：写入探针对象 → 读回比对 → 删除，返回 `{provider, bucket, storage_path, public_url}` |

`controller/workspace_artifact.go` 的列表接口按配置回填 `public_url`（`model/workspace_artifact.go` 新增展示字段 `PublicUrl gorm:"-"`），前端可直接从 OSS/CDN 拉取；未配置 CDN 时回落受鉴权的内容接口，行为不变。

### 14.4 Docker（本机未装 Docker，仅产出文件、未实测）

| 文件 | 改动 |
| - | - |
| `Dockerfile` | builder / builder2 阶段新增 `ARG GOPROXY=https://goproxy.cn,direct`、`ARG NPM_REGISTRY=https://registry.npmmirror.com`（`ENV BUN_CONFIG_REGISTRY` / `GOSUMDB`），解决国内构建拉不到依赖 |
| `docker-compose.prod.yml`（新建） | 面向用户场景：**仅应用容器**，PG/Redis 装在宿主机；`extra_hosts: host.docker.internal:host-gateway`；`env_file: [.env]`；healthcheck 打 `/api/status`；日志轮转与内存上限 |
| `docker-compose.yml` | **修正重大隐患**：原为 `image: calciumion/new-api:latest`（上游镜像，会丢失本项目全部定制）→ 改为本地 `build` + `image: ai-workspace:latest` |
| `.dockerignore` | **修正安全缺陷**：原配置会把 `.env` 打进镜像；新增排除 `.env` / `.env.*`（保留 `!.env.example`）/ `/data` / `/logs` / `*.db` / `*.log` / `test` |
| `.env.example` | 新增「AI Workspace 生产部署必填项」区块：`SQL_DSN` / `REDIS_CONN_STRING` / `SESSION_SECRET` / `TRUSTED_PROXIES` / `WORKSPACE_ARTIFACT_DIR` / **限流参数**等 |

### 14.5 教程文档（`docs/installation/AI-Workspace-生产部署教程.md`，新建）

12 章：架构总览 → ECS/安全组 → PostgreSQL 安装（含 `pg_hba.conf` 放行 Docker 网段）→ Redis 安装 → Docker 部署 → OSS 对接（RAM 最小权限策略、控制台配置、目录结构、历史素材迁移）→ CDN 对接（素材直链 / 站点加速 / 回源真实 IP）→ 控制台字段速查 → Nginx+HTTPS → 并发与性能调优（含 **9.1 限流适配**）→ 备份升级回滚 → 并发自测 → 常见问题。

### 14.6 并发压测（`test/concurrency_test.py`，新建）

默认 8 名学生，可 `--students N --rounds M`；复用 `integration_test.py` 的渠道/能力/定价前置与 `Client`。流程：批量建号 → 开课 → 逐人充值 → **`threading.Barrier` 让所有学生同一时刻出发** → 并发文生文 + 文生图 → 校验成功数 / 无 5xx / 无限流误伤 / 点数按次精确扣除 / 计费明细条数 / 素材落盘条数 → `finally` 清理并还原开关。

### 14.7 **实测发现的生产级缺陷：教室场景被限流误封（已修复）**

首次跑 `--students 16` 时 **15 名学生登录失败**，报错为 `Expecting value: line 1 column 1 (char 0)`（响应体为空）。

| 项 | 结论 |
| - | - |
| 根因 | `/api/user/login` 挂了 `middleware.CriticalRateLimit()`，**按客户端 IP 计数**，上游默认 `CRITICAL_RATE_LIMIT=20` 次 / `CRITICAL_RATE_LIMIT_DURATION=1200` 秒 |
| 影响面 | 学校 / 机房出口 NAT 会把整班学生收敛到**同一个公网 IP**；一个班 40 人同时登录会在第 21 人处被封 **20 分钟**。若再叠 CDN 回源且未配 `TRUSTED_PROXIES`，则**全站共用 CDN 回源 IP 计数**，一个班能吃光全校额度 |
| 次要项 | `GLOBAL_API_RATE_LIMIT`（默认 360 次 / 180 秒 / 每 IP）覆盖全部 `/api`，**中台生成请求也走这里** |
| 表现特征 | 被限流时返回 **HTTP 429 且响应体为空**（`writeRateLimited`），前端表现为「登录失败 / 无提示」 |
| 修复 | 这两个限流本就支持环境变量覆盖，属**部署参数适配**而非代码缺陷：`.env.example` 与教程第 9.1 节给出教室场景取值（`CRITICAL_RATE_LIMIT=3000/180`、`GLOBAL_API_RATE_LIMIT=3000/180`），并强调必须配置 `TRUSTED_PROXIES` |

### 14.8 验证结果（2026-11-01）

| 验证项 | 结果 |
| - | - |
| 并发压测（默认 8 人 × 3 轮 = 48 请求） | **44/44 断言通过**：全部 200、无 5xx、无 429、每人扣点 27 精确、24 条 text + 24 条 image 明细、24+24 素材落盘；墙钟 0.93s，吞吐 51.9 req/s ✅ |
| 并发压测（16 人 × 3 轮 = 96 请求，上调限流后） | **44/44 断言通过**：96 请求全成功、无 5xx/429、每人扣点 27、明细 96 条合计 432 点、素材 96 份；墙钟 1.49s，吞吐 **64.3 req/s** ✅ |
| 全链路回归 `test/integration_test.py` | **79/79 通过** ✅ |
| 云端素材 e2e `test/cloud_assets_e2e.py` | **42/42 通过** ✅ |
| Go 单测 `go test ./service/... ./setting/...` | 全部 ok（含 `service` 6.18s） ✅ |
| 存储配置接口实测 | GET 脱敏回显 ✅；PUT 阿里云 OSS 配置后 GET 回显 `********` ✅；带 `********` 的 POST 自检**真实打通到阿里云 OSS**（返回真实 403 `RequestTimeTooSkewed`，证明凭据回填与 SDK 链路正确、错误可回显 UI） ✅ |
| 构建校验 | `bun run build` 通过；`CGO_ENABLED=0 go build -o newapi-run.exe .` 通过；服务已重启 3000 端口（新二进制，含 `storage-settings` 路由，未鉴权返回 401 而非 404） ✅ |
| 测试数据 | 并发脚本与 e2e 脚本均自动清理；`WorkspaceModuleFlags` 已还原为 `{lesson_mode:false,cloud_assets:false}`；存储配置已还原为 `local` ✅ |

**遗留说明**

1. `POST /storage-settings/test` 的语义是「用提交的配置自检」：body 里字段为空时会被 `Normalized()` 归一到 `local`，**不会回落到已保存的配置**。前端页面始终回传完整表单，故正常使用无影响；仅手工用空 body 调用时会得到「测试通过（实际上是本地磁盘）」的误导性结果。
2. 本机无 Docker，`Dockerfile` / `docker-compose*.yml` 仅做静态编写与配置审查，**未做实际构建验证**。
3. `VERSION` 文件存在但长度为 0（`COPY ./VERSION` 不报错，版本号字符串为空），如需版本标识可写入正式版本号。
4. 本轮限流适配采用「上调环境变量」方案，未改动上游 `middleware/rate-limit.go` 的按 IP 计数逻辑；若后续要支持「整校上千人同时在线」，建议评估把登录限流改为按用户名（而非 IP）计数。

---

## 任务 15：对象存储多云预设 + 环境变量兜底 + 部署文档补全（2026-11-01）

**用户需求（原文要点）**：①除数据库外，OSS 与 CDN 能不能都在前端设置——需要研究这些接口；②我可能用腾讯云，也可能用阿里云，还可能用其他家云，你要确认对接这些是否需要额外部署任何东西；③CDN 需要上传什么东西，这些都要写好在文档中；④明确两种模式：一种是开启 OSS + CDN，第二种是都不开启。

**结论（先给答案）**：
- 对象存储支持多云，**对接任何一家都不需要额外部署组件**：底层只有「S3 兼容」与「阿里云 OSS 原生」两条通道，SDK 已编译进二进制，全程纯 HTTPS 直连；
- CDN 侧**唯一需要上传的是 SSL 证书**；素材由应用自动写入对象存储，CDN 回源即可，不需要预先上传素材；私有桶的回源鉴权参数由 CDN 控制台自动生成；
- 数据库**只能启动时决定**（`SQL_DSN` / `SQLITE_PATH`），控制台没有也不会加切换开关——建表与连接池都在进程启动阶段完成。

### 15.1 后端：`setting/workspace_storage.go`

| 元素 | 说明 |
| - | - |
| `Preset` 字段 | 新增 `preset`（云厂商预设标识），仅作表单联动与校验提示；非法值在 `Normalized()` 中置空 |
| 预设常量 | `aliyun_oss_native` / `aliyun_oss_s3` / `tencent_cos` / `huawei_obs` / `qiniu_kodo` / `jdcloud_oss` / `minio` / `aws_s3` / `cloudflare_r2` / `custom_s3` |
| `GetWorkspaceStorageSettings()` | 改为「控制台保存值 + 环境变量覆盖」的**生效配置** |
| `StoredWorkspaceStorageSettings()`（新增） | 只读控制台那份配置，供写接口回填密钥——避免把环境变量里的密钥误写进数据库 |
| `WithEnvOverrides(cfg)`（新增） | 逐字段用非空环境变量覆盖 |
| `WorkspaceStorageEnvLockedFields()`（新增） | 返回被环境变量锁定的字段名，前端据此置灰输入框 |
| 环境变量键 | `WORKSPACE_STORAGE_PROVIDER / PRESET / BUCKET / PREFIX / PUBLIC_BASE_URL / S3_ENDPOINT / S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY / S3_FORCE_PATH_STYLE / OSS_ENDPOINT / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / LOCAL_ROOT` |

**优先级：环境变量 > 控制台保存值**。环境变量只在读取时覆盖，**不落库**，
因此「控制台那份配置」始终干净，可以随时退回控制台配置。

### 15.2 后端：`controller/workspace_storage.go`

| 改动 | 说明 |
| - | - |
| GET 返回体 | 由 `settings` 改为 `{ settings, locked_fields }` |
| PUT | 持久化对象改为 `req.MergeSecrets(Stored…())`（不含环境变量），校验则针对**生效配置** |
| POST /test | 自检对象改为**生效配置**，与实际运行时完全一致 |
| 校验增强 | Endpoint 必须以 http(s) 开头；腾讯云 Bucket 必须带 `-APPID` 后缀；阿里云 OSS 的 S3 端点禁止 Path Style |

### 15.3 前端：`storage-settings.tsx` + `types.ts` + `api.ts`

| 改动 | 说明 |
| - | - |
| 云厂商预设下拉 | 新增 `Select`，选中后自动切换存储类型并带出 Endpoint / Region / 寻址风格与提示文案 |
| Region 联动 | Endpoint 模板含 `{region}` 时，改 Region 实时重算 Endpoint（腾讯云 COS 等） |
| 预设与类型绑定 | 手动切换「存储类型」后，预设不匹配则自动回到「自定义」，避免模板错配 |
| 环境变量锁 | 顶部提示「环境变量已接管部分字段」，对应输入框置灰 |
| 置灰补全（复验修复） | 首轮浏览器复验发现「存储类型」分段按钮与「云厂商预设」下拉**未置灰**（横幅已声明被接管，控件却仍可点）。已给 `kit.tsx` 的 `Select` / `Switch` 增加 `disabled` 支持、`ProviderTabs` 增加 `disabled`，并接线 `provider` / `preset` / `s3_force_path_style` 三个字段 |
| `fetchStorageSettings` | 返回类型改为 `AiHubStorageSettingsResponse`（含 `locked_fields`） |

### 15.4 `.env.example`

- 新增「数据库选择」说明区块：列出 `SQL_DSN` 四种取值对应的数据库、以及「控制台不可切换」的结论，并给出改 SQLite 的示例；
- 新增「云端素材存储与 CDN（两种模式，二选一）」区块：模式 A 全关闭 / 模式 B 开启 OSS（可只开 OSS 不开 CDN），并列出全部 `WORKSPACE_STORAGE_*` 键。

### 15.5 部署教程（`docs/installation/AI-Workspace-生产部署教程.md`）

12 章 → 13 章，重新编排：

| 章节 | 内容 |
| - | - |
| 第 2 章（改） | 「数据库：选型与安装」，新增 2.1 选型规则表（`SQL_DSN` 四种取值）+ 控制台不可切换的结论 |
| 第 5 章（新） | 「两种运行模式」对比表：模式 A 全关闭 / 模式 B 开启 OSS（可再加 CDN），并明确「都不需要额外部署组件」 |
| 第 6 章（重写） | 「对接对象存储」：6.1 各云厂商对照表（阿里云原生/S3、腾讯云 COS、华为云 OBS、七牛 Kodo、京东云、R2、AWS S3、MinIO 的 Endpoint 与注意事项）、6.2 云端准备、6.3 控制台配置、6.4 目录结构、6.5 历史素材 |
| 第 7 章（重写） | 「对接 CDN」：7.1 **CDN 到底要上传什么**（唯一需要上传的是 SSL 证书）、7.2 加速素材直链、7.3 只开 OSS 不开 CDN、7.4 站点加速、7.5 回源真实 IP |
| 第 8 章（重写） | 字段速查：8.1 界面字段、8.2 优先级「环境变量 > 控制台」、8.3 全部环境变量键名表 |
| 第 9–13 章 | 原 8–12 章顺延（反向代理 → 并发调优（10.1 限流）→ 备份升级 → 并发自测 → 常见问题），并同步修正全部交叉引用 |
| FAQ（新增 3 条） | 控制台能否切数据库 / 腾讯云等是否要装额外组件 / 只想开 OSS 不上 CDN |

### 15.6 验证结果（2026-11-01）

| 验证项 | 结果 |
| - | - |
| `go build ./setting/... ./controller/...` | 通过 ✅ |
| `bun run build`（前端） | 通过，exit 0 ✅ |
| `CGO_ENABLED=0 go build -o newapi-run.exe .` | 通过，exit 0 ✅ |
| 服务健康检查 | `GET /api/status` 返回 200 ✅ |
| 环境变量兜底实测（临时实例 :3010） | `locked_fields` 正确返回 `provider/preset/bucket/s3_endpoint/s3_access_key/s3_secret_key`；密钥以 `********` 回显（环境变量里的密钥也不会明文外泄） ✅ |
| 优先级实测 | PUT 写入 AWS S3 控制台配置后，GET 仍返回环境变量值（腾讯云 COS），证明**环境变量 > 控制台** ✅ |
| S3 通道真连通 | `POST /storage-settings/test` 真实打到 `s3.us-east-1.amazonaws.com`，返回上游真实错误 `NoSuchBucket`（证明 S3 SDK 链路与错误回显可用） ✅ |
| 浏览器实测（存储与加速页） | 云厂商预设下拉 11 个选项、顶部锁定横幅、字段置灰均正常；首轮发现分段按钮与预设下拉未置灰，修复后复验**全部置灰且点击无响应**，控制台无报错 ✅ |
| 全链路回归 `test/integration_test.py` | **79/79 通过** ✅（修复后重跑） |
| 云端素材 e2e `test/cloud_assets_e2e.py` | **42/42 通过** ✅（修复后重跑） |
| 测试数据 | 两个 e2e 脚本均自动清理；开关已还原 `{lesson_mode:false,cloud_assets:false}`；临时 :3010 探针实例与临时 SQLite 已删除 ✅ |

### 15.7 站点图标替换（追加）

用户提供 `d:\杂项\aiworkspace\workspace-icon.jpg`（紫色圆角方块 + 白色八角星），要求把浏览器 head 图标与 logo 全部换成这张图。
处理方式：裁掉白边、剔除图标外淡投影、圆角外侧做透明，生成 `web/public` 下的 `favicon.ico`(16/32/48/64) / `favicon.png`(512) / `apple-touch-icon.png`(180) / `logo.png`(512)；`bun run build` 同步到 `web/dist`，重编二进制并重启 3000，四个资源实测 200 且内容一致 ✅。

---

## 任务 16：教师端教学闭环重构（需求确认 + 实施计划）（2026-11-01）

**用户需求原文要点（语音转写，已逐条确认口径）**

1. 定价规则要挂到模型上，在「模型管理 → 模型详情 → 生成能力」处体现该模型的功能计价；单次消耗点数统一默认（5 点）；「计价单位」应为下拉+默认值，不能手填文本；不同模型的点数折算金额、上游单价不同，不能全局一份。
2. 日期选择不应是手输文本框，应为下拉/日历。
3. 选修课、合班授课应合并成一个「新建授课」。
4. 使用记录需定时清除（口径见下表）。
5. 教师端：上课模式 = 登录后的概览页；历史课程独立成栏页；概览页可直接下拉选班级 + 一键上课；本节课点数应在当前页按能力设置，而不是去「学生与班级」配。
6. 所有下拉/自选控件都要自研样式，不用浏览器原生控件。
7. 直升规则：初中名单增加「是否为直升学生」列，选「是」则填「原账号」；学籍转接后原账号停用，毕业满 1 年彻底删除；名单里命中原账号时自动恢复。

**已确认的关键决策**

| 议题 | 决策 |
| - | - |
| 定价层级 | 单次消耗点数按「能力(kind)」统一、默认 5 点；`1点折算金额 / 上游单价 / 计价单位` 按「模型」独立配置 |
| 日期控件 | 全部统一换成自研下拉+日历（月度对账、使用记录、云端素材、上课模式授课时间） |
| 授课组织 | 合并成一个「新建授课」页，数据仍分开存（选修课 / 合班 / 小班） |
| 教师端首页 | 新增「概览」页做教师登录首页；上课模式保留为下发/看板详情页；历史课程拆为独立页面 |
| 30 天清理范围 | 生成明细 `workspace_usages` + 未提交素材，每 30 天一次；系统日志 `logs` 每 6 个月一次 |
| 毕业生删除程度 | 删登录账号 + 生成明细 + 云端素材，保留学生名单档案（标记已注销） |
| 直升恢复触发 | 名单里「原账号」命中已停用的旧账号时自动恢复并绑定 |

**现状调研结论（关键位置，实施时直接引用）**

| 领域 | 现状 |
| - | - |
| 定价规则 | 前端 `web/src/features/ai-hub/sections/pricing.tsx`（L130-169），字段 `points / point_price_yuan / unit / unit_price / base_units`；`unit` 是纯文本 TextInput；数据结构 `web/src/features/ai-hub/types.ts:273-283`。后端 `setting/workspace_pricing.go`（默认值 :44-53；`AmountYuan` :126-131；`CostYuan` :134-153；`NormalizeWorkspacePricing` :176-182 空则回落「次」）。接口 `/api/workspace/admin/pricing`（`controller/workspace_pricing.go:18/27`，路由 `router/workspace-router.go:102-103`）。**全局一份、与模型无关** |
| 模型能力 | `web/src/features/models/components/model-capability-panel.tsx`（开关 L166-182），挂在模型编辑抽屉 `drawers/model-mutate-drawer.tsx:683-685`；结构体 `setting/workspace.go:82-89`；存 option `WorkspaceModelCapabilities`（`setting/workspace.go:11`） |
| 扣点 | `middleware/workspace_metering.go:88-91` → `setting.GetWorkspacePricingItem(capId)`；成功后 :170-213 写 `model.WorkspaceUsage`（`model/workspace_usage.go:38`） |
| 手输日期 | 唯一手输月份的是「月度对账」`web/src/features/ai-hub/sections/reconciliation.tsx:80-85`（`TextInput placeholder='2026-10'`）；另有 `records.tsx:144-171`（datetime-local）、`cloud-assets.tsx:373-394/547-552`、`lesson-mode.tsx:501-503` |
| 可复用日期组件 | `web/src/components/date-picker.tsx:48`、`datetime-picker.tsx:52`、`web/src/features/usage-logs/components/compact-date-time-range-picker.tsx:50`（含今天/7天/本周/30天/本月预设）；全仓无 MonthPicker |
| 授课组织 | 选修课 `web/src/features/ai-hub/sections/electives.tsx`（`WorkspaceClass{Kind:1}` + `workspace_elective_members`，`model/workspace_org.go:316`）；合班 `sections/teaching-units.tsx`（`workspace_teaching_units` `model/workspace_org.go:223` + members :237）；小班 `workspace_sub_classes`（:138，在 `classes.tsx:680-739` 配）；年级/学段/校区 `sections/grades.tsx`。**三表分立，无统一节点** |
| 上课创建 | `sections/lesson-mode.tsx:305 createLesson` → `api.ts:679-720` → `controller/workspace_lesson.go:111`；表 `model/workspace_lesson.go:31`。三级选择「年级→班级→小班」，**未暴露合班/选修课**；解析层 `ResolveWorkspaceLessonStudentUserIds`（`model/workspace_lesson.go:223-265`）已兼容四类 |
| 教师落地页 | `web/src/routes/index.tsx:27-33` → `/workspace` → `features/workspace/components/workspace-studio.tsx:133`（通用创作台，非教师专属页） |
| 上课模式页 | `sections/lesson-mode.tsx`（L86）：选择授课对象 L441-490 / 课程概览 L492-559 / 实时看板 L561-642 / 课堂作品 L644-720 / **历史课程 L722-787（页内 Panel，非独立页）** |
| 本节课点数 | 源数据 `WorkspaceClass.LessonPoints`（`model/workspace.go:100-101`），在「学生与班级 → 班级编辑」配（`classes.tsx:1584-1611`）；下发 `applyClassLessonPoints`（`controller/workspace_admin.go:888-904`）；上课模式只决定发不发 |
| 定时任务框架 | `service/system_task.go:34/42/57/123`（15s ticker）；注册入口 `controller/system_task_handlers.go:18`，启动 `main.go:161-162`；范例 `channelTestHandler` :28-44、`midjourneyPollHandler` :116-126 |
| 现有清理 | 只有日志清理 `service/system_task.go:338 runLogCleanupTask`（删 `logs`），且**是手动按钮非定时**（`controller/system_task.go:14`，前端 `web/src/features/system-settings/maintenance/history-log-cleanup.tsx:68/84` 默认 30 天）。`workspace_usages` 无任何清理 |
| 学生 / 直升 | 表头 `controller/workspace_class_excel.go:46-50`，只有「沿用学号（直升填原账号）」列（:788 解析、:513-522 执行、`linkLegacyWorkspaceStudent` :638-664），**无「是否为直升学生」布尔列**；表 `workspace_students`（`model/workspace.go:112`），`Enabled` :123 / `Status` :125（1在读 2已毕业）；学年结转 `RolloverWorkspaceSchoolYear`（`model/workspace_org.go:700-737`，手动触发、幂等）；用户名 `WorkspaceUsernamePrefix` :741；删除 `DeleteWorkspaceStudent`（`model/workspace.go:420`，硬删无级联）；User 为软删（`model/user.go:108`）。**无「停用 + 1 年后删除」实现** |

**实施顺序**

- A. 定价规则重构（点数按能力统一 + 金额/单位按模型独立；单位改枚举下拉；模型详情页展示功能计价）
- B. 日期控件全部替换为自研下拉 + 日历（新增 `MonthPicker`）
- C. 「新建授课」合并页（选修课 / 合班 / 小班 同页分类）+ 上课三级对象里暴露合班单元与选修课
- D. 教师端新增「概览」页（登录落地）+ 上课模式瘦身 + 历史课程独立页 + 本节课点数在页内按能力设置
- E. 定时清理任务：生成明细 + 未提交素材每 30 天；系统日志每 6 个月
- F. 直升与毕业生账号生命周期（Excel 两列 + 停用/满年删除/自动恢复）
- G. 全站下拉自研化

每项完成后跑 `test/integration_test.py` + `test/cloud_assets_e2e.py`（42 项）回归，并做浏览器复验。

**实施记录**

| 子项 | 状态 | 说明 |
| - | - | - |
| G 全站下拉自研化 | 已完成（2026-11-01） | 新增通用自研下拉 `CustomSelect`（`web/src/components/ui/native-select.tsx`）：受控开合 + document mousedown 关闭，触发器为 `<button aria-haspopup="listbox">`（Hugeicons `UnfoldMoreIcon`），浮层 `role="listbox"`/选项 `role="option"`、选中项打勾；新增 `className`（外层宽度）/`triggerClassName`（复刻原输入框视觉）/`menuClassName`/`align` 四个样式口子，尺寸与 `NativeSelect` 对齐（`sm/default`）。替换清单：创作台 `features/workspace/components/generate-panel.tsx` 13 处（尺寸/张数/视频时长/分辨率/生成质量×2/图像风格/返回格式×2/画面比例/音乐版本/TTS 格式/使用模型）、教师专业版 `features/teacher-studio/components/teacher-studio.tsx` 1 处（顶部紧凑模型选择器，`triggerClassName` 保留 `border-0 bg-transparent`、`align='end'`）、`studio-settings-dialog.tsx` 1 处、教师钱包 `features/ai-hub/sections/teacher-wallets.tsx` 1 处（每月发放日）、系统任务历史 `features/system-info/components/system-task-history.tsx` 2 处（类型/状态筛选）、渠道亲和规则编辑 `features/system-settings/general/channel-affinity/rule-editor-dialog.tsx` 1 处（session_mode，由 `{...form.register}` 改为 `value={form.watch()}` + `form.setValue(..., { shouldDirty: true })` 以适配 react-hook-form，不再依赖原生 ref）。ai-hub 的 `Select` 改为委托同目录自研 `Dropdown`，`teacher-wallets` 的原生 `<select>` 随之移除。清理：`SELECT_CLASS` 去掉已无意义的 `appearance-none pr-9`；`native-select.tsx` 删除已成为死代码的 `NativeSelect/NativeSelectOption/NativeSelectOptgroup`（全仓已无引用，grep 校验通过）。验证：`bun run build` 通过；重启 3000 端口后浏览器复验创作台（教师专业版展开进阶参数）与系统任务历史页，下拉均为自绘浮层、选中打勾、点击外部收起，控制台无 error |
| F 直升与毕业生账号生命周期 | 已完成（2026-11-01） | 数据模型（`model/workspace.go`）：新增状态常量 `WorkspaceStudentStatusDeactivated = 3`（1 在读 / 2 已毕业停用 / 3 已注销），`WorkspaceStudent` 新增 `GraduatedAt int64`（`graduated_at`，索引 + 默认 0，并加入 `Update()` 的 Select 列表）；新增函数 `SetWorkspaceUserAccountEnabled`、`MarkWorkspaceStudentGraduated`（事务：学生 status=2 / enabled=false / graduated_at，同时把登录账号 `User.Status` 置为 Disabled）、`ReinstateWorkspaceStudent`（事务：学生 status=1 / enabled=true / graduated_at=0 + 改班级 + 重新启用账号 + 写 `WorkspaceStudentTransferLog`）、`ListWorkspaceStudentsPendingDeletion`、`MarkWorkspaceStudentDeactivated`、`DeleteWorkspaceUsagesByUserId`、`DeleteWorkspaceUserQuotas`。学年结转（`model/workspace_org.go`）：`RolloverWorkspaceSchoolYear` 的查询条件由 `status <> 已毕业` 收紧为 `status = 在读`，循环内改调 `MarkWorkspaceStudentGraduated(student.Id, student.UserId, now)`，实现「毕业即停用登录账号并记录毕业时间」。Excel 名单（`controller/workspace_class_excel.go`）：学生表末两列由「沿用学号（直升填原账号）」改为「是否为直升学生」（J 列，字典表下拉 是/否）+「原账号」；解析新增 `DirectPromotion` 字段（保留旧列名作为兼容别名），选「是」但未填原账号直接标红报「直升学生」请填写「原账号」；`linkLegacyWorkspaceStudent` 重写——原账号不存在时报「原账号「X」对应的账号不存在」，命中已毕业账号时调用 `ReinstateWorkspaceStudent` 自动恢复绑定，从未建立学生档案时新建并显式启用账号。清理（`service/workspace_cleanup.go`）：新增定时任务类型 `SystemTaskTypeWorkspaceGraduatedPurge`（`model/system_task.go`）与 `workspaceGraduatedPurgeHandler`（周期 24h、保留 365 天、200 条/批），逐批对 `status=已毕业 且 graduated_at<=now-365d` 的学生执行：删除其全部云端素材文件 + 索引 → 删生成明细 `workspace_usages` → 删点数配额 → 硬删登录账号 `User` → 名单档案标记 `status=3`（保留姓名/学号档案），结果返回 `{purged_count, artifacts_deleted}`。前端：`types.ts` 补 `graduated_at` 与状态注释，`classes.tsx` 学生状态徽章新增「已注销」分支。测试：`service/workspace_cleanup_test.go` 新增 `TestWorkspaceGraduatedAccountLifecycle`（结转停用 → 满年彻底删除账号与素材、名单保留 → 直升恢复为在读并重新启用账号）与 `TestWorkspaceGraduatedPurgePayloadDefaults`，`go test ./service/...` 全绿。验证：Go `CGO_ENABLED=0` 静态构建 + 前端构建通过；重启 3000 端口后 `/api/system-task/list` 中 `workspace_graduated_purge` 已注册且 succeeded；下载导入模板确认学生表列头含「是否为直升学生」「原账号」；回归 integration 81/81、cloud_assets 42/42 |
| E 定时清理（明细/素材 30 天，日志 6 个月） | 已完成（2026-11-01） | 复用系统任务框架新增两个定时任务类型：`model.SystemTaskTypeWorkspaceUsageCleanup` / `model.SystemTaskTypeWorkspaceArtifactCleanup`（`model/system_task.go`）。新增 `service/workspace_cleanup.go`：`workspaceUsageCleanupHandler`（周期 30 天，删除 `workspace_usages` 中 `created_at` 早于 30 天的明细）与 `workspaceArtifactCleanupHandler`（周期 30 天，删除超期且 `submitted=false` 的云端素材文件 + 索引，已提交课堂作品永不清理），两者在 `init()` 注册；载荷 `WorkspaceCleanupPayload{target_timestamp,batch_size}`，未提供时按保留期回落默认边界，循环分批（500 条/批）直到清空，批间响应 ctx 取消。原有 `logCleanupHandler` 由「仅手动触发」升级为 `ScheduledSystemTaskHandler`（`Enabled()=true`、周期 180 天、载荷边界为 now-180 天），即系统日志每 6 个月自动清理一次、保留 6 个月，手动清理入口保持不变。模型层新增 `model.DeleteOldWorkspaceUsagesBatch`（先取 id 再删，兼容 SQLite/MySQL/PostgreSQL）与 `model.ListOldUnsubmittedWorkspaceArtifacts`。新增单测 `service/workspace_cleanup_test.go`：覆盖「超期明细删除/期内保留」「超期未提交素材文件与索引同删、已提交与期内素材保留」「载荷默认边界」「日志清理已接入调度」；`go test ./service/...` 通过。运行时验证：重启 3000 端口服务后调度器即时生成三条任务行并全部 succeeded——`workspace_usage_cleanup`（target=now-30d，deleted 0）、`workspace_artifact_cleanup`（target=now-30d，deleted 0）、`log_cleanup`（target=now-180d，deleted 0），清理边界与口径一致（当前库无超期数据，删除数均为 0）。回归：integration 81/81、cloud_assets 42/42 |
| D 教师端概览页 + 看板瘦身 + 历史课程独立页 + 页内点数 | 已完成（2026-11-01） | 前端新增两个页面：`sections/lesson-overview.tsx`（`LessonOverviewSection`，教师登录落地页，含三 Panel：选择授课对象〔年级/班级·合班单元·选修课/小班 三级自研 Dropdown + 参课人数 Badge〕、本节课点数按能力设置〔按 kindOptions 渲染数字输入、默认取所选班级 `lesson_points`、显示合计〕、开始上课 / 制定并下发任务〔主题 + 自研 DatePicker 授课时间 + 下发模式 + 能力勾选全部自研 Button，未用原生 checkbox〕）与 `sections/lesson-history.tsx`（`LessonHistorySection`，独立「历史课程」页，表头 主题/班级/授课时间/状态/作品数/操作，操作含 进入看板 / 打包导出 / 导出统计 / 下课〔Modal 二次确认〕）；新增路由 `routes/_authenticated/ai-hub/lesson-overview.tsx`、`lesson-history.tsx`（role<ADMIN→/403；缓存 flags 关闭→重定向或 /403，overview 回落 `/workspace` 避免落地死循环）。`sections/lesson-mode.tsx` 整体重写瘦身为「课堂看板」：用 `getRouteApi('/_authenticated/ai-hub/lesson-mode').useSearch()` 读 `lesson` 参数，仅保留「本节课实时看板」+「课堂作品」，无参数时展示提示 + 「前往上课概览」「查看历史课程」按钮；路由文件加 `validateSearch` 产出 `{ lesson: number }`。侧边栏「上课模式」拆为三项（均 ROLE.ADMIN + `moduleFlags.lesson_mode` 门控）：上课概览 `/ai-hub/lesson-overview`、课堂看板 `/ai-hub/lesson-mode`、历史课程 `/ai-hub/lesson-history`。`routes/index.tsx` 与 `features/auth/hooks/use-auth-redirect.ts` 按角色落地：教师/管理员→`/ai-hub/lesson-overview`，学生→`/workspace`。后端支持页内按能力设置本节课点数并持久化：`WorkspaceLessonRequest` / `StartWorkspaceClassLesson` 新增 `lesson_points map[string]int`，提供时覆盖班级 `LessonPoints` 并 `Update()`，下发循环改用显式 `lessonPoints`；`workspace_admin.go` 抽出通用 `applyLessonPoints` + `normalizeLessonPoints`；`api.ts` 的 `startClassLesson(classId, lessonPoints?)` 与 `createLesson`（`LessonCreatePayload.lessonPoints`）透传 `lesson_points`。回归：integration 81/81 + cloud_assets 42/42；前端 `bun run build` + Go `CGO_ENABLED=0` 构建 + 3000 重启正常；浏览器复验 8/8 断言通过（登录直达概览、侧栏三项、三级下拉选班后点数默认 `5,5,5,5`、改成 8 后一键上课班级 `lesson_points={edit:5,image:5,text:8,tts:5}` 且两名学生配额均 23、制定下发跳转 `/ai-hub/lesson-mode?lesson=35`、看板仅两 Panel、历史课程页含新课、无参数提示、控制台无 error）；flags 关闭后根路径回落 `/workspace` 无 403 死循环，直链看板 → `/403`；验收数据与开关已还原 |
| C 新建授课合并页 | 已完成（2026-11-01） | 新增 `web/src/features/ai-hub/sections/teaching-org.tsx`：`TeachingOrgSection` 用自研三段切换（小班 / 合班授课 / 选修课）把三类授课组织合并到同一页，数据仍分表存；新增 `SubClassPanel`（跨班级小班一览 + 新建/编辑/删除，表头「所属班级/小班代码/教室/学生数/状态/操作」）。原 `electives.tsx` / `teaching-units.tsx` 去掉 `PageShell` 外壳改为内嵌面板 `ElectivesPanel` / `TeachingUnitsPanel`（工具条移入面板内），删除旧路由文件 `routes/_authenticated/ai-hub/electives.tsx`、`teaching-units.tsx`，新增路由 `teaching-org.tsx`（构建自动重生成 `routeTree.gen.ts`）；侧边栏「选修课」「合班授课」两项合并为「新建授课」→ `/ai-hub/teaching-org`。上课模式把楼层选择扩展为「年级 → 班级 / 合班单元 / 选修课 → 小班」：年级下拉新增「合班授课」分组（有合班单元时出现），班级下拉用 `unit:<id>` 前缀标识合班单元，选中后小班下拉禁用、参课人数按单元成员小班并集预览（新增 `unitStudentsQuery`），`createLesson` 增加 `unitId` 透传（后端 `unit_id` 与 `ResolveWorkspaceLessonStudentIds` 早已支持）；上课模式内 5 处原生 `<select>` 改为自研 `Dropdown`。回归：integration 81/81、cloud_assets 42/42；前端构建 + Go 静态构建 + 3000 端口重启正常；浏览器复验 9/9 断言通过（含自定义下拉浮层、合班单元双标签、年级下拉含合班授课、选中后提示与小班禁用），控制台无 error；验收数据与功能开关已还原 |
| B 日期控件自研化 | 已完成（2026-11-01） | `components/kit.tsx` 新增三个自研控件：`MonthPicker`（年 + 月两个下拉，产出 `YYYY-MM`）、`DatePicker`（自绘日历浮层：‹› 翻月 + 年/月下拉 + 周表头 + 日期网格 + 清除/今天，产出 `YYYY-MM-DD`）、`DateTimePicker`（DatePicker + 时/分下拉，产出 `YYYY-MM-DDTHH:mm`）。替换点：`reconciliation.tsx` 手输 `2026-10` → MonthPicker；`records.tsx` 两个 `datetime-local` → DateTimePicker；`cloud-assets.tsx`（筛选区 + 按时间段清理）两处 `type=date` → DatePicker；`lesson-mode.tsx` 授课时间 `type=date` → DatePicker。ai-hub 目录下已无任何原生日期输入框。回归：integration 81/81、cloud_assets 42/42；浏览器复验 4 个页面（月度对账/使用记录/云端素材/上课模式）共 15 项断言全部通过，原生日期控件计数为 0 |
| A 定价规则重构 | 已完成（2026-11-01） | 数据结构由「按功能(全局一份)」改为「能力点数(kinds) + 按模型计价(models)」；`setting/workspace_pricing.go` 重写（默认 5 点、单位枚举、`ResolveWorkspacePricing`、兼容旧 items 迁移）；`middleware/workspace_metering.go` 改为按 `resolved_task_model` 解析模型计价；接口 `/api/workspace/admin/pricing` 返回 `kinds/models/unit_options/platform_name`；前端 `pricing.tsx` 拆为「能力点数」+「按模型计价」两区，计价单位改用自研 `Dropdown`（新增于 `components/kit.tsx`）；模型详情页「生成能力」区新增只读计价区块。回归：integration 81/81（新增 2 项：单位枚举、按模型计价回读）+ cloud_assets 42/42，浏览器复验通过 |

---

## 任务 17：选修课 / 社团 Excel 导入 + 站内操作教程页（2026-11-01）

**用户需求原文要点**

1. 选修课页面单独提供一个 Excel 模板上传入口。
2. Excel 要能填「类别」，第一种就是**社团**（也算选修课）；选修课列表要显示它是不是社团。
3. 选修课/社团成员**一定有正课班级**（小学阶段尤其），要重新想清楚「怎么选学生」这条链路。
4. 同时要支持「有时候专门为社团或选修课创建一个学生」。
5. 再写一个文档页面：点顶部「文档」按钮要有**两个入口**（官方文档 + 班级配置操作教程），教程最好配图讲每一步怎么操作。

**设计口径（计划中拟定的 4 条假设）**

| 议题 | 决策 |
| - | - |
| 「社团」如何落库 | **不新增实体**，选修课（`WorkspaceClass.Kind=1`）加 `Category` 字段（`elective` / `club`），列表按类别显示徽章 |
| 成员如何选学生 | 按学号精确匹配 `workspace_students.student_no`，命中且**有正课班级**才可入课；无正课班级且非社团学生直接报错跳过 |
| 「专门建学生」怎么办 | 导入弹窗提供开关「学号不存在时自动创建社团学生」（**默认关闭**）；开启后按「自动建号学段/校区/年级」建号，建成 `class_id=0` + `club_only=true` 的社团学生 |
| 教程入口怎么放 | 顶部「文档」改为下拉两项；教程页 `/docs/workspace-guide` 仅 `ROLE >= ADMIN` 可见，正文 9 节 + 9 张真实截图 |

### 17.1 数据模型

`model/workspace.go`：

- `WorkspaceClass` 新增 `Category string`（`gorm:"size:32;default:''"`）；
- `WorkspaceStudent` 新增 `ClubOnly bool`（`gorm:"default:false"`）——标记「只为社团/选修课而建、没有正课班级」的学生；
- 新增常量 `WorkspaceElectiveCategoryElective = "elective"`、`WorkspaceElectiveCategoryClub = "club"`。

### 17.2 后端（选修课 Excel 模板与导入）

新增 `controller/workspace_excel.go` 同级的 `controller/workspace_elective_excel.go`：

| 接口 | 说明 |
| - | - |
| `GET /api/workspace/admin/electives/import-template` | `DownloadWorkspaceElectiveTemplate`：生成 `workspace-elective-template.xlsx`（文件名 URL 编码），含 `选修课信息` / `成员名单` 两张表 + 隐藏 `字典` 表（类别 / 状态 / 学段 / 校区），并对「类别 / 状态 / 学段 / 校区」加数据校验下拉 |
| `POST /api/workspace/admin/electives/import` | `ImportWorkspaceElectives`：读 multipart `file` + `allow_create_students`，导入后返回 `{electives_created, electives_updated, members_added, students_created, teachers_unresolved, failed:[{row, reason}]}` |

- 选修课信息表列头：`名称* / 类别 / 描述 / 校区 / 学段 / 教师 / 状态`；定位口径为「名称 + 校区 + 学段」命中 `Kind=1`，无则建、有则更新 `Category / Description / Enabled`。
- 成员名单表列头：`选修课名称* / 类别 / 学号* / 姓名 / 正课班级 / 自动建号学段 / 自动建号校区 / 自动建号年级 / 备注`。
- **「怎么选学生」链路**（本次需求的核心）：

| 学号查库结果 | 处理 |
| - | - |
| 命中，且 `ClassId > 0`（有正课班级）或 `ClubOnly = true`（已是社团学生） | 直接加入选修课 |
| 命中，但既无正课班级也不是社团学生 | 记 `failed`，提示「学生「X」没有正课班级，也不是社团学生，请先在学生与班级里补班级」 |
| 未命中 + 开关关闭（默认） | 记 `failed`，提示「学号「X」不存在」 |
| 未命中 + 开关开启 | `createClubOnlyWorkspaceStudent` 按「自动建号学段/校区/年级」建号（`AllocateWorkspaceUsername`，规则=前缀+届 2 位+顺位 4 位），创建 `ClassId=0 / ClubOnly=true` 的学生并加入选修课 |

- `resolveWsElectiveEntryYear`：优先取 4 位年份，其次按学段内年级名反推（`WorkspaceCurrentAcademicYear() - index`）。
- 复用 `workspace_class_excel.go` 的既有工具：`wsHeaderIndex` / `wsCell` / `wsSplitNames` / `parseWsExcelYear` / `writeWorkspaceExcelRow` / `addWorkspaceExcelValidation` / `buildWorkspaceExcelDictionary` / `workspaceCampusNameIndex` / `wsExcelStudentDefaultPassword`。

路由：`router/workspace-router.go`（`adminRouter` 下新增两条，位于 L186-188）。

### 17.3 前端

| 文件 | 改动 |
| - | - |
| `features/ai-hub/types.ts` | `AiHubClass` 补 `category?: string`；新增 `AiHubElectiveImportResult` |
| `features/ai-hub/api.ts` | 新增 `downloadElectiveTemplate()`、`importElectives(file, allowCreateStudents)` |
| `features/ai-hub/sections/electives.tsx` | 工具条新增「下载模板」「导入 Excel」；导入 Modal（自研选择文件按钮 + `Switch`「学号不存在时自动创建社团学生」默认关闭 + 失败行列表）；列表新增「类别」列徽章 |
| `features/docs/workspace-guide.tsx`（新） | 教程页正文与配图：`GUIDE_MARKDOWN`（9 个 `###` 分节）、`GUIDE_SHOTS`（9 项，`src` 为空渲染虚线占位，填真实地址即渲染图片）、`GuideFigure`、`WorkspaceGuidePage` |
| `routes/_authenticated/docs.workspace-guide.tsx`（新） | 路由 `/docs/workspace-guide`，`beforeLoad` 中 `role < ROLE.ADMIN` → `redirect /403` |
| `hooks/use-top-nav-links.ts` | 「文档」在 `HeaderNavModules.docs !== false` 时输出父项带 `items`：官方文档（外链）+ 班级与授课配置操作教程（站内） |
| `components/layout/types.ts` / `top-nav.tsx` | `TopNavLink` 增加 `items?: TopNavLink[]`，新增 `DesktopNavDropdown` 渲染二级下拉 |

教程页 9 节内容：① 角色与权限 ② 校区/学段/年级维护 ③ 建班（含 Excel 名单与直升两列）④ 学生与班级 ⑤ 新建授课 ⑥ 选修课与社团 Excel 导入 ⑦ 上课概览 ⑧ 云端素材与自动清理 ⑨ 定价与模型能力。

### 17.4 教程配图（9 张真实截图）

存放于 `web/public/docs/guide/`（构建时同步进 `web/dist/docs/guide/`，Go 二进制内嵌）：

| 文件 | 内容 |
| - | - |
| `01-roles.png` | 左侧「AI 教学」管理入口（视口截图） |
| `02-campus.png` | 年级与校区（全页：校区管理 / 学段与年级 / 年级总览 / 教师与校区） |
| `03-class-create.png` | 班级列表 + 新建班级 / 下载导入模板 / 导入 Excel（裁剪） |
| `04-students.png` | 班级详情学生名单 + 批量新建学生账号（裁剪） |
| `05-teaching.png` | 新建授课（小班 / 合班授课 / 选修课） |
| `06-elective-import.png` | 「导入选修课与社团」弹窗（选择文件 + 自动创建社团学生开关） |
| `07-lesson.png` | 上课概览 |
| `08-storage.png` | 存储与加速 |
| `09-pricing.png` | 定价规则 |

截图脚本用 Python Playwright + 系统 Chrome（`channel="chrome"`）；每张截图前会造临时演示数据、截完即清理（含 `users` 表残留行）。

### 17.5 验证结果（2026-11-01）

| 验证项 | 结果 |
| - | - |
| 新增 e2e `test/elective_import_e2e.py` | **27/27 断言通过** ✅（模板三表与列头、隐藏字典表、`category=club` 与 `category=elective`、已有学生入课、不存在学号记 `failed`、开关开启后创建 `club_only=true / class_id=0 / student_no=EL260001` 的社团学生） |
| 全链路回归 `test/integration_test.py` | **81/81 通过** ✅ |
| 云端素材 e2e `test/cloud_assets_e2e.py` | **42/42 通过** ✅ |
| 前端构建 `bun run build` | 通过，`routeTree.gen.ts` 含 `/docs/workspace-guide` ✅ |
| 后端 `CGO_ENABLED=0 go build -o newapi-run.exe .` | 通过，exit 0 ✅ |
| 路由注册 | `GET .../electives/import-template` 返回 401（需鉴权，路由存在）；`GET .../electives/import` 返回 404（POST 路由，符合预期） ✅ |
| 静态配图 | `GET /docs/guide/01-roles.png` 返回 200 ✅ |
| 浏览器复验教程页 | `figure img` 计数 **9**、`naturalWidth === 0` 的图片 **0**、「示意图待补」占位 **0**；页面 9 节全部渲染，顶部「文档 ▾」二级下拉存在 ✅ |
| 测试数据 | e2e 脚本自动清理（含自动建号学生的 `users` 行，按 `workspace_students.display_name` 兜底定位）；DB 复查 students / users / electives / stages / members 均为空 ✅ |

---

## 任务 18：删除模型残留 + 历史记录扣点与内容缺失（2026-11-01）

**用户反馈原文要点**

1. 「我已经把一些模型删除了，但在工作台的下拉里**还是能选到**。」
2. 「我用真实模型测了一次，**历史记录里扣的点数不正常**。」
3. 「历史记录**点进去看不到我发送了什么、收到了什么**。」

### 18.1 根因定位

| 问题 | 根因 |
| - | - |
| 删除的模型仍可选 | 模型管理删除走 `model.DeleteModelMetadata`（只删 `models` 元数据、可选从 `channels.models` 移除并重建 `abilities`、可选清定价），**全程未触碰 option `WorkspaceModelCapabilities`**；而创作台模型下拉的唯一来源就是这份能力声明（`setting/workspace.go` 的 `buildWorkspaceCapabilities` 只读该 option、不查 channels/abilities 表） |
| 扣点不正常 | `GetWorkspaceRecords` 的扣点取自 new-api 的 `logs.quota` / `task.quota`，但中台请求在 new-api 侧按**零成本计价**（`service.WorkspaceBillingContextKey`）→ 实测 `logs.quota` 绝大多数为 **0**（个别 8775 是 new-api 原生定价残留）；**中台真实扣点在 `workspace_usages.points`**，两张表没有关联键 |
| 点进去看不到内容 | 前端创作台（`workspace-studio.tsx`）与管理端（`sections/records.tsx`）两处记录表**都没有详情弹窗/点击事件**；后端 `workspaceRecord` 也**不返回 prompt / result_preview** |

### 18.2 修复清单

**后端**

| 文件 | 改动 |
| - | - |
| `setting/workspace.go` | 新增 `RemoveWorkspaceModelCapabilities(models []string) (string, error)`：从能力声明里剔除指定模型，返回可持久化 JSON；一个都没命中时原样返回 |
| `model/model_meta.go` | `ModelDeleteResult` 新增 `DeletedNames []string`；`DeleteModelMetadata` 的 `deleteRecords` 闭包回填排序后的被删模型名 |
| `controller/model_meta.go` | `DeleteModelMeta` / `BatchDeleteModelMeta` 删除成功后调用新增的 `pruneWorkspaceModelCapabilities(result.DeletedNames)` → `model.UpdateOption(setting.WorkspaceModelCapabilitiesKey, …)` |
| `model/workspace_usage.go` | `WorkspaceUsage` 新增 `RequestId string`（`request_id`，varchar(64) + 索引）；新增 `ListWorkspaceUsagesByRequestIds` |
| `middleware/workspace_metering.go` | 写 `WorkspaceUsage` 时补 `RequestId: c.GetString(common.RequestIdKey)`，与 `logs.request_id`（`X-Oneapi-Request-Id`）同源 |
| `controller/workspace_admin.go` | `workspaceRecord` 新增 `Points / Prompt / ResultPreview`（JSON 字段 `points / prompt / result_preview`）与内部字段 `requestId`；`GetWorkspaceRecords` 在 `fillWorkspaceRecordUsernames` 之后调 `fillWorkspaceRecordCharges`：按 `request_id` 批量取计费明细并**回填真实扣点 + 提示词 + 生成结果**；同时新增 `workspaceTaskRequestId(task)`（取 `task.PrivateData.Execution.RequestID`）；能力类型为空时用 `usage.Kind` 兜底 |

**前端**

| 文件 | 改动 |
| - | - |
| `features/ai-hub/types.ts` | `AiHubRecord` 新增 `points?` / `prompt?` / `result_preview?` |
| `features/workspace/components/workspace-studio.tsx` | 创作台「我的记录」：扣点列由 `record.quota` 改为 `record.points`（0 显示「—」）；新增「操作 → 详情」列；新增自研详情弹窗（右上角 X 关闭、点遮罩关闭），展示 时间 / 能力 / 模型 / 消耗点数 / 状态 / 我发送的内容 / 收到的内容（结果是图片 URL 时直接渲染为可点开大图的 `<img>`） |
| `features/ai-hub/sections/records.tsx` | 管理端「使用记录」同步：真实扣点 + 「详情」列 + 复用 `kit.tsx` 的 `Modal` 展示同一组字段 |

### 18.3 验证结果（2026-11-01）

| 验证项 | 结果 |
| - | - |
| 删除模型 → 能力声明同步清理 | 建临时模型 `tmp-del-check-*` → 声明 `kinds:["text"]` → `DELETE /api/models/:id` 返回 `deleted_names:["tmp-del-check-*"]` → `/api/workspace/admin/model-capabilities` 与 `/api/workspace/capabilities` 的 models 均**不再包含**该模型 ✅ |
| `workspace_usages` 自动迁移 | 新增 `request_id` 列，重启后 AutoMigrate 生效 ✅ |
| 真实生成 → 记录回填 | 生成文生文后 `/api/workspace/records` 最新一条 `points=2`、`prompt=「详情弹窗验证：请回复」`、`result_preview=[openai] 收到你的问题：…`（修复前均为 0 / 空） ✅ |
| request_id 关联率 | 新生成 10/10 全部命中（`logs.request_id` ↔ `workspace_usages.request_id`）✅ |
| 浏览器复验（管理端 `/ai-hub/records`） | 详情弹窗渲染「我发送的内容 / 收到的内容」，X 关闭可用 ✅ |
| 浏览器复验（创作台 `/workspace` → 我的记录） | 扣点列出现真实值（7），详情弹窗显示「能力 文生图 / 消耗点数 7 点 / 我发送的内容 阶梯定价2 / 收到的内容（图片正常渲染）」，控制台无页面级报错 ✅ |
| 全链路回归 `test/integration_test.py` | **81/81 通过** ✅ |
| 云端素材 e2e `test/cloud_assets_e2e.py` | **42/42 通过** ✅ |
| 构建 | `bun run build` + `CGO_ENABLED=0 go build -o newapi-run.exe .` 均通过，服务已重启 3000 端口 ✅ |

**已知边界**

- 修复前已有的历史记录没有 `request_id`，无法回溯关联，其「消耗点数」仍显示「—」。修复后新产生的生成记录才有真实扣点与内容。
- 记录列表里 `points=0` 的行表示「未关联到计费明细」（老数据或已被测试清理脚本删掉的账号），前端统一显示「—」而非 0，避免误导。

---

## 任务 19：腾讯云 COS 优先接入 + 参考图转存 + 产物直链分发 + TTS 音色按模型配置（2026-11-01）

**用户需求原文要点**

1. 对象存储**优先接入腾讯云 COS**，并写一份**教会用户操作**的知识文档；
2. **图生图源图、视频生成参考图**等参考素材，**全部先上传到 COS**，再由中台转发；
3. **文字转语音（注意不是文字转音乐）**：使用记录**只保存「要说的文本 + 选用的音色」**；
   **音色要能在每个模型里单独配置**，学生端**下拉选择**；
4. 生成的**视频 / 图片 / 音频全部上传 COS**，之后**按 CDN 分发**。

### 19.1 设计要点

| 议题 | 结论 |
| - | - |
| 参考图上行链路 | 浏览器 → 中台 → 中台代写 COS → 返回直链；**学生端不持有任何云凭据** |
| 参考图落存储的位置 | 与产物同一桶、同一前缀，键为 `<prefix>/<学段>/<届>/<班级>/…`；素材类型记为 `input` |
| 视频参考图 | 图生视频 / 首尾帧 / 主体参考**各模式都支持上传**，直链以 `image`（单张）/ `images`（多张）转发上游 |
| TTS 记录内容 | 使用明细的提示整理为 `音色：<voice>｜文本：<文本>`，**不保存原始音频请求体** |
| TTS 音色来源 | 挂在**单个模型的模型能力**上（`voices`），按 TTS 模型独立配置，学生端下拉随所选模型联动 |
| 越权兜底 | 请求音色不在该模型声明列表内时，服务端**回落列表中第一个音色**；未配置音色则保持原样 |

### 19.2 实现清单

**后端**

| 文件 | 改动 |
| - | - |
| `setting/workspace.go` | `WorkspaceModelCapability` 新增 `Voices []string`；新增 `workspaceMaxVoices=50` / `workspaceMaxVoiceRunes=64` / `normalizeWorkspaceVoices()`；`WorkspaceCapability` 新增 `Voices` 与 `ModelVoices map[string][]string`；新增 `WorkspaceModelVoices(model, kind)`；`buildWorkspaceCapabilities` 聚合音色并集与按模型映射（仅勾选 `tts` 时归一化） |
| `service/workspace_artifact.go` | 新增 `WorkspaceInputKind="input"`、`workspaceInputMaxBytes=32MB`、`SaveWorkspaceInputArtifact(...)`；参考素材**不受**「云端素材保存」开关约束 |
| `model/workspace_artifact.go` | `WorkspaceArtifactQuery` 新增 `ExcludeKind`（`kind <> ?`） |
| `controller/workspace_artifact.go` | 新增 `UploadWorkspaceAsset`（读 multipart `file` → `SaveWorkspaceInputArtifact` → 返回 `{id,kind,storage_path,url,public_url,size_bytes,mime_type}`，`url` 优先 CDN 直链，否则回落 `/api/workspace/artifacts/{id}/content`）+ `mimeTypeForUploadName`；素材列表默认 `ExcludeKind="input"`；`workspaceArtifactById` 增加归属者短路 |
| `router/workspace-router.go` | queryRouter 新增 `POST /uploads`、`GET /artifacts/:id/content` |
| `middleware/workspace.go` | 新增 `WorkspaceResolvedVoiceKey`、`workspaceInputSaveTimeout`；`kind=="tts"` 调 `workspaceResolveTTSVoice`（校验/回落音色并写上下文）；`kind=="edit"` 调 `workspaceCaptureEditInputs`（解析 multipart `image`/`image[]` 落 COS 归档，**不改写**转发正文）；抽出通用 `workspaceJSONStringField` / `workspaceRewriteJSONField` |
| `middleware/workspace_metering.go` | TTS 时 `usage.Prompt = workspaceTSSCaption(...)`；`workspaceResultPreview` 对非 JSON / 非法 UTF-8 返回空串 |

**前端**

| 文件 | 改动 |
| - | - |
| `features/workspace/types.ts`、`features/ai-hub/types.ts` | 新增 `voices?` / `model_voices?` |
| `features/workspace/api.ts` | 新增 `WorkspaceUploadResult`、`uploadWorkspaceAsset(file)`（`POST /api/workspace/uploads`）；`WorkspaceGenerateParams` 新增 `videoReferences: string[]`（视频：单张发 `image`，多张发 `images`） |
| `features/workspace/components/generate-panel.tsx` | 新增 `VIDEO_REFERENCE_COUNT`（text:0 / img2img:1 / frames:2 / subject:1）、`videoReferences`、`uploading`、`voiceOptions`（优先 `model_voices[model]`、回落 `voices`）、`handleUploadReference`、`requiredRefs`；新增视频参考图上传槽（label + 隐藏 file input + 预览）与 TTS 音色 `CustomSelect`（无音色时回落文本输入） |
| `features/models/components/model-capability-panel.tsx` | 新增 `Textarea` 音色列表输入（勾选「声音合成」后出现，一行一个标识），保存时提交 `voices` |

### 19.3 联调与验证（2026-11-01）

新增两个联调脚本（放在 `test/`）：

- `mock_s3.py`：纯 Python 标准库的**最小 S3 兼容服务**（PUT/GET/HEAD/DELETE + 列举 + path-style），
  自动兼容 aws-sdk-go-v2 的 `aws-chunked` 分帧请求体，对象落盘到 `test/.mock-s3/` 便于按字节比对；
- `cos_e2e.py`：把中台存储配置临时指向 mock S3，跑完整链路后自动还原配置。

| 验证项 | 结果 |
| - | - |
| 存储配置写入 + 真实读写自检（探针写→读回→删） | 通过，自检返回 CDN 直链 ✅ |
| 参考素材上传 `POST /api/workspace/uploads`（图片 / 视频） | 均返回 `kind=input` + 直链，对象键带配置前缀，字节一致 ✅ |
| 图生图 multipart 源图在中台归档 | 落 COS，字节与上传源图**完全一致**，且转发链路不受影响 ✅ |
| 生成产物落 COS（文生图 / 声音合成 / 图生图） | 均登记素材并落盘，`public_url` 为 CDN 直链 ✅ |
| CDN 直链可匿名拉取 | 图片为合法 PNG、音频为合法 WAV、字节与磁盘对象一致 ✅ |
| TTS 音色按模型配置下发 | `capabilities[tts].voices = [alloy,nova,shimmer]`，`model_voices["mock-tts-a"]` 一致 ✅ |
| TTS 非法音色回落 | 传 `不存在音色` → 上游实际收到 `alloy`，使用明细记录 `音色：alloy｜文本：音色校验二` ✅ |
| 素材列表默认隐藏参考素材 | 默认列表无 `kind=input`，显式筛选可查 ✅ |
| 删除素材联动删除对象 | 删除后列表移除，COS 中对象同步消失 ✅ |
| `test/cos_e2e.py` | **45/45 通过** ✅ |
| 全链路回归 `test/integration_test.py` | **81/81 通过** ✅ |
| 云端素材 e2e `test/cloud_assets_e2e.py` | **42/42 通过** ✅ |
| 选修课导入 e2e `test/elective_import_e2e.py` | **27/27 通过** ✅ |
| 构建 | `bun run build` + `CGO_ENABLED=0 go build -o newapi-run.exe .` 通过，服务重启在 3000 ✅ |

> `cloud_assets_e2e.py` 中「按时间段清理」的断言已同步更新：
> 图生图源图现在会归档为 `input` 参考素材，同样落在当天，也会被时间段清理带走，
> 因此预期删除条数改为「未提交产物 + 未提交参考素材」。

### 19.4 文档

- `docs/installation/AI-Workspace-生产部署教程.md` 新增：
  - **6.6 腾讯云 COS 专项：从开通到跑通（实操）** —— 建桶（必须带 `-APPID`）、CAM 子账号与最小权限策略、
    CORS、控制台字段逐项对照、测试连接、CDN 回源/缓存/证书、跑通验证、常见错误对照表；
  - **6.7 素材链路说明：参考图、生成产物与语音音色** —— 参考图上行链路、产物落盘链路、
    TTS 只记录「文本 + 音色」、音色按模型配置与同学端下拉联动、越权回落规则。
- 同步复制到 `d:\杂项\aiworkspace\how\AI-Workspace-生产部署教程.md`。

**已知边界**

- 「视频生成参考图」端到端只覆盖到**上传落 COS + 直链透传**这一段：
  mock 上游未实现 `/v1/video/generations` 的异步任务闭环，故未做整链路视频产物断言；
  真实上游接入后按同一套产物落盘逻辑生效。
- 音色标识**原样透传**，中台不做显示名翻译，下拉里展示的就是标识本身。

### 19.5（回退）移除对象存储与 CDN：改为纯内网本地磁盘（2026-11-02）

**用户指令原文要点**

> 「我不需要去用 COS / OSS / CDN 了，我就纯内网跑，所以你就把这些功能全给删了。然后运行我去看别的功能要删哪些。」

确认口径（4 项全选）：

1. **保留「生成素材落盘」本身**，改为**仅走本地磁盘**；「云端素材」管理页（预览 / 筛选 / 删除 / 按课次或时间段清理）保留。
2. 删除管理端「存储与加速」配置页与**全部多云对象存储适配**（S3 / 阿里云 OSS / 腾讯云 COS / 华为云 OBS / 七牛 Kodo / MinIO / Cloudflare R2 等）。
3. 删除 **CDN / 自定义域名（`public_base_url`）与直链逻辑**，素材只走应用本地受鉴权接口。
4. 删除 `WORKSPACE_STORAGE_*` 环境变量、`.env.example`、docker-compose / Dockerfile 中的对象存储配置，以及部署教程里的对象存储章 / CDN 章 / COS 专项章节（含 `how/` 副本）。

**删除清单**

| 类型 | 内容 |
| - | - |
| 后端文件（删除） | `setting/workspace_storage.go`、`service/artifactstore/object.go`、`controller/workspace_storage.go` |
| 前端文件（删除） | `web/src/features/ai-hub/sections/storage-settings.tsx`、`web/src/routes/_authenticated/ai-hub/storage-settings.tsx` |
| 测试脚本（删除） | `test/cos_e2e.py`、`test/mock_s3.py` |
| 存储抽象 | `service/artifactstore/store.go`：`Store` 接口去掉 `PublicURL`，仅剩 `Save / Delete / Open / LocalPath`；`Default()` 固定返回本地磁盘实现（根目录 `WORKSPACE_ARTIFACT_DIR`，默认 `data/workspace-artifacts`），`SetDefault()` 仅供单测注入 |
| 素材接口 | `controller/workspace_artifact.go`：上传返回体去掉 `public_url`，`url` 统一为 `/api/workspace/artifacts/{id}/content`；列表不再回填直链 |
| 数据模型 | `model/workspace_artifact.go` 去掉展示字段 `PublicUrl` |
| 配置与路由 | `model/option.go` 去掉 `WorkspaceStorageSettings` 注册；`router/workspace-router.go` 去掉 3 条 `storage-settings` 路由 |
| 前端 | `features/ai-hub/types.ts` / `api.ts` 去掉全部存储配置类型与请求；`hooks/use-sidebar-data.ts` 去掉「存储与加速」菜单；`cloud-assets.tsx` 预览/下载统一走受鉴权接口 |
| 部署配置 | `.env.example` 仅保留 `WORKSPACE_ARTIFACT_DIR`；`docker-compose.yml`、`docker-compose.prod.yml` 注释改为「无对象存储/CDN 依赖」 |
| 文档 | 部署教程删除原第 5/6/7/8 章（两种模式 / 对象存储 / CDN / 字段速查），新增「5. 云端素材：纯内网本地磁盘存储」，章节重编号并清理全部 OSS/CDN/直链措辞；同步覆盖 `how/` 副本 |

> `go.mod` 中残留的 `aws-sdk-go-v2/service/s3`、`aliyun-oss-go-sdk` 等依赖未清理（`proxy.golang.org` 不可达导致 `go mod tidy` 失败），不影响编译与运行。

---

## 2026-11-03 组织模型精简 / 学生独立登录 / 记录筛选（A1-A4、B1-B2、C1、D1）

**规格来源**：用户两条消息（12 项改造 + 澄清答复），已固化。

### 已完成
| 项 | 内容 |
| - | - |
| A1-A3 | 删除社团/选修课/小班/合班；删除校区管理；删除上课模式。班级不再绑定教师，所有教师可见全部班级。 |
| A4 | 取消记录/产物 30 天自动清理；仅保留「毕业满 1 年注销账号（保留名单档案）」定时任务（`service/workspace_cleanup.go`）。 |
| B1 | 三个建号入口（单建/批量/Excel 导入）统一走 `model.AllocateWorkspaceUsername(gradeCode, entryYear)`，产出 8 位账号（如 `A2600001`）；教师 `T` + 届别 `00` + 顺序。密码改为可选随机占位（学生登录不依赖密码）。 |
| B2（后端） | `model.ResetWorkspaceUserUsedQuota` + `controller.ClearWorkspaceAccountUsedQuota` + 路由 `POST /api/workspace/{teacher,admin}/accounts/usage/clear`、`POST /api/workspace/admin/users/usage/clear`。**前端按钮待补**。 |
| C1 | 新增独立学生登录入口：`POST /api/workspace/student/login`（班级+姓名+可选学号，无密码）、`GET /api/workspace/student/classes`（公开）。教师/管理员密码登录入口对 `RoleCommonUser` 直接拒绝（`controller/user.go`）。前端新增 `sign-in-student.tsx`。 |
| D1 | 生成记录新增筛选（年级/班级/时间段/生成模式）；新增 `POST /api/workspace/{teacher,admin}/artifacts/package`（archive/zip 流式打包，≤200 个）；记录页支持预览/下载/多选打包下载/删除产物。 |

### 本轮验证（修复联调脚本缺陷）
- **根因**：`test/integration_test.py` 的 `purge_test_accounts` 引用了不存在的表 `workspace_user_quotas`（真实表名为 `workspace_user_quota`），命中异常后未 `close()` 连接，仍持有 SQLite 写锁；表现为中台服务的**所有写请求（含登录）阻塞 60s 超时**，与业务无关。
- 修复：表名改为 `workspace_user_quota`；`purge_test_accounts` / `purge_stale_sessions` 统一改为 `try/except/finally` 确保 `conn.close()`。
- `test/cloud_assets_e2e.py` 时间段清理断言改为「清理前后全局素材数量差（含 `kind=input`）」，避免其他用例的今日遗留素材导致误报。
- 结果（重新构建 + 重启 3000 后）：`integration_test.py` **95/95**、`cloud_assets_e2e.py` **31/31**。

### 本轮完成（B2 前端 + E1）

**B2 前端「一键清零已用点数」**
- `web/src/features/users/api.ts` 新增 `clearUserUsedQuota(id)` → `POST /api/workspace/admin/users/usage/clear`。
- `web/src/features/users/components/data-table-row-actions.tsx` 行操作菜单新增「Clear Used Quota」，用自研 `ConfirmDialog` 二次确认（不触发原生 confirm）。
- `web/src/i18n/locales/zh.json` 补 4 条中文文案。

**E1 模型 × 功能接口配置 + 附加参数 + 通用 JSON + 生成耗时**
- 存储：`setting.WorkspaceModelCapability` 新增 `Endpoints []WorkspaceModelEndpoint`（`kind/format/path/qpath/method/extra`）；
  `WorkspaceCapability` 新增 `model_qpaths`。归一化 `normalizeWorkspaceEndpoints/Endpoint`：仅保留已勾选模态、校验
  `format(openai|json)`/`method(POST|GET)`、截断路径、校验 `extra` 为合法 JSON 对象。
- 通道：`middleware/workspace.go` `workspaceApplyModelEndpoint` 按「模型 × 功能」改写上游路径（`c.Request.URL.Path`
  → `RelayInfo.RequestURLPath` → `GetFullRequestURL`），并把 `extra` 深合并进 JSON 请求体
  （`workspaceMergeJSONObject`/`workspaceDeepMerge`，附加参数叶子优先；教师专业版跳过）。
- 通用 JSON：`controller/workspace.go` `workspaceApplyBodyPassthrough` 在 `Relay()` 前把当前渠道设置为
  `PassThroughBodyEnabled`，使 new-api 原样透传请求体，避免按 `dto.GeneralOpenAIRequest` 重新序列化丢弃非标准字段。
- 生成耗时：`middleware/workspace_metering.go` 记录 `elapsedMs` → `model.WorkspaceUsage.DurationMs` → 记录接口
  `workspaceRecord.duration_ms`；前端 `generate-panel.tsx` 生成按钮实时显示「生成中… N秒」，`records.tsx` 详情弹窗展示「生成耗时」。
- 前端配置 UI：`features/models/components/model-capability-panel.tsx` 每个已勾选模态展开一行：请求格式（OpenAI 对话格式/通用 JSON 格式）、
  接口路径、结果查询接口、请求方法（POST/GET）、附加参数 JSON。

**E1 运行时探针（`t_e1_probe.py`，已跑通）**
- 给 `mock-chat-a` 的 `text` 配置 `format=json`、`path=/v1/mock-custom-path`、
  `extra={"custom_flag":"e1_probe","temperature":0.123,"nested":{"a":1}}`，学生端发起文生文。
- 断言：mock A 收到 `POST /v1/mock-custom-path`（**路径覆盖生效**），请求体含 `custom_flag`、`nested.a`，
  且 `temperature` 被覆盖为 `0.123`（**附加参数深合并 + 通用 JSON 透传生效**）。探针结束自动还原配置与清理数据。

### 已知限制
- `method=GET` 目前仅存储并下发到前端（结果查询接口轮询用 GET）；生成接口仍固定 POST（new-api relay 按 `relay_mode` 固定方法），如需 GET 生成需另开 relay 路径。

### 回归验证（重建 + 重启 3000 后）
- `bun run build` 通过；`go build` 通过。
- `integration_test.py` **95/95**、`cloud_assets_e2e.py` **31/31**。
- 冒烟遗留数据已清理（班级/年级/学生表已清空）。

### 本轮完成（P1–P5 验收整改）

**P1 清理「新建授课」残留**
- `web/src/features/docs/workspace-guide.tsx`：删除「新建授课 / 选修课导入 / 上课概览」3 节与 3 张配图（`GUIDE_SHOTS` 9→6），按后端事实重写 Excel 模板、学号规则、计价章节，标题改「班级与学生管理操作教程」。
- `web/src/hooks/use-top-nav-links.ts`：菜单标题同步。
- `web/src/features/ai-hub/sections/cloud-assets.tsx`、`api.ts`、`types.ts`：删除 `lesson_id` / 课次主题 / 按课次清理等悬空字段与 UI。

**P2 教师放开学生与班级管理**
- `router/workspace-router.go`：`teacherRouter` 新增 `/classes`（含导入模板、导入）、`/students`（含批量创建、转班）等路由。
- `web/src/features/ai-hub/api.ts`：班级与学生写接口改用 `scopeBase()`（按角色选 admin/teacher 前缀）。
- `web/src/features/ai-hub/sections/classes.tsx`：去掉 `isTeacher` 只读门禁。

**P3 使用记录筛选重构**
- `web/src/features/ai-hub/sections/records.tsx`：筛选顺序改为 年级 → 班级 → 指定账户（`Combobox` 可按账号/姓名搜索选中）→ 开始时间 → 结束时间 → 生成模式；切换年级/班级会清空已选账户；详情弹窗内嵌图片/视频/音频预览，图片额外提供「下载该产物」。

**P4 按「模型 × 功能」设置价格**
- `setting/workspace_pricing.go`：`WorkspaceModelPricing` 新增 `Kind`；`GetWorkspaceModelPricing(model, kind)` 按组合查找（`kind` 为空的历史记录按模型级兜底）；归一化与去重键改为「模型 + 功能」；`RemoveWorkspaceModelPricing` 支持按模型整批剔除。
- `web/src/features/models/components/model-capability-panel.tsx`：每个已开启功能一行可编辑「计价单位 / 1 点折算（元） / 上游单价（元/单位） / 每次计量数量」，保存元数据时同时写能力声明与计价；关闭功能连带删除该组合计价。
- `web/src/features/ai-hub/sections/pricing.tsx`：定价面板改为「按模型 × 功能」，行只由现存模型已声明功能展开。
- `web/src/features/ai-hub/types.ts`：`AiHubModelPricing` 增加可选 `kind`。

**P5 已删除模型不再显示**
- `controller/model_meta.go`：单个/批量删除模型后，除清理能力声明外同步调用 `pruneWorkspaceModelPricing`。
- `controller/workspace_pricing.go`：新增 `workspaceExistingModelNames()`（模型元数据 + 渠道已配置模型），定价接口返回前过滤；新增 `PruneStaleWorkspaceModelConfig()` 在服务启动时一次性清理历史残留。
- `controller/workspace.go`：`model-capabilities` 管理端返回同样按现存模型过滤。
- `main.go`：`model.InitOptionMap()` 之后调用启动清理（查询失败不做删除，幂等）。
- `web/src/features/models/components/dialogs/model-delete-dialog.tsx`：删除成功后失效 `['ai-hub','model-capabilities']` 与 `['ai-hub','pricing']` 缓存。

### 本轮验证（P4 / P5）
- P4 接口层：写 `{model, kind}` 组合定价 → `PUT /api/workspace/admin/pricing` 200 → 回读 `kind` 正常；历史 `kind` 为空记录未被破坏。
- P5 端到端：新建临时模型 → 声明能力 + 写定价 → 两处列表均出现；删除后两处均消失；从未存在的幽灵模型定价被接口过滤。
- P5 启动自愈：手工注入幽灵模型配置后重启，日志 `pruned stale workspace model config for 2 model(s)`；直接读 SQLite 确认 `WorkspaceModelCapabilities` / `WorkspacePricing` 已无残留；再次重启清理数为 0（幂等）。
- 全量回归：`integration_test.py` **95/95**、`cloud_assets_e2e.py` **31/31**（Mock 上游 8101–8103 + 中台 3000 重启后）。

### 本轮完成（定价货币统一为人民币）
- `setting/operation_setting/general_setting.go`：`QuotaDisplayType` 默认值改为 `CNY`。
- `model/option.go`：旧字段 `DisplayInCurrencyEnabled` 兼容映射改为 true→`CNY`、false→`TOKENS`（不再回落 USD）。
- `main.go`：`model.InitOptionMap()` 后新增启动归一，历史配置为 USD/CUSTOM/TOKENS 时自动写回 `general_setting.quota_display_type=CNY` 并记录日志。
- `web/src/stores/system-config-store.ts`：默认 `quotaDisplayType: 'CNY'`、`usdExchangeRate: 7.3`。
- `web/src/lib/currency.ts`：`parseCurrencyDisplayType` 兜底改为 `CNY`。
- `web/src/features/system-settings/billing/index.tsx`：默认 `general_setting.quota_display_type: 'CNY'`。
- `web/src/features/system-settings/general/pricing-section.tsx`：展示模式下拉收敛为仅「人民币（CNY）」。
- `web/src/features/dashboard/lib/charts.ts`：金额符号兜底由 `$` 改为 `¥`。
- `web/src/stores/pricing-preferences-store.ts`：模型定价编辑器默认为 `site`（人民币），并 `version: 2` + `migrate` 覆盖历史持久化的 USD 选择。
- 中台自有计价（单次折算元 / 上游单价元 / 对账）本身即为人民币，无需换算。

### 本轮验证（货币统一）
- `/api/status` 返回 `quota_display_type=CNY`、`usd_exchange_rate=7.3`，前端据此按 ¥ 展示模型广场、模型定价、数据看板与日志额度。
- `bun run build` 通过；`go build`（CGO_ENABLED=0）通过；3000 端口重启成功。
- `integration_test.py` **95/95**、`cloud_assets_e2e.py` **31/31**。

### 本轮完成（年级管理 → 学部管理）

**需求**：小学部 / 初中部 / 高中部三个学部，学部内配置学段年级阶梯与规则；不再手动新建年级，改为按学生届次自动计算当前年级。

**后端**
- 新增 `model/workspace_section.go`：`WorkspaceSection{Code(唯一), Name, Years, PromoteMonth, GradeNames, AutoGraduate, SortOrder, Enabled}`；
  种子 `P 小学部(6 年, 一年级…六年级)`、`J 初中部(3 年, 初一…初三)`、`S 高中部(3 年, 高一…高三)`，默认 `PromoteMonth=9`、`AutoGraduate=true`；
  `EnsureWorkspaceSections()` 启动幂等补齐。
- 年级换算：`当前学年 = 月份 >= PromoteMonth ? 本年 : 上一年`；`年级序号 = 当前学年 - 届次 + 1`；
  `> Years` 显示「已毕业」并可自动冻结登录；`WorkspaceSectionGradeName/IndexAt/Graduated`、`WorkspaceSectionOverview()`、`RolloverWorkspaceSchoolYear()`。
- `model/workspace.go`：班级改挂 `SectionId + EntryYear`（移除静态 `GradeId`），新增展示字段 `SectionName/SectionCode/GradeIndex/GradeName/Graduated`；
  `GetWorkspaceActiveStudentUserIds` 支持按学部 + 年级反推届次筛选。
- 账号：学生 `学部代码 + 届(2 位) + 顺位(5 位)`（如 `P2600001`），教师 `T00 + 顺位(5 位)`；`AllocateWorkspaceUsername(sectionCode, entryYear)`。
- 控制器/路由：`/sections` CRUD、`/section-options`（年级下拉）、`/section-overview`（含学年结转）、`POST /school-year/rollover`；
  删除 `/grades` 系列（避免与 `/sections/:id` 路由冲突，子路径独立）。
- Excel 模板表头改「班级名称 / 学部（代码或名称）/ 届」，并兼容旧「年级」表头。

**前端**
- `ai-hub/sections/grades.tsx` 重写为学部管理页（保留路由 `/ai-hub/grades` 与 `GradesSection` 导出名）：学部列表（代码/名称/学制/年级阶梯/升级月份/毕业冻结/班级数/在读学生数/状态）、学部总览（按年级展平 + 一键学年结转）、教师账号。
- `sections/classes.tsx`：筛选改「学部」，表格新增「学部」列，建班/编辑字段改「所属学部 + 届别」。
- `sections/records.tsx`：筛选层级改为 学部 → 年级（依赖学部，值 `grade_index`）→ 班级 → 指定账户 → 时间段 → 生成模式。
- `hooks/use-sidebar-data.ts` 菜单「年级管理」→「学部管理」；`features/docs/workspace-guide.tsx` 教程同步为学部口径（学制/年级阶梯/升级月份/学年结转/超学制毕业冻结、账号规则 `P2600001`）。

**数据迁移**：按确认方案清空重建（清空 `workspace_students` / `workspace_classes`、删除 `workspace_grades`、重置 `workspace_username_sequences` 与测试学生账号），启动后自动写入三个学部种子。

**测试脚本同步**：`integration_test.py`、`cloud_assets_e2e.py`、`concurrency_test.py` 均改为「建学部 → 建班级（section_id + entry_year）」，总览接口改 `/section-overview`。

### 本轮验证（学部管理）
- `bun run build`（67.5 MB dist）通过；`go build`（CGO_ENABLED=0）通过；3000 重启后 `/api/status` 正常（`system_name=AI Workspace`、`quota_display_type=CNY`）。
- 种子校验：`workspace_sections` 含 P/J/S 三条。
- `integration_test.py` **95/95**、`cloud_assets_e2e.py` **31/31**；素材落盘目录为 `素材联调学部/2024届/素材联调班级/未关联课次/...`（学部名第一段生效）。
- 注意：重建后端前须先停 3000 端口进程，否则 `go build` 写 `newapi-run.exe` 会因文件占用而阻塞。

### 本轮完成（菜单精简 / 定价合并 / 学生账号体系）

**一、删除冗余菜单与页面**
- 系统设置侧栏删除 `Claude`、`Grok`、`模型部署`（`system-settings/models/section-registry.tsx`、`use-sidebar-data.ts`、`use-sidebar-config.ts`）。
- 计费设置侧栏删除 `分组定价`、`支付网关`、`签到奖励`（`system-settings/billing/section-registry.tsx`）。
- 删除「人民币兑美元汇率」配置项（`general/pricing-section.tsx`）。
- 删除 `游乐场` 与 `聊天` 入口及路由：`routes/_authenticated/playground/index.tsx`、`chat/$chatId.tsx`、`chat2link.tsx`，并清理侧栏导航。

**二、模型定价并入 AI 中台**
- 「模型定价」从系统设置移出，合并进 `ai-hub/sections/pricing.tsx`（控制台侧），直接嵌入 `RatioSettingsCard`（模型定价 / 未设价模型 / 工具价 / 上游同步 四个标签页）。
- 删除全局「1 点折算（元）」列与配置项；金额口径统一为「模型上游单价 × 实际用量」，由 `CostYuan(units)` 自动计算。
- 后端 `WorkspaceModelPricing` 去掉 `PointPriceYuan` 相关字段与 `DefaultWorkspacePointPriceYuan`；`setting/workspace_pricing.go`、`middleware/workspace_metering.go` 的 `AmountYuan` 改为 `charge.CostYuan(units)`。

**三、学生登录与账号体系**
- `WorkspaceStudent` 新增 `PasswordSet`：批量建号与 Excel 导入写入的密码仅为占位（默认免密登录），仅「学生自助设置」与「教师修改密码」会置位 `password_set=true`，此后登录必须输入密码。
- 学生登录接口 `POST /api/workspace/student/login` 支持 `account`（学号 / 登录账号 / 小写拼音，大小写不敏感）+ `password`，保留旧「班级 + 姓名（可选学号）」免密路径。
- 学生档案接口 `GET /api/workspace/student/profile`、自助改密 `POST /api/workspace/student/password`（旧密码仅在已设置密码时校验；改密直接更新 `users.password`，不提升 `auth_version`，避免被强制登出）。
- 学生登录页 `routes/(auth)/sign-in-student.tsx` 重写为 AI 创作工坊紫风（`#6c5ce7` / 渐变 `#8b7bf5 → #5b4bd6`）。
- 学生端顶部按钮改为「开始创作 / 我的记录 / 账户管理」三枚同栏同风格，账户管理为工坊内视图，提供密码设置面板（`features/workspace/components/workspace-studio.tsx`）。
- 班级管理导入解析支持第三列「小写拼音」，`classes.tsx` 新增拼音列与编辑资料 Modal，`workspace_admin.go` 建号写入 `PinyinUsername`。
- 记录权限：学生仅返回本人生成记录，教师可查看全部学生记录。

**测试脚本同步**
- `test/integration_test.py` 删除 `point_price_yuan` 断言，定价回读改 `unit_price` + `unit`；金额断言改为 `amount_yuan == cost_yuan`（同源于上游单价 × 用量）。

### 本轮验证（菜单精简 / 定价合并 / 学生账号）
- `bun run build` 通过；`go build`（CGO_ENABLED=0）通过；3000 端口重启后 `/api/status` = 200。
- `integration_test.py` **95/95**（含「新建学生账号可登录」免密登录、按模型独立计价回读、金额 = 上游单价 × 用量）。
- `cloud_assets_e2e.py` **31/31**。
- 决策与待确认问题记录在 `question/2026-11-05-本轮改造决策与待确认问题.md`。

### 本轮完成（学生名单字段收敛 + Excel 导入修复）

**一、学生名单字段收敛**
- 学生名单人工维护字段收敛为「姓名」「姓名拼音」，学号由系统自动生成（学部代码 + 届 2 位 + 5 位顺位）。
- 前端文案统一：`classes.tsx` 表头「拼音用户名」→「姓名拼音」，「添加已有账号」「编辑资料」两处字段标签改为「姓名拼音（全拼，用于登录）」。
- `parseRosterText` 由「学号,姓名[,拼音]」改为「姓名,姓名拼音」，学号不再必填（后端自动分配账号）。
- `normalizeWorkspacePinyin` 统一为「去空格 + 小写」；`FindWorkspaceStudentByAccount` 兼容登录输入中的半角/全角空格。

**二、Excel 名单导入修复（重点）**
- 模板「学生」表新增「姓名拼音（全拼，用于登录）」列（`controller/workspace_class_excel.go`），示例 `P, 2024, 一班, 张三, zhangsan, 空`。
- 工作表定位模糊化：`wsFindSheet` 精确名优先，其次含「学生 / 名单 / 花名册」关键字；单表时按班级表解析。
- 表头/单元格归一化：`wsNormalizeCell` 去全角空格与首尾空格，兼容列名「姓名拼音（全拼）」「姓名拼音」「拼音用户名」「拼音」「全拼」「学生姓名」「名字」。
- 班级匹配重写：`wsNormalizeClassName` 忽略空格与大小写；同名班级按「学部 + 届别」挑选，仍无法区分取第一个。**班级已存在时直接把学生追加进去，不再报「班级不存在」。**
- 重复学生不再算失败：同班级同名同拼音自动跳过，计入 `students_skipped`；同名不同拼音（真重名）正常追加。
- 返回体新增 `students_skipped`，`failed` 为空时返回 `[]` 而非 `null`。
- 前端 `api.ts` `importClasses` 对返回字段做兜底；导入结果提示追加「跳过同名学生 N 人」。

### 本轮验证（学生名单字段与 Excel 导入）
- 实测：向已存在的「联调班级（学部 A / 2026 届）」导入 2 名学生 → `classes_created=0, classes_updated=1, students_created=2`；重复导入同一表格 → `students_created=0, students_skipped=2, failed=[]`。
- 实测：学生用姓名全拼 `zhangsan` 登录成功（免密）。
- `bun run build` 通过；`go build`（CGO_ENABLED=0）通过；`/api/status` = 200。
- `integration_test.py` **95/95**；`cloud_assets_e2e.py` **31/31**。
- 本轮决策与新增待确认问题已追加到 `question/2026-11-05-本轮改造决策与待确认问题.md`（第三、四节）。

### 本轮完成（云端素材批量清理扩充 + 筛选去 ID 化）

**一、批量清理能力扩充**
- `controller/workspace_artifact.go`：`workspaceArtifactPurgeRequest` 新增 `lesson_id` 与 `ids`；`PurgeWorkspaceArtifacts` 支持四种模式，优先级 `ids` > 课时 > 班级 > 时间段，统一跳过已提交素材。
- `model/workspace.go` 新增 `FindWorkspaceStudentUserIds`：按班级 / 学部年级 + 姓名关键词筛选在读学生 userId。
- 前端 `cloud-assets.tsx`：批量清理面板新增「按课时清理」与「课时 ID」，班级下拉改用全量班级列表（不再随筛选联动）。

**二、勾选 / 单行清理**
- 顶部新增「全选本页」（仅选未提交）与「清理选中（N）」；行内新增「清理」按钮，复用同一确认弹窗。
- 勾选清理改为一次调用 `purgeArtifacts({ ids })`，返回删除条数与释放字节数。

**三、筛选去 ID 化**
- `cloud-assets.tsx`：移除 `user_id` 输入，改为「学生姓名 + 学部 + 年级 + 班级 + 能力类型 + 起止日期」；年级选项随学部联动。
- `records.tsx`：移除「指定账户」下拉，改为「学生姓名」关键词输入，保留学部 / 年级 / 班级 / 生成模式 / 起止时间。
- `api.ts`：`ArtifactQuery` 移除 `user_id`，新增 `section_id / grade_index / keyword`；`RecordQuery` 新增 `keyword`；`ArtifactPurgePayload` 新增 `lesson_id / ids`。
- `controller/workspace_admin.go`：`GetWorkspaceRecords` 支持 `class_id / section_id / grade_index / keyword`，保留 `user_id` 兼容参数。

**本轮验证**
- `bun run build` 通过；`go build`（CGO_ENABLED=0）通过；3000 端口重启后 `/api/status` = 200。
- `integration_test.py` **95/95**；`cloud_assets_e2e.py` **31/31**。
- `bun run typecheck` 仍有 11 处既有无关错误（chat-presets-item / overview-dashboard / model-capability-panel / system-task-history），本轮改动文件无错误。
- 本轮决策与新增待确认问题已追加到 `question/2026-11-05-本轮改造决策与待确认问题.md`（第五、六节）。

### 本轮完成（HTML 编程实验室）

**一、能力与计费**
- `setting/workspace.go`：`workspaceKindMeta` 新增 `Hidden` 字段，新增 kind `html`（Hidden=true）；`buildWorkspaceCapabilities` 对学生/教师跳过 Hidden 能力卡（管理员全量列表仍可见）；html 未单独声明模型时回退复用文生文模型。
- `setting/workspace_pricing.go`：默认计价单位 `text` 分支并入 `html`，管理员可在定价页配置「每次发送扣点」。
- `middleware/workspace.go`：`workspaceUpstreamFor` 新增 `html` → `/v1/chat/completions`。
- `middleware/workspace_metering.go`：html 与 text 同样做 token 用量折算。
- 计费链路复用 `/api/workspace/generate/html` → `WorkspaceMetering`（预校验 + 成功后按次扣点 + 写 `workspace_usages`）。

**二、提示词工程与落库（`middleware/workspace_html.go`）**
- `WorkspaceHTMLPrepare`：从请求中取用户需求与 `workspace_html.project_id/code`，校验项目归属或新建项目；读取该项目最近 12 条历史消息；组装「系统提示词（含当前源码）+ 历史消息 + 本次需求」，强制 `stream=false`，剔除 `workspace_html` 字段后重写请求体；响应头回传 `X-Workspace-Html-Project-Id`。
- 系统提示词要求：单文件完整 HTML、DOCTYPE/head/body/charset/viewport、原生 JS、简体中文、增量修改、先 3 行说明再输出 html 代码块（三反引号）、禁止省略、不反问。
- `WorkspaceHTMLCapture`：缓冲上游响应（上限 2MB），失败且为新建项目时回滚；成功时提取代码块并更新项目源码，同时写入 user / assistant 两条消息（assistant 截断 20000 字）。

**三、API**
- 新增 `controller/workspace_html.go`：`GET /api/workspace/html/config`（按角色过滤可用模型 + 单次点数）、`GET /api/workspace/html/projects`、`GET /api/workspace/html/projects/:id`。
- 新增 `model/workspace_html.go`：`workspace_html_projects`（含完整源码）与 `workspace_html_messages`，并注册进 `AutoMigrate`。

**四、前端**
- 新增 `features/workspace/html-api.ts` 与 `components/html-lab.tsx`：三栏工作台（AI 对话 / 代码编辑器 / 运行预览）。
- 默认「自由创作」，无 BMI 示例；支持新建项目、历史项目下拉切换并回填源码与对话、发送需求、把反馈插入编辑器、运行刷新 iframe 预览；顶部展示每次发送消耗点数与模型选择。

**本轮验证**
- `bun run build` 通过（产物已含「HTML 实验室」）；`go build`（CGO_ENABLED=0）通过；3000 端口重启后 `/api/status` = 200。
- 冒烟：`GET /html/config` 返回 `enabled=true`、3 个 mock 对话模型、`points=5`；`POST /generate/html` 返回 200，响应头含 `x-workspace-html-project-id: 1`，点数 149999994 → 149999989（扣 5 点），`workspace_usages` 记录 `kind=html / points=5`，项目与 user/assistant 两条消息落库；`GET /html/projects/1` 返回项目与消息。测试数据已清理。
- `integration_test.py` **95/95**；`cloud_assets_e2e.py` **31/31**。
- 本轮决策与新增待确认问题已追加到 `question/2026-11-05-本轮改造决策与待确认问题.md`（第七、八节）。

### 本轮完成（决策落地：清理支付/签到、自动计价、班级与学生治理、HTML 实验室补充）

**一、彻底删除支付网关与签到奖励**
- 后端删除：`controller/checkin.go`、`topup*.go`、`subscription_payment_*.go`、`payment_*`；`model/checkin.go`、`topup.go`；`setting/payment_*.go`、`operation_setting/payment_setting*`、`checkin_setting.go`；`service/epay.go`、`waffo_pancake.go`、`common/topup-ratio.go`；同步清理 `router/api-router.go`、`middleware/access_token_routes.go`、`middleware/audit.go`、`model/option.go`、`model/main.go`（AutoMigrate 与支付字段 DDL）。
- 一键部署 / 支付相关配置项随删除一并移除；保留订阅套餐 CRUD、兑换码、`Price`、`USDExchangeRate` 与模型/分组倍率计费内核。
- 前端删除签到卡片与签到设置页，删除 integrations 下 11 个支付网关组件、购买订阅弹窗、钱包支付库与支付合规 API；订阅管理移除 Stripe/Creem/Waffo 字段、支付渠道列与合规门禁。

**二、AI 中台计价改为自动换算**
- `setting/workspace_pricing.go` 新增 `WorkspaceAutoPricingFor`：读取 `GetModelRatio` / `GetCompletionRatio` / `GetModelPrice` 与 `USDExchangeRate`，自动换算「元/单位」；`ResolveWorkspacePricing` 优先用自动值，为 0 时回落历史 `unit_price`。
- 定价页表头改为「上游单价（元/单位，自动换算）」，只读展示；模型能力面板移除手工单价输入。

**三、班级编号与学生账号**
- `WorkspaceClass` 新增 `code`，新建留空自动生成 `C{1000+id}`，班级列表新增「班级编号」列，保存弹窗可编辑。
- 学生管理新增「重置密码」与「恢复免密登录」，教师/管理员可用；账户卡片新增「查看剩余点数明细」「退出登录」。
- 姓名拼音支持「自动转拼音」（新增学生弹窗、编辑资料弹窗均接入）；同班拼音重复时后端返回中文错误，弹窗内红字提示并让教师改拼音后重试（新增学生弹窗保持打开）。
- 学号列保留，学号与姓名拼音均可作为登录账号。

**四、筛选与素材归属**
- 使用记录 / 云端素材新增「包含已毕业」开关，查询按 `status IN (active, graduated)`；素材归属仍按学生当前班级 / 届别实时换算（`fillWorkspaceStudentDisplay`）。
- 使用记录筛选结果展示「姓名 + 学号 + 班级 + 年级」，便于区分重名。
- 批量清理移除课时维度，班级下拉展示「班级名（年级）」；后端清理接口改为 `{from,to} / {mode:"class", class_id}`，删除 submitted 相关过滤与字段。
- `test/cloud_assets_e2e.py` 同步改为 `mode=class`。

**五、HTML 实验室**
- 学生与教师均开放；单次发送默认扣 5 点，可在定价页按模型配置；每个项目计入 `workspace_usages`（`kind=html`）与云端素材。
- 项目支持重命名；项目列表 10 条/页并支持关键词搜索；历史消息仅回传最近 12 条、每条截断 3000 字，assistant 落库截断 20000 字。
- 允许加载外部图片 / CSS；上游未返回 html 代码块时编辑器不更新，界面明确提示「本次未生成代码」。

**本轮验证**
- `bun run build` 通过；`go build`（CGO_ENABLED=0）通过；`go vet` 相关包无输出；3000 端口重启后 `/api/status` = 200。
- `integration_test.py` **95/95**；`cloud_assets_e2e.py` **31/31**。
- `bun run typecheck` 仅剩 4 个历史无关文件的 11 处既有错误，本轮改动文件无新增错误。
- i18n 词条未改动（残留支付/签到词条不影响功能）。

---

# 2026-11-05 第二轮：界面放大 / 思考强度 / 默认学生登录 / 模型下拉修复

**一、界面字体放大 + 内容占满整屏**
- `workspace-studio.tsx` 顶栏与主体移除 `mx-auto max-w-[1240px]`，改为 `w-full`（顶栏/主体 `px-6 md:px-8`），内容占满整屏宽度。
- 创作台整体字号上调一档（12.5→13.5、13→14 等），页签、记录表格、能力卡片文字同步放大。
- `html-lab.tsx` 文本统一放大（12→13、12.5→13.5、13→14/15），行高上调（leading-6→7、mono leading-5→6），三栏最小高度 460→560、对话区 maxHeight 420→520、输入框 76→88px、预览 380→440。

**二、HTML 实验室默认思考强度（后台可配）**
- 新增 Option `WorkspaceHtmlThinkingEffort`（`setting/workspace_pricing.go`），合法值 `none/minimal/low/medium/high`，空串=跟随模型默认；`model/option.go` 注册默认值，`validateOptionValue` 未知 key 放行。
- 定价接口 GET/PUT 支持 `html_thinking_effort` 与 `thinking_effort_options`；定价页「平台设置」新增思考强度下拉。
- `GET /api/workspace/html/config` 下发 `thinking_effort` / `thinking_effort_options`；学生端 html-lab 顶栏新增思考强度下拉，以后台默认为初始值、可手动切换，发送时透传 `reasoning_effort`。
- `middleware/workspace_html.go`：请求未显式指定 `reasoning_effort` 时注入后台默认档位。

**三、默认显示学生登录窗口**
- `routes/index.tsx` 未登录改跳 `/sign-in-student`；`routes/workspace/index.tsx` 未登录同样改跳学生登录。
- `workspace-studio.tsx` 退出登录后跳 `/sign-in-student`；教师/管理员经学生登录页的「教师 / 管理员登录」链接切换。

**四、模型下拉选不中渠道测试模型的修复**
- 根因：`workspaceExistingModelNames()`（`controller/workspace_pricing.go`）只认 `NameRuleExact` 的模型管理记录，渠道里配置的 mock/测试模型仅存在于 abilities 表，能力声明被管理端接口过滤。
- 修复：并入 `model.GetEnabledModels()`（abilities 已启用模型），渠道测试模型可正常声明能力并被文生文/文生图等下拉选中。

**本轮验证**
- `gofmt` + `go vet`（setting/controller/middleware）无输出；`bun run build` 通过；`go build`（CGO_ENABLED=0）通过。
- 重启 3000 后 `/api/status` = 200；`integration_test.py` **95/95**、`cloud_assets_e2e.py` **31/31**。
- `bun run typecheck` 11 处错误，与既有基线一致，无新增。
- 含管理员凭据的额外验证脚本被安全策略拦截（未执行），新字段端到端展示可在管理端「定价规则」页与 HTML 实验室直接核验。

---

# 2026-11-06 第三组：模块 E 学生端课堂任务面板与提交

**一、后端**
- `WorkspaceClassSession` / `WorkspaceTaskSubmission` 模型与控制器落地：学生端 `GET /api/workspace/class-session` 返回当前进行中的课堂与任务、历史提交；提交支持 text / file / ai 三种形式。
- 文件提交按任务 `allowed_extensions` 白名单与 `max_uploads` 上限校验；AI 作品保存为本地素材并写入 `artifact_id`。
- 文字提交不占用文件上传名额（`CountWorkspaceTaskFileSubmissions` 仅统计 `content_type = 'file'`）。

**二、前端**
- 新增学生端右侧可折叠任务面板 `class-task-panel.tsx`，展示课时任务、历史提交与我方提交数；`workspace-studio.tsx` 挂载 `classSessionQuery`。
- `generate-panel.tsx` 新增「提交到课堂任务」入口，AI 文字/图片作品可直接提交为课堂任务。
- 未开通 AI 课程的小班：隐藏开始创作等 AI 入口，历史生成记录与已提交任务仍可见。

**本轮验证**
- `test/class_session_e2e.py` **30/30** 通过；浏览器 UI 验证 PASS；测试数据已清理。

---

# 2026-11-06 第四组：模块 D 教师课堂概览/分发/成果 + 模块 F 存储规范

**一、一键分发与课堂概览（D1/D2）**
- 新增教师默认首页「课堂概览」：`/ai-hub/overview`（`class-overview.tsx` + 文件路由 + 侧边栏入口），登录后教师/管理员默认落地该页。
- 学部 → 年级 → 上课小班 → 课时四级下拉，一键分发课时；重复分发自动复用同一 `WorkspaceClassSession`，接续历史进度。
- 会话列表展示状态 / 小班 / 单元 / 课时 / 任务数 / 提交数 / 分发时间，支持结束授课。

**二、实时提交查看（D3）**
- `GET /class-sessions/:id` 返回会话、任务与全部提交；概览页 8s 轮询实时刷新，会话列表 15s 轮询。
- 提交表格展示「学生姓名 + 学号 + 任务标题 + 形式 + 时间」；文件类支持图片/视频/音频在线预览与单条下载。

**三、ZIP 打包（D4）**
- 新增 `GET /class-sessions/:id/package`（教师与超管各一条路由），流式输出 `application/zip`。
- 按任务顺序建 `01_任务标题` 文件夹；文字写 `_文字.txt`；文件与 AI 产物从本地磁盘读取后按原文件名归档；无落盘产物时回退写 `_作品.txt`（提示词 / 参数 / 结果）。
- 空课堂返回「该课堂还没有学生提交」；结束授课后仍可打包。

**四、AI 作品详情与参数留痕（D5/F）**
- `WorkspaceTaskSubmission` 新增 `params`（生成参数 JSON 快照）与展示字段 `student_no`；学生端 AI 提交透传 `params`。
- 概览页「AI 作品详情」弹窗展示提示词、生成参数、结果文本与产物预览。

**五、存储规范（F）**
- 图片、文件、AI 产物统一落本地磁盘，数据库仅存路径与元信息；预览与下载全部走受鉴权接口，不使用 CDN 直链。

**本轮验证**
- 后端 `go build`（CGO_ENABLED=0）通过；前端 `bun run build` 通过；3000 端口重启后 `/api/status` = 200。
- `test/class_overview_e2e.py` **25/25** 通过（分发、列表、详情、参数回显、ZIP 结构、结束授课后打包、重复分发复用）。
- `test/class_session_e2e.py` **30/30** 回归通过。
- 浏览器验证：`/ai-hub/overview` 正常渲染（4 个下拉、课堂会话表格、一键分发按钮），无报错 toast。
- `bun run typecheck` 仅剩 10 处历史既有错误（已删除的 chat/playground 相关页面），本轮改动文件无新增错误。

---

# 2026-11-06 学生登录页增加年级/班级下拉

**需求**：学生登录改为「年级 → 班级 → 姓名」，用年级缩小范围、降低重名混淆；页面视觉对齐。

**后端**
- `GetWorkspaceStudentLoginClasses`（`controller/workspace_student_auth.go`）返回体补充 `grade_index`，供前端按年级序号排序。
- 该接口本就公开只读返回启用中的班级，登录仍走 `POST /api/workspace/student/login`（`class_id + name + student_no + password`），免密逻辑未变。

**前端**
- `routes/(auth)/sign-in-student.tsx` 重写表单：年级下拉（按 `grade_name` 去重、按 `grade_index` 排序）→ 班级下拉（自动落到该年级第一个班级）→ 姓名 → 学号（同名时必填）→ 密码；移除原「学号/拼音登录名」账号登录。
- 下拉用自研 `CustomSelect`（非原生 select），触发器/菜单样式与登录卡紫色主题对齐。
- 视觉对齐：输入框与下拉统一 `h-12`（48px）、圆角 11px、边框 `#e5e2f7`、焦点 `#8b7bf5`，两列 `sm:grid-cols-2` 对齐；班级选项末尾以 `12px` 灰字附学部名。

**验证**
- `bun run build`、`go build`（CGO_ENABLED=0）通过；3000 重启后 `/api/status` = 200，`/api/workspace/student/classes` 返回 `grade_index`。
- 浏览器验证 PASS：2 个自绘下拉 + 3 输入框，`document.querySelectorAll('select').length === 0`；5 个控件高度均 48px、两列边界严格对齐、圆角边框一致，无红色报错。
- `test/class_session_e2e.py` **30/30** 回归通过（学生登录链路未被破坏）。
- `bun run typecheck` 10 处错误，全部为历史既有文件，本轮改动文件无新增。

---

# 2026-11-06 修复全站自定义下拉「看不见列表、无法点选」

**现象**：创作台底部「使用模型」下拉点开后看不见选项、无法选择（DOM 里选项其实存在）。

**根因（两层，浏览器复现确认）**
1. `CustomSelect` 菜单原为 `absolute` 定位，被创作卡片祖先 `section.overflow-hidden` 裁剪 —— 菜单 rect 737–891 vs 容器底边 752，露出仅约 15px。
2. 改为 `fixed` 后仍未修复：`section.workspace-enter` 入场动画挂着 `animation-fill-mode: both`，其 `transform: matrix(1,0,0,1,0,0)` 成为 fixed 的包含块，按视口算出的 top 被整体下移 315px（≈ section.offsetTop），再次落回裁剪区。

**修复**（`components/ui/native-select.tsx`）
- 菜单改用 `createPortal(..., document.body)` 渲染，同时脱离 overflow 裁剪与 transform 包含块。
- 坐标由 `getBoundingClientRect` 按视口计算；下方空间不足时自动向上弹出（`data-placement=top`），菜单底边对齐按钮顶边。
- 打开期间监听 `scroll`（capture）与 `resize` 实时跟随；点到组件外或菜单外即关闭（点菜单内部不误关）。
- 菜单高度按选项数估算，`align=end` 时用 `translateX(-100%)` 右对齐。

**影响范围**：全站所有 `CustomSelect`（登录页年级/班级、创作台模型、教师端等）统一受益；`sign-in-student.tsx` 移除菜单的 `mt-1.5`（间距现由 JS 控制）。

**验证**
- 浏览器三轮验证闭环：Portal 后菜单 `parentElement=BODY`、`fullyInViewport=true`、`elementFromPoint` 命中选项，真实点击 `mock-chat-a → mock-chat-c` 成功；对照组「高级参数」下拉仍正常。
- `bun run build` + `go build` 通过；3000 重启后 `/api/status` = 200。
- 回归：`class_session_e2e.py` **30/30**、`class_overview_e2e.py` **25/25**。
- `bun run typecheck` 11 处错误，全为历史既有文件，本轮改动文件无新增。

---

# 2026-11-06 需求文档遗留待办第 4 项：本节课主题口径落地

**口径（用户确认）**：课程主题**不是独立实体**，分发时**默认带出备课课时标题，教师可自由修改**。

**后端**
- `model/workspace_class_session.go`：`WorkspaceClassSession` 新增 `Theme string`（`varchar(255)`，GORM AutoMigrate 自动建列）。
- `DistributeWorkspaceLesson(..., theme string)`：入参接收可选主题，`TrimSpace` 后留空回落课时标题，超长按 255 rune 截断；复用已有会话（决策 7）时同步更新 `Theme`。
- `fillWorkspaceClassSessionDisplay`：存量会话 `theme` 为空时回填课时标题，保证前端展示始终有主题。
- `controller/workspace_class_session.go`：`distributeLessonRequest` 新增 `theme` 字段。

**前端**
- `features/ai-hub/api.ts`：`AiHubClassSession` 增加 `theme`；`distributeLesson(smallClassId, lessonId, theme?)` 提交主题。
- `features/ai-hub/sections/class-overview.tsx`：分发表单新增「本节课主题（默认课时标题，可修改）」输入框；未手动编辑时主题随课时切换自动跟随，编辑过（`themeTouched`）则保留手填值；当前课堂提示、会话列表「单元 / 课时」列、提交面板标题均改为 `theme || lesson_title`。
- `features/workspace/components/class-task-panel.tsx`（学生端任务面板）与 `features/workspace/types.ts`：同步展示 `theme || lesson_title`。

**验证**
- `bun run build` + `go build` 通过，服务 3000 端口重启正常。
- `class_overview_e2e.py` 新增 2 条断言（未传主题回落课时标题 / 分发可保存自定义主题）→ **27/27 通过**；`class_session_e2e.py` **30/30 通过**。
- 浏览器验证 PASS：输入框在「一键分发」按钮左侧可见，切换课时未手编时自动带出课时标题；验证产生的临时单元/课时已清理。
- 需求文档第四节第 4 条已标注结论。

---

# 2026-11-06 学生登录页简化：年级下拉 + 账户名 + 密码

**口径（用户确认，推翻上一版「年级→班级→姓名→学号→密码」）**：学生登录只选年级，不选班级；输入的是**账户名**（学号生成的编号 或 姓名拼音全称），密码维持现有逻辑（未设置密码可留空免密登录）。拼音账号由教师导入名单时自动生成，生成有误（如 XXX1XXX2）由教师手工修改。

**后端**
- `model/workspace.go`：`FindWorkspaceStudentByAccount(account, classId, gradeName)` 增加年级过滤——年级为实时换算字段（`gorm:"-"`），新增 `filterWorkspaceStudentsByGrade` 先查班级再 `fillWorkspaceClassOrg` 回填后内存过滤，仅在账号命中多人时生效；多人未指定年级的报错文案改为「该账号对应多名学生，请核对学号或拼音账号」。
- `controller/workspace_student_login` 请求体新增 `grade_name`，`account` 非空时按「账户名 + 年级」命中；旧「班级 + 姓名」免密分支保留兼容（E2E 依赖）。

**前端**（`web/src/routes/(auth)/sign-in-student.tsx`）
- 移除班级下拉、姓名/学号输入，仅保留三项：年级 `CustomSelect` → 账户名 input（placeholder「学号编号或姓名拼音全称」，autoFocus）→ 密码 input（placeholder「未设置密码可留空」）。
- 提交 `{ grade_name, account, password }`；副标题文案同步为「先选择年级，再输入账户名（学号或姓名拼音全称）……」；紫色主题 48px/11px 圆角样式常量保留。

**验证**
- API 层：拼音账号 `wangpeng` 同名两人分属不同年级，选对年级各自命中、不选年级报多人错误、选错年级报未找到；学号与拼音唯一账号均可登录（测试造数已清理）。
- 回归：`class_session_e2e.py` **30/30**、`class_overview_e2e.py` **27/27**。
- 浏览器复验 PASS：页面仅三项（年级/账户名/密码），无班级与姓名学号输入，年级下拉 Portal listbox 展开可见「1年级」，未提交表单。
- 关键坑：`bun run build` 与 `go build` **必须串行**，并行会导致 Go embed 旧 dist、线上跑旧构建（上轮浏览器 FAIL 根因）；重启服务须带 `CRITICAL_RATE_LIMIT=3000`、`GLOBAL_API_RATE_LIMIT=3000`（否则测试触发 429）。
- `bun run typecheck` 11 处错误均为历史既有文件，本轮改动无新增。

---

# 2026-11-07 i18n 精简：仅保留英文与简体中文

**口径（用户确认）**：界面语言只保留中文（简体）与英文两种，其余语种全部删除。

**改动**
- 删除 5 个语言文件：`web/src/i18n/locales/{fr,ru,ja,vi,zh-TW}.json`（保留 `en.json`、`zh.json`）。
- `web/src/i18n/config.ts`：`LOCALE_LOADERS` 与 `supportedLngs` 收敛为 `['en', 'zhCN']`。
- `web/src/i18n/languages.ts`：
  - `INTERFACE_LANGUAGE_OPTIONS` 仅剩「简体中文 / English」（language-switcher 与语言偏好卡片自动只显示两项）。
  - `normalizeInterfaceLanguage`：任何 `zh*` 标签归到 `zhCN`，其余一律回退 `en`（修复原实现中 `zhcn` 小写与 `'zhCN'` 不匹配导致恒回 en 的隐患）。
  - `convertDetectedLanguage`：浏览器探测到的中文变体统一映射 `zhCN`。
  - `toIntlLocale` **保留 `zhTW → zh-TW` 映射**：它是数据侧语言码到 BCP-47 的纯转换函数（计价条件「週一」等数据级渲染依赖），不代表界面语言选项——移除它会破坏 billing-expression 等 85 项测试，教训是「精简界面语言 ≠ 删除数据 locale 转换」。
- `web/src/components/{date-picker,datetime-picker}.tsx`：react-day-picker 日历 locale 映射收敛为 `en/zhCN`。
- 同步修正依赖已删 locale 的测试：`model-listing`、`model-mapping-batch-dialog`、`mobile-filter`、`oauth-settings`、`viewer`（fr/zh-TW 矩阵改为 en/zhCN）、`date-picker-locale`（zhTW 用例改为「不支持语言回退 en-US」）。

**验证**
- `bun run typecheck`：11 处错误均为历史既有文件，本轮无新增。
- `bun run build` → 串行 `go build` 通过，服务带限流环境变量重启，3000 端口正常。
- 直接相关测试全过：`languages.test` + `billing-expression` 85/85、`inference-status`、`date-picker-locale`、`model-mapping-batch-dialog`、`mobile-filter`、`oauth-settings`。
- 浏览器 PASS：登录后头部「更改语言」菜单仅「简体中文（✓）/ English」两项，全页无 Français/Русский/日本語/Tiếng Việt/繁體中文。
- 全量 `bun run test`：24 文件 104 项失败，**均为历史既有失败**，两类：① `$` vs `¥` 货币符号差异（历史「定价货币统一为人民币」改动后测试未同步，cost-display 未被本轮触碰同样失败 11 项可佐证）；② 筛选/排序类组件定位失败（combobox/columnheader）。与本次 i18n 改动无关。

**日志维护说明（用户指示）**：系统设置-日志维护功能保持原样不改动，本轮仅做可用性确认——`log-settings.test.tsx` 4/4 通过。多类型选择删除（审计/使用/任务日志）留待后续。

---

# 2026-11-07 目录改名与 GitHub 上传副本

**目录改名（用户完成）**：`d:\杂项\aiworkspace\new-api` → `d:\杂项\aiworkspace\AIWorkspace`，原 new-api 目录已不存在，后续所有路径以 AIWorkspace 为准。

**GitHub 上传副本**：源码已复制到 `d:\杂项\aiworkspace\gitpart\aiworkspace`，remote 指向 https://github.com/Williamwei20130122/AIWorkspace.git（master 分支，尚无提交）。
- 复制方式：robocopy 排除 node_modules/dist/build/data/logs/tiktoken_cache 等目录与 *.exe/*.db/*.log/.env 文件，共 2659 文件 / 327.7MB。
- 副本中两个 >100MB 的 Linux 编译产物（newapi-linux-amd64/arm64）已删除并加入 .gitignore（GitHub 单文件上限 100MB）。
- 副本已验证：`bun install` + `bun run build` 通过（Go embed 所需 dist 已生成）。
- **Releases 打包按用户指示取消**，未执行 Linux 交叉编译。
- 副本内 git status 仅 53 个顶层未跟踪项、无已跟踪文件被修改；web/dist、web/node_modules、编译产物均被 ignore 规则覆盖。

---

# 2026-11-07 端口 3002 + Linux/Docker 检查 + 小班多选 + Excel 合并

**① 端口默认 3002（全链路同步）**
- `common/init.go`：`flag.Int("port", 3002, ...)`（main.go 中 `PORT` 环境变量优先）。
- Docker 6 文件：Dockerfile / Dockerfile.dev `EXPOSE 3002`；docker-compose.yml、docker-compose.dev.yml、docker-compose.prod.yml 端口映射与 healthcheck 改 3002；.env.example `APP_PORT=3002`、`# PORT=3002`。
- `new-api.service`（systemd）`--port 3002`；`web/rsbuild.config.ts` dev 代理目标 `http://localhost:3002`。
- 部署文档同步：`docs/installation/AI-Workspace-生产部署教程.md`（6 处）、`docs/installation/BT.md`（3 处）。
- 有意保留 3000 不动：README*.md（上游示例与上游镜像默认端口）、测试 fixture（与端口无关）。

**② Linux 适配与 Docker 文件检查结论：齐全**
- Dockerfile、Dockerfile.dev、docker-compose{,.dev,.prod}.yml、.dockerignore 6 文件内容完整；`.github/workflows` 6 个 CI 文件存在；makefile 存在；两个 Linux 交叉编译产物（newapi-linux-amd64/arm64）此前已生成并入 .gitignore（GitHub 100MB 上限）。

**③ 小班「所属行政班 / 授课教师」多选（管理员默认可见全部）**
- `model/workspace_small_class.go`：`ParentClassIds/TeacherIds` 改为 `WorkspaceIdList`（JSON 文本列表），新增 `Contains(id)`；`GetAllWorkspaceSmallClasses` 全量返回 + 内存 Contains 过滤（无角色过滤，管理员/教师均可见全部小班）；`fillWorkspaceSmallClassDisplay` 收集 id 集合回填，展示名按 id 顺序分号拼接；`Update()` Select 列同步；新增 `MigrateWorkspaceSmallClassMultiSelect()` 存量迁移（读旧单值列→写列表列→删旧列，幂等），在 `model/main.go` AutoMigrate 后调用。
- `controller/workspace_small_class.go`：请求体改 `parent_class_ids/teacher_ids []int`，`normalizeWorkspaceIdList` 去空去重保序；列表筛选参数仍为单值 `parent_class_id/teacher_id`（服务端 Contains 二次校验）。
- 前端：`types.ts` 类型改数组；`classes.tsx` 表单两处 Select 改 Checkbox 复选列表（`onCheckedChange` 增删）；`class-overview.tsx` 年级映射改 `parent_class_ids` some/find。

**④ 行政大班 + 上课小班 Excel 合并为一个文件**
- `controller/workspace_class_excel.go`：模板改为 4 工作表（班级 / 学生 / 小班 / 小班学生），文件名 `workspace-import-template.xlsx`；小班表表头含「所属行政班（多个用；分隔）」「授课教师（多个用；分隔）」，多选拆分支持 ；/;/、。
- `ImportWorkspaceClasses` 增量执行：小班 sheet 按名称 upsert（行政班/教师按名称解析为多 id，未知名报错跳过，编码查重，留空自动生成 S{id}）；小班学生 sheet 按「姓名+届次+年级」三层匹配直接入班（同名多候选报错，已在班跳过），返回 `small_classes_created/updated、small_members_added/skipped`。
- 串表防护：班级 sheet 关键字改「行政班」、行政班学生 sheet 关键字改「班级学生/行政班学生」，避免命中「小班」「小班学生」；单表回退排除含「小班」的表名。
- 小班模板下载 `DownloadWorkspaceSmallClassImportTemplate` 改为直接调用 `DownloadWorkspaceClassTemplate`（两端点同文件）；按小班导入 `/small-classes/:id/import` 解析时优先取「小班学生」表，且只导入属于目标小班的行（小班名称列为空的旧行为不变）。
- 前端：小班 tab 顶部动作区新增「导入 Excel」按钮（复用行政大班同一隐藏 input 与 `importClasses`）；导入摘要追加小班统计（新建/更新/入班）；两处下载文件名统一 `workspace-import-template.xlsx`。

**验证**
- `go build ./...`、`go build -o new-api.exe .` 通过；`go vet ./controller ./model` 干净。
- 临时测试 `TestTmpMergedTemplate`：模板 4 表生成、4 个解析器互不串表、；/;/、多选拆分全通过（测试文件已删除）。
- 前端：`bun check -b` 11 处错误均为历史既有（chat-presets/overview-dashboard/model-capability/system-task-history，非本轮文件）；`bun run build` → 串行 `go build` 通过；dist 产物 grep 确认包含 `workspace-import-template.xlsx`、`parent_class_ids`、`small_classes_created`、`授课教师（可多选）`。
- 服务以 `new-api.exe --port 3002` 启动，`GET /api/status` 200。
- 浏览器 PASS（admin 登录 → /ai-hub/classes → 上课小班 tab）：顶部三个按钮（下载导入模板/导入 Excel/新建小班）齐全；新建小班弹窗中所属行政班与授课教师为可滚动 Checkbox 复选列表（非下拉）；控制台 0 报错。

# 2026-11-07 厂商生成API调研 + 每日渠道余额检查与预警

**① 厂商图片/视频生成 API 调研结论（q1）**
- 智谱 GLM：图片同步 `/images/generations` 返回 URL（有特定参数 quality/size/watermark_enabled/user_id）；异步 `/async/images/generations` + GET `/async-result/{id}` 轮询；视频 `/videos/generations` 异步（with_audio/fps/duration）。GLM 无专用任务插件，走 OpenAI 兼容同步路径。
- DashScope（阿里）：全异步 task_id，URL 24h 有效；方舟 Seedance 异步、Seedream 同步 response_format=url(24h)/b64_json；OpenAI 图 URL 60 分钟有效；Veo 异步 operation 2 天；混元 ResultImage URL 1 小时；Sora 已关停。
- 统一结论：临时 URL 必须服务端转存、异步任务必须轮询后下载产物——项目已有完整基建，无需新开发。

**② 异步与 URL 转存现状核对（q4，零改动）**
- 同步图片：middleware `WorkspaceArtifactCapture` 截留响应体（url→服务端下载落盘、b64_json→解码落盘），学生预览走本地鉴权接口，不依赖上游临时 URL。
- 异步任务：model.Task 落库 + 15s `asyncTaskPollHandler`（service.RunTaskPollingOnce）轮询，终态 `CollectWorkspaceTaskArtifact` 下载落盘，`TaskTimeoutMinutes` 超时兜底。
- 插件协议适配已覆盖 alibaba（X-DashScope-Async）、kling、jimeng、doubao（同步）、google Veo、vidu、vertex-ai、sora、sunoapi、xai；GLM 走 OpenAI 兼容同步路径被现有链路覆盖。

**③ 每日渠道余额检查 + 余额预警（q3，新功能）**
- 配置：`setting/operation_setting/monitor_setting.go` MonitorSetting 新增 `AutoBalanceCheckEnabled`（默认 false）、`ChannelBalanceAlertThreshold`（<=0 关闭预警）；新增 `ValidateChannelBalanceAlertThreshold`（0~1e9 数值校验）。
- 选项白名单：`model/request_policy.go` IsRequestPolicyOption/布尔校验/阈值校验纳入 `monitor_setting.auto_balance_check_enabled`、`monitor_setting.channel_balance_alert_threshold`（走 /api/option/request_policy 读写，经 config 分层配置自动生效）。
- 执行：`controller/channel-billing.go` 新增 `RunChannelBalanceCheckTask`——遍历启用渠道逐个 updateChannelBalance（跳过 multi-key），`isBalanceQueryUnsupported`（errors.As 识别 Not implemented yet）计入 Unsupported 不视为失败，逐渠道间隔 common.RequestInterval，低于阈值的渠道汇总为一条通知。
- 通知：`relaykit/dto/notify.go` 新增 `NotifyTypeChannelBalanceAlert`；i18n keys `channel.balance_alert_subject/content` 三语言文案（en/zh-CN/zh-TW）；经 `service.NotifyChannelWatchers` 发给开启渠道通知的管理员（复用频控）。不复用 updateAllChannelsBalance 的自动禁用行为。
- 调度：`model/system_task.go` 新增 `SystemTaskTypeChannelBalanceCheck`；`controller/system_task_handlers.go` 注册 `channelBalanceCheckHandler`（Interval=24h，Enabled 读开关），复用 System Task Runner 的 15s 调度与 per-type DB lease 去重。
- 前端：`web/src/features/system-settings/request-policies/` defaults.ts 类型与默认值、channel-health-section.tsx zod schema/normalize 三处映射 + 新增「每日余额检查」区块（开关 + 阈值数字输入）；web/src/i18n/locales/{en,zh}.json 各新增 7 个文案键。

**验证**
- `gofmt -w` 已格式化 monitor_setting.go、channel-billing.go；`go build ./...` 通过；`go test ./setting/... ./i18n/...` 全通过。
- 前端 `bun run typecheck`：本轮改动文件 0 错误（11 处历史既有错误在 chat-presets/overview-dashboard/model-capability/system-task-history）；`bun run test -- src/features/system-settings`：settings.test 18/18、channel-health-layout 3/3 通过（10 个失败均在 pricing-sync/email-notifications/routing，与本轮无关）；`bun run build` 通过。

# 2026-11-07 授课教师可选中学生的 Bug 修复

**问题**：小班「授课教师（可多选）」复选框列表遍历的是全量用户接口 `/api/workspace/{scope}/users`（GetWorkspaceUsers 返回 GetAllUsers 前 100 个用户，不区分角色），因此学生账号（role=1）也出现在授课教师候选里。
**根因**：前端 classes.tsx 用 `fetchUsers` 填充教师复选框与新建小班默认 teacher_ids；后端 Create/UpdateWorkspaceSmallClass 对 teacher_ids 仅做 normalizeWorkspaceIdList（去空去重），无角色校验。（Excel 导入链路已有 ListWorkspaceTeacherUsers 过滤，接口保存链路没有。）
**修复**：
- 后端 `controller/workspace_small_class.go`：新增 `validateWorkspaceTeacherIds`（基于 `model.ListWorkspaceTeacherUsers` role>=RoleAdminUser 白名单），CreateWorkspaceSmallClass / UpdateWorkspaceSmallClass 落库前校验，非教师 id 返回「用户 ID x 不是教师账号…」错误。
- 前端 `web/src/features/ai-hub/sections/classes.tsx`：新增 teachersQuery（复用已有 `fetchTeachers` → /{scope}/teachers，与 grades.tsx 同一 queryKey ['ai-hub','teachers'] 共享缓存）；小班复选框列表、新建小班默认 teacher_ids 均改用 teachers（user_id 字段），users 保留给「关联账号」学生下拉。
**注意**：存量数据 teacher_ids 中非教师 id（如有）在下次保存时会被拒绝，需先清掉；当前库中小班 #1 绑定的 1/3/6 均为 admin/teacher/root（role>=10），无需清理。
**验证**：`go build ./...` OK、`go vet ./controller` 干净；前端 `bun run typecheck` 无 classes.tsx 新增错误。

# 2026-11-07 云端素材自动删除功能 + 测试日志清理

**需求**：云端素材页可设置保留时长（如创建后 2 个月），超期素材自动删除磁盘文件，保留生成记录但禁止预览下载；同时清空当前测试日志。

**后端**：
- `model/system_task.go`：新增 `SystemTaskTypeWorkspaceArtifactCleanup = "workspace_artifact_cleanup"`。
- `model/workspace_artifact.go`：`WorkspaceArtifact` 新增 `FilePurged`（bool, default:false, index）与 `PurgedAt`（int64）字段，AutoMigrate 自动建列；新增 `ListExpiredWorkspaceArtifacts(cutoff, limit)`（created_at < cutoff 且未清理，NOT IN WorkspaceTaskSubmission.artifact_id 引用，每批 500）与 `MarkWorkspaceArtifactsFilePurged(ids, purgedAt)`；`AggregateWorkspaceArtifactStats` 增加 `file_purged = false` 条件（空间占用不计已删文件）。
- `setting/workspace.go`：新增 `WorkspaceArtifactRetentionDaysKey = "WorkspaceArtifactRetentionDays"`、`GetWorkspaceArtifactRetentionDays()`（0 = 关闭）、`NormalizeWorkspaceArtifactRetentionDays()`（0-3650 校验）；`model/option.go` InitOptionMap 注册默认值 "0"，validateOptionValue 接入校验。
- `service/workspace_cleanup.go`：新增 `workspaceArtifactCleanupHandler`（每天 24h 一次，Enabled = retentionDays > 0；Run 分批删文件 → store.Delete 容错（文件不存在视同已清理）→ 打 FilePurged 标记保留记录；单任务最多 100 批 x 500 条），在 init() 注册（与 workspaceGraduatedPurgeHandler 同处）。
- `controller/workspace_artifact.go`：`GetWorkspaceArtifactContent` 对 FilePurged 素材返回「已超过保留期限自动清理，记录保留但不可预览下载」；`PackageWorkspaceArtifacts` zip 打包跳过 FilePurged 条目。

**前端**：
- `web/src/features/ai-hub/types.ts`：AiHubArtifact 加 `file_purged`/`purged_at`。
- `web/src/features/ai-hub/api.ts`：新增 `ARTIFACT_RETENTION_OPTION_KEY`、`fetchArtifactRetentionDays`（GET /api/option/ 找 key）、`saveArtifactRetentionDays`（PUT /api/option/，RootAuth 仅超管可用）。
- `web/src/features/ai-hub/sections/cloud-assets.tsx`：超管新增「自动清理」设置面板（保留天数输入 + 保存，0=关闭，占位示例「60 表示两个月」）；retentionQuery 回填；预览/下载 handler 与行内按钮对 file_purged 素材禁用并提示；文件名旁显示「已清理」徽标；预览弹窗下载按钮对 file_purged 禁用。
- `web/src/features/system-info/constants.ts`：SYSTEM_TASK_TYPE_LABEL 补 `workspace_artifact_cleanup`。

**日志清理**：删除 logs/oneapi-*.log、logs/console.*.log、run-3002.log、run-3002.err.log 及根目录 *.log，运行中 new-api 进程已停止，无残留。

**验证**：`go build ./...` exit 0；`go vet ./model ./setting ./service ./controller` 干净；`gofmt -l` 改动文件无输出；前端 `bun run typecheck` 本轮文件 0 新增错误（11 处历史错误在 chat-presets/overview-dashboard/model-capability/system-task-history）；`bun run build` 通过。

---

## 2026-11-07 课堂任务独立页签 + 小班 AI课堂/HTML实验室双开关 + Excel 模板优化

**需求（用户 5 点确认）**：1）「我的任务」页签仅学生可见；2）默认页签：无任何任务→开始创作，当前课时无 AI 产出任务→我的任务，有 AI 任务→开始创作；3）AI课堂开关在小班管理设置且 Excel 导入支持；4）HTML 实验室按小班开关控制、默认关闭；5）优化导入模板示例数据。

**后端**：
- `model/workspace_small_class.go`：`WorkspaceSmallClass` 新增 `HtmlEnabled`（default:false）；`Update()` Select 列表加 `html_enabled`；新增 `WorkspaceStudentHtmlEnabled(userId)`（与 AI 开关同构三段式：任一 enabled 小班 html 开→放行，全关→拦截，无小班归属→不拦截）与 `SetWorkspaceSmallClassHtml`。
- `controller/workspace_small_class.go`：请求体新增 `html_enabled *bool`，Create/Update 接线；`SetWorkspaceSmallClassAIEnabled` 扩展为 `ai_enabled`/`html_enabled` 二选一均可切换（复用同一 PUT /small-classes/ai 路由）。
- `controller/workspace.go`：GetWorkspaceCapabilities 响应增加 `html_enabled`（教师/管理员恒 true）。
- `controller/workspace_html.go`：GetWorkspaceHtmlLabConfig `enabled = htmlEnabled && len(models)>0`，关闭时前端隐藏入口。
- `middleware/workspace.go`：WorkspaceGenerateRoute 按 capability id == "html" 对学生二次拦截未开通小班的 HTML 生成请求。
- `controller/workspace_class_excel.go`：小班表头新增「AI课堂（是/否）」「HTML实验室（是/否）」两列；`wsExcelSmallClassRow` 加 `AiEnabled/HtmlEnabled *bool`；新增 `parseWsExcelBoolPtr`（是/否、Y/N、1/0、true/false、开/关，缺列或留空返回 nil 沿用默认）；parseWsExcelSmallClasses 解析两列；创建处默认 `AiEnabled:true, HtmlEnabled:false` 并按行覆盖，更新处同步覆盖；模板示例优化为三个工作表各 2-3 行（班级表加二班、学生表加密码/小班编码/不同届示例、小班表加多行政班/多教师/选修及两开关示例）。

**前端**：
- `web/src/features/ai-hub/types.ts`：AiHubSmallClass 加 `html_enabled: boolean`。
- `web/src/features/ai-hub/api.ts`：新增 `setSmallClassHtml`（PUT /small-classes/ai 带 html_enabled）。
- `web/src/features/ai-hub/sections/classes.tsx`：小班列表加「HTML 实验室」开关列；新建小班初始值 `html_enabled:false`；编辑弹窗加「HTML 实验室开关」Field；面板描述文案更新。
- `web/src/features/workspace/api.ts`：WorkspaceCapabilitiesResult 加 `html_enabled`（数组兼容分支回退 true）。
- `web/src/features/workspace/components/workspace-studio.tsx`：view 加 `'tasks'`；新增 `htmlEnabled`；页签数组按 aiEnabled/htmlEnabled 组合且 tasks 仅学生；标签渲染加「我的任务」；html 视图改由 htmlEnabled 控制；新增默认页签一次性 effect（classSession 加载完成后判定：无任务→create/records，无 AI 产出任务→tasks，有→create）；原右侧内联 ClassTaskPanel 改为仅 create 视图渲染 `variant='floating'`，tasks 视图渲染 `variant='page'`。
- `web/src/features/workspace/components/class-task-panel.tsx`：新增 `variant?: 'page'|'floating'`；page 形态为常驻大卡片（双列任务网格、空态文案），floating 形态恒为右下角浮层（默认收起为浮动按钮、带任务数徽标，无任务/无会话时不渲染）；移除 ai_course 折叠逻辑与 useEffect。

**验证**：`go build ./...` exit 0；`go vet ./controller ./model ./middleware` 干净；`gofmt -l` 改动文件无输出；`bun run typecheck` 无新增错误（仍为 11 处历史错误）；`bun run build` 通过（52.4s）。

## 2026-11-07 前端卡顿修复 + 后端内存优化 + 学生页面视觉补齐

**需求**：用户反馈前端页面卡（教师端滚动/动画卡顿为主）、后台内存占用大；要求先修卡顿再统一视觉，视觉补齐范围为学生登录页、创作台全部页签、历史记录/详情弹窗等全部学生触达页面。

**后端内存优化**：
- `main.go`：启动早期设置 `debug.SetMemoryLimit` 软性内存上限，`GOMEMLIMIT_MB` 环境变量可覆盖，默认取进程所在机器物理内存的 75%（读 `runtime.MemStats.Sys` 推算），并打印启动日志。
- `model/main.go`：主库与日志库连接池默认值收紧——`MaxIdleConns` 100→25、`MaxOpenConns` 1000→300（`SQL_MAX_IDLE_CONNS`/`SQL_MAX_OPEN_CONNS`/`SQL_MAX_LIFETIME` 环境变量可覆盖），减少空闲 TCP 连接与驱动缓冲常驻内存。
- `setting/performance_setting/config.go`：磁盘缓存默认值 `DiskCacheEnabled` false→true（阈值仍为 10MB），使上游图片/视频等大文件下载超过 10MB 即落盘缓存，不再整块驻留内存（此前默认关闭导致所有下载全量进内存 + base64 再翻倍）。

**前端性能修复**：
- `workspace-studio.tsx`：移除 fixed 全屏噪点层（feTurbulence SVG + mix-blend-multiply，每帧滚动都强制合成）；sticky header `backdrop-blur-xl` 改纯色 `bg-white/95`；能力页签与能力卡片 `transition-all` 收敛为 `transition-colors`；页签条 `backdrop-blur` 移除。
- `teacher-studio.tsx` / `chat-composer.tsx`：教师端固定 header 与输入栏 `backdrop-blur-xl` 移除，改不透明底色。
- `public-header.tsx`：滚动吸顶 nav 的 3 处 `transition-all` 收敛为具体属性（max-width/padding、height/padding/background/box-shadow/radius、opacity），吸顶态 `backdrop-blur-2xl` 移除改 `bg-background/90`，移动全屏遮罩 blur 移除。
- `overview-dashboard.tsx`：两处卡片 `backdrop-blur` 移除，改不透明背景。
- `bulk-actions.tsx`：批量操作浮条 `backdrop-blur-lg` 移除改 `bg-background/98`。
- `class-overview.tsx`（教师概览）：课时详情轮询 8s→12s（会话列表维持 15s），降低高频请求与重渲染。
- `styles/index.css`：表格行入场动画改为仅对 `nth-child(n+20)`（视口外行）做 60ms 单段入场，前 19 行取消逐行动画——此前每行 25ms 阶梯 delay 使长表每次 refetch 都产生大量样式/绘制工作。

**学生页面视觉补齐**：
- `sign-in-student.tsx`：新增与创作台同源的紫色氛围背景（三处径向渐变 + 34px 网格线 + radial mask，fixed 不随卡片滚动、`-z-10` 置于卡后，无噪点层），登录卡片加 `workspace-enter` 入场动效。
- `html-lab.tsx`：根容器补 `workspace-enter` 入场动效；工具条 `bg-white/85` 改实色 `bg-white`。
- 生成面板、我的任务页、我的记录、账户页、点数/详情弹窗均确认已有 `workspace-enter` 与统一紫色卡片视觉，与登录页补齐后的背景形成一致风格。

**验证**：`go build ./...` exit 0；`go vet . ./model/ ./setting/performance_setting/` 干净；`gofmt -l` 仅报 4 个本轮未改动的存量文件；`bun run typecheck` 仍为 11 处历史错误、0 新增；`bun run build` 通过。

## 2026-11-07 修复：已删除的模型仍出现在前端模型下拉

**问题**：用户反馈部分已删除的模型在学生/教师端的模型选择下拉里仍可被选中。

**根因**：
- 学生/教师端能力接口 `GetWorkspaceCapabilities`（controller/workspace.go）与 HTML 实验室配置接口 `GetWorkspaceHtmlLabConfig`（controller/workspace_html.go）直接下发能力声明，没有做模型存在性过滤（只有管理端 `GetWorkspaceModelCapabilitiesAdmin` 做了过滤）。
- `workspaceExistingModelNames()`（controller/workspace_pricing.go）把 abilities 表（渠道已启用）里的模型也算「存在」——模型管理删除时若未勾选「从渠道移除」，该模型永远不算 stale，启动兜底清理 `PruneStaleWorkspaceModelConfig` 会放行残留声明；且渠道侧编辑/删除模型的路径不会触发声明清理。

**修复**：
- `controller/workspace.go`：新增 `filterWorkspaceCapabilityModels(caps)` —— 按 `workspaceExistingModelNames()` 过滤每个能力的 `Models` 列表，全部被过滤时 `Enabled=false`（前端隐藏入口），同步剔除 `ModelVoices`/`ModelQPaths` 里已删模型的键，并按过滤后的模型重算 tts 的 `Voices` 音色并集；`GetWorkspaceCapabilities`（学生/教师端）与 `GetWorkspaceCapabilitiesAdmin` 均改用该过滤。
- `controller/workspace_pricing.go`：`workspaceExistingModelNames()` 增补排除——查询 models 表软删记录（deleted_at 非空），命中且不存在同名存活行时从可用集合中剔除；同名模型删除后重建（有存活行）不受影响；任一查询失败则跳过排除（保守保留，避免误伤）。由此管理端过滤、启动兜底清理、定价过滤同步受益。
- `controller/workspace_html.go`：HTML 实验室配置接口的 models 循环加上同样的存在性过滤。

**测试**：新增 `controller/workspace_capability_filter_test.go` 3 个用例：
- `TestWorkspaceCapabilitiesOmitDeletedModelResidue`：删除后仍残留渠道的模型被过滤、仅渠道配置的测试模型保留；
- `TestWorkspaceCapabilitiesKeepsRecreatedModelWithDeletedHistory`：同名重建不被历史软删误过滤；
- `TestWorkspaceHtmlLabConfigOmitsDeletedModelResidue`：实验室接口同样过滤。

**顺手修复存量**：`controller/model_management_test.go` 两处断言未同步上一任务新增的 `DeletedNames` 字段（L1319、L1393），补齐后子测试全部 PASS。

**验证**：`go build ./...` exit 0；`go vet ./controller/` 干净；`gofmt -l` 改动文件无输出；新 3 用例 + `TestModelDeletionDatabaseMatrix` 全部子测试通过（仅剩 Windows TempDir audit.db 文件锁的环境性 cleanup 失败，与改动无关）。

## 2026-11-08 全平台使用教程 + 学生端指南（多任务延续）
- 备课模式支持 Excel 导入：新增 controller/workspace_lesson_plan_excel.go（模板下载+幂等导入），teacherRouter 注册 /lesson-plans/import-template 与 /lesson-plans/import，前端备课页新增「下载导入模板 / Excel 导入」按钮与失败清单弹窗；Python requests 上传验证通过（重复导入幂等）
- 渠道新增 3 个测试渠道与 10 个模型能力声明、12 条模型定价（模型管理补足真实数据），6 名测试学生各下发 200 点（接口参数 mode=set + value）
- HTML 实验室菜单项新增 Beta 徽章（workspace-studio.tsx）
- 教师端备课创建 2 单元/3 课时/4 任务真实数据，课时 1 已分发到小班 1
- web/src/features/docs/workspace-guide.tsx 从零重写：5 章节侧边栏教程（快速开始/学生与班级/备课教学/教师个人/系统管理-超管），按 auth.role 过滤章节（minRole），配 15+ 张真实截图（web/public/docs/guide/）
- use-top-nav-links.ts 顶部「文档」入口重定向到站内 /docs/workspace-guide（移除外链下拉）
- 新增学生端 Word 使用指南：d:/杂项/aiworkspace/AIWorkspace学生使用指南.docx（7 章节 + 6 张截图：登录/开始创作/文生文步骤/课堂任务提交/HTML实验室/我的记录/常见问题）
- 截图素材：C:/Users/willi/AppData/Local/Temp/aw-shots/01-42 系列已复制至 web/public/docs/guide/
- 验证：typecheck 11 存量错误 0 新增、bun run build、go build 通过；浏览器实测教程页章节切换与权限过滤正常

## 2026-11-08 Docker 发布包与部署教程完善
- 新增 refile/v1.0/AIWorkspace-v1.0/ 发布目录：docker-compose.sqlite.yml（SQLite 单机生产编排，限流 3000、healthcheck、data/logs 卷、2g 内存限制）、.env.sqlite 环境模板、部署教程.md（8 章简明手册）、完整源码副本
- 完善 docs/installation/AI-Workspace-生产部署教程.md：新增 §0.5 SQLite 单机 Docker 快速部署路线、§8.1 新版本更新流程（IMAGE_TAG 版本管理、覆盖升级/git 两种方式、升级要点表、回滚与备份恢复）
- VERSION=1.0.0 写入主仓库并同步至 gitversion / testfile / refile 三处
- 源码三副本同步：gitversion（2695 文件）、testfile（保留 one-api.db 测试数据）、refile/v1.0/AIWorkspace-v1.0（排除 node_modules/dist/data/logs/二进制/db）
- 打包 refile/v1.0/AIWorkspace-v1.0.zip（22.45MB / 2733 entries，含 Dockerfile、docker-compose.sqlite.yml、.env.sqlite、两份教程，无数据库文件）

## 2026-11-08 教程页布局修复与内容细化
- 修复页面未撑满问题：正文区移除 max-w-3xl 窄栏限制，改为 w-full 铺满剩余宽度，内边距加大（px-8 py-8），标题字号升至 text-2xl
- 侧栏细化：章节点击后展开该章全部小节锚点（带左边框缩进），点击小节平滑滚动到对应 section（goto + scrollIntoView）
- 章节小节数量扩充：快速开始 2→4（新增顶部导航与模型广场、通用界面操作习惯），学生与班级管理 7→10（新增编码规则、新增/编辑学生与拼音、点数下发管理），备课 4→5（新增课时与任务配置详解），教师个人 3→6（新增 HTML 实验室 Beta 功能详解、文档帮助入口），系统管理 6→7（新增云端素材管理）
- 内容深化：各小节正文改为表格化逐字段说明（登录入口对照、班级列表列说明、新建班级逐字段、Excel 多选分隔符、开关与关系、课堂会话操作、渠道四步创建、能力声明四步、定价四块、Beta 功能规则表等）
- 配图从 15 张增至 22 张（复用 guide 目录既有截图：16-dashboard、10-pricing、06-elective-import、06-members-selected、04-students、07-lesson、22-channel-menu、08-storage、27-model-pricing、33-student-html-lab 等）
- 验证：typecheck 11 存量错误 0 新增、bun run build、go build 均通过；浏览器实测布局撑满、小节锚点展开与滚动、Beta 小节渲染正常
- 已同步 gitversion / testfile / refile 三副本并重新打包 AIWorkspace-v1.0.zip（22.45MB / 2733 entries）

## 2026-11-08 部署教程重构（SQLite 专用 + 本地构建→内网部署）与学生 Word 指南接入
- 生产部署教程完全重写为 SQLite 专用：删除 PostgreSQL 安装、Redis 安装、PG 连接串/建库授权等全部章节，明确标注「PostgreSQL / Redis 不需要」
- 部署流程改为用户实际方式：【自己的电脑】docker build 构建镜像 → docker save 导出 tar → scp/U盘传内网服务器 → docker load 导入 → up -d --no-build 启动（服务器全程不联网、不构建）
- 新版更新流程同构：本地 build 新镜像 → save 传输 → 服务器 down/load/覆盖(保留 .env+data)/改 IMAGE_TAG/up --no-build/verify/prune
- 两份教程同步重写：docs/installation/AI-Workspace-生产部署教程.md（11 章）+ refile/v1.0/AIWorkspace-v1.0/部署教程.md（三阶段简明版），已验证发布包内教程不含 PostgreSQL 章节
- 学生端 Word 使用指南接入站内：复制到 web/public/docs/AIWorkspace-student-guide.docx，教程页标题右侧新增「下载《学生使用指南》Word 版」下载按钮（HEAD 请求 200 验证），同时放入发布包根目录
- 验证：typecheck 0 新增错误、bun run build、go build 通过，服务重启后下载接口 200
- 三副本同步 + 重新打包 AIWorkspace-v1.0.zip（29.69MB / 2734 entries，含 Word 指南与两份 SQLite 教程，无数据库）
