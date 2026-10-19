# Vigil Wallpaper Engine 插件

本目录是 Vigil 原版 Brain 目录插件（3.0.0），直接沿用 `brain/plugins/wallpaper/` 的 Python 入口、HTTP 路由、设置格式和 renderer 前端资源。

## 功能

- 自动探测 Steam 安装和所有 `libraryfolders.vdf` 创意工坊库，也允许在壁纸设置中手动指定 Workshop 目录。
- 扫描 Wallpaper Engine 壁纸库，显示缩略图，并播放视频/网页壁纸；场景壁纸沿用原插件的预览图显示行为。
- 保留原有配置、启用开关、选中壁纸、透明度、遮罩、模糊和静音设置；启用后在 Vigil 窗口内应用背景层及透明/毛玻璃样式。
- API 兼容原 Brain 插件路径：`/api/plugin/wallpaper/*`。

## 运行环境和数据

- 依赖 Vigil Brain 的目录插件 API、Python 标准库和客户端通用插件前端 API；不需要额外 pip 包。
- 配置与扫描缓存仍保存在用户目录 `~/.vigil/wallpaper/`，壁纸素材由 Steam/用户 Workshop 目录管理。
- 禁用或卸载不会删除用户配置、缓存或 Workshop 素材。
- Manifest 中的 `wallpaper.*` 权限是安装时展示及校验的能力声明；插件运行仍使用 Vigil Brain 的既有授权 API 合约。

## 安装

在 Vigil 插件市场安装。客户端先校验 HTTPS ZIP 制品 SHA-256，再校验本 Manifest、协议、权限白名单和全部文件 SHA-256，然后使用 Brain 通用目录插件安装事务落盘。

## 版本

- 3.0.0：恢复原版 Wallpaper Engine Brain 插件。
