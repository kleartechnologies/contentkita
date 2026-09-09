import type { CalendarEvent, EventKind, MalaysiaState } from "./types.ts";

/**
 * The dataset.
 *
 * Every date below is a literal read from published Malaysian public-holiday
 * gazette listings for 2026 and 2027, cross-checked between two sources. It is
 * deliberately hand-entered rather than computed: Islamic and lunar dates are
 * declared by JAKIM and by each state, not derived, and a calculated Hijri date
 * would be a guess dressed up as arithmetic.
 *
 * COVERAGE is the honest boundary. A pack whose thirty days fall outside it
 * gets no calendar days at all — which is the correct failure, because an empty
 * calendar produces a normal month of content while a wrong one produces a
 * restaurant wishing its customers happy Deepavali in July.
 *
 * Re-verify against the gazette every year and extend COVERAGE with it.
 * Islamic dates in particular are subject to moon sighting and may move by a
 * day; the anticipation post is placed several days out partly for that reason.
 *
 * What is deliberately NOT here: shopping dates (11.11, 12.12 and friends).
 * They only work as content if the restaurant has an offer, and inventing one
 * is exactly what `lib/content/validate.ts` exists to stop.
 */
export const COVERAGE = { start: "2026-01-01", end: "2027-12-31" } as const;

const KL = "kuala-lumpur" as const;
const N9 = "negeri-sembilan" as const;

/** Everywhere that gazettes 1 January. */
const NEW_YEAR_STATES: readonly MalaysiaState[] = [
  KL, "labuan", "putrajaya", "melaka", N9, "pahang", "perak", "penang",
  "sabah", "sarawak", "selangor", "terengganu",
];
const THAIPUSAM_STATES: readonly MalaysiaState[] = [
  KL, "putrajaya", "johor", N9, "perak", "penang", "selangor",
];
const NUZUL_STATES: readonly MalaysiaState[] = [
  KL, "labuan", "putrajaya", "kelantan", "pahang", "perak", "perlis",
  "penang", "selangor", "terengganu",
];
const ISRAK_STATES: readonly MalaysiaState[] = ["kedah", N9, "perlis", "terengganu"];
const FT_STATES: readonly MalaysiaState[] = [KL, "labuan", "putrajaya"];
const BORNEO: readonly MalaysiaState[] = ["sabah", "sarawak"];
/** School term groups. A: Kedah, Kelantan, Terengganu. B: everywhere else. */
const SCHOOL_A: readonly MalaysiaState[] = ["kedah", "kelantan", "terengganu"];
const SCHOOL_B: readonly MalaysiaState[] = [
  "johor", "melaka", N9, "pahang", "perak", "perlis", "penang", "sabah",
  "sarawak", "selangor", KL, "labuan", "putrajaya",
];

interface Spec {
  id: string;
  name: string;
  kind: EventKind;
  states: readonly MalaysiaState[] | null;
  weight: number;
  angle: string;
  /** `[start]` for a single day, `[start, end]` for a range. Inclusive. */
  dates: readonly (readonly [string, string?])[];
}

