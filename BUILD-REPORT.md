# stayport — Build Report

MCP Rebuild 1000, Batch 8. Clean-room rebuild of
keithah/hostex-mcp (rank 285, Tier B), built from the public spec
in `specs-batch8/hostex.md` (README + `src/index.ts` +
`hostex-ts@0.2.0` client). The spec's enumeration governs: the
README headline claims "25+" tools and its list enumerates 22,
but `src/index.ts` registers **23** — the 22 plus
`hostex_post_guest_review`. This rebuild implements exactly those
23; no tools were invented, and the two hostex-ts client methods
with no MCP tool (`updateListingInventories`,
`updateListingRestrictions`) were excluded. The docs-derived
fixture is
`harness/fixtures/hostex-mcp-tools-original.json`, whose
`_source` records the 22-vs-23-vs-"25+" facts. Parity proves the
rebuild matches this program's defined spec, labelled
docs-derived. Local build only — nothing pushed or published.

Identity: repo `stayport`, npm `@reneturcios/stayport`,
MCP name `io.github.CloudCorpRecords/stayport`, version `0.1.0`,
bin `stayport` → `dist/cli.js`. Tool names keep the original
`hostex_*` names; only the package/server name changed.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `stayport: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Hostex PMS via MCP: properties,
  reservations, availability, messages, reviews, and webhooks." =
  **92 chars** (≤100 ✓, counted programmatically); npm entry
  carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/stayport:0.1.0` carries **no**
  `version` field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/stayport"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (23 subcommands covering the tools,
  plus `mcp` and `--version` → `0.1.0`; exit 2 usage / 1 API
  error), `src/mcp.ts`, `src/types.ts`, `src/stayport.ts` (core
  logic, `VERSION = "0.1.0"`)
- `test/stayport.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to stayport)

## Tools implemented (23)

`hostex_list_properties`, `hostex_list_room_types`,
`hostex_list_reservations`, `hostex_create_reservation`,
`hostex_cancel_reservation`, `hostex_update_lock_code`,
`hostex_get_custom_fields`, `hostex_update_custom_fields`,
`hostex_list_availabilities`, `hostex_update_availabilities`,
`hostex_list_conversations`, `hostex_get_conversation`,
`hostex_send_message`, `hostex_list_reviews`,
`hostex_create_review`, `hostex_post_guest_review`,
`hostex_list_webhooks`, `hostex_create_webhook`,
`hostex_delete_webhook`, `hostex_get_listing_calendar`,
`hostex_update_listing_prices`, `hostex_list_custom_channels`,
`hostex_list_income_methods` — the full enumerated set from the
spec, with the spec's exact params (required/optional, types,
enums) and endpoints.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals, per the standing fleet rule: `McpServer`'s
  zod-to-JSON-Schema conversion injects `$schema` /
  `additionalProperties` keys that are absent from the defined
  spec and break exact schema parity. Zod still validates every
  `tools/call`. (The one `additionalProperties: true` in
  `hostex_update_custom_fields` is part of the spec schema
  itself — `custom_fields` is a Zod `record(any)`.)
- V3 endpoints under `https://api.hostex.io/v3` (overridable via
  `HOSTEX_API_URL`): filters go as query params on GET calls,
  writes as JSON bodies on POST/PATCH, path params are
  URL-encoded, and only defined optionals are sent. Per-tool
  path/body splits follow the spec exactly (e.g. lock code PATCHes
  `{lock_code}` to `.../check_in_details`; create-review POSTs the
  remaining params to `/reviews/{reservation_code}`).
- Auth: header `Hostex-Access-Token` from env
  `HOSTEX_ACCESS_TOKEN`. A missing or blank token fails before
  any request with an error naming the env var — verified live
  over stdio as an `isError` result, never a fake success.
- Envelope: a v3 call succeeds only on HTTP ok **and**
  `error_code === 200`; failures surface `error_code`,
  `error_msg`, and `request_id`. On success the envelope's
  `data` is returned when the key is present, otherwise the
  whole payload (documented local choice — see Gaps).
- `hostex_post_guest_review` uses the web-app flow from the
  spec: `POST https://hostex.io/api/v2/user/login` with body
  `{account, password, image_code: "", dynamic_code: "",
  login_type: "password", locale: "en"}`, session cookies
  captured from `set-cookie` and forwarded, then
  `POST /reservation_comment/send_comment` with
  `category_ratings` whose rating values are converted to
  numbers. Web-app requests carry `opid` + `opclient=Web-Mac-Chrome`
  query params and treat `error_code` 0 as success (200 also
  accepted). Unset `HOSTEX_EMAIL` / `HOSTEX_PASSWORD` fails
  honestly naming both env vars, before any request; a failed
  login stops the flow before any review is posted.
