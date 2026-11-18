# AI Workspace 打包教程（Ubuntu）

在 Ubuntu 打包机上完成：解压源码 → 构建镜像 → 导出 tar → 传输。
服务器收到 tar 之后的导入、启动、升级、回滚见 `DEPLOY_GUIDE.md` 第二章。

## 1. 前置：安装并检查 Docker

打包机**只需要 Docker**，不需要 Go / Node / Bun。

```bash
docker version
docker buildx version
```

- 输出版本号 → 正常
- `Cannot connect to the Docker daemon` → `sudo systemctl start docker`
- `docker: command not found` → `sudo apt-get install -y docker.io`（或按 Docker 官方文档安装 Engine）

**版本要求**：Docker 20.10 以上（Dockerfile 使用了 BuildKit 的 `RUN --mount=type=cache`，旧版本会报不识别该语法）。

**国内网络加速（推荐配置）**：构建时要从 Docker Hub 拉取基础镜像，国内直连常超时。

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://docker.m.daocloud.io"]
}
EOF
sudo systemctl restart docker
```

> 注意：公共加速地址会不定期失效。若某天拉取超时，可搜索"docker 镜像加速 20XX"更换地址。

## 2. 解压源码 zip

拿到源码包 `aiworkspace-src-1.4.0.zip`，解压到**纯英文路径**（路径含中文或空格时，部分旧版 Docker 工具链会报错）：

```bash
sudo apt-get install -y unzip   # 如已安装可跳过
unzip aiworkspace-src-1.4.0.zip -d /opt/aiworkspace
```

## 3. 校验目录结构

复制下面整段到终端回车：

```bash
cd /opt/aiworkspace
need="Dockerfile .dockerignore go.mod go.sum VERSION main.go LICENSE NOTICE THIRD-PARTY-LICENSES.md upgrade.sh backup.sh relaykit/go.mod tokenkit/go.mod web/package.json web/bun.lock web/rsbuild.config.ts web/src/main.tsx i18n/locales/zh-CN.yaml"
miss=""
for f in $need; do [ -e "$f" ] || miss="$miss $f"; done
if [ -n "$miss" ]; then echo "缺少以下文件，zip 解压不完整，重新获取 zip！:$miss"; else echo "目录结构校验通过"; fi
```

- 输出「目录结构校验通过」→ 继续。
- 输出缺少列表 → zip 不完整，重新解压或重新获取。

## 4. 构建镜像

```bash
cd /opt/aiworkspace
v=$(cat VERSION)
docker build --platform linux/amd64 -t "ai-workspace:$v" .
```

- `v=$(cat VERSION)` 读出版本号（如 `1.4.0`），后面导出 tar 文件名要用。
- 首次构建较久：前端 bun 构建 + Go 编译**全部在 docker build 内部完成**，阶段间有缓存，基础镜像拉取视网络可能较慢。
- 二次构建复用 web 与 Go 缓存，源码不变时几分钟内完成。
- **禁止**在打包机手动执行 `bun run build` / `go build`。
- `--platform linux/amd64`：打包机与目标机架构不一致时必须保留；两边都是 x86_64 时可省略，目标机是 ARM 则改为 `linux/arm64`。

## 5. 导出 tar 并记录校验值

```bash
docker save -o "ai-workspace-$v.tar" "ai-workspace:$v"
ls -lh "ai-workspace-$v.tar"
sha256sum "ai-workspace-$v.tar"
```

- `docker save`：把镜像导出为**一个文件**（几百 MB 属正常）。
- `sha256sum`：生成校验值——**把它记下来，连同 tar 一起告知服务器运维**，传输后要核对。

## 6. 传输给部署电脑

方式一：终端自带 scp：

```bash
scp ai-workspace-1.4.0.tar 用户名@服务器IP:/opt/aiworkspace/
```

> 首次连接会问 `Are you sure you want to continue connecting?`，输入 `yes`；然后输入服务器密码。

方式二：U盘 / 网盘 / 内部文件服务器，传到对方电脑 `/opt/aiworkspace/` 目录。

> 同时把 `docker-compose.prod.yml` 和 `.env`（按部署教程填好变量）一并交给对方，启动时要用。

## 7. 常见报错

| 现象 / 报错 | 原因 | 处理 |
|------------|------|------|
| `Cannot connect to the Docker daemon` | Docker 服务没启动 | `sudo systemctl start docker` |
| `manifest for oven/bun:... not found` 或 `manifest unknown` | 基础镜像 digest（`@sha256:...` 校验值）在镜像仓库已失效 | 编辑 `Dockerfile`，把 `FROM` 行末尾的 `@sha256:xxxx...` 整段删掉，只留 `oven/bun:1.4.4` 这类 tag，保存后重新 build（其余两个 FROM 同理） |
| `pull access denied` / 拉取超时 | Docker Hub 网络受限 | 按第 1 步配置 `registry-mirrors` 加速后重试 |
| `exec format error` 启动即崩溃 | 构建平台与服务器架构不匹配 | 确认 build 命令带了 `--platform`（见第 4 步），删除旧镜像重新 build |
| ``ERROR: `RUN --mount=type=cache` requires BuildKit`` | Docker 版本过旧 | 升级 Docker 至 20.10+；或临时删除 Dockerfile 第一行 `# syntax=docker/dockerfile:1` |

---

相关文档：`DEPLOY_GUIDE.md`（构建与部署完整流程）、`打包教程-Windows.md`（Windows 版）、附录A（开发机打源码 zip）
