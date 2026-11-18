# AI Workspace 生产部署与对接教程

面向阿里云 ECS 的生产部署手册。按顺序执行即可从零跑起一套完整的 AI Workspace，
中台的生成素材全部落到服务器本地磁盘，**不依赖任何对象存储或 CDN**。

---

## 0. 部署形态总览

```
                    ┌─────────────── 用户浏览器 ───────────────┐
                    │                                          │
                    v                                          v
        ┌──────────────────────────────────────────────────────┐
        │  Nginx（可选）                                        │
        │  HTTPS 终止 / 反向代理                                │
        └─────────────────────────┬────────────────────────────┘
                                  │ 回源
                                  v
        ┌──────────────────────────────────────────────────────┐
        │              ECS：AI Workspace（Docker 容器）          │
        │              Go 单二进制，内嵌前端，监听 3002           │
        │              素材落本地磁盘 /data/workspace-artifacts  │
        └───────┬───────────────────────────────────┬──────────┘
                │                                   │
                v                                   v
        ┌────────────────────┐              ┌──────────────┐
        │ SQLite（单文件）     │              │   Redis      │
        │ 业务数据            │              │ 缓存/限流/会话│
        │ /data/one-api.db   │              └──────────────┘
        └────────────────────┘
```

| 组件 | 是否必需 | 说明 |
| --- | --- | --- |
| ECS | 必需 | 跑应用容器；4C8G 起步可支撑数百并发 |
| SQLite | 必需 | 本教程的生产数据库：单文件、零运维，随 `./data` 卷持久化到 `/data/one-api.db`；**类型只能在启动时用 `SQL_DSN` 决定，控制台不可切换**（见第 2.1 节） |
| Redis | 强烈建议 | 多实例、限流、会话、缓存依赖 |
| 本地磁盘 | 必需 | 中台生成的图片/音频/视频/音乐/文本与参考素材落到 `./data/workspace-artifacts`，通过受鉴权接口访问（见第 5 章） |
| Nginx | 可选 | 需要 HTTPS 或统一入口时使用 |

> 关键约定：**必须使用本仓库的 `Dockerfile` 构建镜像**。上游 `calciumion/new-api` 官方镜像
> 不包含本项目的 AI Workspace 定制（双皮肤、教学增强、云端素材等），直接使用会丢失全部定制功能。

---

## 0.5 离线交付：在你电脑上打包镜像 tar，发给部署电脑

适用于**部署到别人的电脑**（例如对方已装 Docker 的 Ubuntu）：构建只在你自己的电脑上做一次，
对方只收一个 tar 镜像包和两个小文件，**不需要源码，也不需要 Go / Node / 构建环境**。

**你这边（Ubuntu 打包机，已装 Docker）：**

```bash
# 1. 解压源码包（aiworkspace-src-1.4.0.zip）后进入目录，构建镜像
unzip aiworkspace-src-1.4.0.zip -d aiworkspace && cd aiworkspace
docker build --platform linux/amd64 -t "ai-workspace:1.4.0" .

# 2. 导出为单个 tar 文件（几百 MB 属正常），并记下哈希用于传输后校验
docker save -o "ai-workspace-1.4.0.tar" "ai-workspace:1.4.0"
sha256sum "ai-workspace-1.4.0.tar"

# 3. 发给对方共 3 个文件：ai-workspace-1.4.0.tar、docker-compose.prod.yml、
#    .env（按第 2、3 章填好 SQLite / Redis / 密钥，见 4.2 节的变量清单）
```

**对方电脑（只需 Docker，全程不联网、不构建）：**

```bash
# 1. 把收到的 3 个文件放到同一目录，例如 /opt/ai-workspace/
cd /opt/ai-workspace

# 2. 导入镜像（本地导入，不访问任何镜像仓库）
docker load -i ./ai-workspace-1.4.0.tar

# 3. .env 里加一行 IMAGE_TAG=1.4.0，然后启动（--no-build = 用已导入的镜像，禁止现场构建）
docker compose -f docker-compose.prod.yml up -d --no-build
```

后续升级重复同一流程：你这边换版本号重新 `docker build` / `docker save` 出新 tar → 发过去 →
对方 `docker load` 新 tar → 改 `.env` 的 `IMAGE_TAG` → `docker compose up -d --no-build`。

