import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BASE_URL,
  DEFAULT_WEB_BASE_URL,
  cancelReservation,
  createReservation,
  createReview,
  createWebhook,
  deleteWebhook,
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
  resolveBaseUrl,
  sendMessage,
  updateAvailabilities,
  updateCustomFields,
  updateListingPrices,
  updateLockCode,
} from "../src/stayport.js";
import type { FetchFn, HttpResponse, StayportConfig } from "../src/types.js";

function jsonResponse(
  body: unknown,
  status = 200,
  statusText = "OK",
  setCookies?: string[],
): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: () => "application/json",
      ...(setCookies ? { getSetCookie: () => setCookies } : {}),
    },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

interface CapturedCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

type Responder = (url: string, callIndex: number) => HttpResponse;

function fakeFetch(calls: CapturedCall[], responder: Responder): FetchFn {
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    return responder(url, calls.length - 1);
  };
}

function okFetch(calls: CapturedCall[], data: unknown = { ok: true }): FetchFn {
  return fakeFetch(calls, () => jsonResponse({ error_code: 200, data, request_id: "req-1" }));
}

const CONFIG: StayportConfig = { accessToken: "test-token" };
const BASE = "https://api.hostex.io/v3";

function bodyOf(call: CapturedCall): Record<string, unknown> {
  return JSON.parse(call.body ?? "{}") as Record<string, unknown>;
}

describe("base URL resolution", () => {
  it("defaults and strips trailing slashes", () => {
    assert.equal(resolveBaseUrl(undefined, DEFAULT_BASE_URL), BASE);
    assert.equal(resolveBaseUrl("  ", DEFAULT_BASE_URL), BASE);
    assert.equal(resolveBaseUrl("https://example.test/v3/", DEFAULT_BASE_URL), "https://example.test/v3");
    assert.equal(resolveBaseUrl(undefined, DEFAULT_WEB_BASE_URL), "https://hostex.io/api");
  });
});

describe("properties and room types", () => {
  it("list properties hits GET /properties with the token header and no query", async () => {
    const calls: CapturedCall[] = [];
    const out = await listProperties(okFetch(calls, [{ id: 1 }]), CONFIG, {});
    assert.deepEqual(out, [{ id: 1 }]);
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[0]?.url, `${BASE}/properties`);
    assert.equal(calls[0]?.headers?.["Hostex-Access-Token"], "test-token");
  });

  it("list properties composes offset, limit and id query params", async () => {
    const calls: CapturedCall[] = [];
    await listProperties(okFetch(calls), CONFIG, { offset: 5, limit: 10, id: 42 });
    const url = new URL(calls[0]?.url ?? "");
    assert.equal(url.pathname, "/v3/properties");
    assert.equal(url.searchParams.get("offset"), "5");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("id"), "42");
  });

  it("list room types hits GET /room_types with offset/limit", async () => {
    const calls: CapturedCall[] = [];
    await listRoomTypes(okFetch(calls), CONFIG, { offset: 0, limit: 20 });
    const url = new URL(calls[0]?.url ?? "");
    assert.equal(url.pathname, "/v3/room_types");
    assert.equal(url.searchParams.get("limit"), "20");
  });

  it("an envelope without a data key returns the whole payload", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = fakeFetch(calls, () => jsonResponse({ error_code: 200, total: 3 }));
    const out = (await listProperties(fetchFn, CONFIG, {})) as Record<string, unknown>;
    assert.equal(out.total, 3);
  });
});

