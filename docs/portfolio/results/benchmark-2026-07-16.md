# Xenophon Portfolio Benchmark Results

Generated at: 2026-07-16T17:32:24.415Z

Model: `google/gemini-2.5-flash`

Questions: 15

## Summary

- Average retrieved chunks: 4
- Citation pass rate: 100%
- Expected-source pass rate: 100%
- Average expected-term coverage: 88.3%
- Average Standard latency: 1934 ms
- Average RAG latency: 4993 ms
- Estimated total cost: $0.048606

## Per Question

| ID | Category | Retrieved | Citation pass | Source pass | Term coverage | Standard ms | RAG ms | Cost |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: |
| q01 | foundations | 4 | yes | yes | 100% | 606 | 6349 | $0.003014 |
| q02 | foundations | 4 | yes | yes | 100% | 6478 | 3343 | $0.004415 |
| q03 | efficient-computation | 4 | yes | yes | 100% | 287 | 6612 | $0.003634 |
| q04 | efficient-computation | 4 | yes | yes | 50% | 366 | 4161 | $0.004217 |
| q05 | training | 4 | yes | yes | 100% | 349 | 10743 | $0.004731 |
| q06 | training | 4 | yes | yes | 100% | 548 | 3573 | $0.002505 |
| q07 | training | 4 | yes | yes | 100% | 427 | 4190 | $0.002616 |
| q08 | training | 4 | yes | yes | 100% | 720 | 3122 | $0.002292 |
| q09 | training | 4 | yes | yes | 25% | 10027 | 3088 | $0.002124 |
| q10 | model-components | 4 | yes | yes | 50% | 6863 | 3823 | $0.002300 |
| q11 | model-components | 4 | yes | yes | 100% | 363 | 3890 | $0.004599 |
| q12 | model-components | 4 | yes | yes | 100% | 518 | 3848 | $0.002212 |
| q13 | architectures | 4 | yes | yes | 100% | 654 | 6658 | $0.003495 |
| q14 | synthesis | 4 | yes | yes | 100% | 427 | 4340 | $0.002859 |
| q15 | compute-schism | 4 | yes | yes | 100% | 377 | 7160 | $0.003592 |

## Notes

- All 15 questions retrieved chunks from the expected source document.
- Citation pass is structural: bracket citations must point to returned source indexes. Grouped citations such as `[2, 4]` are supported, while four-digit bibliography references such as `[2020]` are not treated as source indexes.
- Expected-term coverage is a lightweight lexical check rather than a semantic or human correctness score.
- Standard and RAG paths used the same model. RAG additionally performed retrieval and returned source-grounded answers.