> 传输完整性校验（双方 SHA256 比对）、纯 `docker run` 启动/升级/回滚口诀，见仓库 `DEPLOY_GUIDE.md`
> 第一章（1.4 导出、1.5 传输）与第二章（2.3 首次部署、2.4 升级、2.5 回滚）。

## 1. 准备：ECS、域名与安全组

**ECS 规格建议**

| 并发规模 | 规格 | 说明 |
| --- | --- | --- |
| ≤ 50 | 2C4G | 单实例够用 |
| 100 ~ 300 | 4C8G | 推荐 `APP_MEMORY_LIMIT=4g` |
| 400 ~ 500 | 8C16G | 单机参考上限；再往上或需要多实例时应换 PostgreSQL |

**安全组放行**

| 端口 | 用途 | 是否对公网开放 |
| --- | --- | --- |
| 3002 | 应用直连端口 | 建议**不开放**，仅走 Nginx 反向代理回源 |
| 80 / 443 | Nginx 反向代理 | 开放 |
| 6379 | Redis | **不要开放**，仅内网/容器访问 |

> SQLite 没有网络端口，不受此影响；Redis 端口一旦对公网开放，极易被扫描爆破，务必只在内网可达。

---

## 2. 数据库：选型与安装

### 2.1 数据库选型（启动时决定，控制台不可切换）

数据库类型**只能通过启动时的环境变量决定**，管理控制台里没有、也不会有切换开关。
原因是建表（AutoMigrate）与连接池都在进程启动阶段一次性完成。

选型规则（按顺序判断，源码见 `common/init.go` 与 `model/main.go::chooseDB`）：

| `SQL_DSN` 的取值 | 实际使用的数据库 |
| --- | --- |
| 以 `postgres://` 或 `postgresql://` 开头 | **PostgreSQL**（多实例 / 高并发写入时再切换） |
| 以 `local` 开头 | SQLite |
| 形如 `user:pass@tcp(host:port)/db` | MySQL |
| 留空 | SQLite，文件路径取 `SQLITE_PATH`（默认 `one-api.db`，内置 WAL + busy_timeout） |

结论：

- **换数据库 = 改 `.env` 并重启容器**，不是控制台里的开关；
- **本教程的生产部署用 SQLite**：`SQL_DSN` 留空、`SQLITE_PATH` 指向 `/data/one-api.db`（见 2.2 节）；
- SQLite 是**单实例**数据库：并发写入会串行化，多实例部署不能用；单实例生产由内置
  WAL + busy_timeout 支撑（含整班同时上课），需要多实例或更高并发写入时再按上表换 PostgreSQL / MySQL；
- 无论选哪种，表结构都会在启动时自动迁移，无需手工建表。

### 2.2 配置 SQLite（本教程的生产选择）

SQLite 不需要安装任何数据库服务，应用内嵌驱动；生产部署只要保证**数据库文件落在持久化卷**即可。

`.env` 按下面配置（`SQL_DSN` 留空 = 走 SQLite，路径取 `SQLITE_PATH`）：

```bash
# .env
SQL_DSN=
SQLITE_PATH=/data/one-api.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate
```

| 项 | 说明 |
| --- | --- |
| 文件位置 | 容器内 `/data/one-api.db`，对应宿主机 `./data/one-api.db`（`volumes` 已挂载，容器重建不丢） |
| 附属文件 | `one-api.db-wal` / `one-api.db-shm` 与数据库同目录，备份时需一并覆盖 |
| 内置参数 | `busy_timeout=30000` 防锁等待超时；`journal_mode=WAL` 读写不互斥；`_txlock=immediate` 事务开始即加写锁 |
| 建表 | 应用启动时自动迁移（AutoMigrate），无需手工执行 SQL |

> **注意**：`SQLITE_PATH` 必须指向 `/data/one-api.db`，留在容器文件系统里会**随容器重建丢数据**；
> SQLite 是单实例数据库，不要让两个容器同时挂载同一 `./data` 目录，也不要多副本部署；
> 想换 PostgreSQL / MySQL 时改 `SQL_DSN` 并重启容器即可（见 2.1 节）。

