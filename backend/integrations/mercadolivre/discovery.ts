import { ContractError } from "../../shared/errors.ts";

export const HIGHLIGHT_TYPES = ["ITEM", "PRODUCT", "USER_PRODUCT"] as const;
export type HighlightType = typeof HIGHLIGHT_TYPES[number];

export interface Highlight {
  id: string;
  position: number;
  type: HighlightType;
}

export interface CategoryHighlights {
  categoryId: string;
  entries: Highlight[];
}

export type TrendGroup = "fastest_growing" | "most_wanted" | "most_popular";

export interface Trend {
  keyword: string;
  rank: number;
  group: TrendGroup;
}

const CATEGORY = /^MLB\d+$/;

export function highlightsPath(categoryId: string): string {
  if (!CATEGORY.test(categoryId)) throw new RangeError("invalid category_id");
  return `/highlights/MLB/category/${categoryId}`;
}

export function trendsPath(categoryId?: string): string {
  if (categoryId === undefined) return "/trends/MLB";
  if (!CATEGORY.test(categoryId)) throw new RangeError("invalid category_id");
  return `/trends/MLB/${categoryId}`;
}

export function mapHighlights(raw: unknown): CategoryHighlights {
  const body = raw as { query_data?: { id?: unknown }; content?: unknown } | null;
  const categoryId = body?.query_data?.id;
  if (typeof categoryId !== "string" || !CATEGORY.test(categoryId)) {
    throw new ContractError("highlights.query_data.id", "invalid category");
  }
  if (!Array.isArray(body?.content)) {
    throw new ContractError("highlights.content", "expected an array");
  }
  const entries = body.content.map((entry, index): Highlight => {
    const path = `highlights.content[${index}]`;
    const value = entry as Record<string, unknown> | null;
    if (typeof value?.id !== "string" || !/^MLBU?\d+$/.test(value.id)) {
      throw new ContractError(`${path}.id`, "invalid id");
    }
    if (!Number.isInteger(value.position) || (value.position as number) < 1) {
      throw new ContractError(`${path}.position`, "invalid position");
    }
    if (!(HIGHLIGHT_TYPES as readonly unknown[]).includes(value.type)) {
      throw new ContractError(`${path}.type`, "unknown type");
    }
    return { id: value.id, position: value.position as number, type: value.type as HighlightType };
  });
  return { categoryId, entries: entries.sort((a, b) => a.position - b.position) };
}

function trendGroup(index: number): TrendGroup {
  if (index < 10) return "fastest_growing";
  if (index < 30) return "most_wanted";
  return "most_popular";
}

export function mapTrends(raw: unknown): Trend[] {
  if (!Array.isArray(raw)) throw new ContractError("trends", "expected an array");
  return raw.map((entry, index) => {
    const keyword = (entry as Record<string, unknown> | null)?.keyword;
    if (typeof keyword !== "string" || keyword.trim().length === 0 || keyword.length > 120) {
      throw new ContractError(`trends[${index}].keyword`, "invalid keyword");
    }
    return { keyword: keyword.trim().toLowerCase(), rank: index + 1, group: trendGroup(index) };
  });
}
