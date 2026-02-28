

## Plan: Refactor gemini-vocal to use Google AI File API

### Single file: `supabase/functions/gemini-vocal/index.ts`

**1. Restore models**
- `PRIMARY_MODEL = "gemini-3.1-pro-preview"`
- `FALLBACK_MODEL = "gemini-3-pro-preview"`

**2. Remove `MAX_BASE64_LENGTH`** (File API handles large files; keep `MIN_BASE64_LENGTH`)

**3. Add `uploadToFileApi(apiKey, audioBase64, mimeType)`**
- Binary conversion via `atob` + `charCodeAt` loop → `Uint8Array`
- POST resumable start, extract upload URL from both `x-goog-upload-url` and `location` headers
- PUT raw bytes with `upload, finalize` command
- Return `{ fileUri, fileName }`

**4. Add `waitForFileActive(apiKey, fileName)`**
- Poll GET every 2s, max 15 polls, return on `ACTIVE`, throw if exhausted

**5. Add `deleteFile(apiKey, fileName)`**
- DELETE, fire-and-forget with error logging

**6. Update main handler**
- After validation: upload → wait for active
- Build contents with `file_data: { mime_type, file_uri }` instead of `inlineData`
- Wrap Gemini call in `try/finally` calling `deleteFile`

### STATUS: ✅ IMPLEMENTED
