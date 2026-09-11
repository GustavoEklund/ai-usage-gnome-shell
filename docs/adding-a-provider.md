# Adding a provider

Nothing in the shell process knows what Claude is. The UI iterates over whatever
limits, days and models arrive in the snapshot, so a second provider is additive:
a new directory under `src/helper/providers/` and one line in the registry.

## The contract

```js
// src/helper/providers/codex/index.js
export default {
    id: 'codex',
    displayName: 'Codex',
    iconName: 'ai-usage-codex-symbolic',

    /** @returns {Array<{id: string, …}>} */
    discoverAccounts(ctx) { … },

    /** @returns {Promise<{account: object, entry: object}>} */
    async fetchAccount(ctx, account, cache) { … },
};
```

Register it:

```js
// src/helper/registry.js
import codex from './providers/codex/index.js';
export const PROVIDERS = [claude, codex];
```

and add its id to the `enabled-providers` default in the GSettings schema.

`ctx` carries everything the provider may touch:

| Field | What it is |
|---|---|
| `fs` | `exists`, `readText`, `listTranscripts`, `readChunk` |
| `http` | `get(url, headers) → {status, body, headers}` |
| `now` | milliseconds, injectable so runs are reproducible |
| `timeZone` | optional IANA zone; the system zone when absent |
| `configDirs` | directories the user configured |
| `userAgent` | the string to identify as |

They are injected, never imported, which is what makes a provider testable without
a disk or a network. See `tests/support/fakes.js`.

## What `fetchAccount` must return

```jsonc
{
  "account": {
    "id": "codex:/home/me/.codex",
    "label": "me@example.com",
    "organizationName": "Acme",
    "plan": {"rateLimitTier": "…", "subscriptionType": "…"},
    "status": {"code": "ok", "since": null, "params": {}},
    "limits": [
      {"id": "session", "role": "session", "scopeLabel": null,
       "percent": 21, "resetsAt": "…", "severity": "normal", "primary": true}
    ],
    "week": {"startsOn": "sunday", "start": "2026-09-06", "days": [ /* 7 */ ]},
    "models": [{"id": "…", "tokens": 0, "breakdown": {…}}]
  },
  "entry": {"scanState": …, "limits": …, "lastSuccessAt": …, "retryAfter": null}
}
```

`entry` is what gets written to the cache for this account, and is handed back as
the third argument next time.

## About the icon

`iconName` resolves to `src/icons/<name>.svg`, loaded as a `Gio.FileIcon`. Two
things about that file are not optional:

* **It must start with `<svg`.** gdk-pixbuf identifies an image by sniffing its
  first bytes, so an XML prologue or a licence header before the root element
  makes the loader answer "Unrecognized image file format" — and the icon renders
  as nothing, silently, with nothing in the journal. Put comments inside the root
  element.
* **One fill, 16x16 grid, solid shapes.** The shell treats a `-symbolic.svg` as a
  mask and tints it, so fine outlines disappear at panel size.

If you use a service's own mark, it stays that service's trademark: name it as
such in the file and in the README, as the Claude icon does. Nominative use —
identifying the service the data comes from — is the only use intended here.

## Three rules that are not negotiable

1. **No prose.** The helper has no gettext domain. Report
   `{code, since, params}` and let `src/lib/status.js` do the wording. `role` on a
   limit exists for the same reason: `src/lib/snapshot.js` turns a role into
   "Session" or "Weekly" in the user's language.
2. **No secrets leave the provider.** A token goes from the credentials file to
   the request header and nowhere else — not the snapshot, not the cache, not a
   log line. Put every error string through `redactError()`.
3. **Never write to the tool's own configuration.** Read it.

## Roles

`session`, `weekly`, `scoped` and `other`. The panel tracks a role rather than an
id, so a provider that exposes a session-like limit works with the existing
setting without any UI change. `scoped` limits carry a `scopeLabel` (a model or
surface name, a proper noun, left untranslated).

## Tests

Logic goes in pure modules and is held at 100% coverage per file. Only the thin
Gio/Soup adapters are exempt, and they are listed explicitly in
`vitest.config.js`. A provider that needs a new exemption is a provider with logic
in the wrong file.
