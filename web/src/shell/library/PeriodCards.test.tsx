import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryPeriodBucket } from "../../api";
import PeriodCardGrid from "./PeriodCards";
import { buildPeriodCards } from "./rows";

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

const YEARS: SummaryPeriodBucket[] = [
  { key: "2005", count: 9, key_asset_ids: ["y05"] },
  { key: "2007", count: 1, key_asset_ids: ["y07"] },
  { key: "2024", count: 1200, key_asset_ids: ["y24"] },
];
const MONTHS: SummaryPeriodBucket[] = [
  { key: "2007-01", count: 3, key_asset_ids: ["m0701"] },
  { key: "2007-02", count: 2, key_asset_ids: [] },
];

describe("buildPeriodCards (#307)", () => {
  it("keeps the server's oldest-first order and labels years and months", () => {
    expect(buildPeriodCards(YEARS, "years").map((c) => c.label)).toEqual(["2005", "2007", "2024"]);
    expect(buildPeriodCards(MONTHS, "months").map((c) => c.label)).toEqual(["Jan 2007", "Feb 2007"]);
  });
});

function renderGrid(view: "years" | "months", buckets: SummaryPeriodBucket[], extra: Partial<Parameters<typeof PeriodCardGrid>[0]> = {}) {
  const scroller = document.createElement("div");
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 5000 });
  const scrollRef = createRef<HTMLElement>() as { current: HTMLElement | null };
  scrollRef.current = scroller;
  const onOpen = vi.fn();
  const result = render(
    <PeriodCardGrid libraryId={1} view={view} cards={buildPeriodCards(buckets, view)} scrollRef={scrollRef} onOpen={onOpen} {...extra} />,
    { container: scroller.appendChild(document.createElement("div")) },
  );
  return { ...result, scroller, onOpen };
}

describe("PeriodCardGrid (#307)", () => {
  it("renders one card per bucket, oldest first, with the label in the card", () => {
    renderGrid("years", YEARS);
    const cards = screen.getAllByTestId("period-card");
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.getAttribute("data-period-key"))).toEqual(["2005", "2007", "2024"]);
    expect(cards[0]).toHaveTextContent("2005");
    expect(cards[2]).toHaveAccessibleName("2024, 1,200 Items");
    expect(cards[1]).toHaveAccessibleName("2007, 1 Item");
  });

  it("uses the sharp grid2x thumbnail of the key photo, and no request for cards without one", () => {
    renderGrid("months", MONTHS);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("/api/libraries/1/thumb/m0701?size=grid2x");
  });

  it("opens scrolled all the way down to the newest card", () => {
    const { scroller } = renderGrid("years", YEARS);
    expect(scroller.scrollTop).toBe(5000);
  });

  it("lands on the first card of a year when asked, instead of the bottom", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const onLanded = vi.fn();
    const { scroller } = renderGrid("months", MONTHS, { landOnKey: "2007", onLanded });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toHaveAttribute("data-period-key", "2007-01");
    expect(scroller.scrollTop).toBe(0);
    expect(onLanded).toHaveBeenCalled();
  });

  it("clicking a card reports its key", () => {
    const { onOpen } = renderGrid("years", YEARS);
    fireEvent.click(screen.getByText("2007"));
    expect(onOpen).toHaveBeenCalledWith("2007");
  });
});