describe("reservations", () => {
  it("list reservations composes every filter as a query param", async () => {
    const calls: CapturedCall[] = [];
    await listReservations(okFetch(calls), CONFIG, {
      reservation_code: "R1",
      property_id: 7,
      status: "accepted",
      start_check_in_date: "2026-11-01",
      end_check_in_date: "2026-11-30",
      start_check_out_date: "2026-11-02",
      end_check_out_date: "2026-12-01",
      order_by: "booked_at",
      offset: 0,
      limit: 50,
    });
    const url = new URL(calls[0]?.url ?? "");
    assert.equal(url.pathname, "/v3/reservations");
    assert.equal(url.searchParams.get("reservation_code"), "R1");
    assert.equal(url.searchParams.get("property_id"), "7");
    assert.equal(url.searchParams.get("status"), "accepted");
    assert.equal(url.searchParams.get("start_check_in_date"), "2026-11-01");
    assert.equal(url.searchParams.get("end_check_out_date"), "2026-12-01");
    assert.equal(url.searchParams.get("order_by"), "booked_at");
    assert.equal(url.searchParams.get("limit"), "50");
  });

  it("create reservation POSTs the full body and omits unset optionals", async () => {
    const calls: CapturedCall[] = [];
    await createReservation(okFetch(calls), CONFIG, {
      property_id: "123",
      custom_channel_id: 9,
      check_in_date: "2026-11-10",
      check_out_date: "2026-11-12",
      guest_name: "Ada",
      currency: "USD",
      rate_amount: 20000,
      commission_amount: 1000,
      received_amount: 20000,
      income_method_id: 3,
      email: "ada@example.com",
    });
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, `${BASE}/reservations`);
    assert.equal(calls[0]?.headers?.["Content-Type"], "application/json");
    const body = bodyOf(calls[0] as CapturedCall);
    assert.equal(body.property_id, "123");
    assert.equal(body.rate_amount, 20000);
    assert.equal(body.email, "ada@example.com");
    assert.equal("mobile" in body, false);
    assert.equal("remarks" in body, false);
    assert.equal("number_of_guests" in body, false);
  });

  it("cancel reservation DELETEs /reservations/{code}", async () => {
    const calls: CapturedCall[] = [];
    await cancelReservation(okFetch(calls), CONFIG, { reservation_code: "RES 9" });
    assert.equal(calls[0]?.method, "DELETE");
    assert.equal(calls[0]?.url, `${BASE}/reservations/RES%209`);
  });

  it("update lock code PATCHes check_in_details with only lock_code in the body", async () => {
    const calls: CapturedCall[] = [];
    await updateLockCode(okFetch(calls), CONFIG, { stay_code: "STAY1", lock_code: "4321" });
    assert.equal(calls[0]?.method, "PATCH");
    assert.equal(calls[0]?.url, `${BASE}/reservations/STAY1/check_in_details`);
    assert.deepEqual(bodyOf(calls[0] as CapturedCall), { lock_code: "4321" });
  });

  it("get custom fields GETs the custom_fields path", async () => {
    const calls: CapturedCall[] = [];
    await getCustomFields(okFetch(calls), CONFIG, { stay_code: "STAY1" });
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[0]?.url, `${BASE}/reservations/STAY1/custom_fields`);
  });

  it("update custom fields PATCHes {custom_fields}", async () => {
    const calls: CapturedCall[] = [];
    await updateCustomFields(okFetch(calls), CONFIG, {
      stay_code: "STAY1",
      custom_fields: { wifi: "net-5g", floor: 3 },
    });
    assert.equal(calls[0]?.method, "PATCH");
    assert.equal(calls[0]?.url, `${BASE}/reservations/STAY1/custom_fields`);
    assert.deepEqual(bodyOf(calls[0] as CapturedCall), {
      custom_fields: { wifi: "net-5g", floor: 3 },
    });
  });
});

