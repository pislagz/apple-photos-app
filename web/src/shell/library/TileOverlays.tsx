import type { AssetListItem } from "../../api";
import { Icon } from "../icons";

// #208: overlays hide below 48 px tile width, and the heart shrinks to 10 px
// below 80 px.
export const OVERLAY_HIDE_BELOW = 48;
export const OVERLAY_SMALL_BELOW = 80;

export type OverlayLevel = "none" | "small" | "full";

export function overlayLevel(tileWidth: number): OverlayLevel {
  if (tileWidth < OVERLAY_HIDE_BELOW) return "none";
  return tileWidth < OVERLAY_SMALL_BELOW ? "small" : "full";
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

// Always-visible favourite heart (bottom-left) and video duration
// (bottom-right). Rendered by the grid cell, which sits in a positioned box.
export function TileOverlays({ item, tileWidth, prefix }: { item: AssetListItem; tileWidth: number; prefix: string }) {
  const level = overlayLevel(tileWidth);
  if (level === "none") return null;
  return (
    <>
      {item.favorite && (
        <span className={`${prefix}__heart`} aria-label="Favorite" data-overlay={level}>
          <Icon name="favorite" filled size={level === "small" ? 10 : 12} />
        </span>
      )}
      {item.is_video && (
        <span className={`${prefix}__duration`} data-overlay={level}>
          {formatDuration(item.duration)}
        </span>
      )}
    </>
  );
}

// Bottom-right badge. `mode="selected"` is the filled accent check; on the
// iPhone `mode="empty"` is the outlined circle shown on every tile while
// selecting.
export function CheckBadge({ prefix, selected }: { prefix: string; selected: boolean }) {
  return (
    <span className={`${prefix}__check`} data-selected={selected} aria-hidden="true">
      <svg viewBox="0 0 22 22" width="22" height="22" focusable="false">
        <path d="M6.5 11.5l3.2 3.2 6-6.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
