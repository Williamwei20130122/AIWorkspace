# AI Workspace 生产部署教程（SQLite + Docker，内网服务器）

本教程面向**内网服务器**部署形态：数据库统一使用 **SQLite**（无 PostgreSQL / Redis），
镜像在**自己的电脑上构建**好，再把镜像传到内网服务器部署——内网服务器无需联网构建。

```
【你的电脑】                     【内网服务器】
源码 + Dockerfile                 docker load 镜像
   │ docker build                    │
   ▼                                ▼
镜像 ai-workspace:v1.0.0  ──scp/U盘──▶  docker compose up -d
   │ docker save                        │
   ▼                                   ▼
xxx.tar ──────────────────▶   ./data/one-api.db + 素材文件
```

---

## 0. 部署形态总览

```
        ┌─────────────── 用户浏览器 ───────────────┐
        │                                          │
        ▼                                          ▼
┌────────────────────────────────────────────────────────┐
│  Nginx（可选，需要 HTTPS 时才装）                        │
└──────────────────────────┬─────────────────────────────┘
                           │ 回源
                           ▼
┌────────────────────────────────────────────────────────┐
│          内网服务器：AI Workspace（Docker 容器）          │
│          Go 单二进制，内嵌前端，监听 3002                  │
│          SQLite 库 + 生成素材全部落 ./data 目录           │
└────────────────────────────────────────────────────────┘
```

| 组件 | 是否需要 | 说明 |
| --- | --- | --- |
| 内网服务器 | 必需 | 2C4G 起步可支撑一个班量级并发；4C8G 更稳妥 |
| Docker + Compose v2 | 必需 | 服务器**只需能运行容器**，构建在自己电脑上完成 |
| SQLite | 必需 | 自动创建，无需安装任何数据库软件 |
| PostgreSQL / Redis | **不需要** | 本部署形态完全不使用 |
| Nginx | 可选 | 仅当需要 HTTPS / 统一域名入口时使用 |
| 本地磁盘 | 必需 | 生成素材落 `./data/workspace-artifacts`，无对象存储依赖 |

> 关键约定：**必须使用本仓库的 `Dockerfile` 构建镜像**。上游 `calciumion/new-api` 官方镜像
> 不包含本项目的 AI Workspace 定制（双皮肤、教学增强、云端素材等），直接使用会丢失全部定制功能。

**发布包内容**（`AIWorkspace-v1.0.zip`）：

| 文件 | 用途 |
| --- | --- |
| 源码全部 | 用于本地构建镜像 |
| `Dockerfile` | 三阶段构建（bun 构建前端 → go 构建后端 → 运行时镜像） |
| `docker-compose.sqlite.yml` | SQLite 单机编排（端口、卷、限流、健康检查已配好） |
| `.env.sqlite` | 环境变量模板（复制为 `.env` 使用） |
| `部署教程.md` | 与本教程同内容的简明版 |
| `AIWorkspace学生使用指南.docx` | 学生端 Word 使用教程 |

---

## 1. 环境要求

**自己的电脑（构建机）**

| 项 | 要求 |
| --- | --- |
| 操作系统 | Windows / macOS / Linux 均可 |
| Docker Desktop | 20.10+，内置 Compose v2（`docker compose version` 验证） |
| 内存 | 构建时建议 ≥ 8GB 分配给 Docker |
| 网络 | 首次构建需联网拉取基础镜像与依赖（国内已默认配 goproxy.cn / npmmirror 镜像源） |
| 磁盘 | 预留 10GB 以上（镜像层 + 导出的 tar） |

**内网服务器（运行机）**

| 项 | 要求 |
| --- | --- |
| 操作系统 | Linux（CentOS / Ubuntu / 麒麟等） |
| Docker | 20.10+，**无需联网** |
| Compose v2 | `docker compose version` 有输出即可 |
| 配置 | 2C4G 起步；支撑 400-500 并发建议 4C8G 以上 |
| 端口 | 放行 3002（或收敛到 80/443 仅走 Nginx 回源） |

---

## 2. 阶段一：在自己的电脑上构建镜像

### 2.1 解压发布包

```bash
unzip AIWorkspace-v1.0.zip -d aiworkspace-build
cd aiworkspace-build/AIWorkspace-v1.0
```

Windows 用资源管理器解压即可，进入解压后的 `AIWorkspace-v1.0` 目录（含 `Dockerfile`）。

### 2.2 确认版本号

镜像 tag 决定版本标识，构建前确认 `.env.sqlite` 中的版本与要发布的版本一致：

