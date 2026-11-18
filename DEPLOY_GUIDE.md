# AIWorkspace 构建与部署操作教程

> 本文档面向两类操作人员：**构建电脑**（Windows 或 Ubuntu，负责把源码编译成 Docker 镜像）和**业务服务器**（Linux，负责运行镜像）。
> 分平台独立打包教程：**《打包教程-Windows.md》**（PowerShell 版）、**《打包教程-Ubuntu.md》**（bash 版），与本文同目录。
> 所有命令均可直接复制粘贴执行，每一步都解释了目的。

## 角色与材料一览

| 角色 | 操作系统 | 拿到什么材料 | 需要安装什么 | 做什么 |
|------|---------|-------------|-------------|--------|
| 开发机 | Windows | 源码仓库 | Go / Node（开发用） | 打包源码 zip（附录A） |
| **构建电脑** | Windows / Ubuntu | **源码 zip** | **仅 Docker**（Windows 用 Docker Desktop） | 解压 → `docker build` → `docker save` 导出 tar |
| **业务服务器** | **Linux** | **仅 tar 镜像包**（**不需要源码 zip**） | **仅 Docker** | `docker load` 导入 → `docker run` 启动/更新 |

## 总流程

```
开发机                构建电脑(Win/Ubuntu)        业务服务器(Linux)
────────              ─────────────────           ────────────────
源码 ──打zip──▶  解压源码zip
                 docker build（三阶段，全在容器内编译）
                 docker save ──导出tar──▶  docker load 导入镜像
                                          docker run 启动容器
                                          （数据存宿主机 /opt/aiworkspace/data）
```

**铁律：**

1. TS 编译、Go 编译**全部在 `docker build` 内部完成**，构建电脑上**禁止**手动执行 `npm run build` / `bun run build`。
2. 业务服务器**只接收 tar 镜像包**，永远不需要源码、不需要编译环境。
3. **数据库和生成数据的缓存放在宿主机独立目录**（`/opt/aiworkspace/data`），与容器彻底分离——**删除容器绝不会删除这个目录里的任何数据**。

---

# 第一章 构建电脑操作教程（Ubuntu 终端）

> 本章命令按 **Ubuntu（bash）** 编写，内容与《打包教程-Ubuntu.md》一致；
> Windows 构建机请直接按《打包教程-Windows.md》执行，流程相同、仅命令语法不同。

## 1.1 前置准备

构建电脑**只需要 Docker**，不需要安装 Go、Node、Bun、npm。

**检查 Docker 是否可用**——打开终端执行：

```bash
docker version
docker buildx version
```

- 输出版本号 → 正常。
- 报 `Cannot connect to the Docker daemon` → 先启动 Docker（`sudo systemctl start docker`）。
- 报错 `docker: command not found` → Docker 未安装，先安装 Docker Engine（Ubuntu 可 `sudo apt-get install -y docker.io`）。

**版本要求**：Docker 20.10 以上（Dockerfile 使用了 BuildKit 的 `RUN --mount=type=cache`，旧版本会报不识别该语法）。Docker Engine 自带 BuildKit，安装即满足。

**磁盘空间**：建议可用空间 ≥ 30 GB（基础镜像 + 依赖缓存 + 导出的 tar）。

