# Tagengo：个人日语学习库

使用 ChatGPT 网页收录扩展录入内容，网页应用显示单词、例句和语法，OneDrive 应用文件夹保存学习记录。两台电脑和手机使用同一微软个人账号与同一个应用 ID。

## OneDrive 首次配置

1. 在 Microsoft Entra 管理中心注册应用。支持账户类型选择“仅个人 Microsoft 帐户”，或包含个人 Microsoft 帐户的选项。
2. 添加“单页应用程序 (SPA)”平台。重定向 URI 必须与实际访问学习库的网址完全一致（包括结尾斜杠）。部署地址预期为 `https://tagengo-study.mydexiaomail.chatgpt.site/`；实际部署成功后以最终地址为准。
3. 在 Microsoft Graph 委托权限中加入 `Files.ReadWrite.AppFolder`。
4. 复制“应用程序(客户端) ID”，在学习库“连接 OneDrive”中填写。
5. 两台电脑、手机使用同一个应用 ID；各设备分别登录并授权。

不需要创建或分享客户端密码。个人微软账号可以授权 OneDrive；但注册应用仍需要可访问应用注册的 Entra 目录。如果注册入口不可用，需要先解决目录/应用注册访问，不能仅凭 OneDrive 账号完成开发者配置。

官方资料：
- https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder
- https://learn.microsoft.com/en-us/entra/msal/javascript/browser/initialization

## 数据原则

- 单词保存表记（汉字可空）、假名、罗马音、释义、词性和活用。
- 例句只保存一次，通过稳定 ID 关联多个词和语法。高亮采用明确文本范围，可由用户调整。
- 语法保存含义、接续、使用条件及关联例句。
- 每次保存产生独立版本，保留父版本 ID；同一记录多个并行版本提示冲突，不按设备时间静默覆盖。
- OneDrive 为跨设备保存来源，本机缓存/待上传队列用于断网恢复。未同步内容必须明确显示。
- 数据不通过聊天网页或网页托管服务的应用后端保存。

## ChatGPT 网页录入

第一版采用用户主动收录：选中文字后打开学习库录入草稿。支持 GPT 按约定 JSON 格式整理后导入。不会自动抓取整个聊天历史，不声称 GPT 已拥有直接写入权限。