```bash
grep IMAGE_TAG .env.sqlite
# IMAGE_TAG=v1.0.0
```

`VERSION` 文件内容应与之对应（`1.0.0`），二者共同决定界面右上角与接口返回的版本号。

### 2.3 构建镜像

```bash
# Windows (PowerShell) / macOS / Linux 通用
docker build -t ai-workspace:v1.0.0 .
```

> - 首次构建需拉取 `oven/bun`、`golang`、`debian` 基础镜像并编译前后端，**耗时较长属正常**（10-30 分钟）。
> - 卡在拉取基础镜像时，检查 Docker Desktop 的镜像加速配置。
> - 后续增量修改代码后重新执行同一条命令，Docker 层缓存会自动跳过未变动的步骤。
> - 怀疑构建了旧代码时加 `--no-cache` 全量重建。

构建成功后验证：

```bash
docker images ai-workspace
# REPOSITORY     TAG      ...
# ai-workspace   v1.0.0  ...
```

### 2.4 导出镜像为 tar 文件

```bash
docker save -o ai-workspace-v1.0.0.tar ai-workspace:v1.0.0
```

导出后得到约 200-400MB 的 `ai-workspace-v1.0.0.tar`，这就是要传到内网服务器的文件。

---

## 3. 阶段二：把镜像与发布包传到内网服务器

需要传两个东西：

1. **镜像文件**：`ai-workspace-v1.0.0.tar`
2. **发布包**：`AIWorkspace-v1.0.zip`（含编排文件、环境模板、源码、教程）

**方式 A：scp（服务器与你的电脑网络互通时）**

```bash
scp ai-workspace-v1.0.0.tar AIWorkspace-v1.0.zip user@内网服务器IP:/opt/
```

**方式 B：U 盘 / 内网文件服务器**

把两个文件拷到 U 盘带到服务器，或上传到内网共享目录后在服务器上取。

**服务器上导入镜像：**

```bash
cd /opt
docker load -i ai-workspace-v1.0.0.tar
docker images ai-workspace    # 确认 v1.0.0 已出现
```

> `docker load` 完成后内网服务器即具备运行镜像的能力，全程无需联网。

---

## 4. 阶段三：在内网服务器上部署

### 4.1 解压并配置

```bash
cd /opt
unzip AIWorkspace-v1.0.zip -d ai-workspace
cd ai-workspace/AIWorkspace-v1.0

# SQLite 形态无需填写任何连接串
cp .env.sqlite .env
```

按需修改 `.env`（都有默认值，可先不改）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `APP_PORT` | 3002 | 宿主机映射端口 |
| `IMAGE_TAG` | v1.0.0 | 必须与 `docker load` 导入的镜像 tag 一致 |
| `APP_MEMORY_LIMIT` | 2g | 容器内存上限，4C8G 建议调到 4g |
| `TZ` | Asia/Shanghai | 时区 |
| `CRITICAL_RATE_LIMIT` / `GLOBAL_API_RATE_LIMIT` | 3000 | 教室同出口 IP 场景**不要调低**（见第 8 节） |

### 4.2 启动（使用已导入的镜像，不触发构建）

```bash
docker compose -f docker-compose.sqlite.yml up -d --no-build
```

> `--no-build` 表示只用 `docker load` 进来的镜像，服务器上**不会触发任何构建与联网拉取**。

健康检查：

```bash
docker compose -f docker-compose.sqlite.yml ps          # STATUS 应为 healthy
curl -s http://127.0.0.1:3002/api/status                # 期望包含 "success":true
docker compose -f docker-compose.sqlite.yml logs -f --tail=100
```

### 4.3 首次登录

打开 `http://内网服务器IP:3002`，系统首次启动自动创建超级管理员：

```
用户名：root
密码：  123456
```

**立即登录并在「个人资料 / 安全与访问」中修改密码**，随后创建教师与学生账号。

### 4.4 数据落点与持久化

| 宿主机目录 | 容器目录 | 内容 |
| --- | --- | --- |
| `./data` | `/data` | SQLite 数据库（`one-api.db` + WAL）、全部生成素材、上传文件 |
| `./logs` | `/app/logs` | 应用日志 |

```
./data/
├── one-api.db            # SQLite 主库
├── one-api.db-wal
├── one-api.db-shm
└── workspace-artifacts/  # 图片/音频/视频/音乐等生成素材
```

这两项已通过 `volumes` 挂载到宿主机，**容器重建、镜像升级都不会丢数据**。
数据库表结构在应用启动时自动迁移（AutoMigrate），无需手工建表。

