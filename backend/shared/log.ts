export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
const SENSITIVE_KEY = /authorization|password|secret|token|api[_-]?key|cookie|code_verifier/i;
const SENSITIVE_VALUE = [/Bearer\s+\S+/gi, /APP_USR-[\w-]+/g, /\bTG-[\w-]+/g];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === "string") {
    return SENSITIVE_VALUE.reduce((text, pattern) => text.replace(pattern, REDACTED), value);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1) };
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map((
        [key, item],
      ) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1)]),
    );
  }
  return value;
}

export function createLogger(
  base: LogFields = {},
  write: (line: string) => void = (line) => console.log(line),
  now: () => Date = () => new Date(),
): Logger {
  const emit = (level: LogLevel, event: string, fields: LogFields = {}) => {
    write(JSON.stringify(redact({ ts: now().toISOString(), level, event, ...base, ...fields })));
  };
  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (fields) => createLogger({ ...base, ...fields }, write, now),
  };
}