**国内网络加速（推荐配置）**：构建时要从 Docker Hub 拉取基础镜像，国内直连常超时。配置 Docker 镜像加速：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://docker.m.daocloud.io"]
}
EOF
sudo systemctl restart docker
```

> 注意：公共加速地址会不定期失效。若某天拉取超时，可搜索"docker 镜像加速 20XX"更换地址，或配置公司内部镜像仓库。

## 1.2 解压源码 zip 并校验目录结构

**建议把源码解压到纯英文路径**，例如 `/opt/aiworkspace`（路径含中文或空格时，部分旧版 Docker 工具链会报错）。

在终端执行解压（把 zip 路径换成实际位置）：

```bash
sudo apt-get install -y unzip   # 如已安装可跳过
unzip ~/Downloads/aiworkspace-src-1.4.0.zip -d /opt/aiworkspace
```

> 目的：把源码展开到固定构建目录，后续所有命令都在这个目录里执行。

**校验目录结构是否完整**——复制下面整段到终端回车：

```bash
cd /opt/aiworkspace
need="Dockerfile .dockerignore go.mod go.sum VERSION main.go LICENSE NOTICE THIRD-PARTY-LICENSES.md upgrade.sh backup.sh relaykit/go.mod tokenkit/go.mod web/package.json web/bun.lock web/rsbuild.config.ts web/src/main.tsx i18n/locales/zh-CN.yaml"
miss=""
for f in $need; do [ -e "$f" ] || miss="$miss $f"; done
if [ -n "$miss" ]; then echo "缺少以下文件，zip 解压不完整，重新获取 zip！:$miss"; else echo "目录结构校验通过"; fi
```

- 输出「目录结构校验通过」→ 继续。
- 输出缺少列表 → zip 不完整，重新解压或重新获取。

## 1.3 执行 docker build（三阶段构建）

回到终端，执行构建：

```bash
cd /opt/aiworkspace
v=$(cat VERSION)
docker build --platform linux/amd64 -t "ai-workspace:$v" .
```

> 目的：
> - `cd` 进入源码根目录（Dockerfile 在这里）。
> - `v=$(cat VERSION)` 读出版本号（如 `1.4.0`），后面导出 tar 文件名要用。
> - `docker build --platform linux/amd64` 以 Linux/amd64 平台构建——**业务服务器是 Linux，必须加这个参数**，否则在 ARM 构建机上会产出无法运行的镜像。
> - `-t "ai-workspace:$v"` 给镜像打上「仓库名:版本号」标签。
> - 末尾的 `.` 表示构建上下文是当前目录。

**这个命令内部自动完成三阶段编译（多阶段构建），全程在 Docker 容器内进行：**

| 阶段 | 基础镜像 | 做什么 | 产出 |
|------|---------|--------|------|
| 阶段1 `builder` | `oven/bun`（Node 类运行时） | 安装前端依赖 + **编译 TypeScript**（rsbuild build） | `web/dist` 静态文件 |
| 阶段2 `builder2` | `golang`（Go 编译器） | **静态编译 Go**（`CGO_ENABLED=0`），并用 `go:embed` 把阶段1 的 `web/dist` 嵌进二进制 | 单文件 `new-api` |
| 阶段3 运行时 | `debian:bookworm-slim` | 只拷贝二进制 + 证书 + 时区 + sqlite3，**不含源码、不含编译器、不含 Node 环境** | 最终镜像 |

- 构建期国内代理已内置：前端走 npmmirror 源、Go 模块走 goproxy.cn。
- 构建缓存（依赖下载结果）会保留，**第二次构建会明显变快**。
- 首次构建拉取基础镜像较慢属正常。

**重要：禁止在构建电脑上手动执行 `npm run build` / `bun run build` / `go build`。** 前端产物由阶段1 在容器内生成，Go 编译由阶段2 完成，手动构建的产物不会进入镜像，反而可能污染源码目录。

## 1.4 导出镜像 tar 包并校验

构建成功后，把镜像导出成 tar 文件：

```bash
docker save -o "ai-workspace-$v.tar" "ai-workspace:$v"
ls -lh "ai-workspace-$v.tar"
sha256sum "ai-workspace-$v.tar"
```

> 目的：
> - `docker save` 把镜像完整导出为单个 tar 文件（几百 MB 属正常）。
> - `sha256sum` 生成校验值——**把它记下来，连同 tar 一起告知服务器运维**，传输后要核对（见 2.8）。

确认 tar 文件大小不是 0 KB、SHA256 有输出，再进行传输。

## 1.5 传输到业务服务器

方式一：终端自带 scp：

```bash
scp ai-workspace-1.4.0.tar 用户名@服务器IP:/opt/aiworkspace/
```

> 目的：把 tar 直接传到服务器的目标目录。首次连接会问 `Are you sure you want to continue connecting?`，输入 `yes`；然后输入服务器密码。

方式二：图形化工具 WinSCP / XFTP，拖拽上传到服务器 `/opt/aiworkspace/` 目录。

上传完成后，把 1.4 记录的 SHA256 值告知服务器运维，用于完整性核对。

## 1.6 构建常见报错排查

| 现象 / 报错 | 原因 | 处理 |
|------------|------|------|
| `Cannot connect to the Docker daemon` | Docker 服务没启动 | `sudo systemctl start docker` |
| `manifest for oven/bun:... not found` 或 `manifest unknown` | 基础镜像 digest（`@sha256:...` 校验值）在镜像仓库已失效 | 编辑 `Dockerfile`，把 `FROM` 行末尾的 `@sha256:xxxx...` 整段删掉，只留 `oven/bun:1.4.4` 这类 tag，保存后重新 build（其余两个 FROM 同理） |
| `pull access denied` / 拉取超时 | Docker Hub 网络受限 | 按 1.1 配置 `registry-mirrors` 加速后重试 |
| `exec format error` 启动即崩溃 | 构建平台与服务器架构不匹配 | 确认 build 命令带了 `--platform linux/amd64`，删除旧镜像重新 build |
| `ERROR: `RUN --mount=type=cache` requires BuildKit` | Docker 版本过旧 | 升级 Docker 至 20.10+；或临时删除 Dockerfile 第一行 `# syntax=docker/dockerfile:1` 并在设置中启用 BuildKit |
| 第一行 syntax 拉取失败 | 无法访问 dockerfile frontend 仓库 | 临时删除 Dockerfile 第一行 `# syntax=docker/dockerfile:1` 后重试 |
| `go.mod` / `relaykit/go.mod` not found | 解压不完整 | 按 1.2 重新校验目录结构 |
| 磁盘空间不足 | 缓存 + 镜像占用大 | 执行 `docker builder prune -f` 清理构建缓存；必要时 `docker system prune -f` |
| 构建上下文过大 / 上传慢 | 源码目录混入大文件 | 确认 `.dockerignore` 存在且未被删除；清理目录里的 exe、tar、db 文件 |
| `bun install` 慢或失败 | npm 源网络问题 | 重试；或在 build 命令后加 `--build-arg NPM_REGISTRY=https://registry.npmmirror.com` |

