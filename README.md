# GLM Quota Monitor（DSH 插件）

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）编写的 **GLM Coding Plan 额度监控插件**：在 Web GUI 里随时看到智谱 GLM Coding Plan 的剩余额度，再也不用等 1310 报错才发现额度打满。

## 功能

- **设置页「GLM 额度查询」**（设置 → 左侧栏）
  - 套餐档位（LITE / PRO / MAX）、更新时间
  - 每个 token 窗口的 **剩余 % / 已用 %**、彩色进度条、**重置时间（绝对时刻 + 倒计时）**
  - 内置工具 30 天次数：剩余 / 已用 + 按工具拆分明细
  - 手动刷新按钮 + **可设置自动刷新频率**（1 分钟 ~ 3 小时 / 关闭，选择自动记忆）
- **输入框下方极简 dock**：只显示 `5h 剩 xx% · x小时x分后重置`（升级 Pro/Max 后自动多出周窗口一栏）
- **Agent 工具 `glm_quota_check`**：在任何会话里直接问“我还剩多少额度”即可查询
- **零配置密钥**：每次请求实时从 DSH 凭据库解析 `ZAI_CODING_CN_API_KEY`（DSH 的 GLM coding 模型路由用的就是它），不落配置、不回显
- 刷新**不消耗**套餐额度：调用的是智谱账务查询接口（`open.bigmodel.cn/api/monitor/usage/quota/limit`），不跑模型、不调内置工具

## 数据说明

| 窗口 | 来源 | 说明 |
|---|---|---|
| 5 小时窗口 | `TOKENS_LIMIT` (unit=3) | 滚动窗口，Lite 套餐唯一 token 窗口 |
| 本周窗口 | `TOKENS_LIMIT` (unit=6) | Pro/Max 才有，Lite 下自动隐藏 |
| 内置工具 30 天 | `TIME_LIMIT` | search-prime / web-reader 等次数 |

注意：智谱只返回**百分比**，不给具体 token 数；`percentage` 是已用比例。

## 安装

要求：DSH 桌面版 / Web 版，profile 中已挂载 `dsh-credentials`、`dsh-host-webserver`、`dsh-tools`（默认组合都有）。

1. 克隆本仓库：

   ```powershell
   git clone https://github.com/XJPeng12/glm-quota-monitor.git
   ```

2. 在 DSH 会话里让 Agent 安装（或自行调用 Plugin Manager）：

   ```
   请安装插件 bundle：<克隆目录的绝对路径>
   ```

   等价操作：`plugin_manager install_bundle target=<绝对路径>`。安装后刷新 Web GUI 页面（F5）即生效。

> 插件以目录链接方式安装（`link:` 协议），后续修改源码后重新 `remove_bundle` + `install_bundle` 即可更新；替换已安装版本需要重启 DSH 才能加载新模块。

## 使用

- **设置 → GLM 额度查询**：完整详情 + 更新频率设置
- **输入框下方**：常驻的剩余额度 / 重置倒计时
- **会话内**：直接提问“GLM 额度还剩多少”，Agent 会调用 `glm_quota_check`

### 可选配置

插件行（`cordis.patch.yml` 中 `config`）支持：

| 字段 | 默认 | 说明 |
|---|---|---|
| `apiKey` | — | 直接提供 API Key（跳过凭据库） |
| `credentialRef` | `ZAI_CODING_CN_API_KEY` | 凭据库中的 Key 名 |
| `endpoint` | `https://open.bigmodel.cn/api/monitor/usage/quota/limit` | 上游接口（仅接受 https） |

## 工作原理

- Host 半（`index.js`）注册同源路由 `GET /glm-quota-v<版本>`：每次请求实时调智谱 monitor 接口并归一化，带 Origin 校验（拒绝跨站浏览器请求）；同时注册 `glm_quota_check` Agent 工具
- Client 半（`client.js`）注册两个槽位：`settings.section`（设置页）与 `conversation.composer.dock`（极简 dock），共享一个页面级取数 store，自动刷新频率存于 localStorage
- 样式仅使用 `--dsw-alias-*` 主题 token，跟随宿主明暗主题

## 卸载

`plugin_manager remove_bundle target=@local/glm-quota-monitor`，刷新页面。

## License

MIT
