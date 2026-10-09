# wallpaper 插件

给 Vigil 客户端加一个渐变背景层，支持自定义颜色和透明度，带独立设置页。

## 功能

- 界面背景出现淡紫色渐变（透明度 12%）
- 导航栏自动多出「壁纸」设置页
- 设置页可切换背景显隐
- 可测试后端接口连通性

## 自定义

编辑 `frontend.js`：

**改背景颜色**（第 10 行）：
```javascript
'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
```

**改透明度**（第 11 行）：
```javascript
'opacity:0.12',
```

**换成图片背景**：
```javascript
'background-image:url(图片路径或URL)',
'background-size:cover',
```

## 版本

- v1.0.0 - 初始版本
