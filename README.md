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

## 可复现发布

使用已提交的明确源码版本（不会读取工作区，也不会把旧 ZIP 打入新包）：

```sh
python tools/package_plugin.py wallpaper <完整源码提交号>
```

工具从 Git blob 生成全部文件摘要，包含 `version.json`；Manifest 自身不参与自身哈希。
ZIP 路径、文件顺序、时间戳和权限固定，同一源码提交重复生成的 SHA-256 相同，
不受 Windows checkout 的 CRLF 转换影响。源码的版本、Manifest 版本和市场版本必须一致。

先提交生成的 Manifest、ZIP 和市场摘要，再将市场制品 URL 中的 `main` 改为该制品提交的
完整提交号并提交。先发布制品提交，再发布指向它的市场索引。不要改动旧版本包。
客户端按索引摘要验证下载内容，禁止通过忽略额外文件解决打包问题。

Wallpaper 3.0.1 修复包使用源码提交 `c196b3db5ef7294a907a34c6b746111fdbfd1986`，
修复 `version.json` 遗漏于 Manifest 的问题，保留原版本号及插件功能。