const SPECS: readonly Spec[] = [
  /* ------------------------------ national ------------------------------- */
  {
    id: "tahun-baru",
    name: "Tahun Baru",
    kind: "holiday",
    states: NEW_YEAR_STATES,
    weight: 0.6,
    angle:
      "Awal tahun. Cakap pasal permulaan baru dari sudut kedai — bukan azam palsu, bukan tawaran.",
    dates: [["2026-01-01"], ["2027-01-01"]],
  },
  {
    id: "tahun-baru-cina",
    name: "Tahun Baru Cina",
    kind: "holiday",
    states: null,
    weight: 0.9,
    angle:
      "Ucapan Gong Xi Fa Cai yang ikhlas dan ringkas. Kalau kedai bukan kedai Cina, ucap sebagai jiran, jangan pura-pura sambut.",
    dates: [["2026-02-17", "2026-02-18"], ["2027-02-06", "2027-02-07"]],
  },
  {
    id: "hari-raya-aidilfitri",
    name: "Hari Raya Aidilfitri",
    kind: "holiday",
    states: null,
    weight: 1,
    angle:
      "Raya. Nada hangat, memaafkan, tak menjual. Ucapan pendek lagi kuat daripada perenggan panjang.",
    dates: [["2026-03-21", "2026-03-22"], ["2027-03-10", "2027-03-11"]],
  },
  {
    id: "hari-pekerja",
    name: "Hari Pekerja",
    kind: "holiday",
    states: null,
    weight: 0.5,
    angle:
      "Hari cuti untuk orang yang bekerja. Boleh raikan pekerja kedai sendiri kalau ada.",
    dates: [["2026-05-01"], ["2027-05-01"]],
  },
  {
    id: "hari-raya-aidiladha",
    name: "Hari Raya Aidiladha",
    kind: "holiday",
    states: null,
    weight: 0.8,
    angle: "Raya Korban. Nada tenang dan hormat. Fokus keluarga dan berkongsi.",
    dates: [["2026-05-27"], ["2027-05-17"]],
  },
  {
    id: "wesak",
    name: "Hari Wesak",
    kind: "holiday",
    states: null,
    weight: 0.55,
    angle: "Ucapan hormat dan ringkas. Jangan berlagak sambut kalau bukan perayaan kedai.",
    dates: [["2026-05-31"], ["2027-05-20"]],
  },
  {
    id: "hari-keputeraan-agong",
    name: "Hari Keputeraan Yang di-Pertuan Agong",
    kind: "holiday",
    states: null,
    weight: 0.45,
    angle: "Cuti umum. Kebanyakan orang cuma tahu ia hari cuti — cakap dari sudut itu.",
    dates: [["2026-06-01"], ["2027-06-07"]],
  },
  {
    id: "awal-muharram",
    name: "Awal Muharram",
    kind: "holiday",
    states: null,
    weight: 0.5,
    angle: "Tahun baru Hijrah. Nada tenang, tentang permulaan, bukan promosi.",
    dates: [["2026-06-17"], ["2027-06-06"]],
  },
  {
    id: "maulidur-rasul",
    name: "Maulidur Rasul",
    kind: "holiday",
    states: null,
    weight: 0.55,
    angle: "Nada hormat dan sederhana. Ucapan sahaja sudah memadai.",
    dates: [["2026-08-25"], ["2027-08-15"]],
  },
  {
    id: "hari-merdeka",
    name: "Hari Merdeka",
    kind: "holiday",
    states: null,
    weight: 0.75,
    angle:
      "Merdeka. Rasa bangga tempatan, bukan slogan kerajaan. Kedai makan Malaysia bercakap dengan orang Malaysia.",
    dates: [["2026-08-31"], ["2027-08-31"]],
  },
  {
    id: "hari-malaysia",
    name: "Hari Malaysia",
    kind: "holiday",
    states: null,
    weight: 0.75,
    angle:
      "16 September. Tentang Malaysia yang berbilang — makanan kita sendiri buktinya.",
    dates: [["2026-09-16"], ["2027-09-16"]],
  },
  {
    id: "deepavali",
    name: "Deepavali",
    kind: "holiday",
    states: null,
    weight: 0.85,
    angle:
      "Ucapan Deepavali yang ikhlas. Kalau kedai bukan kedai India, ucap sebagai jiran.",
    dates: [["2026-11-08"], ["2027-10-28"]],
  },
  {
    id: "krismas",
    name: "Krismas",
    kind: "holiday",
    states: null,
    weight: 0.7,
    angle: "Ucapan hangat dan ringkas. Hujung tahun, orang keluar makan ramai-ramai.",
    dates: [["2026-12-25"], ["2027-12-25"]],
  },

  /* ------------------------------- seasons -------------------------------- */
  {
    id: "ramadan",
    name: "Bulan Ramadan",
    kind: "season",
    states: null,
    weight: 0.95,
    angle:
      "Musim berbuka. Cakap tentang waktu berbuka dan sahur secara umum — jangan janji menu khas, jangan cipta bazar atau set berbuka yang tak wujud.",
    dates: [["2026-02-19", "2026-03-19"], ["2027-02-08", "2027-03-08"]],
  },
  {
    id: "cuti-sekolah-a",
    name: "Cuti Sekolah",
    kind: "season",
    states: SCHOOL_A,
    weight: 0.6,
    angle:
      "Cuti sekolah. Keluarga keluar makan lebih kerap dan lebih ramai. Cakap tentang datang beramai-ramai.",
    dates: [
      ["2026-03-20", "2026-03-28"],
      ["2026-08-28", "2026-09-05"],
      ["2026-12-04", "2026-12-30"],
    ],
  },
  {
    id: "cuti-sekolah-b",
    name: "Cuti Sekolah",
    kind: "season",
    states: SCHOOL_B,
    weight: 0.6,
    angle:
      "Cuti sekolah. Keluarga keluar makan lebih kerap dan lebih ramai. Cakap tentang datang beramai-ramai.",
    dates: [
      ["2026-03-21", "2026-03-29"],
      ["2026-08-29", "2026-09-06"],
      ["2026-12-05", "2026-12-31"],
    ],
  },

  /* ------------------------------ occasions ------------------------------- */
  {
    id: "hari-kekasih",
    name: "Hari Kekasih",
    kind: "occasion",
    states: null,
    weight: 0.55,
    angle:
      "Bukan cuti umum. Pasangan cari tempat makan. Nada manis tapi jangan mengada — dan jangan janji set couple yang tak wujud.",
    dates: [["2026-02-14"], ["2027-02-14"]],
  },
  {
    id: "hari-ibu",
    name: "Hari Ibu",
    kind: "occasion",
    states: null,
    weight: 0.65,
    angle:
      "Bukan cuti umum. Hari paling sibuk untuk kedai makan sepanjang tahun. Cakap tentang bawa mak keluar makan.",
    dates: [["2026-05-10"], ["2027-05-09"]],
  },
  {
    id: "hari-bapa",
    name: "Hari Bapa",
    kind: "occasion",
    states: null,
    weight: 0.5,
    angle: "Bukan cuti umum. Nada ringkas, tak melebih-lebih. Ayah biasanya benci ayat bunga.",
    dates: [["2026-06-21"], ["2027-06-20"]],
  },
  {
    id: "hari-guru",
    name: "Hari Guru",
    kind: "occasion",
    states: null,
    weight: 0.4,
    angle: "Bukan cuti umum. Ucapan pendek untuk cikgu. Jangan tawarkan diskaun yang tak wujud.",
    dates: [["2026-05-16"], ["2027-05-16"]],
  },

  /* --------------------------- state holidays ----------------------------- */
  {
    id: "thaipusam",
    name: "Thaipusam",
    kind: "holiday",
    states: THAIPUSAM_STATES,
    weight: 0.55,
    angle: "Cuti negeri. Ucapan hormat kepada jiran yang menyambut.",
    dates: [["2026-02-01"], ["2027-01-22"]],
  },
  {
    id: "hari-wilayah",
    name: "Hari Wilayah Persekutuan",
    kind: "holiday",
    states: FT_STATES,
    weight: 0.45,
    angle: "Cuti wilayah. Cakap dari sudut orang KL — kedai ini sebahagian bandar.",
    dates: [["2026-02-01"], ["2027-02-01"]],
  },
  {
    id: "nuzul-al-quran",
    name: "Nuzul Al-Quran",
    kind: "holiday",
    states: NUZUL_STATES,
    weight: 0.45,
    angle: "Cuti negeri dalam bulan Ramadan. Nada tenang dan hormat.",
    dates: [["2026-03-07"], ["2027-02-24"]],
  },
  {
    id: "israk-mikraj",
    name: "Israk dan Mikraj",
    kind: "holiday",
    states: ISRAK_STATES,
    weight: 0.4,
    angle: "Cuti negeri. Nada tenang dan hormat.",
    dates: [["2026-01-17"], ["2027-01-06"]],
  },
  {
    id: "good-friday",
    name: "Good Friday",
    kind: "holiday",
    states: BORNEO,
    weight: 0.4,
    angle: "Cuti negeri di Sabah dan Sarawak. Ucapan hormat dan ringkas.",
    dates: [["2026-04-03"], ["2027-03-26"]],
  },
  {
    id: "pesta-kaamatan",
    name: "Pesta Kaamatan",
    kind: "holiday",
    states: ["sabah", "labuan"],
    weight: 0.75,
    angle: "Kotobian Tadau Tagazo Do Kaamatan. Perayaan besar di Sabah — raikan betul-betul.",
    dates: [["2026-05-30", "2026-05-31"], ["2027-05-30", "2027-05-31"]],
  },
  {
    id: "gawai-dayak",
    name: "Hari Gawai",
    kind: "holiday",
    states: ["sarawak"],
    weight: 0.75,
    angle: "Selamat Ari Gawai. Perayaan besar di Sarawak — raikan betul-betul.",
    dates: [["2026-06-01", "2026-06-02"], ["2027-06-01", "2027-06-02"]],
  },
  {
    id: "hari-sarawak",
    name: "Hari Kemerdekaan Sarawak",
    kind: "holiday",
    states: ["sarawak"],
    weight: 0.5,
    angle: "Cuti negeri Sarawak. Rasa bangga tempatan.",
    dates: [["2026-07-22"], ["2027-07-22"]],
  },
  {
    id: "hari-jadi-sultan-johor",
    name: "Hari Keputeraan Sultan Johor",
    kind: "holiday",
    states: ["johor"],
    weight: 0.35,
    angle: "Cuti negeri Johor. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-03-23"], ["2027-03-23"]],
  },
  {
    id: "hari-jadi-sultan-kelantan",
    name: "Hari Keputeraan Sultan Kelantan",
    kind: "holiday",
    states: ["kelantan"],
    weight: 0.35,
    angle: "Cuti negeri Kelantan. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-09-29", "2026-09-30"], ["2027-09-29", "2027-09-30"]],
  },
  {
    id: "hari-jadi-sultan-selangor",
    name: "Hari Keputeraan Sultan Selangor",
    kind: "holiday",
    states: ["selangor"],
    weight: 0.35,
    angle: "Cuti negeri Selangor. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-12-11"], ["2027-12-11"]],
  },
  {
    id: "hari-jadi-sultan-perak",
    name: "Hari Keputeraan Sultan Perak",
    kind: "holiday",
    states: ["perak"],
    weight: 0.35,
    angle: "Cuti negeri Perak. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-11-06"], ["2027-11-05"]],
  },
  {
    id: "hari-jadi-sultan-pahang",
    name: "Hari Keputeraan Sultan Pahang",
    kind: "holiday",
    states: ["pahang"],
    weight: 0.35,
    angle: "Cuti negeri Pahang. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-07-31"], ["2027-07-30"]],
  },
  {
    id: "hari-jadi-sultan-kedah",
    name: "Hari Keputeraan Sultan Kedah",
    kind: "holiday",
    states: ["kedah"],
    weight: 0.35,
    angle: "Cuti negeri Kedah. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-06-21"], ["2027-06-20"]],
  },
  {
    id: "hari-jadi-sultan-terengganu",
    name: "Hari Keputeraan Sultan Terengganu",
    kind: "holiday",
    states: ["terengganu"],
    weight: 0.35,
    angle: "Cuti negeri Terengganu. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-04-26"], ["2027-04-26"]],
  },
  {
    id: "hari-jadi-raja-perlis",
    name: "Hari Keputeraan Raja Perlis",
    kind: "holiday",
    states: ["perlis"],
    weight: 0.35,
    angle: "Cuti negeri Perlis. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-05-17"], ["2027-05-17"]],
  },
  {
    id: "hari-jadi-yang-dipertuan-besar",
    name: "Hari Keputeraan Yang di-Pertuan Besar",
    kind: "holiday",
    states: [N9],
    weight: 0.35,
    angle: "Cuti negeri Negeri Sembilan. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-01-14"], ["2027-01-14"]],
  },
  {
    id: "hari-jadi-yang-dipertua-melaka",
    name: "Hari Jadi Yang Dipertua Negeri Melaka",
    kind: "holiday",
    states: ["melaka"],
    weight: 0.35,
    angle: "Cuti negeri Melaka. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-08-24"], ["2027-08-24"]],
  },
  {
    id: "hari-jadi-yang-dipertua-penang",
    name: "Hari Jadi Yang Dipertua Negeri Pulau Pinang",
    kind: "holiday",
    states: ["penang"],
    weight: 0.35,
    angle: "Cuti negeri Pulau Pinang. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-07-11"], ["2027-07-10"]],
  },
  {
    id: "hari-jadi-yang-dipertua-sabah",
    name: "Hari Jadi Yang Dipertua Negeri Sabah",
    kind: "holiday",
    states: ["sabah"],
    weight: 0.35,
    angle: "Cuti negeri Sabah. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-03-30"], ["2027-03-30"]],
  },
  {
    id: "hari-jadi-yang-dipertua-sarawak",
    name: "Hari Jadi Yang Dipertua Negeri Sarawak",
    kind: "holiday",
    states: ["sarawak"],
    weight: 0.35,
    angle: "Cuti negeri Sarawak. Orang cuti, kedai boleh sibuk.",
    dates: [["2026-10-10"], ["2027-10-09"]],
  },
  {
    id: "george-town-heritage",
    name: "Hari George Town Warisan Dunia",
    kind: "holiday",
    states: ["penang"],
    weight: 0.4,
    angle: "Cuti Pulau Pinang. Rasa bangga tempatan, sejarah pulau.",
    dates: [["2026-07-07"], ["2027-07-07"]],
  },
  {
    id: "hari-kemerdekaan-melaka",
    name: "Hari Perisytiharan Kemerdekaan Melaka",
    kind: "holiday",
    states: ["melaka"],
    weight: 0.4,
    angle: "Cuti negeri Melaka. Rasa bangga tempatan, sejarah bandar.",
    dates: [["2026-02-20"], ["2027-02-20"]],
  },
];

/** Every event, flattened out of the specs. Sorted by start date. */
export const EVENTS: readonly CalendarEvent[] = SPECS.flatMap((spec) =>
  spec.dates.map(([start, end]) => ({
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    states: spec.states,
    start,
    end: end ?? start,
    weight: spec.weight,
    angle: spec.angle,
  })),
).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
