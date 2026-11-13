# 统一代理管理：配置、验证与发布

## 使用范围与完成边界

本功能复用现有 Profile、节点处理链、自定义 INI 模板和 Clash 输出。新增显式客户端参数、Windows 作用域规则和严格策略校验。原始 Base64 节点订阅继续可用。

严格统一模板只支持本次实现的 Clash YAML 输出；请求其他完整配置格式会明确报错。旧模板的其他客户端转换继续兼容。

完整 Shadowrocket 输出采用 Clash YAML 复用路径，包含节点、策略组、规则和 DNS。必须在实际 iPhone 的“配置”入口验证；Node 测试或 Mihomo 校验不能代替 Shadowrocket 真机验收。未实测证明 YAML 路径不可用前，不新增原生 `.conf` 生成器，也不使用 Surge 输出冒充。

## 后台配置

1. 导出当前备份并保存当前 Cloudflare 部署提交。节点订阅与输出配置含真实凭据，不提交仓库。代码变更先在与生产 KV/D1 隔离的预览环境验证。
2. 使用既有“家庭共享”作为资源入口，继续在其中选择机场和手动 VPS；保留其旧订阅链接。
3. 将“统一代理管理（Windows / Shadowrocket）”预设复制为后台的一份自定义 INI 业务模板。也可从 `scripts/generate-unified-examples.mjs` 生成同一模板。
4. 新建 00-TEST、Windows-Mihomo、iOS-Shadowrocket，三者都通过 `subProfiles` 引用同一资源入口，并引用同一份 `custom:<template-id>`。使用内置转换引擎。注意：模板来源应选“自定义规则模板”，不能选会忽略模板引用的“内置自动路由”。
5. 在机场订阅上开启 `enableNodeCache`。请求刷新与无人值守刷新都会使用最近有效节点保护。

仅需要试用预设时，来源模式为 `preset`、引用为 `builtin:unified_proxy_management`，转换引擎仍为 `builtin`。规则要在后台持续编辑时，使用上面的共享自定义模板。

### 可审核的离线准备

```powershell
node scripts/prepare-unified-rollout.mjs BACKUP.json .private-rollout 家庭共享
```

该命令只读本地备份，输出不含凭据的 `rollout.review.json` 及含凭据的 `rollout.import.private.json`；不会联网、导入或部署。导入包使用 `dataOnly`，不更改 Token、运行设置和环境密钥。旧 Profile、订阅、手动节点及已有模板全部保留；发现重名 Profile 时停止，避免覆盖。

导入包包含整个业务集合。导入前必须重新比对线上是否发生新修改，不能用旧快照覆盖后来新增的资源。优先逐项应用已审核差异；只有确认快照新鲜且差异正确时，才使用完整业务导入。

## 客户端链接

从现有 Profile 链接追加参数，不在文档或代码中填写真实 Token：

| 用途         | 参数                                  | 导入位置                                         |
| ------------ | ------------------------------------- | ------------------------------------------------ |
| Windows      | `?target=clash&client=windows-mihomo` | Clash Verge Rev 远程订阅；一键导入已显式带该参数 |
| iOS 完整配置 | `?target=clash&client=shadowrocket`   | Shadowrocket → 配置 → + → 从 URL 下载并启用      |
| 旧节点订阅   | `?target=base64` 或原自适应链接       | 原来的节点订阅入口                               |

Shadowrocket 的“首页添加订阅”和“配置下载”是不同操作。新界面单独展示完整配置链接，旧一键导入标明“仅导入节点”。不能通过刷新首页节点订阅来验收规则同步。

显式完整客户端输出要求内置引擎及 `target=clash`，不允许 `list=true`。配置失败返回 HTTP 422，不会悄然变为 Base64 节点列表。客户端必须保留上次有效配置并显示更新失败。

## 共享规则与策略

`[MiSub] strict-policies=true` 开启严格模式。旧模板继续兼容，新统一模板默认启用。`rule-level=none` 表示完全采用这份业务定义，避免内置 AI 规则自动追加到默认规则之后。

`[Rule:windows]` 只在 `client=windows-mihomo` 时输出；`[Rule]` 为共享规则。iOS 排除 Windows 规则时，响应头 `X-MiSub-Config-Diagnostics` 显示排除条数。普通未分作用域的进程规则在 iOS 输出中报错。

规则优先级：浏览器与搜索域名的 AND → Claude/OpenAI/Gemini 独立规则 → Google 通用规则 → 中国大陆域名集 → GEOIP CN → MATCH PROXY。使用精确 `DOMAIN,www.google.com` 组合，避免把 `gemini.google.com` 提前分流到浏览器搜索策略。

Claude-US、OpenAI-US、Gemini-US、Google-US 分别持有独立的美国节点候选，可在各服务组中分别选择实际节点，选择其中一个不会改变另一个服务的出口。地区组和默认代理组均采用 `select`，不存在 DIRECT 成员；大陆直连由路由规则控制。地区标签来自名称/元数据，实际出口国家需单独验证。

固定出口时，在共享模板中将业务组改为只包含已核实的稳定节点名，例如：

```ini
[Proxy Group]
Claude-US = select, US-VPS-STABLE
```

同时删除旧的同名业务组定义，避免重复定义合并候选。该节点被删除或改名时，业务组保留并变为 `select: [REJECT]`，对应服务规则仍存在。不要使用“美国自动测速”来表达固定单一出口；客户端当前选择与服务器候选列表是不同状态，调整默认顺序不会保证覆盖客户端保存的选择。

严格模式会拒绝循环、未知规则目标、敏感服务到 DIRECT/PASS 的传递路径、US 业务组中的非美国标签节点、未知节点转换和无效正则。空组拒绝连接，失效节点引用被清理，业务规则不会因剪枝消失。

