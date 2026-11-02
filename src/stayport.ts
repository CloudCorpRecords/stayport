/**
 * stayport core: 23 tools against the Hostex APIs.
 *
 *   hostex_list_properties        GET    /properties
 *   hostex_list_room_types        GET    /room_types
 *   hostex_list_reservations      GET    /reservations
 *   hostex_create_reservation     POST   /reservations
 *   hostex_cancel_reservation     DELETE /reservations/{reservation_code}
 *   hostex_update_lock_code       PATCH  /reservations/{stay_code}/check_in_details
 *   hostex_get_custom_fields      GET    /reservations/{stay_code}/custom_fields
 *   hostex_update_custom_fields   PATCH  /reservations/{stay_code}/custom_fields
 *   hostex_list_availabilities    GET    /availabilities
 *   hostex_update_availabilities  POST   /availabilities
 *   hostex_list_conversations     GET    /conversations
 *   hostex_get_conversation       GET    /conversations/{conversation_id}
 *   hostex_send_message           POST   /conversations/{conversation_id}
 *   hostex_list_reviews           GET    /reviews
 *   hostex_create_review          POST   /reviews/{reservation_code}
 *   hostex_post_guest_review      web-app login, then
 *                                 POST   /reservation_comment/send_comment
 *   hostex_list_webhooks          GET    /webhooks
 *   hostex_create_webhook         POST   /webhooks
 *   hostex_delete_webhook         DELETE /webhooks/{webhook_id}
 *   hostex_get_listing_calendar   POST   /listings/calendar
 *   hostex_update_listing_prices  POST   /listings/prices
 *   hostex_list_custom_channels   GET    /custom_channels
 *   hostex_list_income_methods    GET    /income_methods
 *
 * V3 calls go to https://api.hostex.io/v3 with the
 * `Hostex-Access-Token` header; the token comes from the
 * HOSTEX_ACCESS_TOKEN env var and a missing token is an honest
 * error that names the env var — no result is ever faked. The v3
 * response envelope reports success only when `error_code` is 200;
 * failures surface `error_msg` and `request_id`. On success the
 * envelope's `data` is returned when present, otherwise the whole
 * payload.
 *
 * The guest-review tool is the one exception: it talks to the
 * Hostex web app (https://hostex.io/api), logging in with the
 * HOSTEX_EMAIL / HOSTEX_PASSWORD credentials, capturing the
 * session cookies, and posting the review with category ratings.
 * Web-app responses report success with `error_code` 0, normalised
 * here to the same handling as 200. Unset credentials are an
 * honest error naming the env vars.
 *
 * All HTTP goes through an injected FetchFn so everything is
 * testable offline.
 */
