#!/usr/bin/env node
/**
 * stayport CLI.
 *
 *   stayport properties [--offset N] [--limit N] [--id N]
 *   stayport room-types [--offset N] [--limit N]
 *   stayport reservations [--reservation-code C] [--property-id N]
 *     [--status S] [--start-check-in-date D] [--end-check-in-date D]
 *     [--start-check-out-date D] [--end-check-out-date D]
 *     [--order-by F] [--offset N] [--limit N]
 *   stayport create-reservation --property-id ID --custom-channel-id N
 *     --check-in-date D --check-out-date D --guest-name NAME
 *     --currency USD --rate-amount N --commission-amount N
 *     --received-amount N --income-method-id N
 *     [--number-of-guests N] [--email E] [--mobile M] [--remarks R]
 *   stayport cancel-reservation <reservation_code>
 *   stayport update-lock-code <stay_code> <lock_code>
 *   stayport get-custom-fields <stay_code>
 *   stayport update-custom-fields <stay_code> <json-object>
 *   stayport availabilities --property-ids 1,2 --start-date D --end-date D
 *   stayport update-availabilities --property-ids 1,2 --available true|false
 *     [--start-date D] [--end-date D] [--dates D,D]
 *   stayport conversations [--offset N] [--limit N]
 *   stayport conversation <conversation_id>
 *   stayport send-message <conversation_id> [--message TEXT] [--jpeg-base64 B64]
 *   stayport reviews [--reservation-code C] [--property-id N]
 *     [--review-status S] [--start-check-out-date D]
 *     [--end-check-out-date D] [--offset N] [--limit N]
 *   stayport create-review <reservation_code> [--score N]
 *     [--content TEXT] [--reply TEXT]
 *   stayport post-guest-review --reservation-order-code CODE
 *     --content TEXT --recommend 0|1 --overall-rating 1-5
 *     --cleanliness 1-5 --respect-of-house-rules 1-5 --communication 1-5
 *     [--cleanliness-content TEXT] [--respect-house-rules-content TEXT]
 *     [--communication-content TEXT]
 *   stayport webhooks
 *   stayport create-webhook <url>
 *   stayport delete-webhook <webhook_id>
 *   stayport listing-calendar --start-date D --end-date D --listings <json>
 *   stayport update-listing-prices --channel-type T --listing-id ID
 *     --prices <json>
 *   stayport custom-channels
 *   stayport income-methods
 *   stayport mcp
 *
 * V3 calls use HOSTEX_ACCESS_TOKEN against https://api.hostex.io/v3
 * (HOSTEX_API_URL overrides). The guest-review command also needs
 * HOSTEX_EMAIL and HOSTEX_PASSWORD for the web-app login.
 * Exit codes: 0 success, 1 API error, 2 usage error.
 */
import {
  ACCESS_TOKEN_ENV,
  BASE_URL_ENV,
  EMAIL_ENV,
  PASSWORD_ENV,
  VERSION,
  WEB_BASE_URL_ENV,
  cancelReservation,
  createReservation,
  createReview,
  createWebhook,
  deleteWebhook,
  formatPayload,
  getConversation,
  getCustomFields,
  getListingCalendar,
  listAvailabilities,
  listConversations,
  listCustomChannels,
  listIncomeMethods,
  listProperties,
  listReservations,
  listReviews,
  listRoomTypes,
  listWebhooks,
  postGuestReview,
  sendMessage,
  updateAvailabilities,
  updateCustomFields,
  updateListingPrices,
  updateLockCode,
} from "./stayport.js";
import type { FetchFn, RatingValue, RecommendValue, StayportConfig } from "./types.js";

