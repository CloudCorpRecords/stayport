/**
 * stayport MCP server. Tools: the 23 hostex_* tools (properties,
 * room types, reservations, availabilities, conversations,
 * reviews, the web-app guest review, webhooks, listing calendar
 * and prices, custom channels, income methods).
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys that
 * are not in this tool's public spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod still
 * validates every tools/call argument set.
 *
 * V3 calls use the Hostex-Access-Token header from the
 * HOSTEX_ACCESS_TOKEN env var against https://api.hostex.io/v3
 * (overridable with HOSTEX_API_URL). The guest-review tool logs in
 * to the web app with HOSTEX_EMAIL / HOSTEX_PASSWORD. Missing
 * credentials surface as honest isError results naming the env
 * var; nothing is faked.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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
import type { FetchFn, StayportConfig } from "./types.js";

const NoArgs = z.object({});
const ListPropertiesArgs = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
  id: z.number().optional(),
});
const ListRoomTypesArgs = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
});
const ListReservationsArgs = z.object({
  reservation_code: z.string().optional(),
  property_id: z.number().optional(),
  status: z
    .enum(["wait_accept", "wait_pay", "accepted", "cancelled", "denied", "timeout"])
    .optional(),
  start_check_in_date: z.string().optional(),
  end_check_in_date: z.string().optional(),
  start_check_out_date: z.string().optional(),
  end_check_out_date: z.string().optional(),
  order_by: z.string().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});
const CreateReservationArgs = z.object({
  property_id: z.string(),
  custom_channel_id: z.number(),
  check_in_date: z.string(),
  check_out_date: z.string(),
  guest_name: z.string(),
  currency: z.string(),
  rate_amount: z.number(),
  commission_amount: z.number(),
  received_amount: z.number(),
  income_method_id: z.number(),
  number_of_guests: z.number().optional(),
  email: z.string().optional(),
  mobile: z.string().optional(),
  remarks: z.string().optional(),
});
const CancelReservationArgs = z.object({ reservation_code: z.string() });
const UpdateLockCodeArgs = z.object({ stay_code: z.string(), lock_code: z.string() });
const GetCustomFieldsArgs = z.object({ stay_code: z.string() });
const UpdateCustomFieldsArgs = z.object({
  stay_code: z.string(),
  custom_fields: z.record(z.unknown()),
});
const ListAvailabilitiesArgs = z.object({
  property_ids: z.string(),
  start_date: z.string(),
  end_date: z.string(),
});
const UpdateAvailabilitiesArgs = z.object({
  property_ids: z.array(z.number()),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  dates: z.array(z.string()).optional(),
  available: z.boolean(),
});
const ListConversationsArgs = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
});
const GetConversationArgs = z.object({ conversation_id: z.string() });
const SendMessageArgs = z.object({
  conversation_id: z.string(),
  message: z.string().optional(),
  jpeg_base64: z.string().optional(),
});
const ListReviewsArgs = z.object({
  reservation_code: z.string().optional(),
  property_id: z.number().optional(),
  review_status: z.string().optional(),
  start_check_out_date: z.string().optional(),
  end_check_out_date: z.string().optional(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});
const CreateReviewArgs = z.object({
  reservation_code: z.string(),
  host_review_score: z.number().optional(),
  host_review_content: z.string().optional(),
  host_reply_content: z.string().optional(),
});
const RatingEnum = z.enum(["1", "2", "3", "4", "5"]);
const PostGuestReviewArgs = z.object({
  reservation_order_code: z.string(),
  content: z.string(),
  recommend: z.enum(["0", "1"]),
  overall_rating: RatingEnum,
  cleanliness: RatingEnum,
  cleanliness_content: z.string().optional(),
  respect_of_house_rules: RatingEnum,
  respect_house_rules_content: z.string().optional(),
  communication: RatingEnum,
  communication_content: z.string().optional(),
});
const CreateWebhookArgs = z.object({ url: z.string() });
const DeleteWebhookArgs = z.object({ webhook_id: z.number() });
const GetListingCalendarArgs = z.object({
  start_date: z.string(),
  end_date: z.string(),
  listings: z.array(
    z.object({ channel_type: z.string(), listing_id: z.string() }),
  ),
});
const UpdateListingPricesArgs = z.object({
  channel_type: z.string(),
  listing_id: z.string(),
  prices: z.array(z.object({ date: z.string(), price: z.number() })),
});

const TOOLS = [
  {
    name: "hostex_list_properties",
    description:
      "List properties from your Hostex account. Returns property details including ID, title, address, channels, and location coordinates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        offset: { type: "number", description: "Number of records to skip, for paging." },
        limit: { type: "number", description: "Maximum number of properties to return." },
        id: { type: "number", description: "Property id filter; return only the property with this id." },
      },
    },
  },
  {
    name: "hostex_list_room_types",
    description: "List room types from your Hostex account.",
    inputSchema: {
      type: "object" as const,
      properties: {
        offset: { type: "number", description: "Number of records to skip, for paging." },
        limit: { type: "number", description: "Maximum number of room types to return." },
      },
    },
  },
  {
    name: "hostex_list_reservations",
    description:
      "List and search reservations with filters like status, dates, property ID, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reservation_code: { type: "string", description: "Reservation code filter." },
        property_id: { type: "number", description: "Property id filter." },
        status: {
          type: "string",
          enum: ["wait_accept", "wait_pay", "accepted", "cancelled", "denied", "timeout"],
          description: "Reservation status filter: wait_accept, wait_pay, accepted, cancelled, denied, or timeout.",
        },
        start_check_in_date: { type: "string", description: "Earliest check-in date to include, YYYY-MM-DD." },
        end_check_in_date: { type: "string", description: "Latest check-in date to include, YYYY-MM-DD." },
        start_check_out_date: { type: "string", description: "Earliest check-out date to include, YYYY-MM-DD." },
        end_check_out_date: { type: "string", description: "Latest check-out date to include, YYYY-MM-DD." },
        order_by: { type: "string", description: "Sort field for the results." },
        offset: { type: "number", description: "Number of records to skip, for paging." },
        limit: { type: "number", description: "Maximum number of reservations to return." },
      },
    },
  },
  {
    name: "hostex_create_reservation",
    description: "Create a direct booking reservation in Hostex.",
    inputSchema: {
      type: "object" as const,
      properties: {
        property_id: { type: "string", description: "Property id to book." },
        custom_channel_id: { type: "number", description: "Custom channel id for the direct booking." },
        check_in_date: { type: "string", description: "Check-in date, YYYY-MM-DD." },
        check_out_date: { type: "string", description: "Check-out date, YYYY-MM-DD." },
        guest_name: { type: "string", description: "Guest name." },
        currency: { type: "string", description: "Currency code for the amounts." },
        rate_amount: { type: "number", description: "Booking rate amount." },
        commission_amount: { type: "number", description: "Commission amount." },
        received_amount: { type: "number", description: "Amount received." },
        income_method_id: { type: "number", description: "Income method id." },
        number_of_guests: { type: "number", description: "Number of guests." },
        email: { type: "string", description: "Guest email address." },
        mobile: { type: "string", description: "Guest mobile number." },
        remarks: { type: "string", description: "Remarks recorded with the reservation." },
      },
      required: [
        "property_id",
        "custom_channel_id",
        "check_in_date",
        "check_out_date",
        "guest_name",
        "currency",
        "rate_amount",
        "commission_amount",
        "received_amount",
        "income_method_id",
      ],
    },
  },
  {
    name: "hostex_cancel_reservation",
    description: "Cancel a direct booking reservation (channel bookings not supported).",
    inputSchema: {
      type: "object" as const,
      properties: { reservation_code: { type: "string", description: "Reservation code of the direct booking to cancel." } },
      required: ["reservation_code"],
    },
  },
  {
    name: "hostex_update_lock_code",
    description: "Update the lock code for a stay.",
    inputSchema: {
      type: "object" as const,
      properties: {
        stay_code: { type: "string", description: "Stay code to update the lock code for." },
        lock_code: { type: "string", description: "New lock code." },
      },
      required: ["stay_code", "lock_code"],
    },
  },
  {
    name: "hostex_get_custom_fields",
    description: "Get custom fields for a stay.",
    inputSchema: {
      type: "object" as const,
      properties: { stay_code: { type: "string", description: "Stay code to get custom fields for." } },
      required: ["stay_code"],
    },
  },
  {
    name: "hostex_update_custom_fields",
    description:
      "Update custom fields for a stay. Custom fields can be used in automated messages using {{cf.field_name}} syntax.",
    inputSchema: {
      type: "object" as const,
      properties: {
        stay_code: { type: "string", description: "Stay code to update custom fields for." },
        custom_fields: { type: "object", additionalProperties: true, description: "Custom fields object, keyed by field name." },
      },
      required: ["stay_code", "custom_fields"],
    },
  },
  {
    name: "hostex_list_availabilities",
    description: "Query property availability for date ranges.",
    inputSchema: {
      type: "object" as const,
      properties: {
        property_ids: { type: "string", description: "Property ids to query, comma-separated." },
        start_date: { type: "string", description: "Start of the date range, YYYY-MM-DD." },
        end_date: { type: "string", description: "End of the date range, YYYY-MM-DD." },
      },
      required: ["property_ids", "start_date", "end_date"],
    },
  },
  {
    name: "hostex_update_availabilities",
    description: "Update property availability status for specific dates or date ranges.",
    inputSchema: {
      type: "object" as const,
      properties: {
        property_ids: { type: "array", items: { type: "number" }, description: "Property ids to update." },
        start_date: { type: "string", description: "Start of the date range to update, YYYY-MM-DD." },
        end_date: { type: "string", description: "End of the date range to update, YYYY-MM-DD." },
        dates: { type: "array", items: { type: "string" }, description: "Specific dates to update, as an array." },
        available: { type: "boolean", description: "Whether the properties are available on the given dates." },
      },
      required: ["property_ids", "available"],
    },
  },
  {
    name: "hostex_list_conversations",
    description: "List guest conversations and inquiries.",
    inputSchema: {
      type: "object" as const,
      properties: {
        offset: { type: "number", description: "Number of records to skip, for paging." },
        limit: { type: "number", description: "Maximum number of conversations to return." },
      },
    },
  },
  {
    name: "hostex_get_conversation",
    description: "Get conversation details including all messages.",
    inputSchema: {
      type: "object" as const,
      properties: { conversation_id: { type: "string", description: "Conversation id to fetch." } },
      required: ["conversation_id"],
    },
  },
  {
    name: "hostex_send_message",
    description: "Send a text or image message to a guest.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conversation_id: { type: "string", description: "Conversation id to send the message in." },
        message: { type: "string", description: "Text message to send." },
        jpeg_base64: { type: "string", description: "Image to send, as a base64-encoded JPEG." },
      },
      required: ["conversation_id"],
    },
  },
  {
    name: "hostex_list_reviews",
    description: "Query reviews with filters.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reservation_code: { type: "string", description: "Reservation code filter." },
        property_id: { type: "number", description: "Property id filter." },
        review_status: { type: "string", description: "Review status filter." },
        start_check_out_date: { type: "string", description: "Earliest check-out date to include, YYYY-MM-DD." },
        end_check_out_date: { type: "string", description: "Latest check-out date to include, YYYY-MM-DD." },
        offset: { type: "number", description: "Number of records to skip, for paging." },
        limit: { type: "number", description: "Maximum number of reviews to return." },
      },
    },
  },
  {
    name: "hostex_create_review",
    description: "Create a review or reply for a reservation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reservation_code: { type: "string", description: "Reservation code the review applies to." },
        host_review_score: { type: "number", description: "Host review score for the guest." },
        host_review_content: { type: "string", description: "Host review text." },
        host_reply_content: { type: "string", description: "Host reply text to an existing review." },
      },
      required: ["reservation_code"],
    },
  },
  {
    name: "hostex_post_guest_review",
    description:
      "Post a comprehensive guest review with category ratings (requires login via email/password config). This posts reviews as they appear on the Hostex web app.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reservation_order_code: { type: "string", description: "Reservation order code the review applies to." },
        content: { type: "string", description: "Review text." },
        recommend: { type: "string", enum: ["0", "1"], description: "Whether the host recommends the guest: 0 or 1." },
        overall_rating: { type: "string", enum: ["1", "2", "3", "4", "5"], description: "Overall rating, 1 to 5." },
        cleanliness: { type: "string", enum: ["1", "2", "3", "4", "5"], description: "Cleanliness rating, 1 to 5." },
        cleanliness_content: { type: "string", description: "Comment on the cleanliness rating." },
        respect_of_house_rules: { type: "string", enum: ["1", "2", "3", "4", "5"], description: "Respect-of-house-rules rating, 1 to 5." },
        respect_house_rules_content: { type: "string", description: "Comment on the house-rules rating." },
        communication: { type: "string", enum: ["1", "2", "3", "4", "5"], description: "Communication rating, 1 to 5." },
        communication_content: { type: "string", description: "Comment on the communication rating." },
      },
      required: [
        "reservation_order_code",
        "content",
        "recommend",
        "overall_rating",
        "cleanliness",
        "respect_of_house_rules",
        "communication",
      ],
    },
  },
  {
    name: "hostex_list_webhooks",
    description: "List configured webhooks.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "hostex_create_webhook",
    description: "Create a new webhook.",
    inputSchema: {
      type: "object" as const,
      properties: { url: { type: "string", description: "Webhook endpoint URL." } },
      required: ["url"],
    },
  },
  {
    name: "hostex_delete_webhook",
    description: "Delete a webhook (only manageable ones).",
    inputSchema: {
      type: "object" as const,
      properties: { webhook_id: { type: "number", description: "Webhook id to delete." } },
      required: ["webhook_id"],
    },
  },
  {
    name: "hostex_get_listing_calendar",
    description: "Get calendar information for multiple listings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        start_date: { type: "string", description: "Start of the calendar range, YYYY-MM-DD." },
        end_date: { type: "string", description: "End of the calendar range, YYYY-MM-DD." },
        listings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              channel_type: { type: "string" },
              listing_id: { type: "string" },
            },
            required: ["channel_type", "listing_id"],
          },
          description: "Listing ids to get calendar information for.",
        },
      },
      required: ["start_date", "end_date", "listings"],
    },
  },
  {
    name: "hostex_update_listing_prices",
    description: "Update listing prices for channel listings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        channel_type: { type: "string", description: "Channel type of the listing." },
        listing_id: { type: "string", description: "Listing id to update prices for." },
        prices: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string" },
              price: { type: "number" },
            },
            required: ["date", "price"],
          },
          description: "Price entries to apply, as an array.",
        },
      },
      required: ["channel_type", "listing_id", "prices"],
    },
  },
  {
    name: "hostex_list_custom_channels",
    description: "Get custom channels from Custom Options Page.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "hostex_list_income_methods",
    description: "Get income methods from Custom Options Page.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

function resolveConfig(): StayportConfig {
  return {
    accessToken: process.env[ACCESS_TOKEN_ENV],
    email: process.env[EMAIL_ENV],
    password: process.env[PASSWORD_ENV],
    baseUrl: process.env[BASE_URL_ENV],
    webBaseUrl: process.env[WEB_BASE_URL_ENV],
  };
}

const server = new Server(
  { name: "stayport", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  const config = resolveConfig();
  try {
    let out: unknown;
    if (name === "hostex_list_properties") {
      out = await listProperties(fetchFn, config, ListPropertiesArgs.parse(args ?? {}));
    } else if (name === "hostex_list_room_types") {
      out = await listRoomTypes(fetchFn, config, ListRoomTypesArgs.parse(args ?? {}));
    } else if (name === "hostex_list_reservations") {
      out = await listReservations(fetchFn, config, ListReservationsArgs.parse(args ?? {}));
    } else if (name === "hostex_create_reservation") {
      out = await createReservation(fetchFn, config, CreateReservationArgs.parse(args ?? {}));
    } else if (name === "hostex_cancel_reservation") {
      out = await cancelReservation(fetchFn, config, CancelReservationArgs.parse(args ?? {}));
    } else if (name === "hostex_update_lock_code") {
      out = await updateLockCode(fetchFn, config, UpdateLockCodeArgs.parse(args ?? {}));
    } else if (name === "hostex_get_custom_fields") {
      out = await getCustomFields(fetchFn, config, GetCustomFieldsArgs.parse(args ?? {}));
    } else if (name === "hostex_update_custom_fields") {
      out = await updateCustomFields(fetchFn, config, UpdateCustomFieldsArgs.parse(args ?? {}));
    } else if (name === "hostex_list_availabilities") {
      out = await listAvailabilities(fetchFn, config, ListAvailabilitiesArgs.parse(args ?? {}));
    } else if (name === "hostex_update_availabilities") {
      out = await updateAvailabilities(fetchFn, config, UpdateAvailabilitiesArgs.parse(args ?? {}));
    } else if (name === "hostex_list_conversations") {
      out = await listConversations(fetchFn, config, ListConversationsArgs.parse(args ?? {}));
    } else if (name === "hostex_get_conversation") {
      out = await getConversation(fetchFn, config, GetConversationArgs.parse(args ?? {}));
    } else if (name === "hostex_send_message") {
      out = await sendMessage(fetchFn, config, SendMessageArgs.parse(args ?? {}));
    } else if (name === "hostex_list_reviews") {
      out = await listReviews(fetchFn, config, ListReviewsArgs.parse(args ?? {}));
    } else if (name === "hostex_create_review") {
      out = await createReview(fetchFn, config, CreateReviewArgs.parse(args ?? {}));
    } else if (name === "hostex_post_guest_review") {
      out = await postGuestReview(fetchFn, config, PostGuestReviewArgs.parse(args ?? {}));
    } else if (name === "hostex_list_webhooks") {
      NoArgs.parse(args ?? {});
      out = await listWebhooks(fetchFn, config);
    } else if (name === "hostex_create_webhook") {
      out = await createWebhook(fetchFn, config, CreateWebhookArgs.parse(args ?? {}));
    } else if (name === "hostex_delete_webhook") {
      out = await deleteWebhook(fetchFn, config, DeleteWebhookArgs.parse(args ?? {}));
    } else if (name === "hostex_get_listing_calendar") {
      out = await getListingCalendar(fetchFn, config, GetListingCalendarArgs.parse(args ?? {}));
    } else if (name === "hostex_update_listing_prices") {
      out = await updateListingPrices(fetchFn, config, UpdateListingPricesArgs.parse(args ?? {}));
    } else if (name === "hostex_list_custom_channels") {
      NoArgs.parse(args ?? {});
      out = await listCustomChannels(fetchFn, config);
    } else if (name === "hostex_list_income_methods") {
      NoArgs.parse(args ?? {});
      out = await listIncomeMethods(fetchFn, config);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