import type {
  CancelReservationOptions,
  CreateReservationOptions,
  CreateReviewOptions,
  CreateWebhookOptions,
  DeleteWebhookOptions,
  FetchFn,
  GetConversationOptions,
  GetCustomFieldsOptions,
  GetListingCalendarOptions,
  ListAvailabilitiesOptions,
  ListConversationsOptions,
  ListPropertiesOptions,
  ListReservationsOptions,
  ListReviewsOptions,
  ListRoomTypesOptions,
  PostGuestReviewOptions,
  SendMessageOptions,
  StayportConfig,
  UpdateAvailabilitiesOptions,
  UpdateCustomFieldsOptions,
  UpdateListingPricesOptions,
  UpdateLockCodeOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "https://api.hostex.io/v3";

export const DEFAULT_WEB_BASE_URL = "https://hostex.io/api";

export const ACCESS_TOKEN_ENV = "HOSTEX_ACCESS_TOKEN";
export const EMAIL_ENV = "HOSTEX_EMAIL";
export const PASSWORD_ENV = "HOSTEX_PASSWORD";
export const BASE_URL_ENV = "HOSTEX_API_URL";
export const WEB_BASE_URL_ENV = "HOSTEX_WEB_API_URL";

/** Resolve a base URL: the given value when non-blank, else the default. Trailing slashes are stripped. */
export function resolveBaseUrl(value: string | undefined, fallback: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  const base = v ? v : fallback;
  return base.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireToken(config: StayportConfig): string {
  const token = typeof config.accessToken === "string" ? config.accessToken.trim() : "";
  if (!token) {
    throw new Error(
      `${ACCESS_TOKEN_ENV} is not set: a Hostex API access token is required (set the ${ACCESS_TOKEN_ENV} environment variable)`,
    );
  }
  return token;
}

function requireNonEmpty(value: unknown, field: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) throw new Error(`${field} must be a non-empty string`);
  return v;
}

/** Copy only the entries whose value is not undefined. */
function definedOnly(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function envelopeError(payload: unknown, httpStatus: number, httpStatusText?: string): Error {
  if (isRecord(payload)) {
    const code = payload.error_code;
    const msg = typeof payload.error_msg === "string" ? payload.error_msg : "";
    const reqId = typeof payload.request_id === "string" ? payload.request_id : "";
    const parts = [`Hostex API error: error_code ${String(code)}`];
    if (msg) parts.push(msg);
    if (reqId) parts.push(`request_id ${reqId}`);
    if (httpStatus) parts.push(`HTTP ${httpStatus}${httpStatusText ? ` ${httpStatusText}` : ""}`);
    return new Error(parts.join(": "));
  }
  return new Error(
    `Hostex API request failed: HTTP ${httpStatus}${httpStatusText ? ` ${httpStatusText}` : ""}`,
  );
}

async function readJson(response: {
  json(): Promise<unknown>;
}): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Hostex API returned a response that was not valid JSON");
  }
}

/**
 * Unwrap a response envelope: success requires `error_code` to be
 * one of `successCodes`. Returns the envelope's `data` when the key
 * is present, otherwise the whole payload.
 */
function unwrapEnvelope(payload: unknown, successCodes: number[]): unknown {
  if (isRecord(payload) && "error_code" in payload) {
    if (!successCodes.includes(Number(payload.error_code))) {
      throw envelopeError(payload, 0);
    }
    return "data" in payload ? payload.data : payload;
  }
  return payload;
}

