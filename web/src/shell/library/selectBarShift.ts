// The Library opens at its end (#224). When the Select bar first appears its
// height becomes bottom padding, and the grid scrolls by that much so the
// newest row stays above it. Later growth of the bar (the caption and HEIC
// row that appear with the first selected tile) must not move the grid: it
// would slide the tiles out from under a finger that is swipe-selecting (#222).
export function shouldKeepEndAboveBar(
  previousHeight: number,
  height: number,
  oldestFirst: boolean,
  distanceFromEnd: number,
): boolean {
  const delta = height - previousHeight;
  if (!oldestFirst || previousHeight !== 0 || delta <= 0) return false;
  return distanceFromEnd <= delta + 2;
}
