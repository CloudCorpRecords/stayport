/**
 * stayport types.
 *
 * Shapes follow the public Hostex v3 API as wrapped by the
 * hostex-ts client: list calls take their filters as query params,
 * writes take a JSON body, and every v3 response is an envelope
 * whose `error_code` is 200 on success. HTTP access is described by
 * a minimal response surface so tests can inject a fake fetch and
 * never touch the network. The guest-review flow additionally reads
 * `set-cookie` headers from the login response.
 */

export interface StayportConfig {
  accessToken?: string;
  email?: string;
  password?: string;
  baseUrl?: string;
  webBaseUrl?: string;
}

export interface ListPropertiesOptions {
  offset?: number;
  limit?: number;
  id?: number;
}

export interface ListRoomTypesOptions {
  offset?: number;
  limit?: number;
}

export type ReservationStatus =
  | "wait_accept"
  | "wait_pay"
  | "accepted"
  | "cancelled"
  | "denied"
  | "timeout";

export interface ListReservationsOptions {
  reservation_code?: string;
  property_id?: number;
  status?: ReservationStatus;
  start_check_in_date?: string;
  end_check_in_date?: string;
  start_check_out_date?: string;
  end_check_out_date?: string;
  order_by?: string;
  offset?: number;
  limit?: number;
}

export interface CreateReservationOptions {
  property_id: string;
  custom_channel_id: number;
  check_in_date: string;
  check_out_date: string;
  guest_name: string;
  currency: string;
  rate_amount: number;
  commission_amount: number;
  received_amount: number;
  income_method_id: number;
  number_of_guests?: number;
  email?: string;
  mobile?: string;
  remarks?: string;
}

export interface CancelReservationOptions {
  reservation_code: string;
}

export interface UpdateLockCodeOptions {
  stay_code: string;
  lock_code: string;
}

export interface GetCustomFieldsOptions {
  stay_code: string;
}

export interface UpdateCustomFieldsOptions {
  stay_code: string;
  custom_fields: Record<string, unknown>;
}

export interface ListAvailabilitiesOptions {
  property_ids: string;
  start_date: string;
  end_date: string;
}

export interface UpdateAvailabilitiesOptions {
  property_ids: number[];
  start_date?: string;
  end_date?: string;
  dates?: string[];
  available: boolean;
}

export interface ListConversationsOptions {
  offset?: number;
  limit?: number;
}

export interface GetConversationOptions {
  conversation_id: string;
}

export interface SendMessageOptions {
  conversation_id: string;
  message?: string;
  jpeg_base64?: string;
}

export interface ListReviewsOptions {
  reservation_code?: string;
  property_id?: number;
  review_status?: string;
  start_check_out_date?: string;
  end_check_out_date?: string;
  offset?: number;
  limit?: number;
}

export interface CreateReviewOptions {
  reservation_code: string;
  host_review_score?: number;
  host_review_content?: string;
  host_reply_content?: string;
}

export type RecommendValue = "0" | "1";
export type RatingValue = "1" | "2" | "3" | "4" | "5";

export interface PostGuestReviewOptions {
  reservation_order_code: string;
  content: string;
  recommend: RecommendValue;
  overall_rating: RatingValue;
  cleanliness: RatingValue;
  cleanliness_content?: string;
  respect_of_house_rules: RatingValue;
  respect_house_rules_content?: string;
  communication: RatingValue;
  communication_content?: string;
}

export interface CreateWebhookOptions {
  url: string;
}

export interface DeleteWebhookOptions {
  webhook_id: number;
}

export interface ListingRef {
  channel_type: string;
  listing_id: string;
}

export interface GetListingCalendarOptions {
  start_date: string;
  end_date: string;
  listings: ListingRef[];
}

export interface ListingPrice {
  date: string;
  price: number;
}

export interface UpdateListingPricesOptions {
  channel_type: string;
  listing_id: string;
  prices: ListingPrice[];
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: {
    get(name: string): string | null;
    getSetCookie?: () => string[];
  };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;
