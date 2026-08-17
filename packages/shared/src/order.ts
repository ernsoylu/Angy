/**
 * Sibling ordering keys (V2 H5.1).
 *
 * Until now a page's place among its siblings was `created_at`, which is not
 * an order anyone chose — you could not put the overview above the appendix
 * without deleting and recreating it. ADR 0013 also names ordering as the
 * unsolved half of database views, and a view needs a sort key that survives
 * two people inserting at once.
 *
 * The key is a string compared lexicographically, so reordering one page is a
 * single-row update and never renumbers its siblings. It has two parts:
 *
 *     V00001            integer only — appended or prepended at the ends
 *     V00001.l          integer + fraction — inserted between two neighbours
 *
 * The integer is a fixed six base-62 digits, which is what lets a plain string
 * comparison agree with the numeric one: without padding, "9" would sort after
 * "10". Appending increments it, so the common case stays six characters
 * forever; only repeatedly inserting *between the same two rows* grows a key,
 * and it grows by one character per split.
 *
 * **Concurrency.** Two clients dropping a page into the same slot compute the
 * same key from the same neighbours. That is a tie, not a corruption — every
 * ordered query sorts by `(ord, id)`, so the tie resolves identically for
 * everyone and no repair pass is needed. This is the property the alternative
 * (integer positions with renumbering) cannot offer: there, two concurrent
 * inserts silently overwrite each other's shifts.
 *
 * **Collation is load-bearing.** These keys mix digits and both letter cases,
 * and `en_US.UTF-8` does not order those the way JavaScript's string
 * comparison does — it folds case and ignores punctuation, so `V00001.l` and
 * `V00002` can come back in the opposite order to the one computed here. The
 * column is therefore declared `COLLATE "C"`. Anything that stores an order
 * key must do the same.
 */

/** Base-62, in ASCII order — so digit order and byte order are the same thing. */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/** Fixed width of the integer part. 62^6 ≈ 5.7e10 slots in either direction. */
const INT_WIDTH = 6;

/**
 * Separator between integer and fraction. `.` is below every base-62 digit in
 * ASCII, which is exactly right: `V00001` < `V00001.5` < `V00002`.
 */
const SEP = ".";

/**
 * The first key in an empty group. Starts mid-range rather than at zero so
 * that prepending is as cheap as appending — a first page created at `000000`
 * would leave nowhere to put the page that belongs above it.
 */
export const ORDER_KEY_START = "V00000";

const KEY_PATTERN = /^[0-9A-Za-z]{6}(\.[0-9A-Za-z]*[1-9A-Za-z])?$/;

/** Whether a string is a well-formed, canonical order key. */
export function isOrderKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

function encodeInt(value: number): string {
  if (value < 0 || value >= BASE ** INT_WIDTH) {
    throw new RangeError("order key integer part exhausted");
  }
  let out = "";
  let rest = value;
  for (let i = 0; i < INT_WIDTH; i++) {
    out = DIGITS[rest % BASE] + out;
    rest = Math.floor(rest / BASE);
  }
  return out;
}

function decodeInt(text: string): number {
  let value = 0;
  for (const char of text) value = value * BASE + DIGITS.indexOf(char);
  return value;
}

function split(key: string): { int: string; frac: string } {
  if (!isOrderKey(key)) throw new TypeError(`not an order key: ${key}`);
  const at = key.indexOf(SEP);
  return at < 0 ? { int: key, frac: "" } : { int: key.slice(0, at), frac: key.slice(at + 1) };
}

function join(int: string, frac: string): string {
  return frac === "" ? int : int + SEP + frac;
}

/**
 * A fraction strictly between `a` and `b`, both read as digits after an
 * implied "0." — `b === null` means 1. Canonical form never ends in the zero
 * digit, which is what keeps one position from having two spellings.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new RangeError(`fractions out of order: ${a} >= ${b}`);
  if (a.endsWith("0") || (b !== null && b.endsWith("0"))) {
    throw new TypeError("fraction is not canonical (trailing zero digit)");
  }

  if (b !== null) {
    // Shared leading digits are not a choice — recurse past them.
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }

  const digitA = a === "" ? 0 : DIGITS.indexOf(a[0]);
  const digitB = b === null ? BASE : DIGITS.indexOf(b[0]);

  // Room between the two first digits: take it and stop.
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)];

  // Adjacent digits. If b has more to it, b's own first digit already sits
  // above a and below b.
  if (b !== null && b.length > 1) return b.slice(0, 1);

  // Otherwise descend into a's tail, which is always < 1.
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

/**
 * A key strictly between two neighbours. `null` means "no neighbour on that
 * side" — `orderKeyBetween(null, null)` is the first key in an empty group,
 * `orderKeyBetween(last, null)` appends, `orderKeyBetween(null, first)`
 * prepends.
 */
export function orderKeyBetween(before: string | null, after: string | null): string {
  if (before === null) {
    if (after === null) return ORDER_KEY_START;
    // Anything below the neighbour's integer is below the neighbour, and
    // nothing else is down there — this is the first row in the group.
    return encodeInt(decodeInt(split(after).int) - 1);
  }

  if (after === null) return encodeInt(decodeInt(split(before).int) + 1);

  if (before >= after) throw new RangeError(`order keys out of order: ${before} >= ${after}`);

  const a = split(before);
  const b = split(after);
  const intA = decodeInt(a.int);
  const intB = decodeInt(b.int);

  // Same integer: the whole answer is in the fraction.
  if (intA === intB) return join(a.int, midpoint(a.frac, b.frac === "" ? null : b.frac));

  // A whole integer is free between them: use it and keep the key short.
  if (intB - intA > 1) return encodeInt(intA + 1);

  // Adjacent integers: extend the lower one's fraction. Any key on `intA`
  // sorts below every key on `intB`, so the upper neighbour is not consulted.
  return join(a.int, midpoint(a.frac, null));
}

/**
 * `count` keys after `before`, in order. Used where a batch of siblings is
 * created at once (import, subtree copy): generating them one at a time
 * through `orderKeyBetween(prev, null)` is the same thing, and each one is a
 * plain integer increment, so a thousand imported pages stay six characters
 * wide rather than growing a fraction per page.
 */
export function orderKeysAfter(before: string | null, count: number): string[] {
  const keys: string[] = [];
  let previous = before;
  for (let i = 0; i < count; i++) {
    previous = orderKeyBetween(previous, null);
    keys.push(previous);
  }
  return keys;
}
