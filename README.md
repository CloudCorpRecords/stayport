# stayport

stayport talks to a Hostex property-management account from the
terminal and from MCP clients: properties and room types,
reservations (including direct-booking creation, cancellation,
lock codes, and per-stay custom fields), availability, guest
conversations, reviews, webhooks, listing calendars and prices,
custom channels, and income methods. One binary serves a
command-line interface and a stdio MCP server, exposing the same
23 operations as `hostex_*` tools.

Two credentials are involved. Every v3 API call sends a
`Hostex-Access-Token` header whose value comes from the
`HOSTEX_ACCESS_TOKEN` environment variable; calls go to
`https://api.hostex.io/v3` unless `HOSTEX_API_URL` overrides the
base URL. When the token is not set, commands fail with an error
that names the env var — stayport never invents a result. The
guest-review operation is the one exception to the token flow: it
posts through the Hostex web app, so it logs in with
`HOSTEX_EMAIL` and `HOSTEX_PASSWORD` (optionally overriding the
web base URL, default `https://hostex.io/api`, with
`HOSTEX_WEB_API_URL`) and fails the same honest way when they are
unset.

A v3 call counts as successful only when the response envelope
reports `error_code` 200; the envelope's `data` is what you get
back. Any other envelope is an error carrying the upstream
`error_msg` and `request_id`.

## Install

```bash
npx @reneturcios/stayport properties
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/stayport
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead, and pass the env vars above
with `-e` so the server can reach your account.

## CLI

```bash
export HOSTEX_ACCESS_TOKEN=...   # from your Hostex account settings

stayport properties --limit 10
stayport room-types
stayport reservations --status accepted --start-check-in-date 2026-11-01
stayport create-reservation --property-id 123 --custom-channel-id 9 \
  --check-in-date 2026-11-10 --check-out-date 2026-11-12 \
  --guest-name "Ada Lovelace" --currency USD --rate-amount 20000 \
  --commission-amount 1000 --received-amount 20000 --income-method-id 3
stayport cancel-reservation RES-123
stayport update-lock-code STAY-9 4321
stayport get-custom-fields STAY-9
stayport update-custom-fields STAY-9 '{"gate_code":"88"}'
stayport availabilities --property-ids 1,2 --start-date 2026-11-01 --end-date 2026-11-07
stayport update-availabilities --property-ids 1,2 --available false --dates 2026-11-03
stayport conversations --limit 5
stayport conversation conv-9
stayport send-message conv-9 --message "Welcome! Check-in is at 3pm."
stayport reviews --property-id 123
stayport create-review RES-123 --score 5 --content "Great guest"
stayport webhooks
stayport create-webhook https://example.com/hook
stayport delete-webhook 17
stayport listing-calendar --start-date 2026-11-01 --end-date 2026-11-30 \
  --listings '[{"channel_type":"airbnb","listing_id":"L1"}]'
stayport update-listing-prices --channel-type airbnb --listing-id L1 \
  --prices '[{"date":"2026-11-05","price":15000}]'
stayport custom-channels
stayport income-methods

stayport --version
```

The guest-review command additionally needs the web-app login:

```bash
export HOSTEX_EMAIL=you@example.com
export HOSTEX_PASSWORD=...
stayport post-guest-review --reservation-order-code 0-ABC123-xyz \
  --content "Lovely stay" --recommend 1 --overall-rating 5 \
  --cleanliness 4 --respect-of-house-rules 5 --communication 5
```

Successful commands print the response `data` as JSON. Exit
codes: `0` on success, `1` when a call fails (missing credential,
upstream envelope error, network failure), `2` for usage errors.
Amounts on reservation creation are in cents, exactly as the
Hostex API takes them; listing prices are passed through in the
shape the API expects.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio
MCP server:

```bash
npx -y @reneturcios/stayport mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "stayport": {
      "command": "npx",
      "args": ["-y", "@reneturcios/stayport", "mcp"],
      "env": {
        "HOSTEX_ACCESS_TOKEN": "..."
      }
    }
  }
}
```

Add `HOSTEX_EMAIL` and `HOSTEX_PASSWORD` to that `env` block if
you want the guest-review tool to work; the other 22 tools only
need the access token.

### Tools

| Tool | Input | What it does |
| --- | --- | --- |
| `hostex_list_properties` | `offset`, `limit`, `id` (all optional) | Lists properties with ID, title, address, channels, and coordinates. |
| `hostex_list_room_types` | `offset`, `limit` (optional) | Lists room types. |
| `hostex_list_reservations` | `reservation_code`, `property_id`, `status`, check-in/out date bounds, `order_by`, `offset`, `limit` (all optional) | Lists and searches reservations. |
| `hostex_create_reservation` | `property_id` (string), `custom_channel_id`, `check_in_date`, `check_out_date`, `guest_name`, `currency`, `rate_amount`, `commission_amount`, `received_amount`, `income_method_id` (required); `number_of_guests`, `email`, `mobile`, `remarks` (optional) | Creates a direct booking. Amounts are in cents. |
| `hostex_cancel_reservation` | `reservation_code` | Cancels a direct booking (channel bookings are not supported). |
| `hostex_update_lock_code` | `stay_code`, `lock_code` | Sets a stay's lock code. |
| `hostex_get_custom_fields` | `stay_code` | Reads a stay's custom fields. |
| `hostex_update_custom_fields` | `stay_code`, `custom_fields` (object) | Writes a stay's custom fields, usable in automated messages as `{{cf.field_name}}`. |
| `hostex_list_availabilities` | `property_ids` (comma-separated string), `start_date`, `end_date` | Queries availability for a date range. |
| `hostex_update_availabilities` | `property_ids` (number array), `available`; `start_date`, `end_date`, `dates` (optional) | Sets availability for dates or a range. |
| `hostex_list_conversations` | `offset`, `limit` (optional) | Lists guest conversations and inquiries. |
| `hostex_get_conversation` | `conversation_id` | Gets a conversation with all its messages. |
| `hostex_send_message` | `conversation_id`; `message`, `jpeg_base64` (optional) | Sends a text or JPEG image message to the guest. |
| `hostex_list_reviews` | `reservation_code`, `property_id`, `review_status`, check-out date bounds, `offset`, `limit` (all optional) | Queries reviews with filters. |
| `hostex_create_review` | `reservation_code`; `host_review_score`, `host_review_content`, `host_reply_content` (optional) | Creates a review or a reply for a reservation. |
| `hostex_post_guest_review` | `reservation_order_code`, `content`, `recommend` (`"0"`/`"1"`), `overall_rating`, `cleanliness`, `respect_of_house_rules`, `communication` (`"1"`–`"5"`); three optional `*_content` notes | Posts a full guest review through the web app; needs the email/password login. |
| `hostex_list_webhooks` | (none) | Lists configured webhooks. |
| `hostex_create_webhook` | `url` | Creates a webhook. |
| `hostex_delete_webhook` | `webhook_id` | Deletes a manageable webhook. |
| `hostex_get_listing_calendar` | `start_date`, `end_date`, `listings` (`{channel_type, listing_id}` array) | Gets calendar information for multiple listings. |
| `hostex_update_listing_prices` | `channel_type`, `listing_id`, `prices` (`{date, price}` array) | Updates listing prices. |
| `hostex_list_custom_channels` | (none) | Lists custom channels from the Custom Options Page. |
| `hostex_list_income_methods` | (none) | Lists income methods from the Custom Options Page. |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
