<p align="center">
  <a href="README.md">English</a> |
  <strong>简体中文</strong> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <img src="src/assets/logo.png" width="112" alt="EvelProxyTool Logo">
</p>

<h1 align="center">EvelProxyTool</h1>

<p align="center">
  One Proxy. All Models. Any Platform.<br>
  CLIProxyAPI 的便携桌面控制台 —— 我们的目标是实现 token free（free 在这里的意思是自由）。
</p>

## 项目简介

EvelProxyTool 是基于 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 打造的图形化桌面管理工具，
将内核生命周期管理、OAuth 授权、API 供应商聚合、协议转换、凭据管理、配额查询、用量记录、模型别名与
Agent 客户端配置整合到同一个界面中，让一个本地代理就能同时对接 Claude、Codex、Gemini 以及所有支持
这些接口的 Agent/CLI 工具。

应用基于 Tauri、React 与 Rust 构建，可以随包携带匹配的 CLIProxyAPI 内核压缩包，让首次安装和离线安装
更加简单。

## 功能导览

### 主页仪表盘与本地 API 端点

主页可以快速查看本地代理运行状态和可直接使用的 API 端点：

- 启动、停止、重启并刷新 CLIProxyAPI 内核。
- 查看安装状态、运行状态、进程 ID 与监听端口。
- 复制可直接使用的 OpenAI、Claude、Gemini 兼容端点。
- 一眼查看本地连通性与应用/内核版本。

内核安装、版本比对与离线安装可在**版本管理**页面完成。

### OAuth 账号授权

“账户”页面集中管理各家供应商的浏览器授权流程，并以一张扁平表格列出全部已授权凭据，
配额、到期时间与优先级一目了然：

- Codex OAuth
- Claude OAuth
- Antigravity OAuth
- Kimi OAuth
- xAI OAuth

EvelProxyTool 会在浏览器中打开授权页面，在自动回调不可用时也支持手动完成回调流程，并可选择
自动定时刷新配额。

### API 供应商聚合

供应商工作区按协议或供应商管理上游 API 凭据与端点：

- Codex
- OpenAI 兼容供应商
- DeepSeek
- Claude
- Gemini

你可以添加多个连接、搜索已有条目、刷新供应商状态，并通过统一的本地 CLIProxyAPI 端点使用它们。
请求与响应可以在受支持的 OpenAI、Claude、Gemini 及兼容格式之间转换。

### 用量记录与 Token 分析

“用量”页面帮助你了解本地请求活动与 Token 消耗情况：

- 查看请求总数、Token 数量、成功率、吞吐量、缓存命中率与预估花费。
- 按时间、模型、供应商、来源、密钥与结果筛选用量。
- 查看请求/Token 趋势，以及输入、输出、推理与缓存用量。
- 浏览请求详情、分析视图与价格统计。
- 通过 CPA 的实时用量订阅采集数据，配合可靠的本地收件箱与自动 HTTP 回退机制。
- 启动时一次性升级旧版用量数据库，并在 `usage-records/backups` 下保存备份。

### Agent 客户端配置

“Agent 配置”页面会检测已安装的桌面端和 CLI 客户端，并帮助它们接入本地代理。支持的客户端包括：

- Claude Code
- Claude Desktop
- Codex
- OpenCode
- OpenClaw
- Hermes Agent
- Pi（配合 CLIProxyAPI 供应商扩展）
- ZCode
- Kimi Code
- Grok Build

对于受支持的客户端，应用可以同步可用模型目录、选择默认模型、在应用受管配置前备份原始配置，
并支持还原为之前的配置。

## 其他能力

- 管理内核设置、API 密钥、远程管理凭据与路由策略。
- 创建面向客户端的模型别名，并映射到供应商模型与推理级别。
- 上传、下载、查看并管理认证文件。
- 查看供应商配额与账号可用性。
- 保持应用常驻于 macOS 菜单栏或 Windows 系统托盘。
- 支持越南语、英语、简体中文与日语界面。

## 快速开始

1. 前往 [GitHub Releases](https://github.com/evel2903/EvelProxyTool/releases/latest) 下载适用于你操作系统的安装包。
2. 解压 Windows 或 Linux 压缩包，或打开 macOS DMG。
3. 启动 EvelProxyTool。
4. 打开**版本管理**，安装内置或最新版本的 CLIProxyAPI 内核。
5. 返回**主页**，启动内核，然后复制所需的本地端点或配置 OAuth/API 供应商。

## 升级说明

每个 Windows 发行版都会同时发布完整 ZIP 和旧版 `update` ZIP。这样尚未迁移的旧客户端仍可使用应用内更新，
而新客户端则使用完整安装包，以便随附内核也能一并更新。

当前的 Windows、Linux、macOS 发行包均支持应用内自动更新。Linux 会在保留运行时数据的同时替换便携应用文件，
macOS 会替换已签名的应用程序包。每个平台都会等待新版本确认成功启动，若启动失败会自动回滚。安装目录必须
对当前用户可写。

现有的 Linux 和 macOS 安装需要先手动升级到包含跨平台自动更新标记的版本，之后启动一次该版本即可使用应用内更新。

如果你正在使用 v0.2.5 或更早版本，请执行一次手动迁移：退出 EvelProxyTool，下载适用于你架构的最新完整 Windows ZIP，
然后将其顶层目录内容覆盖到现有安装目录。请勿先删除现有目录；`config.toml`、`oauth`、`cpa-core/config.yaml`
等用户数据会保留原位。启动新版本后，后续版本即可使用应用内自动更新。

## 支持的平台

GitHub Actions 会构建以下发行包：

| 操作系统 | 架构 | 包格式 |
| --- | --- | --- |
| Windows | amd64、aarch64 | ZIP |
| macOS | amd64、aarch64 | DMG |
| Linux | amd64、aarch64 | TAR.GZ |

## 相关项目

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) —— 本应用管理的代理内核。
- 本项目最初 fork 自 [router-for-me/EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI)；`upstream`
  远程仓库仍指向该地址，方便需要追踪上游变更的人使用。
