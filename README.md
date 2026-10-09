# Vigil 插件市场

私人插件仓库，用于 Vigil 客户端的插件分发。

## 仓库结构

```
vigil-plugins/
├── market.json              # 插件清单（客户端拉取这个文件获取插件列表）
├── README.md                # 本文件
└── plugins/
    └── <插件名>/
        ├── __init__.py      # 后端逻辑（必填）
        ├── frontend.js      # 前端代码（可选）
        ├── frontend.css     # 前端样式（可选）
        └── README.md        # 插件说明文档
```

## 怎么上传新插件

1. 按《Vigil插件开发指南》写好插件
2. 把插件目录放进 `plugins/<插件名>/`
3. 在 `market.json` 的 `plugins` 数组里加一条：
   ```json
   {
     "name": "插件名",
     "desc": "一句话描述",
     "version": "1.0.0",
     "author": "作者名",
     "tags": ["标签1", "标签2"],
     "path": "plugins/插件名",
     "readme": "plugins/插件名/README.md",
     "has_frontend": true
   }
   ```
4. `git add . && git commit -m "add: 新插件" && git push`
5. 客户端点「刷新市场」就能看到

## 怎么更新插件

1. 修改插件文件
2. 更新 `market.json` 里对应插件的 `version` 字段
3. commit + push
4. 客户端会检测到版本变化，提示更新

## 可用标签

- `UI增强` - 界面相关
- `主题与外观` - 主题、壁纸、样式
- `会话与消息` - 聊天、消息处理
- `记忆` - 记忆、知识库
- `工具` - 工具调用、本地操控
- `效率` - 生产力、自动化
- `其他` - 不属于以上分类
