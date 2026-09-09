import type { ContentCategory, Platform } from "./types.ts";

export type TintName =
  | "amber"
  | "rose"
  | "teal"
  | "violet"
  | "blue"
  | "green"
  | "clay"
  | "slate";

export interface CategoryMeta {
  /** Shown on chips and in the calendar. */
  label: string;
  /** One line explaining why this post exists, shown on the detail screen. */
  purpose: string;
  tint: TintName;
  /** Where this kind of post works best. */
  platform: Platform;
}

export const CATEGORY_META: Record<ContentCategory, CategoryMeta> = {
  best_seller: {
    label: "Best Seller",
    purpose: "Tunjuk menu paling laris supaya orang baru tahu apa nak order.",
    tint: "amber",
    platform: "instagram",
  },
  produk: {
    label: "Produk",
    purpose: "Fokus pada satu menu supaya ia melekat dalam kepala pelanggan.",
    tint: "clay",
    platform: "instagram",
  },
  behind_the_scenes: {
    label: "Behind The Scenes",
    purpose: "Tunjuk kerja di dapur — orang percaya apa yang mereka nampak.",
    tint: "slate",
    platform: "instagram",
  },
  customer: {
    label: "Customer",
    purpose: "Raikan pelanggan supaya mereka rasa dihargai dan datang balik.",
    tint: "rose",
    platform: "instagram",
  },
  social_proof: {
    label: "Social Proof",
    purpose: "Biar orang lain yang puji — lagi kuat daripada kita puji diri.",
    tint: "green",
    platform: "facebook",
  },
  engagement: {
    label: "Engagement",
    purpose: "Tanya soalan mudah supaya orang komen dan reach naik.",
    tint: "violet",
    platform: "instagram",
  },
  local: {
    label: "Local",
    purpose: "Sambung dengan komuniti setempat supaya jadi kedai orang sini.",
    tint: "teal",
    platform: "facebook",
  },
  educational: {
    label: "Educational",
    purpose: "Ajar sesuatu kecil — bina kredibiliti tanpa menjual.",
    tint: "blue",
    platform: "instagram",
  },
  storytelling: {
    label: "Storytelling",
    purpose: "Cerita di sebalik kedai — ini yang buat orang ingat anda.",
    tint: "clay",
    platform: "facebook",
  },
  promotion: {
    label: "Promotion",
    purpose: "Beritahu tawaran dengan jelas supaya orang tahu nak buat apa.",
    tint: "amber",
    platform: "facebook",
  },
  urgency: {
    label: "Urgency",
    purpose: "Beri sebab untuk datang hari ini, bukan minggu depan.",
    tint: "rose",
    platform: "whatsapp",
  },
  reels: {
    label: "Reels",
    purpose: "Video pendek — cara paling murah untuk jumpa orang baru.",
    tint: "violet",
    platform: "tiktok",
  },
  whatsapp_status: {
    label: "WhatsApp Status",
    purpose: "Terus kepada pelanggan sedia ada yang memang dah simpan nombor.",
    tint: "green",
    platform: "whatsapp",
  },
  staff: {
    label: "Staff",
    purpose: "Kenalkan orang di sebalik kedai — wajah lebih mudah diingat.",
    tint: "teal",
    platform: "instagram",
  },
  experience: {
    label: "Experience",
    purpose: "Tunjuk suasana kedai supaya orang boleh bayangkan diri di situ.",
    tint: "slate",
    platform: "instagram",
  },
};

export const TINT_CLASS: Record<TintName, string> = {
  amber: "bg-tint-amber text-tint-amber-fg border-tint-amber-line",
  rose: "bg-tint-rose text-tint-rose-fg border-tint-rose-line",
  teal: "bg-tint-teal text-tint-teal-fg border-tint-teal-line",
  violet: "bg-tint-violet text-tint-violet-fg border-tint-violet-line",
  blue: "bg-tint-blue text-tint-blue-fg border-tint-blue-line",
  green: "bg-tint-green text-tint-green-fg border-tint-green-line",
  clay: "bg-tint-clay text-tint-clay-fg border-tint-clay-line",
  slate: "bg-tint-slate text-tint-slate-fg border-tint-slate-line",
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
};

/**
 * The 30-day rhythm.
 *
 * This is the content strategy, written down once. It is deliberate, not a
 * shuffle: selling posts are spaced out so the feed never reads as one long
 * advertisement, video lands roughly weekly, and no category repeats on
 * consecutive days. Weekly shape is roughly:
 *
 *   value -> proof -> story -> ask -> video -> sell
 *
 * `SELLING_CATEGORIES` are the ones that push an offer. There are only four in
 * thirty days on purpose.
 */
export const PLAN_RHYTHM: readonly ContentCategory[] = [
  "best_seller",
  "behind_the_scenes",
  "engagement",
  "produk",
  "local",
  "reels",
  "promotion",
  "storytelling",
  "customer",
  "educational",
  "best_seller",
  "whatsapp_status",
  "staff",
  "experience",
  "social_proof",
  "reels",
  "produk",
  "engagement",
  "behind_the_scenes",
  "urgency",
  "local",
  "customer",
  "best_seller",
  "educational",
  "reels",
  "staff",
  "storytelling",
  "whatsapp_status",
  "social_proof",
  "promotion",
] as const;

/** Categories that require a real promotion to exist before we may post them. */
export const SELLING_CATEGORIES: readonly ContentCategory[] = [
  "promotion",
  "urgency",
] as const;

/**
 * What a selling day becomes when the owner has no promotion recorded.
 *
 * Inventing an offer would be lying about the business, so the day is spent on
 * something we can say truthfully instead. Each selling slot has more than one
 * replacement so a restaurant with no offer does not end up with every spare
 * day collapsed onto the same category — the choice is made from the day
 * number, which keeps it pure and reproducible.
 */
export const SELLING_FALLBACK: Record<string, readonly ContentCategory[]> = {
  promotion: ["storytelling", "educational"],
  urgency: ["experience", "staff"],
};