---

## 5. 备份

数据全部在 `./data` 一个目录里，备份即备份该目录：

```bash
# 定时任务建议：每天凌晨备份
tar czf /opt/backup/data-$(date +%F).tar.gz -C /opt/ai-workspace/AIWorkspace-v1.0 ./data

# 服务运行中想单独热备份数据库（不要直接 cp，WAL 中的数据会丢）
sqlite3 ./data/one-api.db ".backup './backup-$(date +%F).db'"
```

**升级或迁移前务必先备份 `./data` 与 `.env`。**

---

## 6. 新版本更新流程（重点）

新版本的构建**永远在自己电脑上完成**，内网服务器只负责导入新镜像并重启：

```
【你的电脑】                          【内网服务器】
拿到新版源码                            1. 备份 ./data + .env
docker build 新镜像                     2. docker compose down
docker save 导出 tar                    3. 上传新 tar
      ────── 传输新 tar + 新发布包 ──────▶ 4. docker load
                                           5. 覆盖编排文件（保留 .env/data）
                                           6. 改 IMAGE_TAG
                                           7. up -d --no-build
                                           8. 验证
```

### 6.1 你的电脑上

```bash
# 1. 更新源码（解压新版发布包，或 git pull）
unzip AIWorkspace-v1.1.zip -d newver
cd newver/AIWorkspace-v1.1

# 2. 构建新镜像（tag 换成新版本号）
docker build -t ai-workspace:v1.1.0 .

# 3. 导出
docker save -o ai-workspace-v1.1.0.tar ai-workspace:v1.1.0
```

### 6.2 内网服务器上

```bash
# 1. 备份（必做）
cd /opt/ai-workspace/AIWorkspace-v1.0
tar czf /opt/backup/pre-upgrade-$(date +%F).tar.gz ./data .env

# 2. 停止旧版
docker compose -f docker-compose.sqlite.yml down

# 3. 导入新镜像
docker load -i ai-workspace-v1.1.0.tar

# 4. 覆盖新版文件（编排/环境模板/源码），保留 .env、data/、logs/
unzip -o AIWorkspace-v1.1.zip -d /tmp/newver
cp -rf /tmp/newver/AIWorkspace-v1.1/* .
rm -rf /tmp/newver

# 5. 修改镜像版本号（关键：不改则 up 仍指向旧镜像）
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v1.1.0/' .env

# 6. 启动新版
docker compose -f docker-compose.sqlite.yml up -d --no-build

# 7. 验证并清理旧镜像
curl -s http://127.0.0.1:3002/api/status    # 期望 "success":true
docker image prune -f                       # 清理悬空旧镜像，释放磁盘
```

**升级要点：**

| 事项 | 说明 |
| --- | --- |
| 数据安全 | 数据库与素材都在 `./data` 卷内，升级只换镜像不动数据；**升级前必份 `./data` 与 `.env`** |
| IMAGE_TAG | 必须改成新版本号，否则 `up` 仍指向旧镜像，页面还是旧版 |
| 覆盖时保留 | **不要删** `.env`、`data/`、`logs/`，这三项是运行态数据 |
| 数据迁移 | 表结构变更由启动时自动迁移，无需手工执行 SQL |
| 构建归属 | 所有构建都在自己电脑上做，服务器永远不执行 `docker build` |

**回滚：**

```bash
docker compose -f docker-compose.sqlite.yml down
docker load -i ai-workspace-v1.0.0.tar          # 重新导入旧镜像
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v1.0.0/' .env
docker compose -f docker-compose.sqlite.yml up -d --no-build
# 若旧版不兼容新库结构，用升级前备份恢复 ./data
```

> 应用启动会自动向数据库迁移升级表结构；回滚跨度较大时旧版可能不兼容新表结构，
> 此时必须用升级前备份的 `./data` 恢复数据库。

---

## 7. 常用运维命令

```bash
cd /opt/ai-workspace/AIWorkspace-v1.0

docker compose -f docker-compose.sqlite.yml ps                  # 查看状态
docker compose -f docker-compose.sqlite.yml logs -f --tail=100  # 跟踪日志
docker compose -f docker-compose.sqlite.yml restart             # 重启
docker compose -f docker-compose.sqlite.yml down                # 停止
docker compose -f docker-compose.sqlite.yml up -d --no-build    # 启动
docker stats                                                     # 资源占用
```

日志已配置 json-file 轮转（20MB × 5 个文件），不会撑爆磁盘。

---

