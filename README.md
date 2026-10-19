# Vigil 插件市场

此公共 Git 仓库提供 `market.json`、插件源码目录和可安装制品。Vigil Brain 默认从
`https://github.com/limingyi2/vigil-plugins.git` 克隆清单仓库至其持久化配置目录；插件包
通过市场条目的 HTTPS URL 下载并使用 SHA-256 校验。

## 仓库结构

```text
market.json
plugins/<插件名>/
  manifest.json
  version.json
  __init__.py
  frontend.js
  frontend.css
  README.md
  <插件名>-<版本>.zip
```

## 制品约定

每条市场记录必须与 `manifest.json` 的版本、协议和权限一致，并声明稳定可访问的 HTTPS
制品 URL 与 ZIP 的 SHA-256。Manifest 为允许字段的严格 JSON 对象，包含入口、依赖、权限
和所有包文件的逐项 SHA-256。包不包含壁纸素材、用户配置、缓存或其他插件数据。

安装前会校验制品摘要、Manifest、协议兼容性、权限白名单、文件路径及文件摘要，再由 Brain
通用静态插件检查器和事务安装。请在发布前审阅源码并验证制品与清单完全一致。
