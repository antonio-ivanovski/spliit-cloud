---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 来了
inApp: true
email: true
---

Spliit Cloud 2.5.0 已发布。下面介绍本版本的新功能，并回顾您可能错过的近期功能。今后我们只会通过这种方式分享新功能和重要公告，不会包含日常发布的小补丁和修复。

## 动态标签页现在只显示与您相关的内容

动态标签页现在与支出时间线保持一致：通过“只看与我相关 / 全部”开关，将与您无关的动态收起到内联行中，每笔支出都会在单独的“我的份额：”行中显示您的份额。详情请参阅 [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) 版本说明。

## 删除账号，附带 48 小时安全期

账号设置中新增了危险区和专用确认页面：查看每个群组的相应影响，选择名称和剩余余额的处理方式，然后输入 删除 即可预约删除。您的账号将在 48 小时内保持有效，您可以随时取消。详情请参阅 [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) 版本说明。

## 分类更快，还可从群组工具批量整理

支出分类改用 Jev 决策模型后仅需约 250 毫秒，而之前使用 LLM 约需 3 秒，不确定的推测会显示为一键应用的建议按钮。如果整个群组需要整理，可在群组工具中使用[批量分类](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0)统一查看建议并保存。详情请参阅 [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) 和 [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) 版本说明。

## 从几乎任何银行或卡片 CSV 导入

上传银行对账单或卡片导出文件，把已有支出带过来。[通用 CSV 导入器](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0)提供实时预览来映射列、映射分类，并在写入前标记重复项。

## 所有账号均支持通行密钥，包括访客

使用指纹、面容或安全密钥代替密码登录。通行密钥适用于邮箱、社交和访客账号，与匿名账号搭配使用，可替代恢复链接。详情请参阅 [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) 版本说明。

## 几秒钟邀请全屋加入

分享一个仅供扫码的二维码，全屋都可以使用，有效期为 15 分钟，并实时显示已加入名单。访客也可以用手机相机扫描，或使用“扫码加入”操作加入。详情请参阅 [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) 版本说明。

## 更简洁的应用，只显示与您相关的内容

时间线现在会将与您无关的支出和动态收起到内联行中，并提供“只看与我相关 / 全部”开关。您还可以自定义群组标签页顺序并隐藏不用的标签页，在支出详情中查看按人列出的明细，在手机上使用大滚轮选择时间。详情请参阅 [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) 和 [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1) 版本说明。

## 随身带走您的数据

导出群组和账号的完整 ZIP 往返备份，以及 CSV 和可打印的 PDF 报告。导入和导出的说明请参阅 [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) 版本说明。

## 让每个群组都独具特色

为每个群组设置表情符号和颜色，在卡片、列表和氛围背景中展示。详情请参阅 [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) 版本说明。

## 面向开发者：出站 Webhook

将支出的创建、更新和删除作为签名事件推送到您自己的 HTTPS 端点，支持重试、投递记录和重新投递。设置方法请参阅 [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) 版本说明。
