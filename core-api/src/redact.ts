export const CARD_PLACEHOLDER = "[TARJETA REDACTADA]";

const luhn = (digits: string): boolean => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
};

// 13 to 19 digits, optionally grouped with spaces or dashes. Not part of a longer number.
const CANDIDATE = /(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g;

/** Replaces payment card numbers (Luhn) before anything is stored or sent to the model. */
export const redactCards = (text: string): string =>
  text.replace(CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? CARD_PLACEHOLDER : match;
  });
