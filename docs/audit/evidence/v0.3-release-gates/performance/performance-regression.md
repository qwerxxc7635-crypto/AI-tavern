# Ember Tavern V0.3 Performance Regression Report

- Current evidence commit: `a77eb03530ab2f90e635a18b513994b1b4dca1af`
- M1-T04 baseline commit: `589ef756c4df3b552a1b8c7cbf5b8da34c8793f5`
- Evidence: **FAKE**; real Provider: **NOT_RUN**
- Aggregation: MEDIAN_OF_RUN_P95, cold 3 runs + warm 3 runs, 10 samples/task/run
- Gate: **PASS**

## Core latency and queue comparison

| Task | M1 latency P95 | Cold median P95 | Warm median P95 | M1 queue P95 | Cold queue median P95 | Warm queue median P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GENERATE_WORLD | 1.857 | 1.843 | 0.157 | 0.056 | 1.764 | 0.067 |
| GENERATE_NPCS | 2.003 | 0.376 | 0.491 | 1.077 | 0.060 | 0.142 |
| GENERATE_QUEST | 0.645 | 0.224 | 0.156 | 0.026 | 0.064 | 0.097 |
| GENERATE_ADVENTURE_TURN | 1.128 | 0.190 | 0.184 | 0.068 | 0.067 | 0.051 |
| RESOLVE_DICE_RESULT | 0.234 | 0.124 | 0.143 | 0.083 | 0.080 | 0.105 |

## Long-save, token and cache gates

- SQLite growth: 541.582 bytes/additional turn (limit 4096).
- Unified Context: 377 tokens at 100 turns; 383 at 1000 turns; growth ratio 1.016 (limits 2048 tokens / 1.05×).
- GenerationQueue pressure P95: 3.000 ms (limit 50 ms).
- Fake Provider does not report prompt/output/cache usage. Unknown stays unknown; token and provider cache checks are NOT_EVALUATED, never converted to zero or a fabricated hit ratio.

## Checks

| Check | Status | Observed | Threshold | Explanation |
| --- | --- | ---: | --- | --- |
| GENERATE_WORLD.cold.latency_p95 | PASS | 1.843 | ≤ max(M1 × 3, M1 + 5 ms) = 6.857 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_WORLD.warm.latency_p95 | PASS | 0.157 | ≤ max(M1 × 3, M1 + 5 ms) = 6.857 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_WORLD.cold.queue_p95 | PASS | 1.764 | ≤ max(M1 × 3, M1 + 5 ms) = 5.056 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_WORLD.warm.queue_p95 | PASS | 0.067 | ≤ max(M1 × 3, M1 + 5 ms) = 5.056 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_NPCS.cold.latency_p95 | PASS | 0.376 | ≤ max(M1 × 3, M1 + 5 ms) = 7.003 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_NPCS.warm.latency_p95 | PASS | 0.491 | ≤ max(M1 × 3, M1 + 5 ms) = 7.003 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_NPCS.cold.queue_p95 | PASS | 0.060 | ≤ max(M1 × 3, M1 + 5 ms) = 6.077 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_NPCS.warm.queue_p95 | PASS | 0.142 | ≤ max(M1 × 3, M1 + 5 ms) = 6.077 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_QUEST.cold.latency_p95 | PASS | 0.224 | ≤ max(M1 × 3, M1 + 5 ms) = 5.645 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_QUEST.warm.latency_p95 | PASS | 0.156 | ≤ max(M1 × 3, M1 + 5 ms) = 5.645 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_QUEST.cold.queue_p95 | PASS | 0.064 | ≤ max(M1 × 3, M1 + 5 ms) = 5.026 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_QUEST.warm.queue_p95 | PASS | 0.097 | ≤ max(M1 × 3, M1 + 5 ms) = 5.026 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_ADVENTURE_TURN.cold.latency_p95 | PASS | 0.190 | ≤ max(M1 × 3, M1 + 5 ms) = 6.128 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_ADVENTURE_TURN.warm.latency_p95 | PASS | 0.184 | ≤ max(M1 × 3, M1 + 5 ms) = 6.128 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_ADVENTURE_TURN.cold.queue_p95 | PASS | 0.067 | ≤ max(M1 × 3, M1 + 5 ms) = 5.068 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| GENERATE_ADVENTURE_TURN.warm.queue_p95 | PASS | 0.051 | ≤ max(M1 × 3, M1 + 5 ms) = 5.068 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| RESOLVE_DICE_RESULT.cold.latency_p95 | PASS | 0.124 | ≤ max(M1 × 3, M1 + 5 ms) = 5.234 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| RESOLVE_DICE_RESULT.warm.latency_p95 | PASS | 0.143 | ≤ max(M1 × 3, M1 + 5 ms) = 5.234 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| RESOLVE_DICE_RESULT.cold.queue_p95 | PASS | 0.080 | ≤ max(M1 × 3, M1 + 5 ms) = 5.083 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| RESOLVE_DICE_RESULT.warm.queue_p95 | PASS | 0.105 | ≤ max(M1 × 3, M1 + 5 ms) = 5.083 ms | 使用多批次 run-level P95 的中位数，不选择单次最快值。 |
| generation_queue.p95 | PASS | 3.000 | ≤ 50 | 真实 GenerationQueue 的同进程压力队列等待 P95。 |
| long_save.database_bytes_per_turn | PASS | 541.582 | ≤ 4096 | 以 SQLite page_count × page_size 计算 100→1000 回合的增量，不使用文件系统稀疏大小。 |
| long_save.context_tokens | PASS | 383.000 | ≤ 2048 | 长期存档只投影有界 recent/memory，不把完整数据库或全量历史送入 Context。 |
| long_save.context_growth_ratio | PASS | 1.016 | ≤ 1.05 | 比较 100 与 1000 回合的 Unified Context token 估算。 |
| provider.input_tokens_per_sample | NOT_EVALUATED | unknown | ≤ 16384 | M1 与当前 Fake Provider 均未报告 usage；unknown 不按 0 处理。 |
| provider.cache_hit_ratio | NOT_EVALUATED | unknown | ≥ 0.5 | Fake Provider 没有计费缓存 usage；不以进程内 prefix reuse 冒充 Provider hit。 |

## Interpretation

This gate compares medians of independent run-level P95 values. It never selects the fastest sample. The 5 ms absolute slack prevents sub-millisecond Fake Provider scheduler noise from looking like a large ratio regression; the 3× ratio still catches meaningful growth above that noise floor.

Real Provider latency, token cost, and billing cache behavior require separately authorized REAL evidence. When available, input tokens must remain at or below the configured per-sample ceiling and cache hit ratio at or above the configured floor; missing usage cannot pass as zero.
