import { CATEGORY_META, PLATFORM_LABEL, type ContentItem } from "@/lib/content";

const DAY_NAMES = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mac",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Ogos",
  "Sep",
  "Okt",
  "Nov",
  "Dis",
];

/** "Rabu, 9 Sep" — short enough for a calendar row on a phone. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return `${DAY_NAMES[date.getUTCDay()]}, ${d} ${MONTH_NAMES[(m ?? 1) - 1]}`;
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Selamat pagi";
  if (h < 15) return "Selamat tengah hari";
  if (h < 19) return "Selamat petang";
  return "Selamat malam";
}

/** Day number as it appears throughout the product: "Hari 01". */
export function dayLabel(day: number): string {
  return `Hari ${String(day).padStart(2, "0")}`;
}

/**
 * The "Copy All" payload — everything the owner needs to actually make the
 * post, in the order they will use it, as plain text that survives pasting
 * into WhatsApp, Notes or Instagram.
 */
export function formatFullContent(item: ContentItem): string {
  const meta = CATEGORY_META[item.category];
  const lines = [
    `${dayLabel(item.day)} · ${meta.label}`,
    `Platform: ${PLATFORM_LABEL[item.platform]}`,
    "",
    `HOOK`,
    item.hook,
    "",
    `CAPTION`,
    item.caption,
    "",
    `CTA`,
    item.cta,
    "",
    `IDEA GAMBAR`,
    item.visualIdea,
  ];
  if (item.videoIdea) {
    lines.push("", `IDEA VIDEO`, item.videoIdea);
  }
  return lines.join("\n");
}
