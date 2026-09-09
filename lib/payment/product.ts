/**
 * What ContentKita sells, as numbers rather than prose.
 *
 * One payment buys one thirty-day pack. There is no subscription, no renewal
 * and no credit balance, so there is exactly one price in the product and it
 * lives here — the checkout route, the callback's amount check and the copy on
 * the page all read the same constant rather than each carrying their own.
 *
 * The amount is in **sen**, as an integer, because that is the unit Billplz
 * bills in and because money must never be a float: RM39.90 written as 39.90
 * is 39.899999999999999 in binary, and a comparison against it in the callback
 * would eventually refuse a payment that was perfectly good.
 */

/** RM39.90 expressed the only way it is ever allowed to be expressed. */
export const PACK_PRICE_SEN = 3990;

export const CURRENCY = "MYR";

/** The single product. Recorded on the order so a future one cannot be confused with it. */
export const PRODUCT = "30_day_content_pack";

/** Days in a pack. The generator's own default, restated where money depends on it. */
export const PACK_DAYS = 30;

/** "RM39.90" — derived from the sen figure so the two can never disagree. */
export function priceLabel(sen: number = PACK_PRICE_SEN): string {
  return `RM${(sen / 100).toFixed(2)}`;
}