## Shadowrocket 能力边界

复用完整 YAML 时保留节点、组、规则及 DNS；显式排除本地端口、控制器、TUN 和 Windows 进程运行设置。当前 iOS 路由允许 DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD、IP-CIDR、IP-CIDR6、GEOIP、RULE-SET、MATCH/FINAL；组类型允许 select/url-test/fallback。MRS、proxy-providers、dialer-proxy 和未实现转换的规则/组类型会报错，不静默删除业务规则。

DNS 与各协议传输字段仍需要实际 Shadowrocket 版本验收，尤其是 Fake-IP、GeoSite DNS 策略、远程规则 provider、REALITY 和协议扩展。不能把这份能力边界当作完整的 Shadowrocket 官方兼容矩阵。

若真机验证显示某字段不兼容，先在独立适配层显式转换或返回错误；若仍无法同时更新节点、组和规则，再新增消费同一模板模型的 Shadowrocket 原生渲染器。

## Windows 本机设置与测试

MiSub 可生成 Rule 模式、进程查找设置和 DNS；Clash Verge Rev 的服务模式、TUN 开关及本机权限需要在客户端确认。模板不自动接管 Windows 网络设置。

在 00-TEST 验证时，Clash Verge Rev 选择 Rule 模式和对应远程订阅，启用服务模式及 TUN。按本机内核版本核对以下 TUN 参数；不要将这些运行设置复制到 iOS：

```yaml
tun:
    enable: true
    stack: mixed
    auto-route: true
    auto-detect-interface: true
    strict-route: true
    dns-hijack:
        - any:53
```

这些是建议的本机覆写参数，当前业务模板不会擅自启用 TUN。配置中的 `ipv6: false` 不能证明 Windows 的所有 IPv6 路径已被系统阻断。需要测试浏览器安全 DNS、HTTP/3、TUN DNS 接管、网卡路由及 IPv6 访问。

测试顺序：

1. 两浏览器同时打开全新 Google 连接，在 Mihomo 连接日志中核对进程名、命中规则和策略链：Edge → 新加坡，Chrome → 美国。
2. 两浏览器分别访问大陆网站，命中中国大陆域名/IP 直连；访问 Claude/OpenAI/Gemini 时命中各自业务组，Gemini 不命中搜索例外。
3. 将 00-TEST 的 AI 固定出口改为不存在节点，刷新订阅后确认该组为 REJECT，服务访问失败而大陆站点仍可访问。恢复共享模板后再次刷新。
4. 对“节点存在但连接不可达”单独测试，确认无直连回退；在连接日志中检查最终策略，不以“网页能够打开”代替验证。
5. 单独退出 Mihomo/TUN，测试系统是否直接访问国外服务。这是系统 Kill Switch 的验收，不属于 MiSub 代理策略的承诺。

### 系统 Kill Switch

此改造没有安装或修改 Windows 防火墙规则。需要系统级保护时，应另行设计高级防火墙的默认出站策略与必要允许规则；先记录 Mihomo 服务路径、出口地址、网卡、DNS、DHCP、管理连接及大陆直连需求。按 Microsoft 的高级防火墙流程配置，并从本机控制台先导出策略，保留可用的恢复通道。

不能简单地“阻断整个浏览器出站”并宣称已兼容 TUN 和大陆直连。严格出站白名单与大陆直连规则需要协调维护。远程控制环境尤其不能在未验证管理链路允许规则前切换默认出站策略。

验收必须包含内核崩溃/退出、TUN 关闭、网络切换、重启及 IPv4/IPv6；在需要保护的服务上验证直连确实失败。通过验证前，只能标记为未实现系统级 Kill Switch。

## 刷新、规则版本与回滚

保护性节点缓存需显式开启。启用后 `/cron` 与手动调度入口复用现有订阅抓取/解析服务；上游失败计入失败，缓存回退另计数，不当成上游成功。关闭缓存的旧订阅保留原来的元数据更新行为。

Cloudflare Pages 需外部定时调度调用已有 `/cron`，沿用现有 Bearer 授权，不创建或更换 Token。前端页面定时器不等同于无人值守任务。配置后台定时服务时，不把授权写进公开 URL 或文档。

内置中国域名源固定版本，客户端定期下载相同 revision 不会得到新规则。更新规则版本应经过测试再发布；需要滚动规则源时，在共享业务模板中明确选择可维护的来源。模板缓存与客户端各有刷新周期，排查时先区分缓存延迟和实际生成失败。

回滚顺序：切回旧 Profile/客户端远程配置；恢复上一版 Cloudflare 部署；必要时根据备份恢复被更改的业务集合。代码回滚不会撤销 KV/D1 配置修改，恢复旧快照也可能覆盖后来新增资源，须先比对。环境变量和运行密钥单独保存。

仓库原有定时强制镜像会丢弃 Fork 的定制提交，已改为只允许快进；分叉时停止并要求人工合并，避免后续覆盖此实现。

## 验证命令

```powershell
npm ci --ignore-scripts
npm run test:run
npm run build
node scripts/generate-unified-examples.mjs
mihomo -t -d PRIVATE_DATA_DIR -f Windows-Mihomo.example.yaml
```

示例生成器只使用虚构凭据和 example.com 地址。实际配置、备份、上游响应和客户端日志必须保存在仓库之外或被忽略的私有目录。

参考：[Mihomo 路由规则](https://wiki.metacubex.one/config/rules/)、[TUN](https://wiki.metacubex.one/config/inbound/tun/)、[Microsoft 高级防火墙规则配置](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure)、[Shadowrocket 开发者页面](https://apps.apple.com/us/app/shadowrocket/id932747118)。