---

# 第二章 业务服务器部署、更新、运行教程（Linux）

## 2.1 前置准备

业务服务器**只需要 Docker**，**不需要源码 zip，不需要 Go/Node**。

检查 Docker：

```bash
docker version
```

- 有版本号输出 → 正常。
- 报 `Cannot connect to the Docker daemon` → 安装并启动 Docker（CentOS/Ubuntu 常规安装方式即可）。

说明：

- 服务器**不需要配置镜像加速**——`docker load` 是本地导入 tar 包，全程不访问任何网络仓库。
- 建议把构建电脑传来的 tar 和两个小脚本统一放到 `/opt/aiworkspace/`：

```bash
mkdir -p /opt/aiworkspace/data
ls -lh /opt/aiworkspace/
```

> 目的：`mkdir -p` 一次性创建部署根目录和**数据持久化目录**（下面细说）；`ls` 确认 tar 包已上传到位。
> 可选：把构建电脑上的 `backup.sh`、`upgrade.sh` 也 scp 到 `/opt/aiworkspace/`，方便后面一键备份/升级。

## 2.2 核心概念：容器是临时的，数据在宿主机另一个文件夹

**这是整个部署流程最重要的一条，务必先理解：**

```
业务服务器
│
├── 容器 ai-workspace（临时的，随时可以删掉重建）
│     内部目录 /data  ──────┐
│     （里面跑着程序）        │  ← -v 挂载：把宿主机目录"映射"进容器
│                           │
└── /opt/aiworkspace/data（永久的，存在服务器硬盘上）
      ├── one-api.db            ← SQLite 数据库（+ one-api.db-wal / one-api.db-shm）
      ├── workspace-artifacts/  ← 程序生成的文件缓存/产物
      ├── backups/              ← backup.sh 生成的数据库备份
      └── logs/                 ← 应用日志
```

要点：

1. **数据库和生成数据的缓存全部放在宿主机的独立文件夹 `/opt/aiworkspace/data`**，通过 `-v /opt/aiworkspace/data:/data` 挂载进容器。
2. **删除容器（`docker rm`）只会删掉容器本身，绝不会删除宿主机 `/opt/aiworkspace/data` 里的数据库和文件。** 这正是"容器可随时删建、数据永不丢失"的原理。
3. 启动命令里 `-v` 后面的路径就是数据的"锚点"——**每次启动、每次升级都必须写同一个路径**，写错路径等于程序看到一个空目录，会表现成"数据全没了"（其实数据还在，只是没挂对）。

**启动命令（全流程唯一权威版本，首次部署、版本更新、回滚都用它，只换镜像名）：**

