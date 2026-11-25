import {
  type OperationalLimits,
  type ProductCandidate,
  productRejections,
  type Rejection,
  type SupplierCandidate,
  supplierRejections,
} from "./eligibility.ts";
import { type Kit, type KitRejection, kitRejections } from "./kits.ts";
import { rankProducts, type ScoreBreakdown, type ScoreInput, scoreProduct } from "./score.ts";
import { type SeasonPhase, seasonPhase, type SeasonWindow } from "./seasonal.ts";

export interface Candidate {
  key: string;
  title: string;
  supplierId: string;
  product: ProductCandidate;
  supplier: SupplierCandidate;
  scoring: ScoreInput | null;
  season?: SeasonWindow;
  kit?: Kit;
}

export type Reason = Rejection | KitRejection | "missing_costs" | "off_season" | "not_viable";

export interface Evaluation {
  key: string;
  title: string;
  supplierId: string;
  phase: SeasonPhase | null;
  reasons: Reason[];
  score: ScoreBreakdown | null;
}

export interface WeeklySelection {
  week: string;
  recommended: (Evaluation & { score: ScoreBreakdown })[];
  deferred: Evaluation[];
  rejected: Evaluation[];
}

const SAO_PAULO_OFFSET_MS = -3 * 3_600_000;
const DAY_MS = 86_400_000;

export function weekOf(at: Date): string {
  const local = at.getTime() + SAO_PAULO_OFFSET_MS;
  if (Number.isNaN(local)) throw new RangeError("invalid date");
  const midnight = Math.floor(local / DAY_MS) * DAY_MS;
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return new Date(midnight - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export function evaluate(candidate: Candidate, limits: OperationalLimits, at: Date): Evaluation {
  const reasons: Reason[] = [
    ...productRejections(candidate.product, limits),
    ...supplierRejections(candidate.supplier, limits),
  ];
  if (candidate.kit) reasons.push(...kitRejections(candidate.kit));
  const phase = candidate.season ? seasonPhase(candidate.season, at) : null;
  if (phase === "off_season") reasons.push("off_season");
  let score: ScoreBreakdown | null = null;
  if (candidate.scoring === null) reasons.push("missing_costs");
  else {
    score = scoreProduct(candidate.scoring);
    if (!score.viable) reasons.push("not_viable");
  }
  return {
    key: candidate.key,
    title: candidate.title,
    supplierId: candidate.supplierId,
    phase,
    reasons: [...new Set(reasons)],
    score,
  };
}

export function weeklySelection(
  candidates: Candidate[],
  limits: OperationalLimits,
  at: Date,
  maxRecommendations: number,
): WeeklySelection {
  if (!Number.isInteger(maxRecommendations) || maxRecommendations < 1) {
    throw new RangeError("maxRecommendations must be a positive integer");
  }
  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (keys.has(candidate.key)) throw new RangeError(`duplicate candidate ${candidate.key}`);
    keys.add(candidate.key);
  }
  const evaluations = candidates.map((candidate) => evaluate(candidate, limits, at));
  const eligible = evaluations.filter((e): e is Evaluation & { score: ScoreBreakdown } =>
    e.reasons.length === 0 && e.score !== null
  );
  const ranked = rankProducts(eligible);
  return {
    week: weekOf(at),
    recommended: ranked.slice(0, maxRecommendations),
    deferred: ranked.slice(maxRecommendations),
    rejected: evaluations.filter((e) => e.reasons.length > 0),
  };
}

export interface SelectionRow {
  product_key: string;
  title: string;
  supplier_id: string | null;
  season_phase: SeasonPhase | null;
  total_points: number | null;
  stressed_margin_bps: number | null;
  stressed_contribution_cents: number | null;
  reasons: Reason[];
  status: "recommended" | "deferred" | "rejected";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function row(evaluation: Evaluation, status: SelectionRow["status"]): SelectionRow {
  return {
    product_key: evaluation.key,
    title: evaluation.title,
    supplier_id: UUID.test(evaluation.supplierId) ? evaluation.supplierId : null,
    season_phase: evaluation.phase,
    total_points: evaluation.score?.totalPoints ?? null,
    stressed_margin_bps: evaluation.score?.stressedMarginBps ?? null,
    stressed_contribution_cents: evaluation.score?.stressedContributionCents ?? null,
    reasons: evaluation.reasons,
    status,
  };
}

export function selectionRows(selection: WeeklySelection): SelectionRow[] {
  return [
    ...selection.recommended.map((e) => row(e, "recommended")),
    ...selection.deferred.map((e) => row(e, "deferred")),
    ...selection.rejected.map((e) => row(e, "rejected")),
  ];
}