---

## 3. 安装 Redis

```bash
sudo dnf install -y redis
sudo sed -i "s/^bind .*/bind 0.0.0.0/" /etc/redis/redis.conf
sudo sed -i "s/^# requirepass .*/requirepass AiWorkspaceRedis@2026/" /etc/redis/redis.conf
sudo sed -i "s/^protected-mode yes/protected-mode no/" /etc/redis/redis.conf
# 关闭危险命令（可选但推荐）
sudo systemctl enable --now redis
redis-cli -a 'AiWorkspaceRedis@2026' ping   # 返回 PONG 即成功
```

**连接串**（写进 `.env` 的 `REDIS_CONN_STRING`）：

```
redis://:AiWorkspaceRedis%402026@host.docker.internal:6379
```

> Redis 同样必须设密码；`protected-mode no` 只在安全组未开放 6379 时才可接受。

---

## 4. 用 Docker 部署应用

### 4.1 安装 Docker

```bash
# 阿里云镜像源
sudo dnf install -y dnf-utils
sudo dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 国内拉取基础镜像加速（把地址换成你自己的阿里云容器镜像加速地址）
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "registry-mirrors": ["https://<你的加速器地址>.mirror.aliyuncs.com"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON

sudo systemctl enable --now docker
docker compose version
```

### 4.2 上传代码并配置环境变量

```bash
# 把项目（new-api 目录）上传到 ECS，例如 /opt/ai-workspace
cd /opt/ai-workspace
cp .env.example .env
vim .env       # SQL_DSN 留空（SQLite，见 2.2 节）、按第 3 节填写 REDIS_CONN_STRING，并生成 SESSION_SECRET
```

`SESSION_SECRET` 生成：

```bash
openssl rand -hex 32
```

`.env` 中与生产相关的关键项：

| 变量 | 说明 |
| --- | --- |
| `SQL_DSN` | 留空即使用 SQLite（本教程）；填 `postgres://` 或 MySQL DSN 则切换数据库（见第 2.1 节） |
| `SQLITE_PATH` | SQLite 文件路径，必须指向 `/data/one-api.db`（见第 2.2 节） |
| `REDIS_CONN_STRING` | Redis 连接串 |
| `SESSION_SECRET` | 会话密钥，多实例部署必须一致 |
| `APP_PORT` | 宿主机映射端口，默认 3002 |
| `APP_MEMORY_LIMIT` | 容器内存上限 |
| `TRUSTED_PROXIES` | 反向代理回源地址段（见第 6 节） |
| `CRITICAL_RATE_LIMIT` | 登录/注册等敏感接口限流，教室场景必须上调（见第 7.1 节） |
| `GLOBAL_API_RATE_LIMIT` | 全站 `/api` 限流（含生成请求），教室场景必须上调（见第 7.1 节） |
| `WORKSPACE_ARTIFACT_DIR` | 素材本地目录，默认 `/data/workspace-artifacts` |
| `TZ` | 时区，建议 `Asia/Shanghai` |

