## 改动说明

<!-- 这个 PR 做了什么，为什么这么做 -->

## 影响的层

- [ ] collector（采集）
- [ ] normalize（归一化）
- [ ] rules / governance（规则与闸门）
- [ ] workflow（工作流）
- [ ] llm（解释层）
- [ ] history / rule-optimizer（归档统计）
- [ ] web（界面与 API）
- [ ] docs / tooling

## 验证方式

<!-- 贴出实际执行的命令与结果，不要只写"已测试" -->

```bash
npm run check
node --test --test-reporter=spec "test/**/*.test.js"
node src/index.js --mode analyze --format text --input <file>
```

结果：

```text
tests 47 / pass 44 / fail 3（stockdb 数据集缺失，已知）
```

## 规则/参数变更（如适用）

| 参数 | 旧值 | 新值 | 依据 |
| --- | --- | --- | --- |
|  |  |  |  |

## 数据与敏感信息自查

- [ ] 没有提交 `.env`、真实 API Key、账户凭证或个人交易流水
- [ ] 没有新增 `outputs/`、`inputs/` 下的运行产物或第三方行情快照
- [ ] 新增的大文件（> 1 MB）已确认必要，并说明为何必须入库
- [ ] 新增第三方代码/内容已在 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) 登记许可与来源

## 其他

<!-- 兼容性影响、回滚方式、截图等 -->