describe("availabilities", () => {
  it("list availabilities sends property_ids and dates as query params", async () => {
    const calls: CapturedCall[] = [];
    await listAvailabilities(okFetch(calls), CONFIG, {
      property_ids: "1,2,3",
      start_date: "2026-11-01",
      end_date: "2026-11-07",
    });
    const url = new URL(calls[0]?.url ?? "");
    assert.equal(url.pathname, "/v3/availabilities");
    assert.equal(url.searchParams.get("property_ids"), "1,2,3");
    assert.equal(url.searchParams.get("start_date"), "2026-11-01");
    assert.equal(url.searchParams.get("end_date"), "2026-11-07");
  });

  it("update availabilities POSTs the array body and omits unset fields", async () => {
    const calls: CapturedCall[] = [];
    await updateAvailabilities(okFetch(calls), CONFIG, {
      property_ids: [1, 2],
      dates: ["2026-11-03"],
      available: false,
    });
    assert.equal(calls[0]?.method, "POST");
    const body = bodyOf(calls[0] as CapturedCall);
    assert.deepEqual(body.property_ids, [1, 2]);
    assert.deepEqual(body.dates, ["2026-11-03"]);
    assert.equal(body.available, false);
    assert.equal("start_date" in body, false);
  });
});

describe("conversations", () => {
  it("list conversations hits GET /conversations with offset/limit", async () => {
    const calls: CapturedCall[] = [];
    await listConversations(okFetch(calls), CONFIG, { offset: 10, limit: 5 });
    const url = new URL(calls[0]?.url ?? "");
    assert.equal(url.pathname, "/v3/conversations");
    assert.equal(url.searchParams.get("offset"), "10");
    assert.equal(url.searchParams.get("limit"), "5");
  });

  it("get conversation hits GET /conversations/{id}", async () => {
    const calls: CapturedCall[] = [];
    await getConversation(okFetch(calls), CONFIG, { conversation_id: "conv-9" });
    assert.equal(calls[0]?.url, `${BASE}/conversations/conv-9`);
  });

  it("send message POSTs only the defined body fields", async () => {
    const calls: CapturedCall[] = [];
    await sendMessage(okFetch(calls), CONFIG, { conversation_id: "conv-9", message: "Welcome!" });
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, `${BASE}/conversations/conv-9`);
    assert.deepEqual(bodyOf(calls[0] as CapturedCall), { message: "Welcome!" });
  });

  it("send message can carry a jpeg_base64 image", async () => {
    const calls: CapturedCall[] = [];
    await sendMessage(okFetch(calls), CONFIG, { conversation_id: "c1", jpeg_base64: "/9j/abc" });
    assert.deepEqual(bodyOf(calls[0] as CapturedCall), { jpeg_base64: "/9j/abc" });
  });
});

describe("reviews", () => {
  it("list reviews composes its filters as query params", async () => {
    const calls: CapturedCall[] = [];
    await listReviews(okFetch(calls), CONFIG, {
      reservation_code: "R7",
      property_id: 3,
      review_status: "pending",
      start_check_out_date: "2026-10-01",
      end_check_out_date: "2026-10-31",
      offset: 0,
      limit: 10,
    });
    const url = new URL(calls[0]?.url ?? "");
    assert.equal(url.pathname, "/v3/reviews");
    assert.equal(url.searchParams.get("reservation_code"), "R7");
    assert.equal(url.searchParams.get("review_status"), "pending");
    assert.equal(url.searchParams.get("end_check_out_date"), "2026-10-31");
  });

  it("create review POSTs /reviews/{code} with the remaining params as body", async () => {
    const calls: CapturedCall[] = [];
    await createReview(okFetch(calls), CONFIG, {
      reservation_code: "R7",
      host_review_score: 5,
      host_review_content: "Great guest",
    });
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, `${BASE}/reviews/R7`);
    const body = bodyOf(calls[0] as CapturedCall);
    assert.equal(body.host_review_score, 5);
    assert.equal(body.host_review_content, "Great guest");
    assert.equal("reservation_code" in body, false);
    assert.equal("host_reply_content" in body, false);
  });
});

