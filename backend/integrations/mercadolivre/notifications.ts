import { ContractError } from "../../shared/errors.ts";

export const SUPPORTED_TOPICS = [
  "orders_v2",
  "shipments",
  "questions",
  "messages",
  "items",
  "post_purchase",
] as const;

export type Topic = typeof SUPPORTED_TOPICS[number];

export interface Notification {
  topic: Topic;
  resource: string;
  userId: number;
  applicationId: number;
  attempts: number;
  sentAt: string;
  actions: string[];
}

const NOTIFICATION_SOURCE_IPS = new Set([
  "44.212.211.213",
  "52.1.149.176",
  "52.44.99.39",
  "52.2.210.204",
  "52.6.145.31",
  "54.205.100.116",
  "184.73.213.131",
  "52.6.10.186",
  "52.73.233.211",
  "3.223.169.202",
  "34.206.9.12",
  "34.238.55.98",
  "3.227.34.138",
  "3.229.206.80",
  "34.238.221.21",
  "13.223.211.78",
  "44.215.49.123",
  "54.159.49.50",
  "13.223.10.233",
  "13.223.33.60",
  "3.93.112.28",
  "13.223.124.243",
  "3.233.174.68",
  "50.16.251.125",
  "50.16.65.64",
  "54.81.195.49",
  "54.82.205.180",
  "3.94.30.241",
  "54.242.75.139",
  "98.82.195.215",
  "34.196.28.113",
  "44.208.170.246",
  "52.23.122.60",
  "13.223.232.16",
  "13.223.236.125",
  "44.193.180.190",
  "13.223.107.11",
  "3.219.157.78",
  "3.230.160.247",
  "13.223.154.1",
  "44.214.161.82",
  "54.196.88.69",
  "100.24.130.185",
  "3.230.190.19",
  "35.172.55.95",
  "23.22.202.234",
  "3.95.35.84",
  "54.146.232.68",
  "13.223.135.7",
  "52.71.11.70",
  "54.173.9.186",
  "100.29.255.54",
  "34.203.95.8",
  "52.7.171.45",
  "3.225.202.17",
  "34.204.236.214",
  "52.200.170.172",
  "34.197.223.209",
  "50.17.138.96",
  "54.84.11.70",
  "3.88.83.19",
  "52.86.119.98",
  "54.88.119.105",
  "13.223.210.67",
  "54.160.66.146",
  "54.236.191.153",
  "13.223.210.140",
  "44.212.229.114",
  "52.204.14.181",
  "34.192.190.219",
  "44.207.104.38",
  "52.200.84.58",
  "35.221.4.79",
  "34.86.252.100",
  "34.145.201.132",
  "34.21.78.254",
  "34.86.6.77",
  "35.245.10.147",
  "35.236.212.3",
  "136.107.43.234",
  "34.48.38.213",
  "35.221.39.135",
  "34.48.138.13",
  "35.221.12.66",
  "54.88.218.97",
  "18.215.140.160",
  "18.213.114.129",
  "18.206.34.84",
  "35.236.253.169",
  "35.245.91.34",
  "35.245.20.104",
  "35.186.182.146",
]);

export function isNotificationSource(ip: string | null): boolean {
  return ip !== null && NOTIFICATION_SOURCE_IPS.has(ip.trim());
}

export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

function field<T>(body: Record<string, unknown>, key: string, check: (v: unknown) => v is T): T {
  const value = body[key];
  if (!check(value)) throw new ContractError(`notification.${key}`, "missing or invalid");
  return value;
}

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isId = (v: unknown): v is number | string =>
  (typeof v === "number" && Number.isSafeInteger(v) && v > 0) ||
  (typeof v === "string" && /^\d{1,16}$/.test(v) && Number.isSafeInteger(Number(v)));
const isTopic = (v: unknown): v is Topic =>
  typeof v === "string" && (SUPPORTED_TOPICS as readonly string[]).includes(v);

export function parseNotification(body: unknown): Notification {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ContractError("notification", "expected an object");
  }
  const record = body as Record<string, unknown>;
  const resource = field(record, "resource", isString);
  if (resource.length > 300 || /\s/.test(resource)) {
    throw new ContractError("notification.resource", "invalid format");
  }
  const sent = field(record, "sent", isString);
  if (Number.isNaN(Date.parse(sent))) throw new ContractError("notification.sent", "invalid date");
  const attempts = record.attempts;
  const actions = record.actions;
  return {
    topic: field(record, "topic", isTopic),
    resource,
    userId: Number(field(record, "user_id", isId)),
    applicationId: Number(field(record, "application_id", isId)),
    attempts: typeof attempts === "number" && Number.isInteger(attempts) ? attempts : 1,
    sentAt: new Date(sent).toISOString(),
    actions: Array.isArray(actions) ? actions.filter(isString) : [],
  };
}
