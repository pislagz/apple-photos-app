import type { IconName } from "../icons";

// Supervisor notes for #125: the phone More tab's Media Types group, with
// the stable `/media/<slug>` route each one lands on. Separate from
// DesktopShell's own MEDIA_TYPES (desktop is unaffected by this issue, and
// shows RAW instead of Slo-mo).
export interface MediaType {
  slug: string;
  label: string;
  icon: IconName;
}

export const MEDIA_TYPES: MediaType[] = [
  { slug: "videos", label: "Videos", icon: "video" },
  { slug: "selfies", label: "Selfies", icon: "camera" },
  { slug: "live-photos", label: "Live Photos", icon: "livephoto" },
  { slug: "portrait", label: "Portrait", icon: "portrait" },
  { slug: "panoramas", label: "Panoramas", icon: "panorama" },
  { slug: "screenshots", label: "Screenshots", icon: "screenshot" },
  { slug: "slo-mo", label: "Slo-mo", icon: "slomo" },
];