### 4.3 构建并启动

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=100
```

健康检查：

```bash
curl -s http://127.0.0.1:3002/api/status
# 期望包含 "success":true
```

> 首次构建需要拉取基础镜像并编译前后端，耗时较长属正常。若卡在拉取镜像，
> 检查 `/etc/docker/daemon.json` 的加速器是否生效（`sudo systemctl restart docker`）。

### 4.4 首次登录

系统首次启动会自动创建一个超级管理员账号：

```
用户名：root
密码：  123456
```

**请立即登录并在「个人设置」中修改密码**，随后再创建教师与学生账号。

### 4.5 数据持久化

| 宿主机目录 | 容器目录 | 内容 |
| --- | --- | --- |
| `./data` | `/data` | SQLite 数据库（`one-api.db` + `-wal`/`-shm`）、素材文件、上传文件 |
| `./logs` | `/app/logs` | 应用日志 |

这两项已通过 `volumes` 挂载，容器重建不会丢数据。**请把 `./data` 纳入备份。**

---

## 5. 云端素材：纯内网本地磁盘存储

中台生成链路产出的成品文件（图片 / 音频 / 视频 / 音乐 / 文本）与参考素材，全部落到应用本地磁盘目录
（默认 `./data/workspace-artifacts`，可用环境变量 `WORKSPACE_ARTIFACT_DIR` 覆盖），
并统一通过受鉴权的内容接口 `/api/workspace/artifacts/{id}/content` 访问。

| 项 | 说明 |
| --- | --- |
| 存储位置 | 应用本地磁盘 `WORKSPACE_ARTIFACT_DIR`（默认 `/data/workspace-artifacts`） |
| 访问方式 | 受鉴权内容接口 `/api/workspace/artifacts/{id}/content` |
| 外部依赖 | 不依赖任何对象存储或 CDN，无需额外部署组件 |
| 持久化 | 保持 `./data` 卷挂载，容器重建后素材仍在 |

---

## 6. 反向代理与 HTTPS（可选）

Nginx 终止 TLS 的示例（证书用 `certbot` 或阿里云证书）：

```nginx
server {
    listen 443 ssl http2;
    server_name ai.yourschool.cn;

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
    server_name ai.yourschool.cn;
    return 301 https://$host$request_uri;
}
```

启用 HTTPS 后同时设置：

```
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_TRUSTED_URL=https://ai.yourschool.cn
TRUSTED_PROXIES=127.0.0.1
```

---

## 7. 并发与性能调优

面向 400-500 并发（大量为生成类长连接），建议：

```bash
# .env
BATCH_UPDATE_ENABLED=true
RELAY_RESPONSE_HEADER_TIMEOUT=1800
STREAMING_TIMEOUT=300
```

- **数据库**：本教程用 SQLite 单文件，写入天然串行化，连接池保持默认即可（调大无益）；重点保证磁盘余量，WAL 文件与数据库同在 `./data`；需要多实例时换 PostgreSQL 并把 `SQL_MAX_OPEN_CONNS` 调到与 `max_connections` 匹配；
- **Redis**：`maxmemory-policy` 用 `allkeys-lru`，并设置合理 `maxmemory`；
- **容器**：`APP_MEMORY_LIMIT` 不低于 2g（8C16G 建议 8g）；
- **Nginx**：流式接口必须关闭代理缓冲（见第 6 节），否则 SSE 会被整段缓冲；
- **素材落盘**：素材落本地磁盘为异步任务，不占用生成请求的响应时间；需留足 ECS 磁盘余量并纳入备份。

### 7.1 限流：教室场景必须上调（否则整班被误封）

上游默认的限流一律**按客户端 IP 计数**，而学校/机房出口 NAT 会把整班学生收敛到
同一个公网 IP，默认值会直接封掉整段 IP。这是上线前最容易踩的坑：

| 参数 | 上游默认 | 影响 | 教室场景建议 |
| --- | --- | --- | --- |
| `CRITICAL_RATE_LIMIT` / `CRITICAL_RATE_LIMIT_DURATION` | 20 次 / 1200 秒 | **登录**、注册、找回密码；一个班 40 人同时登录会在第 21 人处被封 20 分钟 | 3000 次 / 180 秒 |
| `GLOBAL_API_RATE_LIMIT` / `GLOBAL_API_RATE_LIMIT_DURATION` | 360 次 / 180 秒 | 所有 `/api` 请求，**中台生成请求也走这里** | 3000 次 / 180 秒 |

```bash
# .env
CRITICAL_RATE_LIMIT=3000
CRITICAL_RATE_LIMIT_DURATION=180
GLOBAL_API_RATE_LIMIT=3000
GLOBAL_API_RATE_LIMIT_DURATION=180
```

> 被限流时服务端返回 **HTTP 429 且响应体为空**，前端会表现为「登录失败 / 无提示」。
> 若出现该现象，先看 `docker compose logs` 与 `.env` 的上述参数。

**务必同时配置 `TRUSTED_PROXIES`**：走了 Nginx 反向代理时，若未正确设置可信代理，
应用看到的客户端 IP 会全部变成代理 IP，上述「按 IP 计数」就退化成全站互相挤占，
一个班能把整个学校的额度吃光。

自测并发是否通顺，见第 9 节。


---

## 8. 备份、升级与回滚

**备份**（建议做定时任务）：

```bash
# 数据库快照（WAL 模式下直接 cp 不安全，必须用 sqlite3 的 .backup）
docker exec ai-workspace sqlite3 /data/one-api.db ".backup '/data/backups/backup-$(date +%F).db'"
# 素材与配置（./data 已包含上面的快照）
tar czf data-$(date +%F).tar.gz ./data
```

**升级**：

```bash
cd /opt/ai-workspace
git pull            # 或重新上传代码
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
```

数据库结构变更由应用启动时自动迁移；**升级前先执行上面的 `.backup` 快照**。
回滚时先停容器，用快照覆盖 `/data/one-api.db` 并删除残留的 `one-api.db-wal` / `one-api.db-shm`，再切回上一版代码重建。

---

## 9. 本地/线上并发自测

仓库内提供了并发压测脚本（模拟多名学生同时发起生成请求）：

```bash
# 前置：中台服务已启动；若在本地联调还需启动 mock 上游
python test/concurrency_test.py            # 默认 8 名学生并发
python test/concurrency_test.py --students 16 --rounds 2
```

脚本会自动创建测试班级与学生、下发点数、同时发起文生文/文生图请求，
校验：全部请求成功、无 5xx、无限流误伤、点数按次扣除正确、生成明细与素材落盘完整，
并在结束后清理测试数据与还原开关。

> 若本地自测时出现「批量登录失败」而不是生成失败，说明服务端限流仍是上游默认值，
> 按第 7.1 节调整 `CRITICAL_RATE_LIMIT`（本机可用环境变量临时覆盖）后重启服务再测。

生产环境压测请勿直接压真实上课时段，建议先用少量账号验证。

---

## 10. 常见问题

**Q：容器起来了但页面报 500 / 数据库连接失败？**
`docker compose logs` 里会打印真实错误；SQLite 场景依次确认：`SQL_DSN` 是否留空（误填连接串会切到别的库）、
`SQLITE_PATH` 是否指向 `/data/one-api.db`、宿主机 `./data` 目录是否已挂载且可写。

**Q：登录后频繁 429 Too Many Requests？**
说明命中了上游默认限流（登录 20 次 / 20 分钟 / 每 IP）。教室场景多名学生共享出口 IP 时必然触发，
按第 7.1 节把 `CRITICAL_RATE_LIMIT` 与 `GLOBAL_API_RATE_LIMIT` 上调，并配置 `TRUSTED_PROXIES`
让应用取到真实客户端 IP，然后 `docker compose -f docker-compose.prod.yml up -d` 重启生效
（限流计数在内存/Redis 中，重启即清零，但改完参数后才会真正解决问题）。

**Q：素材下载/预览 404？**
素材全部保存在应用本地磁盘（`WORKSPACE_ARTIFACT_DIR`，默认 `/data/workspace-artifacts`），
并通过受鉴权接口 `/api/workspace/artifacts/{id}/content` 访问。出现 404 时依次排查：
容器内目录是否存在该文件、`./data` 卷是否被正确挂载、当前登录用户是否具备该素材的查看权限。

**Q：能不能在控制台里把 SQLite 换成 PostgreSQL？**
不能。数据库类型只在启动时由 `SQL_DSN` 决定（见第 2.1 节），控制台没有该开关。
换库的正确做法是：改 `.env` 的 `SQL_DSN` → 重启容器 → 让新库自动迁移建表。
若需要保留数据，得自行把老库导出再导入新库。

**Q：上传/生成大文件失败？**
调大 Nginx 的 `client_max_body_size`；素材全部落本地磁盘，注意预留 ECS 磁盘余量，并把 `./data` 纳入备份。

**Q：想确认素材到底存在哪？**
超管登录 →「云端素材」页查看列表，文件实际落在应用本地磁盘的 `WORKSPACE_ARTIFACT_DIR` 目录下。

**Q：能否不用 Docker？**
可以，直接以 `CGO_ENABLED=0` 构建静态二进制后 `./new-api --port 3002` 运行，
用 systemd 托管；SQLite 不需要任何数据库服务，`SQLITE_PATH` 指到持久化目录即可，Redis 也非必需。
Docker 方式更容易保证环境一致。