function usage(): never {
  console.error(`Usage:
  stayport properties [--offset N] [--limit N] [--id N]
  stayport room-types [--offset N] [--limit N]
  stayport reservations [--reservation-code C] [--property-id N] [--status S]
    [--start-check-in-date D] [--end-check-in-date D]
    [--start-check-out-date D] [--end-check-out-date D]
    [--order-by F] [--offset N] [--limit N]
  stayport create-reservation --property-id ID --custom-channel-id N
    --check-in-date D --check-out-date D --guest-name NAME --currency USD
    --rate-amount N --commission-amount N --received-amount N
    --income-method-id N [--number-of-guests N] [--email E] [--mobile M]
    [--remarks R]
  stayport cancel-reservation <reservation_code>
  stayport update-lock-code <stay_code> <lock_code>
  stayport get-custom-fields <stay_code>
  stayport update-custom-fields <stay_code> <json-object>
  stayport availabilities --property-ids 1,2 --start-date D --end-date D
  stayport update-availabilities --property-ids 1,2 --available true|false
    [--start-date D] [--end-date D] [--dates D,D]
  stayport conversations [--offset N] [--limit N]
  stayport conversation <conversation_id>
  stayport send-message <conversation_id> [--message TEXT] [--jpeg-base64 B64]
  stayport reviews [--reservation-code C] [--property-id N]
    [--review-status S] [--start-check-out-date D] [--end-check-out-date D]
    [--offset N] [--limit N]
  stayport create-review <reservation_code> [--score N] [--content TEXT]
    [--reply TEXT]
  stayport post-guest-review --reservation-order-code CODE --content TEXT
    --recommend 0|1 --overall-rating 1-5 --cleanliness 1-5
    --respect-of-house-rules 1-5 --communication 1-5
    [--cleanliness-content TEXT] [--respect-house-rules-content TEXT]
    [--communication-content TEXT]
  stayport webhooks
  stayport create-webhook <url>
  stayport delete-webhook <webhook_id>
  stayport listing-calendar --start-date D --end-date D --listings <json>
  stayport update-listing-prices --channel-type T --listing-id ID --prices <json>
  stayport custom-channels
  stayport income-methods
  stayport mcp
  stayport --version`);
  process.exit(2);
}

function flag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

function numFlag(rest: string[], name: string): number | undefined {
  const raw = flag(rest, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) usage();
  return n;
}

function requiredFlag(rest: string[], name: string): string {
  const v = flag(rest, name);
  if (v === undefined || v.startsWith("--")) usage();
  return v;
}

function requiredNumFlag(rest: string[], name: string): number {
  const n = numFlag(rest, name);
  if (n === undefined) usage();
  return n;
}

function positional(rest: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    if (a.startsWith("--")) {
      i++; // skip the flag's value
    } else {
      out.push(a);
    }
  }
  return out;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) usage();
    return v as Record<string, unknown>;
  } catch {
    usage();
  }
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) usage();
    return v;
  } catch {
    usage();
  }
}

function parseIdList(raw: string): number[] {
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) usage();
  const out = parts.map((s) => Number(s));
  if (out.some((n) => !Number.isFinite(n))) usage();
  return out;
}

const RATING_VALUES = ["1", "2", "3", "4", "5"];

