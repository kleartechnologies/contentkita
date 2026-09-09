import type { BrandTone, RestaurantProfile } from "./types.ts";

export const TONE_OPTIONS: { value: BrandTone; label: string; hint: string }[] = [
  { value: "friendly", label: "Mesra", hint: "Sopan, hangat, macam jiran" },
  { value: "casual", label: "Santai", hint: "Selamba, bahasa harian" },
  { value: "funny", label: "Lawak", hint: "Ada jenaka, tak serius sangat" },
  { value: "premium", label: "Premium", hint: "Kemas, tenang, sedikit formal" },
  { value: "family", label: "Mesra Keluarga", hint: "Sesuai untuk semua umur" },
  { value: "kampung", label: "Kampung", hint: "Loghat santai, rasa rumah" },
];

/**
 * The demo restaurant used before an owner completes onboarding.
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
  bestSellers: ["Nasi Ayam Penyet", "Mee Goreng", "Teh Ais"],
  promotion: "Set Lunch RM12.90",
  targetCustomers: "Keluarga, pekerja pejabat, pelajar",
  tone: "friendly",
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
    bestSellers: [],
    promotion: null,
    targetCustomers: "",
    tone: "friendly",
    createdAt: now,
    updatedAt: now,
  };
}