```bash
docker run -d \
  --name ai-workspace \
  --restart unless-stopped \
  -p 3002:3002 \
  -v /opt/aiworkspace/data:/data \
  -e TZ=Asia/Shanghai \
  -e WORKSPACE_ARTIFACT_DIR=/data/workspace-artifacts \
  --log-opt max-size=20m \
  --log-opt max-file=5 \
  ai-workspace:1.0.0
```

> 逐项解释：
> - `-d` 后台运行；
> - `--name ai-workspace` 容器固定叫这个名字（脚本按名字找它）；
> - `--restart unless-stopped` 服务器重启/程序崩溃后自动拉起；
> - `-p 3002:3002` 把容器 3002 端口映射到服务器 3002 端口（**记得在云安全组/防火墙放行 3002**）；
> - `-v /opt/aiworkspace/data:/data` **数据锚点**：宿主机数据目录 → 容器内 `/data`，数据库、缓存、日志都落在这里；
> - `-e TZ=Asia/Shanghai` 时区；
> - `-e WORKSPACE_ARTIFACT_DIR=/data/workspace-artifacts` 生成文件的缓存目录（在挂载卷内，随宿主机持久保存）；
> - `--log-opt max-size=20m --log-opt max-file=5` 容器 stdout 日志轮转，防止撑爆磁盘；
> - 最后的 `ai-workspace:1.0.0` 是镜像名，**换版本时只改这里**。

## 2.3 首次部署

**第 1 步：创建持久化目录**

```bash
mkdir -p /opt/aiworkspace/data
```

> 目的：建立数据目录。之后所有数据库/缓存/备份/日志都进这个文件夹，与容器生命周期无关。

**第 2 步：导入镜像**

```bash
docker load -i /opt/aiworkspace/ai-workspace-1.0.0.tar
```

> 目的：把 tar 包还原成 Docker 镜像。执行完会打印 `Loaded image: ai-workspace:1.0.0`，**记下这个镜像名**。

确认镜像存在：

```bash
docker images | grep ai-workspace
```

**第 3 步：启动容器**（执行 2.2 的权威 `docker run` 命令，镜像名与第 2 步打印的一致）

```bash
docker run -d \
  --name ai-workspace \
  --restart unless-stopped \
  -p 3002:3002 \
  -v /opt/aiworkspace/data:/data \
  -e TZ=Asia/Shanghai \
  -e WORKSPACE_ARTIFACT_DIR=/data/workspace-artifacts \
  --log-opt max-size=20m \
  --log-opt max-file=5 \
  ai-workspace:1.0.0
```

> 目的：以固定参数启动容器。`-v` 路径必须与 2.2 完全一致。

**第 4 步：验证**

```bash
docker ps
curl -s http://localhost:3002/api/status
docker logs --tail 50 ai-workspace
ls -la /opt/aiworkspace/data/
```

> 目的：
> - `docker ps` 看 STATUS：`Up` 且健康检查显示 `starting`（启动初期）或 `healthy`（约 1 分钟后）即正常；
> - `curl` 返回的 JSON 含 `"success": true` 表示接口正常；
> - `docker logs` 查看启动日志有无报错；
> - `ls` 应能看到 `one-api.db` 等文件开始生成（首次启动会自动初始化数据库）。

浏览器访问 `http://服务器IP:3002` 能打开页面即部署成功。

> 健康检查说明：镜像内置 HEALTHCHECK，启动后约 60 秒内状态为 `starting`，属正常，稍等再查 `docker ps` 应变为 `healthy`。

## 2.4 版本更新

**更新口诀（手动执行，按顺序五步）：备份 → 停止旧容器 → 删除旧容器 → 导入新 tar → 启动新容器**

> 再次强调：**第 3 步删除旧容器不会删除 `/opt/aiworkspace/data` 里的数据库**，数据就在宿主机文件夹里等着新容器来挂载。

假设新 tar 包为 `ai-workspace-1.1.0.tar`，已上传到 `/opt/aiworkspace/`。

**第 1 步：备份数据库**

```bash
docker exec ai-workspace sqlite3 /data/one-api.db ".backup '/data/backups/backup-$(date +%Y%m%d-%H%M%S).db'"
```

