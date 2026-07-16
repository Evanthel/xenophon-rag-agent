# Xenophon Portfolio Benchmark Results

Generated at: 2026-07-16T14:54:44.094Z

Model: `google/gemini-2.5-flash`

Questions: 15

## Summary

- Average retrieved chunks: 4
- Citation pass rate: 73.3%
- Average expected-term coverage: 85%
- Average Standard latency: 1139 ms
- Average RAG latency: 4048 ms
- Estimated total cost: $0.03753

This is a historical live run from before citation-retry enforcement and `expected_sources` scoring were added. Keep it as the baseline; rerun `npm run benchmark:portfolio` after deploying the updated `rag-chat` function to produce the improved portfolio result.

## Per Question

| ID | Category | Retrieved | Citation pass | Term coverage | Standard ms | RAG ms | Cost |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| q01 | foundations | 4 | yes | 100% | 664 | 7481 | $0.003148 |
| q02 | foundations | 4 | yes | 100% | 525 | 4198 | $0.004323 |
| q03 | efficient-computation | 4 | yes | 100% | 3951 | 6756 | $0.002997 |
| q04 | efficient-computation | 4 | no | 25% | 3205 | 1178 | $0.001557 |
| q05 | training | 4 | yes | 100% | 868 | 4145 | $0.002428 |
| q06 | training | 4 | yes | 100% | 2194 | 2899 | $0.004530 |
| q07 | training | 4 | yes | 100% | 374 | 3707 | $0.002494 |
| q08 | training | 4 | no | 75% | 330 | 2836 | $0.000452 |
| q09 | training | 4 | yes | 25% | 364 | 1966 | $0.001397 |
| q10 | model-components | 4 | yes | 75% | 1629 | 3853 | $0.002080 |
| q11 | model-components | 4 | yes | 100% | 844 | 7123 | $0.003139 |
| q12 | model-components | 4 | yes | 100% | 427 | 4553 | $0.002454 |
| q13 | architectures | 4 | no | 75% | 438 | 1266 | $0.001223 |
| q14 | synthesis | 4 | no | 100% | 856 | 5402 | $0.002946 |
| q15 | compute-schism | 4 | yes | 100% | 420 | 3353 | $0.002361 |

## Notes

- Questions were aligned to the indexed document `lbdl.pdf` / _The Little Book of Deep Learning_.
- `Citation pass` is structural: bracket citations must exist and point to returned source indexes.
- `Term coverage` is a lightweight lexical check against expected answer terms, not a semantic grading model.
- Failed structural citation checks: `q04`, `q08`, `q13`, `q14`.