- Rating/recommend args are string enums (`"0"|"1"`,
  `"1"`–`"5"`) per the spec's Zod enums, converted with
  `Number(...)` into `category_ratings` per the spec's body
  template.
- All HTTP flows through an injectable `FetchFn` (types.ts).
  The test suite uses a fake fetch returning hand-written
  Hostex-shaped envelopes; no live call is made in tests.

## Verification (foreground, exact outputs)

### 1. Typecheck and build
```
$ ./node_modules/.bin/tsc --noEmit; echo exit=$?
exit=0
$ npm run build
build exit=0
```
`dist/` produced, including `dist/cli.js`.

### 2. Tests
```
$ npm test   (tsx --test test/*.test.ts)
ℹ tests 34
ℹ pass 34
ℹ fail 0
```
Covers: base-URL default/custom/trailing-slash handling;
properties path, query composition and token header; room
types; envelope unwrapping with and without `data`;
reservations list filters, create body (unset optionals
omitted), cancel DELETE path with URL-encoding, lock-code PATCH
body split, custom-fields GET and PATCH body; availabilities
query and array-body shaping; conversations list/get and
send-message body shaping (text and jpeg variants); reviews
list filters and create-review path/body split; the guest-review
flow end to end (login URL/body, `opclient` param, cookie
forwarding from `set-cookie`, numeric `category_ratings`,
optional content fields omitted when unset), unset-credential
error naming `HOSTEX_EMAIL`/`HOSTEX_PASSWORD` with zero
requests, failed login stopping the flow, and a send_comment
envelope error; webhooks list/create/delete; listing calendar
and prices POST bodies; custom channels and income methods
paths; missing/blank token errors naming `HOSTEX_ACCESS_TOKEN`
with zero requests; envelope errors surfacing
`error_code`/`error_msg`/`request_id`; HTTP 500 surfacing;
network-failure wrapping.

### 3. CLI / MCP smoke
`--version` → `0.1.0` (exit 0); unknown command prints Usage
and exits 2; `properties` with no token exits 1 with
"HOSTEX_ACCESS_TOKEN is not set…". MCP `initialize` over stdio
→ `serverInfo: {"name":"stayport","version":"0.1.0"}`; a stdio
`tools/call` for `hostex_list_properties` with no token set
returned an `isError` result naming `HOSTEX_ACCESS_TOKEN`. No
live Hostex call was made in smoke — no token was available,
and no live result is claimed.

### 4. Parity (harness)
```
$ python3 ~/workspace/mcp-rebuild-100/harness/parity.py \
    --original ~/workspace/mcp-rebuild-100/harness/fixtures/hostex-mcp-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/stayport/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/stayport/parity-out
verdict=PASS parity_pct=100.0 original_tools=23 rebuild_tools=23 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
(parity.json: identical_tools 23/23.) Original side is
tools-file mode, so `fixture_results` records
`SKIPPED-TOOLS-FILE-MODE` — expected harness semantics, not an
error.

## Lockfile status

`package-lock.json` was generated clean via Route 3: a temp
copy holding only `package.json` (no `node_modules`, no
`dist`), offline `npm install --package-lock-only
--ignore-scripts`, verified after generation — parses as JSON,
top-level `name` is `@reneturcios/stayport`, version `0.1.0`,
`lockfileVersion` 3, **128 package entries** — then only the
lockfile was copied back. Local `node_modules` is a copy of the
sibling fxrates tree used only for the local build/test; it is
not part of the lockfile generation.

## Gaps / honest notes

- Docs-derived spec: the schemas come from the spec's reading
  of the original's public README, `src/index.ts`, and the
  hostex-ts client — no original hostex-mcp server was probed,
  so parity proves the rebuild matches this program's defined
  spec, not a hand-probed original.
- No live call was made: every endpoint is fake-fetch tested
  only, so live payload/response-shape drift against
  api.hostex.io is unverified until the publish wave. In
  particular, the envelope `data` unwrapping is a documented
  local choice for what the tools return; the spec pins the
  envelope success rule, not the client's return shape.
- Guest-review flow details beyond the spec's explicit body
  templates are reconstructions: the `opid` value is generated
  locally (a timestamp), login is assumed to carry the same
  `opid`/`opclient` params the spec assigns to web-app
  requests generally, and cookie capture follows the standard
  `set-cookie` → `Cookie` header path. The flow is unit-tested
  against that shape only; a real login was not attempted.
- The rating enums are modelled as strings (`"1"`–`"5"`)
  because the spec writes them as Zod enums; if the original
  used numeric literals instead, the live wire behaviour of
  this rebuild still matches the spec's documented
  `category_ratings` body (numbers), but argument parity
  against a probed original could differ on that one tool.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at publish
  time.