> 目的：用 SQLite 在线备份机制导出一份数据库快照（WAL 模式下直接 `cp` 复制是不安全的，必须用 `.backup`）。备份落在 `/opt/aiworkspace/data/backups/`，升级出问题可回滚。
>
> 若按附录把 `backup.sh` 放到了 `/opt/aiworkspace/`，等价的一键写法：`/opt/aiworkspace/backup.sh`（它还会自动清理 7 天前的旧备份）。

**第 2 步：停止旧容器**

```bash
docker stop -t 30 ai-workspace
```

> 目的：给程序 30 秒优雅退出时间，让数据库正常收尾（checkpoint），避免留下未合并的 WAL。

**第 3 步：删除旧容器**

```bash
docker rm ai-workspace
```

> 目的：移除旧容器，腾出容器名。**只删容器，宿主机 `/opt/aiworkspace/data` 分毫未动。**

**第 4 步：导入新镜像**

```bash
docker load -i /opt/aiworkspace/ai-workspace-1.1.0.tar
```

> 目的：导入新版本镜像。若 `docker load` 这一步失败，旧容器还没删也可以先不慌——但按本口诀执行时旧容器已删，**此时直接重跑 load 即可，数据都在，load 成功后继续第 5 步**。

**第 5 步：启动新容器**

```bash
docker run -d \
  --name ai-workspace \
  --restart unless-stopped \
  -p 3002:3002 \
  -v /opt/aiworkspace/data:/data \
  -e TZ=Asia/Shanghai \
  -e WORKSPACE_ARTIFACT_DIR=/data/workspace-artifacts \
  --log-opt max-size=20m \
  --log-opt max-file=5 \
  ai-workspace:1.1.0
```

> 目的：用**完全相同的挂载路径和参数**拉起新版本容器（只有镜像名从 `1.0.0` 变 `1.1.0`）。新程序打开原有的 `/opt/aiworkspace/data/one-api.db`，数据无缝延续。

**验证更新：**

```bash
docker ps
docker logs --tail 50 ai-workspace
curl -s http://localhost:3002/api/status
```

> STATUS 为 `healthy`（或短暂 `starting`）且 curl 返回 `"success": true` 即更新成功。

**方式 B：一键脚本（可选）**

若已把 `upgrade.sh`、`backup.sh` 放到 `/opt/aiworkspace/`：

```bash
chmod +x /opt/aiworkspace/upgrade.sh /opt/aiworkspace/backup.sh
/opt/aiworkspace/upgrade.sh /opt/aiworkspace/ai-workspace-1.1.0.tar
```

> 目的：脚本自动完成 备份 → 停止 → 删除 → 导入 → 启动 → 健康检查，任一步失败立即报错停止。
>
> **与手动口诀的顺序差异（安全性更好，效果等价）**：脚本把 `docker load` 提到**停止旧容器之前**执行——这样如果 tar 包损坏/导入失败，旧容器还在正常服务，线上不受影响；导入成功后才停旧启新。手动口诀把 load 放第 4 步也能完成升级，只是 load 失败时会短暂处于"旧容器已删、新镜像未就绪"状态，此时重跑 load + run 即可。

## 2.5 版本回滚

新版本有问题时回退到旧版本：

**第 1 步：先备份当前状态（防止新版本已写坏数据）**

```bash
docker exec ai-workspace sqlite3 /data/one-api.db ".backup '/data/backups/backup-rollback-$(date +%Y%m%d-%H%M%S).db'"
```

**第 2 步：用旧 tar 包重复 2.4 的五步**（镜像名换回旧版本，例如 `ai-workspace:1.0.0`）

```bash
docker stop -t 30 ai-workspace
docker rm ai-workspace
docker load -i /opt/aiworkspace/ai-workspace-1.0.0.tar
docker run -d \
  --name ai-workspace \
  --restart unless-stopped \
  -p 3002:3002 \
  -v /opt/aiworkspace/data:/data \
  -e TZ=Asia/Shanghai \
  -e WORKSPACE_ARTIFACT_DIR=/data/workspace-artifacts \
  --log-opt max-size=20m \
  --log-opt max-file=5 \
  ai-workspace:1.0.0
```

> 注意：**旧版本程序未必认识新版本写入的数据库结构**（表结构可能已升级）。若回滚后启动报数据库错误，执行"数据库恢复"：