function ratingFlag(rest: string[], name: string): RatingValue {
  const v = requiredFlag(rest, name);
  if (!RATING_VALUES.includes(v)) usage();
  return v as RatingValue;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const known = [
    "properties",
    "room-types",
    "reservations",
    "create-reservation",
    "cancel-reservation",
    "update-lock-code",
    "get-custom-fields",
    "update-custom-fields",
    "availabilities",
    "update-availabilities",
    "conversations",
    "conversation",
    "send-message",
    "reviews",
    "create-review",
    "post-guest-review",
    "webhooks",
    "create-webhook",
    "delete-webhook",
    "listing-calendar",
    "update-listing-prices",
    "custom-channels",
    "income-methods",
  ];
  if (!known.includes(cmd)) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const config: StayportConfig = {
    accessToken: process.env[ACCESS_TOKEN_ENV],
    email: process.env[EMAIL_ENV],
    password: process.env[PASSWORD_ENV],
    baseUrl: process.env[BASE_URL_ENV],
    webBaseUrl: process.env[WEB_BASE_URL_ENV],
  };
  const pos = positional(rest);
  try {
    let out: unknown;
    if (cmd === "properties") {
      out = await listProperties(fetchFn, config, {
        offset: numFlag(rest, "--offset"),
        limit: numFlag(rest, "--limit"),
        id: numFlag(rest, "--id"),
      });
    } else if (cmd === "room-types") {
      out = await listRoomTypes(fetchFn, config, {
        offset: numFlag(rest, "--offset"),
        limit: numFlag(rest, "--limit"),
      });
    } else if (cmd === "reservations") {
      const status = flag(rest, "--status");
      const allowed = ["wait_accept", "wait_pay", "accepted", "cancelled", "denied", "timeout"];
      if (status !== undefined && !allowed.includes(status)) usage();
      out = await listReservations(fetchFn, config, {
        reservation_code: flag(rest, "--reservation-code"),
        property_id: numFlag(rest, "--property-id"),
        status: status as never,
        start_check_in_date: flag(rest, "--start-check-in-date"),
        end_check_in_date: flag(rest, "--end-check-in-date"),
        start_check_out_date: flag(rest, "--start-check-out-date"),
        end_check_out_date: flag(rest, "--end-check-out-date"),
        order_by: flag(rest, "--order-by"),
        offset: numFlag(rest, "--offset"),
        limit: numFlag(rest, "--limit"),
      });
    } else if (cmd === "create-reservation") {
      out = await createReservation(fetchFn, config, {
        property_id: requiredFlag(rest, "--property-id"),
        custom_channel_id: requiredNumFlag(rest, "--custom-channel-id"),
        check_in_date: requiredFlag(rest, "--check-in-date"),
        check_out_date: requiredFlag(rest, "--check-out-date"),
        guest_name: requiredFlag(rest, "--guest-name"),
        currency: requiredFlag(rest, "--currency"),
        rate_amount: requiredNumFlag(rest, "--rate-amount"),
        commission_amount: requiredNumFlag(rest, "--commission-amount"),
        received_amount: requiredNumFlag(rest, "--received-amount"),
        income_method_id: requiredNumFlag(rest, "--income-method-id"),
        number_of_guests: numFlag(rest, "--number-of-guests"),
        email: flag(rest, "--email"),
        mobile: flag(rest, "--mobile"),
        remarks: flag(rest, "--remarks"),
      });
    } else if (cmd === "cancel-reservation") {
      if (!pos[0]) usage();
      out = await cancelReservation(fetchFn, config, { reservation_code: pos[0] });
    } else if (cmd === "update-lock-code") {
      if (!pos[0] || !pos[1]) usage();
      out = await updateLockCode(fetchFn, config, { stay_code: pos[0], lock_code: pos[1] });
    } else if (cmd === "get-custom-fields") {
      if (!pos[0]) usage();
      out = await getCustomFields(fetchFn, config, { stay_code: pos[0] });
    } else if (cmd === "update-custom-fields") {
      if (!pos[0] || !pos[1]) usage();
      out = await updateCustomFields(fetchFn, config, {
        stay_code: pos[0],
        custom_fields: parseJsonObject(pos[1]),
      });
    } else if (cmd === "availabilities") {
      out = await listAvailabilities(fetchFn, config, {
        property_ids: requiredFlag(rest, "--property-ids"),
        start_date: requiredFlag(rest, "--start-date"),
        end_date: requiredFlag(rest, "--end-date"),
      });
    } else if (cmd === "update-availabilities") {
      const availableRaw = requiredFlag(rest, "--available");
      if (availableRaw !== "true" && availableRaw !== "false") usage();
      const datesRaw = flag(rest, "--dates");
      out = await updateAvailabilities(fetchFn, config, {
        property_ids: parseIdList(requiredFlag(rest, "--property-ids")),
        start_date: flag(rest, "--start-date"),
        end_date: flag(rest, "--end-date"),
        dates: datesRaw === undefined ? undefined : datesRaw.split(",").map((s) => s.trim()),
        available: availableRaw === "true",
      });
    } else if (cmd === "conversations") {
      out = await listConversations(fetchFn, config, {
        offset: numFlag(rest, "--offset"),
        limit: numFlag(rest, "--limit"),
      });
    } else if (cmd === "conversation") {
      if (!pos[0]) usage();
      out = await getConversation(fetchFn, config, { conversation_id: pos[0] });
    } else if (cmd === "send-message") {
      if (!pos[0]) usage();
      const message = flag(rest, "--message");
      const jpeg = flag(rest, "--jpeg-base64");
      if (message === undefined && jpeg === undefined) usage();
      out = await sendMessage(fetchFn, config, {
        conversation_id: pos[0],
        message,
        jpeg_base64: jpeg,
      });
    } else if (cmd === "reviews") {
      out = await listReviews(fetchFn, config, {
        reservation_code: flag(rest, "--reservation-code"),
        property_id: numFlag(rest, "--property-id"),
        review_status: flag(rest, "--review-status"),
        start_check_out_date: flag(rest, "--start-check-out-date"),
        end_check_out_date: flag(rest, "--end-check-out-date"),
        offset: numFlag(rest, "--offset"),
        limit: numFlag(rest, "--limit"),
      });
    } else if (cmd === "create-review") {
      if (!pos[0]) usage();
      out = await createReview(fetchFn, config, {
        reservation_code: pos[0],
        host_review_score: numFlag(rest, "--score"),
        host_review_content: flag(rest, "--content"),
        host_reply_content: flag(rest, "--reply"),
      });
    } else if (cmd === "post-guest-review") {
      const recommend = requiredFlag(rest, "--recommend");
      if (recommend !== "0" && recommend !== "1") usage();
      out = await postGuestReview(fetchFn, config, {
        reservation_order_code: requiredFlag(rest, "--reservation-order-code"),
        content: requiredFlag(rest, "--content"),
        recommend: recommend as RecommendValue,
        overall_rating: ratingFlag(rest, "--overall-rating"),
        cleanliness: ratingFlag(rest, "--cleanliness"),
        cleanliness_content: flag(rest, "--cleanliness-content"),
        respect_of_house_rules: ratingFlag(rest, "--respect-of-house-rules"),
        respect_house_rules_content: flag(rest, "--respect-house-rules-content"),
        communication: ratingFlag(rest, "--communication"),
        communication_content: flag(rest, "--communication-content"),
      });
    } else if (cmd === "webhooks") {
      out = await listWebhooks(fetchFn, config);
    } else if (cmd === "create-webhook") {
      const url = pos[0] ?? flag(rest, "--url");
      if (!url) usage();
      out = await createWebhook(fetchFn, config, { url });
    } else if (cmd === "delete-webhook") {
      if (!pos[0]) usage();
      const id = Number(pos[0]);
      if (!Number.isFinite(id)) usage();
      out = await deleteWebhook(fetchFn, config, { webhook_id: id });
    } else if (cmd === "listing-calendar") {
      const listings = parseJsonArray(requiredFlag(rest, "--listings")) as {
        channel_type: string;
        listing_id: string;
      }[];
      out = await getListingCalendar(fetchFn, config, {
        start_date: requiredFlag(rest, "--start-date"),
        end_date: requiredFlag(rest, "--end-date"),
        listings,
      });
    } else if (cmd === "update-listing-prices") {
      const prices = parseJsonArray(requiredFlag(rest, "--prices")) as {
        date: string;
        price: number;
      }[];
      out = await updateListingPrices(fetchFn, config, {
        channel_type: requiredFlag(rest, "--channel-type"),
        listing_id: requiredFlag(rest, "--listing-id"),
        prices,
      });
    } else if (cmd === "custom-channels") {
      out = await listCustomChannels(fetchFn, config);
    } else {
      out = await listIncomeMethods(fetchFn, config);
    }
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
