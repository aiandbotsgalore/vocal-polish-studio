

## Plan: Binary multipart/form-data transport — final revision with three polish items

The approved plan remains unchanged. Three small improvements are added:

### Addition 1: Byte-accurate analysis size check (edge function)

Replace `analysisRaw.length > MAX_ANALYSIS_SIZE` with `new TextEncoder().encode(analysisRaw).length > MAX_ANALYSIS_SIZE`.

### Addition 2: Request ID for correlated logging (edge function)

At the top of the handler (after formData parsing), generate `const reqId = crypto.randomUUID()`. Prefix all `console.log` calls in the handler with `[${reqId}]` — the initial "Received" log, the "Uploading audio" log, the "Waiting for file" log, model attempt logs, and error logs.

### Addition 3: Include statusText in client error fallback (geminiClient.ts)

In the non-200 fallback branch of `callGemini`, change the generic error to include `response.statusText`:

```ts
details: `Server error ${response.status}: ${response.statusText}`
```

Everything else from the previously approved plan is implemented exactly as specified. Same three files, same guardrails, same issue resolution table.

