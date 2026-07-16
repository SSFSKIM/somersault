# OTel demo

```bash
docker compose up            # collector on http://localhost:4318, prints all telemetry
```

Then, from `harness/`:

```ts
import { openSession } from "cc-harness";
const s = openSession({ telemetry: { endpoint: "http://localhost:4318" } });
await s.submit("hello");
```

Watch the collector logs for `claude_code.*` metrics and `user_prompt`/`api_request`/`tool_decision`
events. Full guide: `../../docs/guides/observability-otel.md`.
