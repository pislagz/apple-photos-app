import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryPeriodBucket } from "../../api";
import PeriodCardGrid, { pickThumbSize } from "./PeriodCards";
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

function renderGrid(view: "years" | "months" | "days", buckets: SummaryPeriodBucket[], extra: Partial<Parameters<typeof PeriodCardGrid>[0]> = {}) {
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

describe("pickThumbSize (#301)", () => {
  it("never upscales: picks the smallest size covering the card at the device pixel ratio", () => {
    expect(pickThumbSize(150, 1)).toBe("grid");
    expect(pickThumbSize(170, 2)).toBe("grid2x");
    expect(pickThumbSize(170, 3)).toBe("grid2x");
    expect(pickThumbSize(300, 2)).toBe("grid2x");
    expect(pickThumbSize(320, 3)).toBe("preview");
  });
});

describe("Day cards (#301)", () => {
  const DAYS: SummaryPeriodBucket[] = [
    { key: "2022-05-12", count: 9, key_asset_ids: ["d1"] },
    { key: "2024-03-01", count: 3, key_asset_ids: ["d2"] },
    { key: "2024-03-02", count: 1, key_asset_ids: [] },
  ];

  it("labels days 'May 12' in the current year and with the year otherwise", () => {
    const labels = buildPeriodCards(DAYS, "days", 2024).map((c) => c.label);
    expect(labels).toEqual(["May 12, 2022", "Mar 1", "Mar 2"]);
  });

  it("renders a header with the total, a pill only above 3 photos, and a placeholder card without a key photo", () => {
    const { container, onOpen } = renderGrid("days", DAYS);
    expect(screen.getByTestId("period-grid-header")).toHaveTextContent("Days");
    expect(screen.getByTestId("period-grid-header")).toHaveTextContent("13 Items");
    const pills = screen.getAllByTestId("period-card-pill");
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveTextContent("9");
    expect(container.querySelectorAll(".period-card__image")).toHaveLength(2);
    expect(container.querySelectorAll(".period-card--days")).toHaveLength(3);
    fireEvent.click(container.querySelector('[data-period-key="2024-03-01"]') as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith("2024-03-01");
  });

  it("requests the key photo, never the per-asset detail", () => {
    const { container } = renderGrid("days", DAYS);
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/\/thumb\/d1\?size=grid2x$/);
  });
});

describe("iPhone cards (#219)", () => {
  const DAYS: SummaryPeriodBucket[] = [
    { key: "2024-04-30", count: 2, key_asset_ids: ["a", "b"] },
    { key: "2024-05-10", count: 5, key_asset_ids: ["c", "d", "e"] },
  ];

  it("Days: mosaic only with 3+ photos, weekday title, count pill above 3", () => {
    const { container } = renderGrid("days", DAYS, { phone: true });
    const cards = Array.from(container.querySelectorAll(".period-card--days"));
    expect(cards[0].querySelector(".period-card__mosaic")).toBeNull();
    expect(cards[1].querySelectorAll(".period-card__mosaic-image")).toHaveLength(2);
    expect(cards[1].querySelector(".period-card__label")).toHaveTextContent("Friday");
    expect(cards[1].querySelector(".period-card__count")).toHaveTextContent("5 Items");
    expect(cards[1].querySelector(".period-card__pill")).toHaveTextContent("5");
  });

  it("Months: day cards under one header per month; tapping a day reports its key", () => {
    const { container, onOpen } = renderGrid("months", [{ key: "2024-04-30", count: 1, key_asset_ids: ["a"] }, ...DAYS.slice(1)], { phone: true });
    const headers = Array.from(container.querySelectorAll("[data-testid='period-month-header']"));
    expect(headers.map((h) => h.textContent)).toEqual(["April 2024", "May 2024"]);
    fireEvent.click(container.querySelectorAll(".period-card--days")[1]);
    expect(onOpen).toHaveBeenCalledWith("2024-05-10");
  });

  it("Years: title only, no count line", () => {
    const { container } = renderGrid("years", YEARS, { phone: true });
    expect(container.querySelector(".period-grid--phone")).not.toBeNull();
    expect(container.querySelector(".period-card__count")).toBeNull();
  });

  it("desktop (no phone flag) is unchanged: no mosaic, no month headers", () => {
    const { container } = renderGrid("days", DAYS);
    expect(container.querySelector(".period-card__mosaic")).toBeNull();
    expect(container.querySelector(".period-card--phone")).toBeNull();
  });
});
