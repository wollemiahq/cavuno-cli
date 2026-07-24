# Cavuno CLI

The official command-line client for the
[Cavuno job board platform](https://cavuno.com). Manage jobs, companies, blog
content, media, board settings, domains, asynchronous operations, and
taxonomies through the Cavuno REST API from a terminal, shell script, CI
pipeline, or AI agent.

Full reference: **[Cavuno CLI documentation](https://cavuno.com/docs/cli)**

## Install

```bash
npm install -g cavuno
```

Or run it once without installing:

```bash
npx cavuno --help
```

Requires Node.js 18.18 or newer.

## Authenticate

Set two environment variables. Mint a key in the Cavuno dashboard under **Settings → Developer → API keys** — the plaintext secret shows once at creation, copy it to your secrets manager immediately.

```bash
export CAVUNO_API_KEY='cavuno_live_...'
export CAVUNO_API_URL='https://api.cavuno.com/v1'

cavuno usage get
```

The CLI fails fast at startup if `CAVUNO_API_KEY` is missing or malformed — you don't wait on a 401 round-trip to spot a typo.

## Commands

```
cavuno jobs         # Manage jobs (incl. batch)
cavuno usage        # Inspect plan usage
cavuno billing      # Read subscription and payment connection status
cavuno plans        # Manage employer plans (pricing + features sold to employers)
cavuno employer-subscriptions  # List/get employer subscriptions
cavuno transactions # Read the board transactions ledger
cavuno coupons      # Manage coupons + promotion codes
cavuno companies    # Manage companies (incl. batch)
cavuno blog         # Manage blog posts, authors, and tags
cavuno media        # Upload and fetch media assets
cavuno settings     # Read and update board settings
cavuno domains      # Custom domains + DNS verify
cavuno imports      # Bulk-load jobs from CSV (upload → confirm → execute)
cavuno operations   # Poll / cancel async operations by ID
cavuno subscribers  # Manage alert subscribers (list, export, import)
cavuno taxonomies   # remote helpers + skills/categories/markets CRUD
cavuno members      # Manage the account roster, roles, suspension, ownership
cavuno invitations  # Manage pending invitations
```

### Jobs

| Command | Description |
|---|---|
| `cavuno jobs list` | List jobs with optional filters |
| `cavuno jobs get <id>` | Fetch a single job (enriched) |
| `cavuno jobs create --title <t> [...]` | Create a draft job |
| `cavuno jobs update <id> [...]` | Update fields on an existing job |
| `cavuno jobs publish <id> [--expires-at <iso>]` | Publish a job (quota-gated) |
| `cavuno jobs pause <id>` | Pause a published job |
| `cavuno jobs expire <id>` | Expire a published job immediately |
| `cavuno jobs duplicate <id>` | Create a draft copy |
| `cavuno jobs delete <id>` | Hard-delete a job |
| `cavuno jobs batch [--file ops.json]` | Run a batch of job operations (JSON file or stdin) |

### Usage

| Command | Description |
|---|---|
| `cavuno usage get` | Show used/limit/remaining for jobs, subscribers, and seats |

### Billing

The operator's own platform billing. Reads need `billing.read`; `checkout`/`upgrade` need `billing.manage`.

| Command | Description |
|---|---|
| `cavuno billing subscription` | Show the account's platform subscription (`active:false` when none) |
| `cavuno billing connect` | Show normalized payment connection readiness |
| `cavuno billing checkout --plan <key> [--interval]` | Get a hosted Checkout URL to subscribe (rejects if already subscribed — use `upgrade`) |
| `cavuno billing upgrade --plan <key> [--interval]` | Get a hosted human-confirmation URL for a plan change |

### Plans

Employer plans the operator sells on their board (`billing.read` / `billing.manage`). Distinct from `cavuno billing` (your platform subscription). Single price per plan; archive via `update --archived` (no hard delete).

| Command | Description |
|---|---|
| `cavuno plans list` | List employer plans |
| `cavuno plans get <id>` | Fetch one plan with price + features |
| `cavuno plans create --name <n> --kind <k> [...]` | Create plan metadata |
| `cavuno plans update <id> [...]` | Patch metadata; archive with `--archived` |
| `cavuno plans set-price <id> --currency <c> --amount-cents <n>` | Upsert the single checkout price |
| `cavuno plans get-features <id>` | List feature key/value pairs |
| `cavuno plans set-features <id> '<json>'` | Replace feature values by key |

### Employer subscriptions

Read-only (`billing.read`). Tenant-managed employer plan subscriptions.

| Command | Description |
|---|---|
| `cavuno employer-subscriptions list` | List employer subscriptions (optional `--status`, `--company-id`) |
| `cavuno employer-subscriptions get <id>` | Get one employer subscription |

### Transactions

Read-only (`billing.read`). Board revenue ledger (card posts, invoices, subscription renewals). Void/resend are not in v1.

| Command | Description |
|---|---|
| `cavuno transactions list` | List transactions (optional `--status`, `--kind`, `--search`) |
| `cavuno transactions get <id>` | Get one transaction by id |

### Coupons

Board coupons and promotion codes. Requires a ready payment connection.

| Command | Description |
|---|---|
| `cavuno coupons list` | List coupons |
| `cavuno coupons get <id>` | Retrieve one coupon |
| `cavuno coupons create` | Create (`--name`, `--percent-off` or `--amount-off-cents`, `--duration`) |
| `cavuno coupons rename <id>` | Rename (`--name`) |
| `cavuno coupons delete <id>` | Delete (destructive; requires `--yes`) |
| `cavuno coupons promotion-code-create <couponId>` | Create a promotion code |
| `cavuno coupons promotion-code-archive <id>` | Archive a promotion code |

### Companies

| Command | Description |
|---|---|
| `cavuno companies list` | List companies |
| `cavuno companies get <id>` | Fetch a single company |
| `cavuno companies create --name <n> [...]` | Create a company |
| `cavuno companies update <id> [...]` | Update a company |
| `cavuno companies delete <id>` | Delete a company (cascades to its jobs) |
| `cavuno companies upload-logo <id> <file>` | Upload or replace a company logo |
| `cavuno companies delete-logo <id>` | Delete a company logo |
| `cavuno companies search <query>` | Search companies by name |
| `cavuno companies find-by-domain <domain>` | Resolve a company by website domain |
| `cavuno companies find-or-create --name <n> [...]` | Resolve by domain or create |
| `cavuno companies list-jobs <id>` | List jobs at a company |
| `cavuno companies batch [--file ops.json]` | Run a batch of company operations |

### Blog

| Command | Description |
|---|---|
| `cavuno blog posts list` | List blog posts with optional filters |
| `cavuno blog posts get <id>` | Fetch a single post |
| `cavuno blog posts create --title <t> [...]` | Create a draft post |
| `cavuno blog posts update <id> [...]` | Update fields on a post |
| `cavuno blog posts publish <id>` | Publish a post |
| `cavuno blog posts unpublish <id>` | Return a post to draft |
| `cavuno blog posts toggle-featured <id>` | Toggle the featured flag |
| `cavuno blog posts search <query>` | Search posts |
| `cavuno blog posts delete <id>` | Delete a post |
| `cavuno blog posts batch [--file ops.json]` | Run a batch of blog post operations |
| `cavuno blog authors list\|get\|create\|update\|delete` | Manage blog authors |
| `cavuno blog tags list\|get\|create\|update\|delete` | Manage blog tags |

### Media

| Command | Description |
|---|---|
| `cavuno media upload <file> --purpose <p>` | Upload a media asset |
| `cavuno media get <id>` | Fetch media metadata |

### Settings

| Command | Description |
|---|---|
| `cavuno settings get` | Show board settings |
| `cavuno settings update [...]` | Update name, slug, blog/candidates toggles |
| `cavuno settings get-adsense` / `update-adsense` | Read / update AdSense config |
| `cavuno settings delete-hero` | Remove the hero image (`--yes`) |
| `cavuno settings set-password-protection` | Set board password (reads secret from stdin) |
| `cavuno settings delete-password-protection` | Remove board password protection (`--yes`) |
| `cavuno settings job-form-set-custom-fields --file <json>` | Replace custom job field definitions (whole-array) |

### Domains

| Command | Description |
|---|---|
| `cavuno domains list` | List custom domains |
| `cavuno domains get <id>` | Fetch a domain + verification instructions |
| `cavuno domains add <host>` | Register a custom domain |
| `cavuno domains verify <id>` | Start async DNS verification |
| `cavuno domains remove <id>` | Delete a custom domain |

### Redirects

| Command | Description |
|---|---|
| `cavuno redirects list` | List redirect rules (`--search`, `--limit`, `--cursor`) |
| `cavuno redirects create <fromPath> <toPath>` | Create a redirect (`--status-code 301\|302`) |
| `cavuno redirects update <id>` | Update a redirect (`--from-path`, `--to-path`, `--status-code`) |
| `cavuno redirects remove <id>` | Delete a redirect (`--yes`) |
| `cavuno redirects batch` | Run a batch of redirect operations (`--file`) |

```bash
cavuno redirects create /old-careers /jobs
cavuno redirects list --search /old
cavuno redirects remove k200abc --yes
```

### Imports

Bulk-load jobs from a CSV. The pipeline is two async steps: `create` uploads the file and starts discovery (an `imports.parse` operation that proposes a column→field mapping); once it is ready, `confirm` applies the mapping and starts execution (an `imports.confirm` operation). Poll either operation with `cavuno operations wait <id>`, or pass `--wait` on `create` / `confirm` to block until terminal.

| Command | Description |
|---|---|
| `cavuno imports list` | List import batches (filter by `--status`, `--from`, `--to`) |
| `cavuno imports get <id>` | Fetch one batch (status, row errors, proposed mapping) |
| `cavuno imports create <file>` | Upload a CSV and start discovery (`--wait` to poll) |
| `cavuno imports confirm <id>` | Confirm the mapping and start execution (`--inline-mapping <json>`, `--wait`) |
| `cavuno imports cancel <id>` | Cancel a pending/running batch (rows already written remain) |
| `cavuno imports quota` | Show the account's daily import usage |

```bash
# Upload, wait for discovery, then confirm the proposed mapping and wait for the import
cavuno imports create ./jobs.csv --wait
cavuno imports confirm imports_k25abc --wait
```

### Operations

| Command | Description |
|---|---|
| `cavuno operations get <id>` | Fetch one operation |
| `cavuno operations cancel <id>` | Request cancellation |
| `cavuno operations wait <id>` | Poll until terminal (`--interval-ms`, `--timeout-ms`) |

### Subscribers

| Command | Description |
|---|---|
| `cavuno subscribers list` | List subscribers (`--status`, `--search`, `--limit`, `--cursor`) |
| `cavuno subscribers get <id>` | Fetch a subscriber with alerts inline |
| `cavuno subscribers count` | Count confirmed subscribers |
| `cavuno subscribers alerts <id>` | List a subscriber's alerts |
| `cavuno subscribers unsubscribe <id> [--reason <r>]` | Admin-unsubscribe (reversible) |
| `cavuno subscribers resubscribe <id>` | Restore a previously unsubscribed subscriber |
| `cavuno subscribers export [--export-format <csv\|json>] [--wait]` | Export subscribers |
| `cavuno subscribers import <file> [--wait] [--no-send-confirmation]` | Bulk-import from a CSV |

`export` has two modes. `--export-format csv` (default) starts an async
`subscribers.export` operation; add `--wait` to poll it to completion — the
terminal operation's `result` carries the `downloadUrl` (and `rowCount`) for the
generated CSV. `--export-format json` instead streams an **inline** list capped
at 10,000 rows; past that cap the API returns `413`
(`subscribers_export_too_large`, exit code 2) telling you to switch to CSV.

`import <file>` uploads a CSV (`multipart/form-data`, `email` header column;
10 MB / 50,000-row max) and returns an async `subscribers.import` operation; add
`--wait` to block until the terminal summary (`{ totalRows, created,
skippedDuplicates, failed, errors[] }`). Imported subscribers stay unconfirmed
until they complete double-opt-in; pass `--no-send-confirmation` to skip the
opt-in email.

### Taxonomies

| Command | Description |
|---|---|
| `cavuno taxonomies remote-permits` | List remote-work permit options |
| `cavuno taxonomies remote-timezones` | List remote-work timezone options |
| `cavuno taxonomies skills\|categories\|markets list\|create\|update\|delete\|add-alias\|remove-alias` | Operator taxonomy CRUD (requires `taxonomy.manage`) |
| `cavuno taxonomies categories tree` | Nested category tree |

### Members

| Command | Description |
|---|---|
| `cavuno members list [--role <r>] [--suspended <bool>]` | List account members |
| `cavuno members get <userId>` | Fetch a single member |
| `cavuno members update <userId> --role <r>` | Change a member's role |
| `cavuno members remove <userId>` | Remove a member (owner can't be removed) |
| `cavuno members suspend <userId>` | Suspend a member (reversible, no prompt) |
| `cavuno members unsuspend <userId>` | Reinstate a suspended member (no prompt) |
| `cavuno members transfer-ownership <newOwnerUserId>` | Hand the primary-owner role to another member |

### Invitations

| Command | Description |
|---|---|
| `cavuno invitations list [--status <s>]` | List invitations (accept tokens redacted) |
| `cavuno invitations create --email <e> --role <r>` | Invite a new member (returns the accept token + URL) |
| `cavuno invitations update <id> --role <r>` | Change a pending invitation's role |
| `cavuno invitations renew <id>` | Rotate the accept token and extend expiry — **invalidates the previous accept link** |
| `cavuno invitations revoke <id>` | Cancel a pending invitation |

#### Session-only endpoints with no CLI command

Three v1 endpoints are intentionally **not** exposed by the CLI, because the CLI authenticates with an account-bound API key and these actions require a platform user session (or no key at all):

- `DELETE /v1/members/me` (leave the account) — `user_session` only.
- `POST /v1/invitations/:id/accept` (accept an invitation) — `user_session` only.
- `GET /v1/public/invitations/:token` (public token lookup) — keyless/unauthenticated.

Run `cavuno <group> <command> --help` for full flag detail, or see [the online reference](https://cavuno.com/docs/cli) for typed examples.

## Global flags

| Flag | Purpose |
|---|---|
| `--api-url <url>` | Override `CAVUNO_API_URL` for this invocation |
| `--format <json\|table>` | Output format. Default `json` (pipe-friendly) |
| `--help` | Print help for the command |
| `--version` | Print the CLI version |

## Destructive commands

Every command that deletes data — any command backed by a `DELETE` route (`jobs delete`, `companies delete`, `companies delete-logo`, `blog posts/authors/tags delete`, `domains remove`, `candidates delete`, `employers delete`, `reporting disconnect`, `members remove`, `invitations revoke`) plus `members transfer-ownership` (which is irreversible without the new owner handing it back) — confirms before it runs.

- In an interactive terminal you get a `y/N` prompt that defaults to **No**. Anything but `y`/`yes` aborts with exit code 2.
- Pass `--yes` (`-y`) to skip the prompt. This is the documented path for scripts, CI, and agents.
- When stdin or stdout is not a TTY (piped, cron, CI) and `--yes` is absent, the command refuses immediately with exit code 2 rather than hanging on a prompt nobody can answer.

```bash
cavuno jobs delete k17abc... --yes
```

## Waiting on async operations

Some commands kick off a background operation and return its envelope immediately (`domains verify`, `candidates delete`, `employers delete`, `imports create`, `imports confirm`, `subscribers export` (csv), and `subscribers import`). By default you get the initial operation record and can poll it yourself with `cavuno operations wait`.

Pass `--wait` to block until the operation reaches a terminal state (`succeeded`, `failed`, or `cancelled`) and print the **terminal** envelope instead of the initial one:

```bash
cavuno domains verify domain_123 --wait
cavuno imports create ./jobs.csv --wait --interval-ms 1000 --timeout-ms 120000
```

- `--interval-ms <n>` — poll interval in milliseconds (default 2000).
- `--timeout-ms <n>` — give up after this many milliseconds (default 3600000); a timeout exits 11.
- A terminal `failed`/`cancelled` operation exits 7.

`cavuno operations wait <id>` remains the standalone primitive — `--wait` is the same machinery folded into the initiating command.

## Exit codes

Scripts can branch on the exit code without parsing stderr.

| Code | Reason |
|---|---|
| 0 | Success |
| 1 | Authentication failure (missing or malformed key, 401) |
| 2 | Validation error (400, missing required flag) |
| 3 | Authorization failure (403) |
| 4 | Resource not found (404) |
| 5 | Plan / quota (429 quota_exceeded, 403 plan_cannot_publish) |
| 6 | Rate limited (429); `Retry-After` printed |
| 7 | State conflict (409 already_published, etc.) |
| 10 | Unknown server error (500) |
| 11 | Network error (DNS, refused, timeout) |

## Pipe-friendly

```bash
# Expire every published job below $100k
cavuno jobs list --status published --limit 100 \
  | jq -r '.data[] | select(.salaryMinUsd < 100000) | .id' \
  | xargs -n 1 -I{} cavuno jobs expire {}
```

## Links

- Cavuno: <https://cavuno.com>
- Reference docs: <https://cavuno.com/docs/cli>
- API reference: <https://cavuno.com/docs/api>
- Source: <https://github.com/wollemiahq/cavuno-cli>
- Issues: <https://github.com/wollemiahq/cavuno-cli/issues>
- Support: <hi@cavuno.com>

## License

MIT
