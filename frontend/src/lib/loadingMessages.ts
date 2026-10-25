// Small easter egg: every so often, swap the boring loading copy for
// something that has nothing to do with streaming. Shh.

const FUN_LOADING_MESSAGE = 'Picking orchids...';

/**
 * Returns `defaultMessage` most of the time, but occasionally swaps in
 * the fun message instead. Call once per mount (e.g. via a lazy
 * useState initializer) so it doesn't change mid-render.
 */
export function getLoadingMessage(defaultMessage: string, funChance = 0.99): string {
  return Math.random() < funChance ? FUN_LOADING_MESSAGE : defaultMessage;
}