## 8. 并发与限流（教室场景必读）

上游默认限流**按客户端 IP 计数**，学校/机房出口 NAT 会把整班学生收敛到同一 IP，
默认值会在第 21 个学生处触发封禁（返回 HTTP 429 且**响应体为空**，前端表现为「登录失败/无提示」）。

`docker-compose.sqlite.yml` 已默认设置：

```yaml
CRITICAL_RATE_LIMIT=3000          # 登录等敏感接口：3000 次 / 180 秒
GLOBAL_API_RATE_LIMIT=3000        # 全站 /api（含生成请求）：3000 次 / 180 秒
```

**不要调低这两个值。** 若出现整班登录失败，先查：

```bash
docker compose -f docker-compose.sqlite.yml logs | grep -i 429
grep RATE_LIMIT .env
```

**并发调优参考**（写入 `.env` 后 `restart` 生效）：

```bash
SQL_MAX_IDLE_CONNS=25             # 默认 25，SQLite 形态保持默认即可
SQL_MAX_OPEN_CONNS=300            # 默认 300
GOMEMLIMIT_MB=3072                # Go 软性内存上限，默认取物理内存 75%
```

> SQLite 为单进程串行写入，**适合一个班量级的并发**；数百人持续并发或多实例部署场景需另行评估。

---

## 9. 反向代理与 HTTPS（可选）

内网若只需 IP 直接访问，跳过本节。需要域名 + HTTPS 时用 Nginx 终止 TLS：

```nginx
server {
    listen 443 ssl http2;
    server_name ai.school.internal;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    client_max_body_size 200m;        # 允许上传较大素材

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE / 流式生成必须关闭缓冲并放宽超时
        proxy_buffering off;
        proxy_read_timeout 1800s;
        proxy_send_timeout 1800s;
    }
}

server {
    listen 80;
    server_name ai.school.internal;
    return 301 https://$host$request_uri;
}
```

启用 HTTPS 后在 `.env` 中设置：

```
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_TRUSTED_URL=https://ai.school.internal
TRUSTED_PROXIES=127.0.0.1
```

> 走了反向代理后**必须配置 `TRUSTED_PROXIES`**，否则应用看到的客户端 IP 全是代理 IP，
> 按 IP 限流会退化成全站互相挤占。

**安全建议：**

- 服务器防火墙仅放行 3002（或仅 80/443，3002 只监听 127.0.0.1）；
- `chmod 700 ./data`，数据库与素材不给其他用户读权限；
- 内网服务器不要把 3002 暴露到公网。

---

## 10. 故障排查

| 现象 | 排查 |
| --- | --- |
| `up` 报镜像不存在 | `docker images` 确认 tag；`IMAGE_TAG` 与已 load 的 tag 是否一致；是否忘了 `docker load` |
| 容器起来但页面 500 | `docker compose logs` 看真实错误；确认 `./data` 卷挂载正常、磁盘未满 |
| 登录后频繁 429 | 命中默认限流，检查 `.env` 的 `CRITICAL_RATE_LIMIT` / `GLOBAL_API_RATE_LIMIT`，调回 3000 后 `restart` |
| 页面还是旧版本 | `IMAGE_TAG` 没改，`up` 仍用旧镜像；`docker images` 对比 tag 后改 `.env` 重启 |
| 素材下载/预览 404 | 素材在 `./data/workspace-artifacts`；确认卷挂载、文件存在、当前用户有查看权限 |
| 磁盘持续增长 | `./logs` 与 `./data` 素材目录；已配置日志轮转，素材可在「云端素材」页配置自动删除 |
| 忘记超管密码 | `sqlite3 ./data/one-api.db` 手工重置，或在数据库中新建管理员账号 |
| 想换端口 | 改 `.env` 的 `APP_PORT` 后 `up -d` 重建容器 |

---

## 11. 包内容清单

```
AIWorkspace-v1.0/
├── Dockerfile                    # 本地构建镜像用
├── docker-compose.sqlite.yml     # SQLite 单机编排
├── .env.sqlite                   # 环境变量模板（复制为 .env）
├── VERSION                       # 版本号（1.0.0）
├── 部署教程.md                    # 本教程简明版
├── AIWorkspace学生使用指南.docx    # 学生端 Word 使用教程
├── go.mod / go.sum / main.go ... # Go 后端源码
├── web/                          # React 前端源码
├── relaykit/ tokenkit/           # 本地子模块
└── docs/                         # 项目文档
```

不含任何数据库文件、构建产物与 `.env` 密钥，可直接分发。
