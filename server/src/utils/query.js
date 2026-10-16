export function queryInteger(value, { fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined) return fallback;
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < min) {
    const error = new Error(`Expected an integer greater than or equal to ${min}`);
    error.status = 400;
    throw error;
  }
  return Math.min(number, max);
}
