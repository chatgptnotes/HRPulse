# OpenCode + GLM (Z.ai) Setup

This document describes how the GLM API key is wired into OpenCode for the HRPulse
project, and how to reproduce or rotate the setup.

## 1. Where OpenCode reads config from

OpenCode loads its global config from:

- **Windows:** `C:\Users\<you>\.config\opencode\opencode.jsonc`
- **macOS / Linux:** `~/.config/opencode/opencode.jsonc`

A project-local config (`./opencode.jsonc`) would override the global one for that
project only.

## 2. Configuration approach: env var reference (NOT hardcoded)

The provider uses the standard Z.ai API endpoint with an **OpenAI-compatible**
client. The secret is never stored in the config file — it's resolved from the
`GLM_API_KEY` environment variable at runtime:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "glm": {
      "name": "GLM (Z.ai)",
      "api": "openai-compatible",
      "env": ["GLM_API_KEY"],          // <- declares the env var OpenCode should read
      "options": {
        "baseURL": "https://api.z.ai/api/paas/v4/",
        "apiKey": "{GLM_API_KEY}"       // <- placeholder, resolved from the env var
      },
      "models": {
        "glm-5.2":     { "name": "GLM-5.2",     "tool_call": true, "temperature": true, "attachment": true },
        "glm-4.6":     { "name": "GLM-4.6",     "tool_call": true, "temperature": true, "attachment": true },
        "glm-4.5":     { "name": "GLM-4.5",     "tool_call": true, "temperature": true, "attachment": true },
        "glm-4-flash": { "name": "GLM-4-Flash", "tool_call": true, "temperature": true }
      }
    }
  },
  "model": "glm/glm-5.2"
}
```

**Key points**

- `"api": "openai-compatible"` — Z.ai's API is OpenAI-compatible; this lets
  OpenCode use its standard OpenAI client. (Cline uses the same approach.)
- `"baseURL": "https://api.z.ai/api/paas/v4/"` — the standard Z.ai endpoint.
  This works for both coding-pass and pay-as-you-go keys.
- `"env": ["GLM_API_KEY"]` is OpenCode's documented mechanism for telling the
  runtime "this provider needs the `GLM_API_KEY` environment variable."
- `"apiKey": "{GLM_API_KEY}"` is the placeholder syntax OpenCode replaces with
  the env var's value at runtime.
- This satisfies the project's security rule in `CLAUDE.md`:
  *"No hardcoded secrets, use environment variables."*

## 3. Setting the API key on each OS

### Windows (persistent, user-level)

```powershell
setx GLM_API_KEY "your-key-here.xxxxxxxxxxxxxxxx"
```

- Persists in `HKCU\Environment`. Takes effect in **new** terminal sessions
  (the current session won't see it until restarted).
- Verify: `reg query HKCU\Environment /v GLM_API_KEY`

### macOS / Linux (persistent, user-level)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
export GLM_API_KEY="your-key-here.xxxxxxxxxxxxxxxx"
```

Then `source ~/.zshrc` (or open a new terminal).

## 4. Switching the active model

Change the top-level `model` field:

```jsonc
"model": "glm/glm-5.2"     // flagship, 1M context window
"model": "glm/glm-4.6"     // coding/agentic
"model": "glm/glm-4.5"     // previous stable
"model": "glm/glm-4-flash" // cheap/fast
```

**Note:** The current Z.ai coding pass key covers `glm-5.2`. Older models like
`glm-4.6` may return HTTP 429 ("Insufficient balance") if not included in your
pass plan.

## 5. Getting a Z.ai API key

1. Sign up at <https://z.ai> (or <https://open.bigmodel.cn>).
2. Open the API keys page and create a new key.
3. Copy the key (format: `xxxxxxxx.yyyyyyyyyyyy`).
4. Put it in the `GLM_API_KEY` env var as shown above.

## 6. Rotating / replacing the key

1. Generate a new key in the Z.ai dashboard.
2. Update the env var:
   - **Windows:** `setx GLM_API_KEY "<new-key>"`
   - **macOS/Linux:** edit the `export` line and re-source.
3. Restart OpenCode so it re-reads the env var.
4. (Optional) Revoke the old key in the Z.ai dashboard.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| OpenCode prompts "missing API key" | `GLM_API_KEY` not set in the session that launched OpenCode | Set it with `setx` and open a **new** terminal |
| 401 / unauthorized | Key invalid or revoked | Generate a new key, update env var |
| 429 / "Insufficient balance" | Model not covered by your coding pass plan | Switch to `glm-5.2` (covered by coding pass) or add credits |
| 404 on chat completions | Wrong `baseURL` | Ensure baseURL is `https://api.z.ai/api/paas/v4/` |
| Default model missing | `model` field not set or typo | Use the `provider/model-id` format, e.g. `glm/glm-5.2` |