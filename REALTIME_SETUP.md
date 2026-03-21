## Agora Token Setup (Required for your current Agora project)

Your Agora project is configured for token-based access. Direct static join will fail with:
`CAN_NOT_GET_GATEWAY_SERVER ... dynamic use static key`.

### 1) Deploy token function

From project root:

```bash
supabase functions deploy agora-token
```

### 2) Set function secrets

```bash
supabase secrets set AGORA_APP_ID=YOUR_AGORA_APP_ID
supabase secrets set AGORA_APP_CERTIFICATE=YOUR_AGORA_APP_CERTIFICATE
```

The function also uses `SUPABASE_URL` and `SUPABASE_ANON_KEY` from Supabase runtime env.

### 3) Optional frontend overrides

In `.env`:

```bash
VITE_AGORA_TOKEN_FUNCTION=agora-token
# Optional temporary manual token for quick testing:
# VITE_AGORA_TEMP_TOKEN=...
```

---

## Auto-Update Setup (Windows)

Portable builds are for manual distribution and do not support full automatic replacement.
Use NSIS build for proper auto-update:

```bash
npm run build:exe:auto
```

Then host the generated NSIS artifacts and set update feed URL in:

`electron/update-config.json`

```json
{
  "url": "https://your-update-host/path/"
}
```

The URL should contain the latest release metadata and installer assets.
