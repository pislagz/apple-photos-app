import { triggerDownload } from "../viewer/download";
import { planFiles, plannedUrl } from "./exportFetch";
import { formatFor, type ExportItem } from "./exportModel";
import { getTransferFormat } from "./transferFormat";

const GAP_MS = 300;

// Mac Download for one item: the plain file under its own name, in the
// Transfer Format (a Live Photo's video comes along with Keep Originals).
// `unmodified` is "Download Unmodified Original": the file as stored, whatever
// the setting and whether or not the photo was edited.
export async function downloadItem(
  libraryId: number,
  item: ExportItem,
  options: { unmodified?: boolean; version?: "original" | "edited" } = {},
): Promise<void> {
  const format = options.unmodified ? "original" : formatFor(getTransferFormat());
  const version = options.unmodified ? "original" : options.version;
  const plan = planFiles([item], format);
  for (let index = 0; index < plan.length; index += 1) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    triggerDownload(await plannedUrl(libraryId, plan[index], format, version));
  }
}
