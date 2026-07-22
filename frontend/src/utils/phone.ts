const EMPTY_PHONE_MASK = "—";
const INVALID_PHONE_MASK = "手机号格式无效";

export function hasFilledPhone(phoneMasked?: string | null): boolean {
  const value = (phoneMasked || "").trim();
  return Boolean(value && value !== EMPTY_PHONE_MASK && value !== INVALID_PHONE_MASK);
}

export function formatPhoneMasked(phoneMasked?: string | null, emptyLabel = "未填写手机号"): string {
  return hasFilledPhone(phoneMasked) ? phoneMasked!.trim() : emptyLabel;
}
