# Eversko DSH Black Box

DeepSeek Harness 的隐私优先飞行记录器和故障报告工具。

Black Box 将 DSH 会话转换成简洁的时间线、工具与审批结果、令牌统计和异常提示。默认 `.dshpack` **不包含**提示词、思考文本、工具参数、工具结果、原始会话／调用标识符或文件路径，也不会上传任何数据。

首个版本支持原始 JSONL 和 DSH 的多帧 `.jsonl.zstd`，检测序列缺口、未完成的回合、工具结果缺失、审批卡住、输出失控和重复循环。

```sh
npm exec --package=@eversko/dsh-blackbox -- dsh-blackbox session.jsonl.zstd --runtime 0.1.1-rc.2 --json incident.dshpack.json --markdown incident.md
```

首个版本精确支持 `0.1.1-rc.2`，并已完成真实启动和失败回合捕获。`.dshpack` 仍包含用于诊断的安全格式工具名、预设名、时间、计数和单向哈希，因此分享前仍需检查。

本项目由 Eversko 社区独立开发，并非 DeepSeek 或 DeepSeek Harness 的官方组件，也未获得其背书。下一步是本地可视化查看器、两个运行的对比和版本／预设兼容徽章。
