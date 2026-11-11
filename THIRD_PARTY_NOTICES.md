# 第三方组件与内容说明 (Third-Party Notices)

本仓库主体代码以 **MIT** 许可（见 [`LICENSE`](LICENSE)）发布。仓库内还包含下列第三方组件、内容与数据来源，它们各自保留原有许可与权利归属。

## 1. Awesome-finance-skills（Apache-2.0）

- 路径：`skills/Awesome-finance-skills-main/Awesome-finance-skills-main/`
- 上游项目：<https://github.com/RKiding/Awesome-finance-skills>
- 许可：**Apache License 2.0**，原始许可全文保留在原目录 `LICENSE` 文件中，未作修改。
- 本项目对其的用法：作为可选的 `alphaear-*` 分析技能参考包随仓库一并分发，供本地 agent 调用；本项目未修改其核心脚本逻辑。
- Apache-2.0 与本项目 MIT 许可兼容：分发时保留原许可与版权声明即可。若你再次分发本仓库，请一并保留该目录下的 `LICENSE`。

## 2. 妙想（mx-*）技能脚本

- 路径：`.codex/skills/mx-data`、`mx-moni`、`mx-search`、`mx-xuangu`、`mx-zixuan`
- 来源：东方财富妙想开放平台提供的技能示例（本地副本）。脚本中不含任何真实密钥，Token 由 `.env` 或本地 key-management 页面在运行时注入。
- 权利归属：脚本与接口文档版权归东方财富及其关联方所有；本仓库仅作本地集成示例。若需商用或再分发，请遵循妙想开放平台的服务条款。

## 3. 游资知识库文档（作者自建，需确认授权）

- 路径：`游资知识库/*.md`
- 内容：A 股短线情绪交易的判断标准、执行模板与实战框架笔记，由仓库作者整理维护。
- 状态：**待确认**。这些文档属于方法论笔记，部分表述可能源自公开课程/社群资料。公开再分发前，请确认其内容权利归属；如无法确认，建议将本目录移出公开仓库，改为私有笔记库。

## 4. 行情与资讯数据

- 数据来源：东方财富公开行情接口、同花顺涨停复盘、财联社快讯、本地 `stockdb` 数据集、妙想 API。
- 本项目只做本地抓取与结构化，不转售数据。**行情数据的再分发通常受数据提供方条款限制**，因此：
  - `outputs/` 默认写入 `.gitignore`，不作为仓库内容分发；
  - 仓库内仅保留脱敏演示产物（标的名为 `机器人龙头A` 这类占位符）。

## 5. 运行时/模型服务

- SiliconFlow API（`deepseek-ai/DeepSeek-V3.2` 等模型）：仅通过用户自己的 API Key 调用，不随仓库分发模型权重。

## 6. 依赖库

`package.json` 中的依赖（express、axios、cheerio、better-sqlite3、esbuild、react 等）均为 MIT / Apache-2.0 等宽松许可，具体以各自 `node_modules/<pkg>/LICENSE` 为准。
