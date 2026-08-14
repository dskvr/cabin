---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-08-14T11:32:21.601Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | deviation | src/domain/cohort.ts |  | Strict TypeScript validator narrowing was corrected during Task 2 verification. | open |  | 2026-08-14T11:32:21.549Z |  |
| 2 | 01 | deviation | src/nostr/event-parsers.ts |  | Week configuration event content is capped before JSON parsing. | open |  | 2026-08-14T11:32:21.601Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "01",
    "file": "src/domain/cohort.ts",
    "line": null,
    "description": "Strict TypeScript validator narrowing was corrected during Task 2 verification.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-14T11:32:21.549Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "01",
    "file": "src/nostr/event-parsers.ts",
    "line": null,
    "description": "Week configuration event content is capped before JSON parsing.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-14T11:32:21.601Z",
    "resolved_at": null
  }
]
````
