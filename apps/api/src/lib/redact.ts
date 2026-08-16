const secretKeys = /authorization|cookie|password|secret|token|api[-_]?key/i;
const secretValue = /(sk-[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,})/gi;

export function safeLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeLogValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      secretKeys.test(key) ? "[REDACTED]" : safeLogValue(item),
    ]));
  }
  return typeof value === "string" ? value.replace(secretValue, "[REDACTED]") : value;
}