```bash
docker stop -t 30 ai-workspace 2>/dev/null; docker rm ai-workspace 2>/dev/null
# 删除可能已损坏的数据库文件（仍在宿主机数据目录内操作）
rm -f /opt/aiworkspace/data/one-api.db /opt/aiworkspace/data/one-api.db-wal /opt/aiworkspace/data/one-api.db-shm
# 用升级前的备份还原
cp /opt/aiworkspace/data/backups/backup-升级前时间戳.db /opt/aiworkspace/data/one-api.db
# 重新启动
docker run -d \
  --name ai-workspace \
  --restart unless-stopped \
  -p 3002:3002 \
  -v /opt/aiworkspace/data:/data \
  -e TZ=Asia/Shanghai \
  -e WORKSPACE_ARTIFACT_DIR=/data/workspace-artifacts \
  --log-opt max-size=20m \
  --log-opt max-file=5 \
  ai-workspace:1.0.0
```

> 目的：`rm -f` 只删数据目录里这 3 个数据库文件（**前提是有备份**）；`cp` 把备份还原为 `one-api.db`；再启动即回到升级前状态。执行前把 `backup-升级前时间戳.db` 换成 `ls /opt/aiworkspace/data/backups/` 里实际的文件名。

## 2.6 日常运行与运维

**查看运行状态**

```bash
docker ps
docker inspect -f '{{.State.Health.Status}}' ai-workspace
```

> `docker ps` 看整体；inspect 单独看健康检查值（`healthy` / `starting` / `unhealthy`）。

**查看日志**

```bash
docker logs --tail 100 ai-workspace          # 容器标准输出（启动日志、报错）
docker logs -f --tail 50 ai-workspace         # 实时滚动跟踪，Ctrl+C 退出
ls -la /opt/aiworkspace/data/logs/            # 应用自身的日志文件（落在数据目录内）
```

**手动备份数据库**

```bash
/opt/aiworkspace/backup.sh
```

> 目的：在线备份到 `/opt/aiworkspace/data/backups/backup-时间戳.db`，并自动删除 7 天前的旧备份。

**设置每日自动备份**（每天凌晨 2 点）

```bash
crontab -e
```

在打开的编辑器里加一行（没有 cron 服务先 `yum install cronie` 或 `apt install cron`）：

```
0 2 * * * /opt/aiworkspace/backup.sh >> /opt/aiworkspace/data/backups/backup-cron.log 2>&1
```

> 目的：每晚 2:00 自动备份；输出追加到日志便于排查 cron 是否执行成功。

**磁盘检查（重要，SQLite 单实例最怕磁盘写满）**

```bash
df -h
du -sh /opt/aiworkspace/data/*
```

> 目的：`df -h` 看整体剩余空间；`du` 看数据目录里数据库、备份、日志各占多少。备份保留 7 天、日志已配置轮转，正常情况下增长可控。磁盘不足时优先清理旧备份。

**重启容器**

```bash
docker restart ai-workspace
```

**进容器内部排查（一般不需要）**

```bash
docker exec -it ai-workspace sh
exit   # 退出
```

## 2.7 服务器禁止操作清单

| 禁止操作 | 原因 |
|---------|------|
| `docker rm -v ai-workspace`（带 `-v`） | `-v` 会**连同删除匿名卷**，可能带走数据；删除容器永远不带 `-v` |
| `docker volume prune` / `docker volume rm` | 清理/删除卷可能波及挂载数据 |
| `rm -rf /opt/aiworkspace/data` | **直接删除数据库和全部缓存**，不可恢复 |
| `docker system prune -a --volumes` | 一键清理镜像+容器+卷，极易误删数据卷 |
| 两个容器同时挂载同一个 `-v /opt/aiworkspace/data:/data` | SQLite **单实例**设计，双开会导致锁冲突、数据库损坏 |
| 运行中直接 `cp one-api.db` 复制数据库 | WAL 模式下文件不一致，备份必须用 `.backup` 或 `backup.sh` |
| 升级时改 `-v` 挂载路径 | 新容器挂到空目录 → 程序看到"全新环境"，表现为数据丢失（其实旧数据还在旧路径） |
| 在服务器上执行 `docker build` | 服务器不接收源码，构建只在构建电脑进行 |
| `docker commit` 把容器存成镜像 | 会把运行时状态、密钥一起封进镜像，版本管理只用 `docker save/load` |
| 运行中删除 `one-api.db-wal` / `one-api.db-shm` | 这两个是数据库的在途事务文件，删除会损坏数据库 |
| 手动改容器内文件后以为会保留 | 容器文件层是临时的，`docker rm` 后即消失；**要改的配置一律放宿主机数据目录** |

