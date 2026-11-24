import { type FeeRule, unitContribution } from "../finance/contribution.ts";
import { applyRate, assertBps, assertCents, BPS_SCALE, rateOf } from "../finance/rates.ts";

export interface StressScenario {
  costIncreaseBps: number;
  feeIncreaseBps: number;
  returnRateBps: number;
}

export interface Economics {
  priceCents: number;
  unitCostCents: number;
  supplierShippingCents: number;
  sellerShippingCents: number;
  taxBps: number;
  fee: FeeRule;
}

export interface MarketSignals {
  weeksObserved: number;
  weeksInRanking: number;
  bestPosition: number | null;
  competitors: number;
  competitorsWithFulfillment: number;
  officialStoreCompeting: boolean;
}

export interface ScoreInput {
  economics: Economics;
  stress: StressScenario;
  market: MarketSignals;
  targetMarginBps: number;
}

export interface ScoreBreakdown {
  viable: boolean;
  stressedContributionCents: number;
  stressedMarginBps: number | null;
  marginPoints: number;
  demandPoints: number;
  competitionPoints: number;
  returnPoints: number;
  totalPoints: number;
}

const WEIGHTS = { margin: 4_000, demand: 3_000, competition: 2_000, returns: 1_000 } as const;
const MAX_COMPETITORS = 50;
const MAX_RETURN_RATE_BPS = 2_000;

function clampBps(value: number): number {
  return Math.min(BPS_SCALE, Math.max(0, value));
}

export interface CostInputs {
  priceCents: number;
  unitCostCents: number | null;
  supplierShippingCents: number | null;
  sellerShippingCents: number | null;
  taxBps: number | null;
  fee: FeeRule | null;
}

export function economicsFrom(inputs: CostInputs): Economics | null {
  const { unitCostCents, supplierShippingCents, sellerShippingCents, taxBps, fee } = inputs;
  if (
    unitCostCents === null || supplierShippingCents === null || sellerShippingCents === null ||
    taxBps === null || fee === null
  ) {
    return null;
  }
  return {
    priceCents: inputs.priceCents,
    unitCostCents,
    supplierShippingCents,
    sellerShippingCents,
    taxBps,
    fee,
  };
}

export function stressedContribution(economics: Economics, stress: StressScenario): number {
  for (const value of [stress.costIncreaseBps, stress.feeIncreaseBps, stress.returnRateBps]) {
    assertBps(value, "stress");
  }
  const unitCostCents = economics.unitCostCents +
    applyRate(economics.unitCostCents, stress.costIncreaseBps);
  const fee: FeeRule = {
    percentageBps: Math.min(BPS_SCALE, economics.fee.percentageBps + stress.feeIncreaseBps),
    fixedCents: economics.fee.fixedCents,
  };
  const contribution = unitContribution(economics.priceCents, {
    unitCostCents,
    supplierShippingCents: economics.supplierShippingCents,
    sellerShippingCents: economics.sellerShippingCents,
    taxBps: economics.taxBps,
    targetMarginBps: 0,
    fees: () => fee,
  });
  const lossPerReturn = 2 * economics.sellerShippingCents + economics.supplierShippingCents;
  return contribution - applyRate(lossPerReturn, stress.returnRateBps);
}

function demandShare(market: MarketSignals): number {
  if (market.weeksObserved <= 0 || market.weeksInRanking <= 0) return 0;
  const persistence = Math.floor(
    (Math.min(market.weeksInRanking, market.weeksObserved) * BPS_SCALE) / market.weeksObserved,
  );
  const position = market.bestPosition === null
    ? 0
    : Math.floor(((21 - Math.min(20, Math.max(1, market.bestPosition))) * BPS_SCALE) / 20);
  return Math.floor((persistence * 7 + position * 3) / 10);
}

function competitionShare(market: MarketSignals): number {
  const crowd = BPS_SCALE -
    Math.floor((Math.min(market.competitors, MAX_COMPETITORS) * BPS_SCALE) / MAX_COMPETITORS);
  const fulfillment = market.competitors === 0
    ? BPS_SCALE
    : BPS_SCALE - Math.floor((market.competitorsWithFulfillment * BPS_SCALE) / market.competitors);
  const official = market.officialStoreCompeting ? 0 : BPS_SCALE;
  return Math.floor((crowd * 5 + clampBps(fulfillment) * 3 + official * 2) / 10);
}

export function scoreProduct(input: ScoreInput): ScoreBreakdown {
  assertCents(input.economics.priceCents, "priceCents");
  assertBps(input.targetMarginBps, "targetMarginBps");
  const contribution = stressedContribution(input.economics, input.stress);
  const margin = rateOf(contribution, input.economics.priceCents);
  const viable = margin !== null && margin >= input.targetMarginBps;
  const marginShare = margin === null ? 0 : clampBps(Math.floor((margin * BPS_SCALE) / 4_000));
  const returnShare = BPS_SCALE -
    Math.floor(
      (Math.min(input.stress.returnRateBps, MAX_RETURN_RATE_BPS) * BPS_SCALE) /
        MAX_RETURN_RATE_BPS,
    );
  const points = {
    marginPoints: Math.floor((marginShare * WEIGHTS.margin) / BPS_SCALE),
    demandPoints: Math.floor((demandShare(input.market) * WEIGHTS.demand) / BPS_SCALE),
    competitionPoints: Math.floor(
      (competitionShare(input.market) * WEIGHTS.competition) / BPS_SCALE,
    ),
    returnPoints: Math.floor((returnShare * WEIGHTS.returns) / BPS_SCALE),
  };
  return {
    viable,
    stressedContributionCents: contribution,
    stressedMarginBps: margin,
    ...points,
    totalPoints: viable
      ? points.marginPoints + points.demandPoints + points.competitionPoints + points.returnPoints
      : 0,
  };
}

export function rankProducts<T extends { score: ScoreBreakdown }>(candidates: T[]): T[] {
  return candidates
    .filter((candidate) => candidate.score.viable)
    .sort((a, b) =>
      b.score.totalPoints - a.score.totalPoints ||
      b.score.stressedContributionCents - a.score.stressedContributionCents
    );
}
