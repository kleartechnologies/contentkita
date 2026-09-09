import type {
  BrandTone,
  ContentLanguage,
  CopyFramework,
  CopyStyle,
  Platform,
  RestaurantProfile,
  VisualStyle,
} from "./types.ts";

/**
 * The choice catalogues.
 *
 * Every option an owner can pick lives here so the onboarding wizard, the
 * profile screen and the AI brief all read the same list. Labels are written
 * for a restaurant owner, not a marketer — the marketing vocabulary stays in
 * `framework`, which is never shown on screen.
 */

interface Option<T> {
  value: T;
  label: string;
  hint: string;
}

export const TONE_OPTIONS: Option<BrandTone>[] = [
  { value: "friendly", label: "Mesra", hint: "Sopan, hangat, macam jiran" },
  { value: "casual", label: "Santai", hint: "Selamba, bahasa harian" },
  { value: "funny", label: "Lawak", hint: "Ada jenaka, tak serius sangat" },
  { value: "premium", label: "Premium", hint: "Kemas, tenang, sedikit formal" },
  { value: "family", label: "Mesra Keluarga", hint: "Sesuai untuk semua umur" },
  { value: "kampung", label: "Kampung", hint: "Loghat santai, rasa rumah" },
];

export const LANGUAGE_OPTIONS: Option<ContentLanguage>[] = [
  { value: "ms", label: "Bahasa Melayu", hint: "Semua caption dalam BM" },
  { value: "en", label: "English", hint: "Semua caption dalam English" },
  {
    value: "rojak",
    label: "Campur BM + English",
    hint: "Gaya bahasa harian yang biasa online",
  },
];

export const VISUAL_STYLE_OPTIONS: Option<VisualStyle>[] = [
  { value: "hangat", label: "Hangat", hint: "Warna kuning keemasan, rasa selesa" },
  { value: "bersih", label: "Bersih & Minimal", hint: "Latar kosong, fokus makanan" },
  { value: "cerah", label: "Cerah & Ceria", hint: "Warna terang, tenaga tinggi" },
  { value: "gelap", label: "Gelap & Moody", hint: "Latar gelap, cahaya dramatik" },
  { value: "kampung", label: "Rustik Kampung", hint: "Kayu, rotan, rasa rumah" },
  { value: "moden", label: "Moden & Kemas", hint: "Garis lurus, kelihatan mahal" },
];

export const PLATFORM_OPTIONS: Option<Platform>[] = [
  { value: "instagram", label: "Instagram", hint: "Gambar & Reels" },
  { value: "tiktok", label: "TikTok", hint: "Video pendek" },
  { value: "facebook", label: "Facebook", hint: "Post panjang & komuniti" },
  { value: "whatsapp", label: "WhatsApp", hint: "Status & broadcast" },
];

/**
 * Copywriting styles as an owner would describe them.
 *
 * `framework` is the internal structure the generator follows for that style.
 * It is deliberately not surfaced anywhere in the UI: an owner picks "Suka
 * bercerita", not "storytelling framework", and certainly not "AIDA".
 */
export interface CopyStyleOption extends Option<CopyStyle> {
  framework: CopyFramework;
}

export const COPY_STYLE_OPTIONS: CopyStyleOption[] = [
  {
    value: "bercerita",
    label: "Suka bercerita",
    hint: "Mula dengan cerita pendek, baru sampai ke makanan",
    framework: "story",
  },
  {
    value: "terus_terang",
    label: "Terus terang",
    hint: "Ringkas, tepat, tak berbelit",
    framework: "direct",
  },
  {
    value: "santai",
    label: "Sembang santai",
    hint: "Macam borak dengan pelanggan tetap",
    framework: "story",
  },
  {
    value: "menjual",
    label: "Ajak datang",
    hint: "Fokus buat orang bangun dan datang makan",
    framework: "aida",
  },
  {
    value: "informatif",
    label: "Beri info",
    hint: "Terangkan bahan, cara masak, apa yang istimewa",
    framework: "fab",
  },
  {
    value: "emosi",
    label: "Sentuh perasaan",
    hint: "Rindu, lapar, nostalgia — tulis untuk rasa",
    framework: "pas",
  },
];

/** The frameworks behind the styles an owner picked, de-duplicated. */
export function frameworksFor(styles: CopyStyle[]): CopyFramework[] {
  const out: CopyFramework[] = [];
  for (const style of styles) {
    const option = COPY_STYLE_OPTIONS.find((o) => o.value === style);
    if (option && !out.includes(option.framework)) out.push(option.framework);
  }
  // An owner who somehow saved no style still gets a usable structure.
  return out.length ? out : ["direct"];
}

export function labelFor<T extends string>(
  options: Option<T>[],
  value: T,
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * The demo restaurant used by tests and by the marketing samples.
 *
 * Every field here is fictional sample data that ships with the product — it is
 * never mixed with a real profile, and onboarding replaces it wholesale.
 */
export const DEMO_RESTAURANT: RestaurantProfile = {
  id: "demo-warung-kak-ina",
  name: "Warung Kak Ina",
  cuisine: "Masakan Melayu",
  location: "Kajang",
  description:
    "Warung keluarga yang masak harian guna resipi rumah. Sesuai untuk makan tengah hari yang cepat tapi tak tergesa-gesa.",
  targetCustomers: "Keluarga, pekerja pejabat, pelajar",
  bestSellers: ["Nasi Ayam Penyet", "Mee Goreng", "Teh Ais"],
  menuNotes:
    "Nasi Ayam Penyet paling popular. Mee Goreng Mamak pedas sederhana. Teh Ais buat sendiri, tak guna premix.",
  menuFile: null,
  promotion: "Set Lunch RM12.90",
  promotionDates: "Isnin hingga Jumaat, 12 tengah hari - 3 petang",
  promotionConditions: "Dine-in sahaja",
  logo: null,
  visualStyle: "hangat",
  brandColours: "",
  referenceDesigns: "",
  tone: "friendly",
  language: "ms",
  platforms: ["instagram", "facebook"],
  copyStyles: ["santai", "bercerita"],
  exampleCaption: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** A blank profile for onboarding to fill in. */
export function EMPTY_PROFILE(id: string): RestaurantProfile {
  const now = new Date().toISOString();
  return {
    id,
    name: "",
    cuisine: "",
    location: "",
    description: "",
    targetCustomers: "",
    bestSellers: [],
    menuNotes: "",
    menuFile: null,
    promotion: null,
    promotionDates: "",
    promotionConditions: "",
    logo: null,
    visualStyle: "hangat",
    brandColours: "",
    referenceDesigns: "",
    tone: "friendly",
    language: "ms",
    platforms: ["instagram"],
    copyStyles: ["santai"],
    exampleCaption: "",
    createdAt: now,
    updatedAt: now,
  };
}
