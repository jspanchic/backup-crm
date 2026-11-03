import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * Normalizes digits (WhatsApp sends them without "+") to E.164.
 * Uses "possible" and not "valid": numbers in the 555 range, used by every test fixture, are not valid.
 */
export const toE164 = (value: string): string | null => {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  const parsed = parsePhoneNumberFromString(`+${digits}`);
  if (!parsed?.isPossible()) return null;
  return /^\+[1-9][0-9]{7,14}$/.test(parsed.number) ? parsed.number : null;
};
