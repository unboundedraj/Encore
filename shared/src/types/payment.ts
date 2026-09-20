import type { PaymentGateway, PaymentStatus } from "./enums";

/** Row in the Postgres `encore_payments` table. One per booking. */
export interface Payment {
  id: string;
  booking_id: string;
  gateway: PaymentGateway;
  /** The gateway's own id, e.g. a Stripe PaymentIntent id. */
  gateway_payment_id: string;
  status: PaymentStatus;
  /** Minor units (cents/paise). */
  amount: number;
  /** Verbatim webhook body, kept for reconciliation. Null until one arrives. */
  raw_webhook_payload: Record<string, unknown> | null;
  created_at: string;
}
