// Package server 只负责内嵌前端构建产物（server/webdist）。
//
// go:embed 只能引用当前包目录及其子目录，而按契约前端产物位于 server/webdist，
// 因此把 embed 变量放在模块根目录包里，由 cmd/server 引用。
package server

import "embed"

// WebDist 内嵌的前端构建产物（Vite 构建输出）。
// 构建 Docker 镜像时会用 frontend 的真实产物覆盖 server/webdist。
//
//go:embed all:webdist
var WebDist embed.FS
