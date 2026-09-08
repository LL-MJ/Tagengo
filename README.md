# Tagengo

个人日语学习库：单词、例句、语法相互关联，使用个人 OneDrive 应用文件夹同步。电脑和手机浏览器可访问。

## 开发

- `npm install`
- `npm run dev`
- `npm run build`
- `npx tsc --noEmit`
- `node --experimental-strip-types --test --test-isolation=none tests/records.test.mjs`

## 配置与安装

见 [OneDrive 配置](docs/SETUP.md) 和 [浏览器扩展安装](extension/README.md)。

## 当前边界

- OneDrive 登录需要用户注册的微软应用 ID；未配置时只保存本机草稿，不具备跨设备同步。
- 自动同步在页面打开、聚焦、网络恢复、保存后和页面存活期间每分钟运行。不会在页面关闭时后台同步。
- 单词活用、读音和语法分析由手工或 GPT JSON 导入提供，不含自动形态分析或模型 API。
- 同一条记录多个并发版本会出现在冲突区，用户可选择版本。旧版本不会删除。
- OneDrive 同步当前读取应用目录的版本列表，新增文件逐条上传，适合个人小型学习库；后续可加入增量索引与历史归档。
- 浏览器本机缓存按微软应用 ID 与账号隔离。退出微软账号不会自动清除本机缓存；共用设备请使用独立浏览器配置。
- 手机适配已实现；未做真实手机界面测试、OneDrive 授权与跨设备实测。
- WebMCP 提供预览导入工具，浏览器不支持时自动忽略；当前环境未验证 WebMCP 注册与执行。
- 学习数据通过浏览器直接读写 OneDrive，不经应用后端；浏览器托管站点仍受该站点的访问策略约束。
