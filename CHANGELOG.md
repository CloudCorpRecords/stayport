# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI covering all 23 tools (`properties`, `room-types`, `reservations`,
  `create-reservation`, `cancel-reservation`, `update-lock-code`,
  `get-custom-fields`, `update-custom-fields`, `availabilities`,
  `update-availabilities`, `conversations`, `conversation`, `send-message`,
  `reviews`, `create-review`, `post-guest-review`, `webhooks`,
  `create-webhook`, `delete-webhook`, `listing-calendar`,
  `update-listing-prices`, `custom-channels`, `income-methods`) plus
  `stayport mcp` and `--version`.
- MCP server (`stayport mcp`, stdio) with 23 tools, keeping the original
  `hostex_*` tool names: `hostex_list_properties`,
  `hostex_list_room_types`, `hostex_list_reservations`,
  `hostex_create_reservation`, `hostex_cancel_reservation`,
  `hostex_update_lock_code`, `hostex_get_custom_fields`,
  `hostex_update_custom_fields`, `hostex_list_availabilities`,
  `hostex_update_availabilities`, `hostex_list_conversations`,
  `hostex_get_conversation`, `hostex_send_message`, `hostex_list_reviews`,
  `hostex_create_review`, `hostex_post_guest_review`,
  `hostex_list_webhooks`, `hostex_create_webhook`,
  `hostex_delete_webhook`, `hostex_get_listing_calendar`,
  `hostex_update_listing_prices`, `hostex_list_custom_channels`, and
  `hostex_list_income_methods`.
- Calls go to the Hostex v3 API at `https://api.hostex.io/v3` with the
  `Hostex-Access-Token` header taken from `HOSTEX_ACCESS_TOKEN`; a
  missing token fails honestly and names the env var. The guest-review
  tool uses the Hostex web-app login flow with `HOSTEX_EMAIL` and
  `HOSTEX_PASSWORD`.
- A call succeeds only when the response envelope reports
  `error_code` 200; other envelopes surface `error_msg` and
  `request_id`.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.