describe("guest review web-app login flow", () => {
  const reviewArgs = {
    reservation_order_code: "0-ABC123-xyz",
    content: "Lovely stay",
    recommend: "1" as const,
    overall_rating: "5" as const,
    cleanliness: "4" as const,
    cleanliness_content: "Mostly tidy",
    respect_of_house_rules: "5" as const,
    communication: "5" as const,
  };
  const creds: StayportConfig = { email: "host@example.com", password: "pw" };

  it("unset credentials are an honest error naming the env vars, with no request", async () => {
    const calls: CapturedCall[] = [];
    await assert.rejects(
      () => postGuestReview(okFetch(calls), {}, reviewArgs),
      /HOSTEX_EMAIL and HOSTEX_PASSWORD/,
    );
    assert.equal(calls.length, 0);
  });

  it("logs in, forwards the session cookie, and posts numeric category ratings", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = fakeFetch(calls, (_url, idx) =>
      idx === 0
        ? jsonResponse({ error_code: 0, data: { id: 1 } }, 200, "OK", [
            "session=abc123; Path=/; HttpOnly",
            "uid=7; Path=/",
          ])
        : jsonResponse({ error_code: 0, data: { posted: true } }),
    );
    const out = await postGuestReview(fetchFn, creds, reviewArgs);
    assert.deepEqual(out, { posted: true });
    assert.equal(calls.length, 2);

    const loginUrl = new URL(calls[0]?.url ?? "");
    assert.equal(loginUrl.origin + loginUrl.pathname, "https://hostex.io/api/v2/user/login");
    assert.equal(loginUrl.searchParams.get("opclient"), "Web-Mac-Chrome");
    assert.ok(loginUrl.searchParams.get("opid"));
    const loginBody = bodyOf(calls[0] as CapturedCall);
    assert.equal(loginBody.account, "host@example.com");
    assert.equal(loginBody.password, "pw");
    assert.equal(loginBody.image_code, "");
    assert.equal(loginBody.dynamic_code, "");
    assert.equal(loginBody.login_type, "password");
    assert.equal(loginBody.locale, "en");
    assert.equal(calls[0]?.headers?.["Hostex-Access-Token"], undefined);

    const postUrl = new URL(calls[1]?.url ?? "");
    assert.equal(
      postUrl.origin + postUrl.pathname,
      "https://hostex.io/api/reservation_comment/send_comment",
    );
    assert.equal(postUrl.searchParams.get("opclient"), "Web-Mac-Chrome");
    assert.equal(calls[1]?.headers?.Cookie, "session=abc123; uid=7");
    const postBody = bodyOf(calls[1] as CapturedCall);
    assert.equal(postBody.reservation_order_code, "0-ABC123-xyz");
    assert.equal(postBody.content, "Lovely stay");
    const ratings = postBody.category_ratings as Record<string, unknown>;
    assert.equal(ratings.recommend, 1);
    assert.equal(ratings.overall_rating, 5);
    assert.equal(ratings.cleanliness, 4);
    assert.equal(ratings.cleanliness_content, "Mostly tidy");
    assert.equal(ratings.respect_of_house_rules, 5);
    assert.equal(ratings.communication, 5);
    assert.equal("respect_house_rules_content" in ratings, false);
    assert.equal("communication_content" in ratings, false);
  });

  it("a failed login stops the flow before any review is posted", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = fakeFetch(calls, () =>
      jsonResponse({ error_code: 1001, error_msg: "bad credentials" }),
    );
    await assert.rejects(() => postGuestReview(fetchFn, creds, reviewArgs), /bad credentials/);
    assert.equal(calls.length, 1);
  });

  it("a send_comment envelope error surfaces error_msg", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = fakeFetch(calls, (_url, idx) =>
      idx === 0
        ? jsonResponse({ error_code: 0, data: {} }, 200, "OK", ["s=1; Path=/"])
        : jsonResponse({ error_code: 400, error_msg: "already reviewed" }),
    );
    await assert.rejects(() => postGuestReview(fetchFn, creds, reviewArgs), /already reviewed/);
    assert.equal(calls.length, 2);
  });
});

