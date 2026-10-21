# Vigil Wallpaper Engine 插件 3.1.0

3.1.0 增加基于 WebWallGL 3.0.0 的动态 Scene 实时渲染。场景文件由 Brain 媒体路由安全读取，客户端依赖固定版本；Scene 解析和 WebGL 渲染由 WebWallGL 提供。视频、网页壁纸、Workshop 扫描和既有配置继续兼容。

Electron 保留 contextIsolation 与 sandbox。插件页面、背景 DOM、样式、媒体票据和事件监听器均由插件生命周期清理。禁用或卸载不会删除用户 Workshop 文件。
