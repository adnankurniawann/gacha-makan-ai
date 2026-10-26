/**
 * Weighted random selection utility.
 * Pure function — no side effects, no database or I/O operations.
 */

/**
 * Name recorded in `spin_events.policy` for results this module selects.
 *
 * It deliberately does NOT say `uniform_random`. Selection here is weighted by
 * how far under budget a place is, so cheaper places are shown more often.
 * Labelling that as uniform would corrupt every later comparison: a bandit
 * trained on this data would treat a selection bias it never saw as if it were
 * an even draw, and conclude cheap places are more popular than they are.
 *
 * Change this string whenever the selection rule changes, so rows from the old
 * and new behaviour stay separable.
 */
export const SPIN_POLICY = "weighted_budget_v1";

/**
 * Calculates spin weights from candidate items and the user's budget.
 *
 * The weight is `max(1, budget - price_tier)` so every candidate keeps a
 * minimum chance while cheaper items still get a larger share.
 */
export function calculateSpinWeights<T extends { price_tier: number }>(
  items: T[],
  budget: number
): number[] {
  return items.map((item) => Math.max(1, budget - item.price_tier));
}

/**
 * Selects one item from `items` using weighted random selection.
 *
 * @param items   Non-empty array of items to select from.
 * @param weights Parallel array of numeric weights (must have at least one positive value).
 * @returns       One element from `items`, chosen proportionally to its weight.
 *
 * @throws Error if `items` or `weights` is empty.
 * @throws Error if `items.length !== weights.length`.
 * @throws Error if all weights are ≤ 0.
 */
export function weightedRandom<T>(items: T[], weights: number[]): T {
  if (items.length === 0) {
    throw new Error(
      "weightedRandom: 'items' array must not be empty."
    );
  }

  if (weights.length === 0) {
    throw new Error(
      "weightedRandom: 'weights' array must not be empty."
    );
  }

  if (items.length !== weights.length) {
    throw new Error(
      `weightedRandom: 'items' and 'weights' must have the same length, ` +
        `but got items.length=${items.length} and weights.length=${weights.length}.`
    );
  }

  return items[weightedRandomIndex(weights)];
}

/**
 * Same draw as `weightedRandom`, but returns the index it landed on.
 *
 * Needed because the caller has to know *which* candidate was drawn in order
 * to record the probability that draw had — see `selectionPropensity`.
 *
 * @throws Error if `weights` is empty or every weight is ≤ 0.
 */
export function weightedRandomIndex(weights: number[]): number {
  if (weights.length === 0) {
    throw new Error("weightedRandomIndex: 'weights' array must not be empty.");
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    throw new Error(
      "weightedRandomIndex: all weights are ≤ 0; at least one weight must be positive."
    );
  }

  // Cumulative weight selection
  let random = Math.random() * totalWeight;

  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return i;
    }
  }

  // Fallback: return the last index (handles floating-point edge cases)
  return weights.length - 1;
}

/**
 * Probability that this policy would draw `index` from `weights`.
 *
 * This number is what makes the logs usable for honest offline evaluation.
 * Unbiased replay assumes every candidate had an equal chance; ours did not,
 * because cheaper places carry more weight. Recording the actual probability
 * lets a later evaluation divide it back out (inverse propensity scoring)
 * instead of quietly inheriting a bias nobody accounted for.
 *
 * Without it, the only honest options later are to throw the logs away or to
 * publish a number that is wrong in a direction we cannot even estimate.
 *
 * @returns A value in (0, 1]. Returns 0 when the weights are unusable.
 */
export function selectionPropensity(weights: number[], index: number): number {
  if (index < 0 || index >= weights.length) return 0;

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return 0;

  return weights[index] / totalWeight;
}
