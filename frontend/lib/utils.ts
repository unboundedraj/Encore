/**
 * amountInCents is minor units generally -- cents, or paise for INR -- matching
 * how encore_shows.price and the payment gateways store money. Defaults to INR
 * since Encore's seed venues and prices are Indian; pass currency explicitly
 * once shows in other currencies exist.
 */
export function formatCurrency(amountInCents: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountInCents / 100);
}