## 2.8 镜像包完整性校验（可选但推荐）

上传后在服务器核对 SHA256，与构建电脑 1.4 记录的值比对：

```bash
sha256sum /opt/aiworkspace/ai-workspace-1.4.0.tar
```

> 输出与构建电脑 `sha256sum` 结果一致 → 传输无损坏；不一致 → 重新上传。

---

# 附录A 源码打包（开发机 → 源码 zip）

在**开发机**上把源码打成 zip 交给构建电脑。

**第 1 步：确认版本号**——打包前更新根目录 `VERSION` 文件内容（如 `1.4.0`），它会同时注入后端二进制和前端页面的版本显示。

**第 2 步：打包**（PowerShell，把路径换成实际值）：

```powershell
$src = "D:\杂项\aiworkspace\AIWorkspace"
$stage = "D:\杂项\aiworkspace\_pkgstage\src"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
robocopy $src $stage /E `
  /XD node_modules dist upload data logs tiktoken_cache .git _pkgstage `
  /XF *.exe newapi-linux-amd64 newapi-linux-arm64 *.db *.db-shm *.db-wal *.log *.zip *.tar *.tgz
if ($LASTEXITCODE -lt 8) {
  Compress-Archive -Path "$stage\*" -DestinationPath "$src\aiworkspace-src-1.4.0.zip" -Force
  Write-Host "打包完成" -ForegroundColor Green
} else {
  Write-Host "robocopy 失败，退出码 $LASTEXITCODE" -ForegroundColor Red
}
```

> 目的：
> - `/XD` 按**目录名**排除：运行数据、日志、依赖安装目录、构建产物；
> - `/XF` 按**文件名**排除：本地编译的 exe、Linux 二进制、数据库文件（含 `-shm`/`-wal`）、日志、压缩包——这些绝不能进源码 zip；
> - robocopy 退出码 `< 8` 才算成功（0=无变化 1=有复制 2-7=部分差异，≥8=错误）；
> - `Compress-Archive` 生成最终 zip。
>
> 注意：**不要排除** `plugins/`、`i18n/locales/`、`log_text.zh-CN.json`、`lua/`、`web/dist`（若打包机上有的话由 Docker 内重建）——`go:embed` 需要这些文件；上面的排除清单已按此设计，勿随意追加 `*.md`（`THIRD-PARTY-LICENSES.md` 需要进镜像）。

**第 3 步：交付**——把 `aiworkspace-src-1.4.0.zip` 发给构建电脑，构建电脑按第一章执行。

---

# 附录B 关键文件与路径速查表

| 项目 | 路径 / 值 | 所在位置 |
|------|----------|---------|
| 构建定义 | `Dockerfile` | 源码根目录（构建电脑） |
| 构建排除清单 | `.dockerignore` | 源码根目录（构建电脑） |
| 版本号文件 | `VERSION` | 源码根目录（打包前更新） |
| 一键升级脚本 | `upgrade.sh` | 源码根目录 → 拷到服务器 `/opt/aiworkspace/` |
| 一键备份脚本 | `backup.sh` | 源码根目录 → 拷到服务器 `/opt/aiworkspace/` |
| 镜像名 | `ai-workspace:<VERSION>` | 构建电脑 / 服务器 |
| 容器名 | `ai-workspace` | 业务服务器 |
| 端口 | `3002`（宿主机 = 容器） | 业务服务器（安全组需放行） |
| **数据持久化目录** | **`/opt/aiworkspace/data`** | **业务服务器（数据库/缓存/备份/日志全在这）** |
| 数据库文件 | `/opt/aiworkspace/data/one-api.db`（+ `-wal` `-shm`） | 业务服务器 |
| 生成文件缓存 | `/opt/aiworkspace/data/workspace-artifacts/` | 业务服务器 |
| 数据库备份 | `/opt/aiworkspace/data/backups/backup-*.db` | 业务服务器（保留 7 天） |
| 应用日志 | `/opt/aiworkspace/data/logs/` | 业务服务器 |
| 健康检查接口 | `http://localhost:3002/api/status`（期望 `"success": true`） | 业务服务器 |
| 更新口诀 | 备份 → 停止 → 删除容器 → 导入新 tar → 启动 | 业务服务器 |
