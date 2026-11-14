// Alt text for content images: the asset's title, else its capture date,
// else the media kind. Never the filename (IMG_1234.HEIC says nothing to a
// screen reader) and never empty, because these images are the content.
export function assetAlt(asset: { title?: string | null; date?: string | null; is_video?: boolean }): string {
  const kind = asset.is_video ? "Video" : "Photo";
  const title = asset.title?.trim();
  if (title) return title;
  if (asset.date) {
    const parsed = new Date(asset.date);
    if (!Number.isNaN(parsed.getTime())) {
      const when = parsed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      return `${kind} from ${when}`;
    }
  }
  return kind;
}
