# Vigil Wallpaper Engine 插件 3.2.0

3.2.0 提供 WebWallGL 3.0.0 实时 Scene 渲染、受控用户图片/视频导入、按名称搜索、媒体类型筛选和持久播放列表。导入文件由 Electron 主进程复制到用户数据目录，通过短时媒体票据读取；卸载插件不会删除个人导入素材。

Scene 脚本保持禁用（`scripts: false`），SceneScript 尚不支持。壁纸 HTML 在 sandbox iframe 中运行。Electron 保留 `contextIsolation` 和 `sandbox`；插件禁用或卸载时销毁 Scene、移除背景 DOM 与监听器并撤销媒体票据。

支持 Wallpaper Engine Workshop 的视频、网页与 Scene 项目，不支持外部 `application` 壁纸。复杂 Scene 的 Shader、粒子及交互兼容性需要真实授权工程验收。
