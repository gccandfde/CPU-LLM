# Admin guide

The **Admin** tab controls the server's settings. It has its own password
(`ADMIN_PASSWORD` on first start), separate from the dashboard login, so the
dashboard can stay public while settings stay protected. A sign-in lasts 12
hours in that browser tab. After 10 wrong passwords in a minute from one
address, sign-in pauses for a minute.

Settings are saved in `DATA_DIR/settings.json` and apply immediately, without
a restart or redeploy.

## Dashboard access

| Setting | Effect |
|---|---|
| Require login for the dashboard | When on, the dashboard and its API ask for the dashboard password (any username). Agents and the Admin tab are not affected. |
| Dashboard password | At least 8 characters. Set it before turning login on. |

## Agents and machines

| Setting | Effect |
|---|---|
| Agent token | Shared secret agents connect with. **New token** makes a fresh one; running agents must restart with it. |
| Agent start command | Ready to paste on a machine. Contains the token: share it privately. |
| Accept new machines | When off, only machines that connected before can reconnect. |
| Offline after (seconds) | How long without contact before a machine shows as offline (5–600). |
| Live telemetry kept (samples) | Live chart history per machine, about one sample per second (30–3600). Kept in memory only. |
| Remove machine | Forgets a machine; its runs stay. It reappears if its agent connects again. |

## Tuning options

What the Tune tab offers. The server checks every run against these, so they
also hold for API calls.

| Setting | Effect |
|---|---|
| Models | The list in the Base model menu (Hugging Face id or `builtin:` name, and a label). |
| Default model | Selected when the Tune tab opens. |
| Allow any other Hugging Face model | Adds "Other Hugging Face model…". When off, only listed models can be tuned. |
| Allowed precisions / devices | Hide and reject the others (e.g. turn off GPU runs). |
| Limits per run | Max tokens, repeats, batch size, threads, pruned layers, and values per list. |
| Presets | The preset buttons, edited as JSON. Each has `label`, `desc` and `v` (precisions, prune, batch, tokens, repeats, eval, profile, compile, ppl, evalDrop). Missing fields use safe defaults. |

## Site

Title and tagline in the header and the browser tab.

## Data retention

Finished runs beyond **Keep newest runs**, or older than **Delete runs older
than (days)**, are deleted with their reports and bundles. 0 keeps everything.
Checked at start-up, on save and after each run.

## Admin password

At least 10 characters. Changing it signs out every other admin session.
Forgotten it? Set `ADMIN_PASSWORD_RESET` on the server, restart, sign in,
change it here, then remove the variable.
