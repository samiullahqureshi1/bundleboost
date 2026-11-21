import { numericId, parseConfig, type QuantityBreakConfig } from "./config";

/**
 * Input/output shapes for the cart.lines.discounts.generate.run target,
 * matching src/cart_lines_discounts_generate_run.graphql. Declared locally so
 * the logic is testable without generated types; `shopify app function
 * typegen` produces the equivalent types in generated/api.ts.
 */
export type CartLinesDiscountsGenerateRunInput = {
  presentmentCurrencyRate: string;
  cart: {
    lines: {
      id: string;
      quantity: number;
      merchandise:
        | { __typename: "ProductVariant"; id: string; product: { id: string } }
        | { __typename: "CustomProduct" };
    }[];
  };
  discount: {
    discountClasses: ("ORDER" | "PRODUCT" | "SHIPPING")[];
    metafield?: { jsonValue: unknown } | null;
  };
};

type ProductDiscountCandidate = {
  message?: string;
  targets: { cartLine: { id: string } }[];
  value:
    | { percentage: { value: string } }
    | { fixedAmount: { amount: string; appliesToEachItem: boolean } };
};

type ProductDiscountsAddOperation = {
  productDiscountsAdd: {
    candidates: ProductDiscountCandidate[];
    selectionStrategy: "ALL";
  };
};

export type CartLinesDiscountsGenerateRunResult = {
  operations: ProductDiscountsAddOperation[];
};

const NO_CHANGES: CartLinesDiscountsGenerateRunResult = { operations: [] };

/**
 * Quantity breaks: eligible lines are grouped by product, quantities summed
 * across that product's eligible variants ("buy 3 of any size"), and the
 * highest tier reached is applied to every eligible line in the group.
 *
 * Output is a single productDiscountsAdd operation with one candidate per
 * tier reached (at most 10). Candidates target disjoint cart lines, so
 * selectionStrategy ALL applies each one. Keeping the output this small
 * matters: in JavaScript, every emitted operation costs ~90k instructions.
 */
export function cartLinesDiscountsGenerateRun(
  input: CartLinesDiscountsGenerateRunInput,
): CartLinesDiscountsGenerateRunResult {
  if (!input.discount.discountClasses.includes("PRODUCT")) return NO_CHANGES;
  const config = parseConfig(input.discount.metafield?.jsonValue);
  if (!config) return NO_CHANGES;

  // productId -> eligible line ids and summed quantity
  const groups: Record<string, { lineIds: string[]; quantity: number }> = {};
  const productIds: string[] = [];
  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;
    const productId = numericId(merchandise.product.id);
    const allowedVariants = config.p[productId];
    if (!allowedVariants) continue;
    if (
      allowedVariants.length > 0 &&
      !allowedVariants.includes(numericId(merchandise.id))
    ) {
      continue;
    }
    let group = groups[productId];
    if (!group) {
      group = groups[productId] = { lineIds: [], quantity: 0 };
      productIds.push(productId);
    }
    group.lineIds.push(line.id);
    group.quantity += line.quantity;
  }

  // tier index -> targets of every product group that reached it
  const targetsByTier: { cartLine: { id: string } }[][] = [];
  for (const productId of productIds) {
    const group = groups[productId];
    const tierIndex = highestTierIndex(config, group.quantity);
    if (tierIndex < 0) continue;
    const targets = (targetsByTier[tierIndex] ??= []);
    for (const id of group.lineIds) targets.push({ cartLine: { id } });
  }

  const rate = Number(input.presentmentCurrencyRate) || 1;
  const candidates: ProductDiscountCandidate[] = [];
  targetsByTier.forEach((targets, tierIndex) => {
    if (!targets) return;
    candidates.push({
      ...(config.m ? { message: config.m } : {}),
      targets,
      value: discountValue(config, config.tiers[tierIndex][1], rate),
    });
  });
  if (!candidates.length) return NO_CHANGES;

  return {
    operations: [{ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } }],
  };
}

function highestTierIndex(config: QuantityBreakConfig, quantity: number) {
  let match = -1;
  for (let i = 0; i < config.tiers.length; i++) {
    if (quantity >= config.tiers[i][0]) match = i;
  }
  return match;
}

function discountValue(config: QuantityBreakConfig, value: string, rate: number) {
  if (config.t === "P") {
    return { percentage: { value: Math.min(Number(value), 100).toString() } };
  }
  // Fixed amounts are configured in the shop currency; convert to the
  // buyer's presentment currency.
  return {
    fixedAmount: {
      amount: (Number(value) * rate).toFixed(2),
      appliesToEachItem: true,
    },
  };
}
