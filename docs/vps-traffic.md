# VPS 月度流量

在「手动节点 → 新增」粘贴单条节点链接，或编辑已有节点，打开「VPS 月度流量」。额度、每月重置日、重置时间和计费时区各节点独立设置。没有对应日期的短月份在月末重置。计量单位为十进制 GB（1 GB 等于 1,000,000,000 字节）。

DMIT 实例面板可查看传输额度和下一次重置时间。套餐可能按双向相加或双向计数最大值扣额度。请按照实例实际显示选择计费方式。[DMIT 实例常见问题](https://docs.dmit.io/zh/guide/faq/instance)

## 用量来源

MiSub 可接入输出 JSON 的 HTTPS 采集接口。接口应返回**当前计费周期**的计数，禁止把自开机累计量直接作为当月用量。账期起始是配置时区内的本地时间，格式为 `YYYY-MM-DDTHH:mm`。接口直接报告实际计费用量时用 `usedBytes`，选择双向相加或最大值时用 `uploadBytes` 和 `downloadBytes`。

```json
{
  "periodStart": "2026-11-22T00:00",
  "timeZone": "Asia/Singapore",
  "usedBytes": 137400000000
}
```

自定义域名由部署管理员加入 Cloudflare Pages 上的 `VPS_TRAFFIC_ALLOWED_HOSTS`（逗号分隔，精确域名）。如果接口要求 Bearer Token，将凭据存为 Pages 密钥，例如 `VPS_TRAFFIC_TOKEN_LA`，在节点编辑页填写变量名。接口地址、令牌不会进入订阅数据。接口必须直接返回结果，不跟随重定向。目前仅提供通用 JSON 接入，实际 DMIT 用量需绑定经核验的计量来源。

## 更新与展示

已配置的节点可由现有的受保护 `/cron` 刷新，也可只跑流量任务 `/cron?task=vps-traffic`，使用已有 Cron Secret 的 Bearer 鉴权。Cloudflare Pages 部署可配置仓库变量 `MISUB_VPS_CRON_URL`（完整的 HTTPS `/cron` 地址）和 Actions 密钥 `MISUB_CRON_SECRET`，让随仓库提供的工作流每小时触发。已有每小时外部 Cron 时直接复用即可。

客户端手动更新订阅或完整配置时读取最新有效记录，超过采集间隔时也会尝试采集。失败时最多每五分钟重试，保留本账期最后有效余额并标注时间。跨期不沿用旧余额。节点发生切换时用量记录按来源和计费设置隔离。

小火箭节点订阅末尾显示独立的流量提示。小火箭原生配置和 Clash 内置配置在代理分组列表显示同样的信息。信息分组只有 REJECT，且不会被业务规则引用。机场订阅的流量信息和原协议头保持独立。
