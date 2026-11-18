# AI Workspace 打包教程（Windows）

在 Windows 打包机上完成：解压源码 → 构建镜像 → 导出 tar → 传输。
所有命令在 **PowerShell** 中执行（开始菜单搜索 PowerShell 回车）。
服务器收到 tar 之后的导入、启动、升级、回滚见 `DEPLOY_GUIDE.md` 第二章。

## 1. 前置：安装并检查 Docker Desktop

打包机**只需要 Docker Desktop**，不需要 Go / Node / Bun。

```powershell
docker version
docker buildx version
```

- 输出版本号 → 正常。
- 报 `无法连接到 Docker 守护进程` → 先启动 Docker Desktop，等右下角鲸鱼图标变为稳定（无动画）。
- 报错 `docker : 无法将"docker"项识别为 cmdlet` → Docker Desktop 未安装或未加入 PATH，重新安装 Docker Desktop。

**版本要求**：Docker 20.10 以上（Dockerfile 使用了 BuildKit 的 `RUN --mount=type=cache`，旧版本会报不识别该语法）。Docker Desktop 自带 BuildKit，安装即满足。

**国内网络加速（推荐配置）**：构建时要从 Docker Hub 拉取基础镜像，国内直连常超时。

1. 右键 Docker Desktop 托盘图标 → **Settings** → **Docker Engine**。
2. 在 JSON 中加入（若已有 `registry-mirrors` 则合并进去）：

```json
{
  "registry-mirrors": ["https://docker.m.daocloud.io"]
}
```

3. 点 **Apply & restart**。

> 注意：公共加速地址会不定期失效。若某天拉取超时，可搜索"docker 镜像加速 20XX"更换地址。

## 2. 解压源码 zip

拿到源码包 `aiworkspace-src-1.4.0.zip`，解压到**纯英文路径**（路径含中文或空格时，部分旧版 Docker 工具链会报错）：

```powershell
Expand-Archive -Path "C:\Downloads\aiworkspace-src-1.4.0.zip" -DestinationPath "C:\build\aiworkspace" -Force
```

## 3. 校验目录结构

复制下面整段到 PowerShell 回车：

```powershell
cd C:\build\aiworkspace
$need = @(
  'Dockerfile', '.dockerignore', 'go.mod', 'go.sum', 'VERSION',
  'main.go', 'LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSES.md',
  'upgrade.sh', 'backup.sh',
  'relaykit\go.mod', 'tokenkit\go.mod',
  'web\package.json', 'web\bun.lock', 'web\rsbuild.config.ts',
  'web\src\main.tsx', 'i18n\locales\zh-CN.yaml'
)
$miss = $need | Where-Object { -not (Test-Path $_) }
if ($miss) { Write-Host "缺少以下文件，zip 解压不完整，重新获取 zip！" -ForegroundColor Red; $miss } else { Write-Host "目录结构校验通过" -ForegroundColor Green }
```

- 输出绿色「目录结构校验通过」→ 继续。
- 输出红色缺少列表 → zip 不完整，重新解压或重新获取。

## 4. 构建镜像

回到 PowerShell，执行构建：

```powershell
cd C:\build\aiworkspace
$v = (Get-Content VERSION -Raw).Trim()
docker build --platform linux/amd64 -t "ai-workspace:$v" .
```

- `Get-Content VERSION` 读出版本号（如 `1.4.0`），后面导出 tar 文件名要用。
- 首次构建较久：前端 bun 构建 + Go 编译**全部在 docker build 内部完成**，阶段间有缓存，基础镜像拉取视网络可能较慢。
- 二次构建复用 web 与 Go 缓存，源码不变时几分钟内完成。
- **禁止**在打包机手动执行 `bun run build` / `go build`。
- `--platform linux/amd64`：Windows x86_64 打包机可省略；目标机是 ARM 则改为 `linux/arm64`。

## 5. 导出 tar 并记录校验值

```powershell
docker save -o ".\ai-workspace-$v.tar" "ai-workspace:$v"
Get-Item ".\ai-workspace-$v.tar" | Select-Object Name, @{N='SizeMB';E={[math]::Round($_.Length/1MB,1)}}
Get-FileHash ".\ai-workspace-$v.tar" -Algorithm SHA256
```

- `docker save`：把镜像导出为**一个文件**（几百 MB 属正常）。
- `Get-FileHash SHA256`：生成校验值——**把它记下来，连同 tar 一起告知服务器运维**，传输后要核对。

## 6. 传输给部署电脑

方式一：PowerShell 内置 scp（Windows 10/11 自带）：

```powershell
scp .\ai-workspace-1.4.0.tar 用户名@服务器IP:/opt/aiworkspace/
```

> 首次连接会问 `Are you sure you want to continue connecting?`，输入 `yes`；然后输入服务器密码。

方式二：图形化工具 WinSCP / XFTP，拖拽上传到对方电脑 `/opt/aiworkspace/` 目录；或 U盘 / 网盘拷贝。

> 同时把 `docker-compose.prod.yml` 和 `.env`（按部署教程填好变量）一并交给对方，启动时要用。

## 7. 常见报错

| 现象 / 报错 | 原因 | 处理 |
|------------|------|------|
| `无法连接到 Docker 守护进程` | Docker Desktop 没启动 | 启动 Docker Desktop，等托盘图标稳定 |
| `docker : 无法将"docker"项识别为 cmdlet` | Docker Desktop 未安装或未加入 PATH | 重新安装 Docker Desktop，安装后新开 PowerShell 窗口 |
| `manifest for oven/bun:... not found` 或 `manifest unknown` | 基础镜像 digest（`@sha256:...` 校验值）在镜像仓库已失效 | 编辑 `Dockerfile`，把 `FROM` 行末尾的 `@sha256:xxxx...` 整段删掉，只留 `oven/bun:1.4.4` 这类 tag，保存后重新 build（其余两个 FROM 同理） |
| `pull access denied` / 拉取超时 | Docker Hub 网络受限 | 按第 1 步配置 `registry-mirrors` 加速后重试 |
| `exec format error` 启动即崩溃 | 构建平台与服务器架构不匹配 | 确认 build 命令带了 `--platform`（见第 4 步），删除旧镜像重新 build |
| ``ERROR: `RUN --mount=type=cache` requires BuildKit`` | Docker 版本过旧 | 升级 Docker 至 20.10+；或临时删除 Dockerfile 第一行 `# syntax=docker/dockerfile:1` |

---

相关文档：`DEPLOY_GUIDE.md`（构建与部署完整流程）、`打包教程-Ubuntu.md`（Ubuntu 版）、附录A（开发机打源码 zip）