interface V3Call {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

async function callV3(fetchFn: FetchFn, config: StayportConfig, call: V3Call): Promise<unknown> {
  const token = requireToken(config);
  const baseUrl = resolveBaseUrl(config.baseUrl, DEFAULT_BASE_URL);
  const url = `${baseUrl}${call.path}${call.query ? buildQuery(call.query) : ""}`;
  const headers: Record<string, string> = {
    "Hostex-Access-Token": token,
    Accept: "application/json",
  };
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method: call.method,
    headers,
  };
  if (call.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(call.body);
  }
  let response;
  try {
    response = await fetchFn(url, init);
  } catch (err) {
    throw new Error(
      `Hostex API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const payload = await readJson(response);
  if (!response.ok) throw envelopeError(payload, response.status, response.statusText);
  if (isRecord(payload) && "error_code" in payload && Number(payload.error_code) !== 200) {
    throw envelopeError(payload, response.status, response.statusText);
  }
  return unwrapEnvelope(payload, [200]);
}

/** List properties from your Hostex account. */
export async function listProperties(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: ListPropertiesOptions = {},
): Promise<unknown> {
  return callV3(fetchFn, config, {
    method: "GET",
    path: "/properties",
    query: definedOnly({ offset: options.offset, limit: options.limit, id: options.id }),
  });
}

/** List room types from your Hostex account. */
export async function listRoomTypes(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: ListRoomTypesOptions = {},
): Promise<unknown> {
  return callV3(fetchFn, config, {
    method: "GET",
    path: "/room_types",
    query: definedOnly({ offset: options.offset, limit: options.limit }),
  });
}

/** List and search reservations with filters. */
export async function listReservations(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: ListReservationsOptions = {},
): Promise<unknown> {
  return callV3(fetchFn, config, {
    method: "GET",
    path: "/reservations",
    query: definedOnly({
      reservation_code: options.reservation_code,
      property_id: options.property_id,
      status: options.status,
      start_check_in_date: options.start_check_in_date,
      end_check_in_date: options.end_check_in_date,
      start_check_out_date: options.start_check_out_date,
      end_check_out_date: options.end_check_out_date,
      order_by: options.order_by,
      offset: options.offset,
      limit: options.limit,
    }),
  });
}

/** Create a direct booking reservation in Hostex. */
export async function createReservation(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: CreateReservationOptions,
): Promise<unknown> {
  requireNonEmpty(options.property_id, "property_id");
  requireNonEmpty(options.check_in_date, "check_in_date");
  requireNonEmpty(options.check_out_date, "check_out_date");
  requireNonEmpty(options.guest_name, "guest_name");
  requireNonEmpty(options.currency, "currency");
  return callV3(fetchFn, config, {
    method: "POST",
    path: "/reservations",
    body: definedOnly({ ...options }),
  });
}

/** Cancel a direct booking reservation (channel bookings not supported). */
export async function cancelReservation(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: CancelReservationOptions,
): Promise<unknown> {
  const code = requireNonEmpty(options.reservation_code, "reservation_code");
  return callV3(fetchFn, config, {
    method: "DELETE",
    path: `/reservations/${encodeURIComponent(code)}`,
  });
}

/** Update the lock code for a stay. */
export async function updateLockCode(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: UpdateLockCodeOptions,
): Promise<unknown> {
  const stay = requireNonEmpty(options.stay_code, "stay_code");
  const lock = requireNonEmpty(options.lock_code, "lock_code");
  return callV3(fetchFn, config, {
    method: "PATCH",
    path: `/reservations/${encodeURIComponent(stay)}/check_in_details`,
    body: { lock_code: lock },
  });
}

/** Get custom fields for a stay. */
export async function getCustomFields(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: GetCustomFieldsOptions,
): Promise<unknown> {
  const stay = requireNonEmpty(options.stay_code, "stay_code");
  return callV3(fetchFn, config, {
    method: "GET",
    path: `/reservations/${encodeURIComponent(stay)}/custom_fields`,
  });
}

/** Update custom fields for a stay. */
export async function updateCustomFields(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: UpdateCustomFieldsOptions,
): Promise<unknown> {
  const stay = requireNonEmpty(options.stay_code, "stay_code");
  if (!isRecord(options.custom_fields)) {
    throw new Error("custom_fields must be an object of key-value pairs");
  }
  return callV3(fetchFn, config, {
    method: "PATCH",
    path: `/reservations/${encodeURIComponent(stay)}/custom_fields`,
    body: { custom_fields: options.custom_fields },
  });
}

/** Query property availability for date ranges. */
export async function listAvailabilities(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: ListAvailabilitiesOptions,
): Promise<unknown> {
  requireNonEmpty(options.property_ids, "property_ids");
  requireNonEmpty(options.start_date, "start_date");
  requireNonEmpty(options.end_date, "end_date");
  return callV3(fetchFn, config, {
    method: "GET",
    path: "/availabilities",
    query: {
      property_ids: options.property_ids,
      start_date: options.start_date,
      end_date: options.end_date,
    },
  });
}

/** Update property availability status for specific dates or date ranges. */
export async function updateAvailabilities(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: UpdateAvailabilitiesOptions,
): Promise<unknown> {
  if (!Array.isArray(options.property_ids) || options.property_ids.length === 0) {
    throw new Error("property_ids must be a non-empty array of property IDs");
  }
  if (typeof options.available !== "boolean") {
    throw new Error("available must be a boolean");
  }
  return callV3(fetchFn, config, {
    method: "POST",
    path: "/availabilities",
    body: definedOnly({ ...options }),
  });
}

/** List guest conversations and inquiries. */
export async function listConversations(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: ListConversationsOptions = {},
): Promise<unknown> {
  return callV3(fetchFn, config, {
    method: "GET",
    path: "/conversations",
    query: definedOnly({ offset: options.offset, limit: options.limit }),
  });
}

/** Get conversation details including all messages. */
export async function getConversation(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: GetConversationOptions,
): Promise<unknown> {
  const id = requireNonEmpty(options.conversation_id, "conversation_id");
  return callV3(fetchFn, config, {
    method: "GET",
    path: `/conversations/${encodeURIComponent(id)}`,
  });
}

/** Send a text or image message to a guest. */
export async function sendMessage(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: SendMessageOptions,
): Promise<unknown> {
  const id = requireNonEmpty(options.conversation_id, "conversation_id");
  return callV3(fetchFn, config, {
    method: "POST",
    path: `/conversations/${encodeURIComponent(id)}`,
    body: definedOnly({ message: options.message, jpeg_base64: options.jpeg_base64 }),
  });
}

/** Query reviews with filters. */
export async function listReviews(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: ListReviewsOptions = {},
): Promise<unknown> {
  return callV3(fetchFn, config, {
    method: "GET",
    path: "/reviews",
    query: definedOnly({
      reservation_code: options.reservation_code,
      property_id: options.property_id,
      review_status: options.review_status,
      start_check_out_date: options.start_check_out_date,
      end_check_out_date: options.end_check_out_date,
      offset: options.offset,
      limit: options.limit,
    }),
  });
}

/** Create a review or reply for a reservation. */
export async function createReview(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: CreateReviewOptions,
): Promise<unknown> {
  const code = requireNonEmpty(options.reservation_code, "reservation_code");
  return callV3(fetchFn, config, {
    method: "POST",
    path: `/reviews/${encodeURIComponent(code)}`,
    body: definedOnly({
      host_review_score: options.host_review_score,
      host_review_content: options.host_review_content,
      host_reply_content: options.host_reply_content,
    }),
  });
}

function webUrl(webBaseUrl: string, path: string): string {
  const opid = `${Date.now()}`;
  return `${webBaseUrl}${path}?opid=${encodeURIComponent(opid)}&opclient=Web-Mac-Chrome`;
}

function sessionCookie(headers: HttpResponseHeaders): string {
  let raw: string[] = [];
  if (typeof headers.getSetCookie === "function") {
    raw = headers.getSetCookie();
  } else {
    const single = headers.get("set-cookie");
    if (single) raw = [single];
  }
  return raw
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter((c) => c.length > 0)
    .join("; ");
}

type HttpResponseHeaders = {
  get(name: string): string | null;
  getSetCookie?: () => string[];
};

/**
 * Post a comprehensive guest review with category ratings, as it
 * appears on the Hostex web app. Logs in with the configured
 * email/password, captures the session cookies, then posts.
 */
export async function postGuestReview(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: PostGuestReviewOptions,
): Promise<unknown> {
  const email = typeof config.email === "string" ? config.email.trim() : "";
  const password = typeof config.password === "string" ? config.password : "";
  if (!email || !password) {
    throw new Error(
      `hostex_post_guest_review requires the ${EMAIL_ENV} and ${PASSWORD_ENV} environment variables (Hostex web-app login credentials)`,
    );
  }
  requireNonEmpty(options.reservation_order_code, "reservation_order_code");
  requireNonEmpty(options.content, "content");
  const webBaseUrl = resolveBaseUrl(config.webBaseUrl, DEFAULT_WEB_BASE_URL);

  // Step 1: web-app login; session cookies come back on the response.
  let loginResponse;
  try {
    loginResponse = await fetchFn(webUrl(webBaseUrl, "/v2/user/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        account: email,
        password,
        image_code: "",
        dynamic_code: "",
        login_type: "password",
        locale: "en",
      }),
    });
  } catch (err) {
    throw new Error(
      `Hostex web-app login failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const loginPayload = await readJson(loginResponse);
  if (!loginResponse.ok) {
    throw envelopeError(loginPayload, loginResponse.status, loginResponse.statusText);
  }
  if (
    isRecord(loginPayload) &&
    "error_code" in loginPayload &&
    Number(loginPayload.error_code) !== 0 &&
    Number(loginPayload.error_code) !== 200
  ) {
    throw envelopeError(loginPayload, loginResponse.status, loginResponse.statusText);
  }
  const cookie = sessionCookie(loginResponse.headers);

  // Step 2: post the review with the session cookies attached.
  const body = {
    reservation_order_code: options.reservation_order_code,
    content: options.content,
    category_ratings: definedOnly({
      recommend: Number(options.recommend),
      overall_rating: Number(options.overall_rating),
      cleanliness: Number(options.cleanliness),
      cleanliness_content: options.cleanliness_content,
      respect_of_house_rules: Number(options.respect_of_house_rules),
      respect_house_rules_content: options.respect_house_rules_content,
      communication: Number(options.communication),
      communication_content: options.communication_content,
    }),
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (cookie) headers.Cookie = cookie;
  let response;
  try {
    response = await fetchFn(webUrl(webBaseUrl, "/reservation_comment/send_comment"), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Hostex web-app request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const payload = await readJson(response);
  if (!response.ok) throw envelopeError(payload, response.status, response.statusText);
  return unwrapEnvelope(payload, [0, 200]);
}

/** List configured webhooks. */
export async function listWebhooks(
  fetchFn: FetchFn,
  config: StayportConfig,
): Promise<unknown> {
  return callV3(fetchFn, config, { method: "GET", path: "/webhooks" });
}

/** Create a new webhook. */
export async function createWebhook(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: CreateWebhookOptions,
): Promise<unknown> {
  const url = requireNonEmpty(options.url, "url");
  return callV3(fetchFn, config, {
    method: "POST",
    path: "/webhooks",
    body: { url },
  });
}

/** Delete a webhook (only manageable ones). */
export async function deleteWebhook(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: DeleteWebhookOptions,
): Promise<unknown> {
  if (typeof options.webhook_id !== "number" || !Number.isFinite(options.webhook_id)) {
    throw new Error("webhook_id must be a finite number");
  }
  return callV3(fetchFn, config, {
    method: "DELETE",
    path: `/webhooks/${options.webhook_id}`,
  });
}

/** Get calendar information for multiple listings. */
export async function getListingCalendar(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: GetListingCalendarOptions,
): Promise<unknown> {
  requireNonEmpty(options.start_date, "start_date");
  requireNonEmpty(options.end_date, "end_date");
  if (!Array.isArray(options.listings) || options.listings.length === 0) {
    throw new Error("listings must be a non-empty array of {channel_type, listing_id}");
  }
  for (const listing of options.listings) {
    requireNonEmpty(listing.channel_type, "listings[].channel_type");
    requireNonEmpty(listing.listing_id, "listings[].listing_id");
  }
  return callV3(fetchFn, config, {
    method: "POST",
    path: "/listings/calendar",
    body: definedOnly({ ...options }),
  });
}

/** Update listing prices for channel listings. */
export async function updateListingPrices(
  fetchFn: FetchFn,
  config: StayportConfig,
  options: UpdateListingPricesOptions,
): Promise<unknown> {
  requireNonEmpty(options.channel_type, "channel_type");
  requireNonEmpty(options.listing_id, "listing_id");
  if (!Array.isArray(options.prices) || options.prices.length === 0) {
    throw new Error("prices must be a non-empty array of {date, price}");
  }
  for (const entry of options.prices) {
    requireNonEmpty(entry.date, "prices[].date");
    if (typeof entry.price !== "number" || !Number.isFinite(entry.price)) {
      throw new Error("prices[].price must be a finite number");
    }
  }
  return callV3(fetchFn, config, {
    method: "POST",
    path: "/listings/prices",
    body: definedOnly({ ...options }),
  });
}

/** Get custom channels from Custom Options Page. */
export async function listCustomChannels(
  fetchFn: FetchFn,
  config: StayportConfig,
): Promise<unknown> {
  return callV3(fetchFn, config, { method: "GET", path: "/custom_channels" });
}

/** Get income methods from Custom Options Page. */
export async function listIncomeMethods(
  fetchFn: FetchFn,
  config: StayportConfig,
): Promise<unknown> {
  return callV3(fetchFn, config, { method: "GET", path: "/income_methods" });
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
