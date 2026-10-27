/**
 * Price display shared by every page that shows one.
 *
 * Many places imported from OpenStreetMap have no price yet (`null`). The UI
 * says so plainly instead of hiding the field or guessing a number: a guessed
 * price would lie to the budget filter, which is the main reason people use
 * the app.
 */

export const UNKNOWN_PRICE_LABEL = "Harga belum diketahui";

/** "Rp 15.000", or the unknown-price label when there is no price. */
export function formatPrice(price: number | null | undefined): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return UNKNOWN_PRICE_LABEL;
  }
  return `Rp ${price.toLocaleString("id-ID")}`;
}

/** Whether a price is known well enough to deduct from the wallet. */
export function isKnownPrice(price: number | null | undefined): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}