describe("webhooks, listings and misc lists", () => {
  it("list webhooks hits GET /webhooks with no body", async () => {
    const calls: CapturedCall[] = [];
    await listWebhooks(okFetch(calls), CONFIG);
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[0]?.url, `${BASE}/webhooks`);
    assert.equal(calls[0]?.body, undefined);
  });

  it("create webhook POSTs {url}", async () => {
    const calls: CapturedCall[] = [];
    await createWebhook(okFetch(calls), CONFIG, { url: "https://example.com/hook" });
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(bodyOf(calls[0] as CapturedCall), { url: "https://example.com/hook" });
  });

  it("delete webhook DELETEs /webhooks/{id}", async () => {
    const calls: CapturedCall[] = [];
    await deleteWebhook(okFetch(calls), CONFIG, { webhook_id: 17 });
    assert.equal(calls[0]?.method, "DELETE");
    assert.equal(calls[0]?.url, `${BASE}/webhooks/17`);
  });

  it("listing calendar POSTs start/end/listings to /listings/calendar", async () => {
    const calls: CapturedCall[] = [];
    await getListingCalendar(okFetch(calls), CONFIG, {
      start_date: "2026-11-01",
      end_date: "2026-11-30",
      listings: [{ channel_type: "airbnb", listing_id: "L1" }],
    });
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, `${BASE}/listings/calendar`);
    const body = bodyOf(calls[0] as CapturedCall);
    assert.equal(body.start_date, "2026-11-01");
    assert.deepEqual(body.listings, [{ channel_type: "airbnb", listing_id: "L1" }]);
  });

  it("update listing prices POSTs to /listings/prices", async () => {
    const calls: CapturedCall[] = [];
    await updateListingPrices(okFetch(calls), CONFIG, {
      channel_type: "airbnb",
      listing_id: "L1",
      prices: [{ date: "2026-11-05", price: 15000 }],
    });
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, `${BASE}/listings/prices`);
    const body = bodyOf(calls[0] as CapturedCall);
    assert.equal(body.channel_type, "airbnb");
    assert.deepEqual(body.prices, [{ date: "2026-11-05", price: 15000 }]);
  });

  it("custom channels and income methods hit their GET paths", async () => {
    const calls: CapturedCall[] = [];
    await listCustomChannels(okFetch(calls), CONFIG);
    await listIncomeMethods(okFetch(calls), CONFIG);
    assert.equal(calls[0]?.url, `${BASE}/custom_channels`);
    assert.equal(calls[1]?.url, `${BASE}/income_methods`);
  });
});

describe("auth and envelope errors", () => {
  it("a missing access token is an honest error naming HOSTEX_ACCESS_TOKEN, with no request", async () => {
    const calls: CapturedCall[] = [];
    await assert.rejects(() => listProperties(okFetch(calls), {}, {}), /HOSTEX_ACCESS_TOKEN is not set/);
    assert.equal(calls.length, 0);
  });

  it("a blank access token is treated as missing", async () => {
    const calls: CapturedCall[] = [];
    await assert.rejects(
      () => listWebhooks(okFetch(calls), { accessToken: "   " }),
      /HOSTEX_ACCESS_TOKEN/,
    );
    assert.equal(calls.length, 0);
  });

  it("an envelope error surfaces error_code, error_msg and request_id", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = fakeFetch(calls, () =>
      jsonResponse({ error_code: 401, error_msg: "invalid token", request_id: "req-99" }),
    );
    await assert.rejects(
      () => listProperties(fetchFn, CONFIG, {}),
      /error_code 401: invalid token: request_id req-99/,
    );
  });

  it("an HTTP failure surfaces the status alongside the envelope message", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = fakeFetch(calls, () =>
      jsonResponse({ error_code: 500, error_msg: "boom" }, 500, "Server Error"),
    );
    await assert.rejects(() => listProperties(fetchFn, CONFIG, {}), /HTTP 500/);
  });

  it("a network failure is wrapped with context", async () => {
    const failing: FetchFn = async () => {
      throw new Error("socket hang up");
    };
    await assert.rejects(() => listProperties(failing, CONFIG, {}), /Hostex API request failed: socket hang up/);
  });
});
