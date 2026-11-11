# 敏感数据与公开性检查报告

- 检查时间：2026-11-11
- 检查范围：仓库全部**被 Git 跟踪**的文件（`git ls-files`，去除 `.git/`），以及公开可见的历史提交
- 检查方法：`git grep` 正则扫描（密钥/凭证/手机号/身份证/账户号）＋ 逐目录人工核对 ＋ 文件体积与日志内容审查
- 结论：**未发现真实 API Key、账户凭证或个人身份信息**；发现 **3 类不应继续公开的内容**（第三方行情快照、运行日志、本地开发配置），已在 0.2.0 中处理。

## 一、检查项与结果

| # | 检查项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 硬编码 API Key / Token | ✅ 未发现 | `git grep -nE "sk-[A-Za-z0-9]{16,}\|gh[pou]_[0-9A-Za-z]{20,}\|AIza[0-9A-Za-z_-]{20,}\|Bearer [A-Za-z0-9._-]{24,}"` 无匹配 |
| 2 | `.env` 是否入库 | ✅ 未入库 | `.gitignore` 含 `.env`；仅 `.env.example` 被跟踪，全部为占位符（`your_api_key_here`、`CMES_TOKEN=`、`IFIND_MCP_TOKEN=请填入…`） |
| 3 | 个人身份信息（姓名/手机号/身份证/银行卡/券商账号） | ✅ 未发现 | 正则扫描仅命中浮点数与妙想文档中的示例委托编号（`260854300000078983`，文档示例值，非真实账户） |
| 4 | 个人交易流水 / 持仓 | ⚠️ 已确认脱敏 | `outputs/history/*/outcome.json` 中标的名称为 `机器人龙头A` / `机器人核心B` / `AI核心C` 等占位符，`positionPct` 全为示例值（0），无真实账户或资金数据 |
| 5 | 受限制的行情数据 | ❌ 存在问题 → 已移除 | 2026-04-05 ~ 2026-04-13 的 `outputs/daily/*`（`auto-live.json` 单文件 2.2–2.6 MB）与 `outputs/history/*/live/*` 共 **30 个文件 / 28.61 MB**，为东财/财联社行情抓取原包，属第三方数据，不适合随代码分发 |
| 6 | 运行日志入库 | ❌ 存在问题 → 已移除 | `web-server.out`、`web-server.err`、`web_server.out`、`web_server.err` 记录了本机路径、接口调用序列与抓取失败详情 |
| 7 | 本地开发/编辑器配置入库 | ⚠️ 部分处理 | `.claude/settings.local.json`（含本机 PID、`taskkill //PID …` 授权项）已移除；`.claude/settings.json` 为通用命令白名单，保留 |
| 8 | 第三方内容授权 | ⚠️ 待确认 | `skills/Awesome-finance-skills-main/` 为 Apache-2.0（原 LICENSE 保留）；`游资知识库/*.md` 为公司/课程衍生笔记的可能性未排除，见 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) 第 3 节 |
| 9 | 本地数据集（`.db`）入库 | ✅ 未入库 | `.gitignore` 排除 `*.db` / `*.db-wal` / `*.db-shm`；`src/data/market.db` 未跟踪 |
| 10 | 服务器/内网地址泄露 | ⚠️ 可接受 | 仅出现 `127.0.0.1:3000/3030/7897/7899` 等本机回环地址与文档示例域名，无真实公网主机、内网 IP 或域名 |

## 二、0.2.0 已执行的处置

```text
删除（版本控制 + 工作区）：
  outputs/daily/2026-04-05 … 2026-04-13/{auto-live.json,auto-live.txt,news-catalysts.json}
  outputs/history/2026-04-05 … 2026-04-13/live/{auto-live.json,auto-live.txt}
    → 共 30 个文件 / 28.61 MB

删除（版本控制）：
  web-server.out, web-server.err, web_server.out, web_server.err
  .claude/settings.local.json

.gitignore 增补：
  inputs/        # 个人每日复盘原文
  *.out *.err    # 运行日志
  src/data/      # 本地 SQLite 运行时目录
```

保留的演示产物（脱敏）：

```text
outputs/history/2026-03-27|28|31/*        # 逐笔台账演示，标的为占位符
outputs/history/{index,dashboard,samples,rule-optimizer}.{json,txt}
outputs/daily/2026-03-31/*                # 完整日流水线演示
outputs/daily/undated/*                   # 无日期样本
```

## 三、需要你确认的两件事

1. **游资知识库授权**：`游资知识库/*.md` 是方法论笔记。若其中内容来自付费课程/社群资料，公开再分发可能超出授权范围。建议二选一：
   - 保留但明确标注来源与授权状态（当前做法）；
   - 移出公开仓库，改为私有笔记库（`git rm -r --cached 游资知识库 && echo 游资知识库/ >> .gitignore`）。
2. **行情数据再分发条款**：东财/同花顺/财联社/妙想的接口条款通常限制批量抓取与再分发。当前仓库只保留脱敏演示产物、不再提交行情快照，但**旧的 commit 仍包含已删除文件**（见下节）。

## 四、历史提交中的残留（需要你决定是否清理）

`3346173` 与 `1ef9439` 仍包含上述 30 个行情快照与 4 个日志文件。GitHub 上通过旧 commit 或 `git log -- outputs/` 仍可访问。彻底清除需要重写历史：

```bash
# 1) 备份 + 安装 git-filter-repo
pip install git-filter-repo

# 2) 从全部历史中剔除（示例：只保留 2026-03-27/28/31 与 undated 演示产物）
git filter-repo --invert-paths \
  --path outputs/daily/2026-04-05 --path outputs/daily/2026-04-06 \
  --path outputs/daily/2026-04-07 --path outputs/daily/2026-04-08 \
  --path outputs/daily/2026-04-10 --path outputs/daily/2026-04-13 \
  --path outputs/history/2026-04-05 --path outputs/history/2026-04-06 \
  --path outputs/history/2026-04-07 --path outputs/history/2026-04-08 \
  --path outputs/history/2026-04-10 --path outputs/history/2026-04-13 \
  --path web-server.out --path web-server.err \
  --path web_server.out --path web_server.err

# 3) 强推（会改写所有 commit hash，协作者需重新 clone）
git push --force --all
git push --force --tags
```

注意：重写历史后仓库体积会从约 45 MB 降到约 16 MB，且 `1ef9439` 这类引用哈希会变化。

## 五、持续防护建议

- 提交前自检（本地 pre-commit）：

```bash
git grep -nE "sk-[A-Za-z0-9]{16,}|gh[pou]_[0-9A-Za-z]{20,}|Bearer [A-Za-z0-9._-]{24,}" -- . && echo "发现疑似密钥，禁止提交"
```

- 开启 GitHub **Secret scanning** 与 **Push protection**（Settings → Code security）。
- 任何新增大文件（> 1 MB）应先进 `.gitignore`；归档只存"决策所需字段"的精简版。
- 密钥只通过 `.env` 与本地 `key-management.html` 注入，永不写入代码或文档示例。
