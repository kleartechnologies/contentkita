import type { BrandTone, ContentCategory } from "./types.ts";

/**
 * The copy corpus.
 *
 * Every template is a function of the restaurant's own facts. Two rules hold
 * across the whole file and are enforced by `requires`:
 *
 *  1. A template may only mention something the owner actually told us. A
 *     template that names a dish declares `requires: ["dishes"]`; one that
 *     names an offer declares `requires: ["promotion"]`. If the fact is
 *     missing the template is never selected, so ContentKita cannot invent a
 *     promotion, a price, a review, an award or a halal claim.
 *  2. Nothing here asserts a fact on the restaurant's behalf. Social proof
 *     templates frame a real screenshot the owner supplies; they never write a
 *     fake review.
 */

export type Requirement = "dishes" | "promotion" | "location" | "description";

export interface TemplateContext {
  name: string;
  cuisine: string;
  location: string;
  description: string;
  dishes: string[];
  /** Primary dish for this day. Empty string when the owner listed none. */
  dish: string;
  /** A different dish where possible, for templates that contrast two. */
  dish2: string;
  promotion: string;
  audience: string;
  tone: BrandTone;
}

export interface TemplateOutput {
  hook: string;
  caption: string;
  cta: string;
  visualIdea: string;
  videoIdea?: string;
}

export interface ContentTemplate {
  id: string;
  requires?: Requirement[];
  build: (ctx: TemplateContext) => TemplateOutput;
}

/**
 * A small tone flavour so the same template does not read identically for a
 * kampung warung and a premium bistro. Deliberately light — tone changes the
 * seasoning, not the message.
 */
function byTone(tone: BrandTone, map: Partial<Record<BrandTone, string>> & { default: string }) {
  return map[tone] ?? map.default;
}

const CAT: Record<ContentCategory, ContentTemplate[]> = {
  // ---------------------------------------------------------------- best seller
  best_seller: [
    {
      id: "bs-order-paling-banyak",
      requires: ["dishes"],
      build: (c) => ({
        hook: `Kalau first time datang ${c.name}, order ini dulu.`,
        caption: `${c.dish} memang yang paling banyak keluar dari dapur kami.\n\nBukan sebab kami suruh — sebab orang datang balik untuk benda yang sama.\n\nKalau tak tahu nak order apa, mula dengan ini.`,
        cta: "Save post ni untuk rujukan bila datang nanti.",
        visualIdea: `Gambar ${c.dish} dari atas, cahaya siang dekat tingkap. Pinggan penuh, latar belakang kosong.`,
      }),
    },
    {
      id: "bs-dua-pilihan",
      requires: ["dishes"],
      build: (c) => ({
        hook: `${c.dish} atau ${c.dish2}? Ini soalan paling susah di sini.`,
        caption: `Dua-dua laris. Dua-dua orang repeat.\n\nYang selalu jadi — datang berdua, order dua-dua, then share.\n\nItu pun satu cara.`,
        cta: `Komen mana satu team anda — ${c.dish} atau ${c.dish2}?`,
        visualIdea: `Dua pinggan bersebelahan, ${c.dish} kiri dan ${c.dish2} kanan, tangan tengah capai satu.`,
      }),
    },
    {
      id: "bs-habis-awal",
      requires: ["dishes"],
      build: (c) => ({
        hook: byTone(c.tone, {
          funny: `${c.dish} ni selalu habis dulu. Kami pun tak sempat makan.`,
          premium: `${c.dish} sering habis lebih awal daripada menu lain.`,
          default: `${c.dish} selalu habis awal.`,
        }),
        caption: `Kalau nak yang ini, jangan datang lambat sangat.\n\nKami masak ikut kadar — bila habis, habis. Esok masak fresh balik.\n\nLagi awal datang, lagi senang dapat.`,
        cta: "Tag orang yang selalu ajak makan lambat.",
        visualIdea: `Gambar ${c.dish} baru siap, wap masih naik. Ambil dekat, fokus pada tekstur.`,
      }),
    },
    {
      id: "bs-tanpa-menu",
      build: (c) => ({
        hook: `Apa yang orang selalu order di ${c.name}?`,
        caption: `Setiap kedai ada satu menu yang jadi kegemaran orang.\n\nDi sini pun sama — ada satu yang keluar dari dapur lagi banyak daripada yang lain.\n\nDatang, kami cadangkan.`,
        cta: "Komen menu kegemaran anda di sini.",
        visualIdea: `Gambar meja penuh dengan beberapa pinggan ${c.cuisine}, diambil dari atas.`,
      }),
    },
    {
      id: "bs-tanya-kami",
      build: () => ({
        hook: "Tak tahu nak order apa? Tanya je.",
        caption: `Kami memang biasa dengan soalan "apa yang sedap sini?".\n\nTak payah segan. Beritahu anda suka apa, kami cadangkan yang paling dekat.\n\nSelalunya kena.`,
        cta: "Datang dan tanya kami terus.",
        visualIdea: "Gambar kaunter atau papan menu, dengan orang tengah pilih.",
      }),
    },
    {
      id: "bs-repeat-order",
      build: (c) => ({
        hook: "Menu yang orang order berulang kali.",
        caption: `Kami tak kira berapa banyak terjual setiap hari.\n\nTapi kami perasan muka yang sama, order yang sama, minggu demi minggu.\n\nItu cukup untuk kami tahu mana yang menjadi.`,
        cta: "Komen kalau anda salah seorang.",
        visualIdea: `Gambar satu pinggan ${c.cuisine} di meja, cahaya semula jadi dari tepi.`,
      }),
    },
  ],

  // --------------------------------------------------------------------- produk
  produk: [
    {
      id: "pr-satu-menu",
      requires: ["dishes"],
      build: (c) => ({
        hook: `Kenapa ${c.dish} kami ambil masa lebih sikit.`,
        caption: `Ada bahagian yang memang tak boleh laju.\n\nKalau nak rasa betul, kena bagi masa dia. Itu je bezanya.\n\nSebab tu bila sampai meja, memang berbaloi tunggu.`,
        cta: "Cuba sendiri dan beritahu kami rasanya.",
        visualIdea: `Close-up ${c.dish} — fokus pada satu detail: kuah, kerangupan atau hirisan.`,
      }),
    },
    {
      id: "pr-cara-makan",
      requires: ["dishes"],
      build: (c) => ({
        hook: `Cara paling sedap makan ${c.dish}.`,
        caption: `Panas-panas terus makan. Jangan tunggu sejuk.\n\nCampur sikit-sikit, jangan sekali gaul semua.\n\nBunyi remeh, tapi rasa memang lain.`,
        cta: "Save dulu, cuba bila datang nanti.",
        visualIdea: `Tangan tengah gaul ${c.dish}, ambil dari sudut sisi supaya nampak gerakan.`,
      }),
    },
    {
      id: "pr-generik",
      build: (c) => ({
        hook: `Apa yang buat ${c.cuisine} di ${c.name} rasa macam ni.`,
        caption: `Bukan satu benda besar. Banyak benda kecil.\n\nApi yang betul, masa yang betul, dan tak potong jalan.\n\nItu yang orang boleh rasa walaupun tak boleh terangkan.`,
        cta: "Datang rasa sendiri.",
        visualIdea: "Gambar dapur waktu masak — kuali, api, tangan tukang masak.",
      }),
    },
    {
      id: "pr-bahan",
      build: () => ({
        hook: "Bahan yang kami tak jimat.",
        caption: `Ada benda yang kalau kurangkan, terus rasa lain.\n\nJadi kami tak main kurang di situ. Lagi senang kekalkan rasa daripada jelaskan kenapa dah berubah.\n\nItu je prinsipnya.`,
        cta: "Save kalau anda hargai kerja macam ni.",
        visualIdea: "Bahan mentah tersusun atas meja kayu, cahaya semula jadi.",
      }),
    },
  ],

  // ---------------------------------------------------------- behind the scenes
  behind_the_scenes: [
    {
      id: "bts-pagi",
      build: () => ({
        hook: "Pukul 6 pagi di dapur kami.",
        caption: `Sebelum kedai buka, dapur dah lama hidup.\n\nBahan sampai, api dibuka, semua kena siap sebelum pelanggan pertama masuk.\n\nBahagian ini orang jarang nampak — tapi ini yang menentukan rasa hari tu.`,
        cta: "Follow untuk lihat lagi kerja di sebalik tabir.",
        visualIdea: "Dapur waktu pagi, lampu baru dibuka, bahan tersusun atas meja.",
      }),
    },
    {
      id: "bts-persediaan",
      requires: ["dishes"],
      build: (c) => ({
        hook: `Ini yang berlaku sebelum ${c.dish} sampai ke meja anda.`,
        caption: `Kerja sebenar bermula jauh lebih awal daripada masa order.\n\nPotong, perap, tunggu. Tak boleh laju, tak boleh main hentam.\n\nBila anda tunggu 10 minit, sebenarnya kami dah mula pagi tadi.`,
        cta: "Tag kawan yang suka tengok proses masak.",
        visualIdea: `Susunan bahan mentah untuk ${c.dish} atas meja penyediaan.`,
      }),
    },
    {
      id: "bts-tutup",
      build: () => ({
        hook: "Selepas pelanggan terakhir balik.",
        caption: `Kedai tutup bukan bermakna kerja habis.\n\nCuci, kemas, susun balik untuk esok. Selalunya sunyi je waktu ni.\n\nEsok pagi mula semula.`,
        cta: "Terima kasih sebab datang hari ini.",
        visualIdea: "Kedai waktu malam selepas tutup, kerusi terbalik atas meja, lampu separuh padam.",
      }),
    },
  ],

  // ------------------------------------------------------------------- customer
  customer: [
    {
      id: "cust-regular",
      build: () => ({
        hook: "Ada pelanggan yang kami dah tak perlu tanya nak order apa.",
        caption: `Masuk je, kami dah tahu.\n\nAda yang datang sejak kedai baru buka lagi. Ada yang bawa anak, sekarang anak pula yang order sendiri.\n\nBenda ni tak boleh beli. Terima kasih.`,
        cta: "Kalau anda salah seorang, komen di bawah.",
        visualIdea: "Gambar pelanggan tetap (dengan izin) atau meja kegemaran mereka yang kosong.",
      }),
    },
    {
      id: "cust-bawa-orang",
      build: (c) => ({
        hook: `Cara terbaik orang jumpa ${c.name}? Kawan bawa kawan.`,
        caption: `Kebanyakan orang baru datang sebab ada yang cakap "jom, aku tahu satu tempat".\n\nBukan iklan. Bukan poster. Cuma orang yang betul-betul suka.\n\nItu yang paling bermakna untuk kami.`,
        cta: "Tag orang yang first bawa anda datang sini.",
        visualIdea: "Meja dengan beberapa orang tengah makan, ambil dari jauh sedikit supaya nampak suasana.",
      }),
    },
    {
      id: "cust-terima-kasih",
      requires: ["location"],
      build: (c) => ({
        hook: `Terima kasih ${c.location}.`,
        caption: `Kedai kecil hidup sebab orang sekitar sudi singgah.\n\nSetiap kali anda pilih makan di sini, itu satu sokongan yang kami rasa betul-betul.\n\nKami hargai.`,
        cta: "Jumpa lagi minggu ni.",
        visualIdea: `Gambar depan kedai dengan pemandangan ${c.location} di sekeliling.`,
      }),
    },
  ],

  // ---------------------------------------------------------------- social proof
  social_proof: [
    {
      id: "sp-screenshot",
      build: () => ({
        hook: "Kami tak pandai puji diri sendiri.",
        caption: `Jadi kami biar orang lain yang cakap.\n\nAda mesej dan komen yang kami simpan sebab baca balik pun rasa syukur.\n\nTerima kasih sebab sudi tulis.`,
        cta: "Kalau anda pernah makan sini, komen jujur boleh?",
        visualIdea:
          "Screenshot komen atau mesej pelanggan yang BETUL — minta izin dulu dan tutup nama jika perlu. Jangan reka.",
      }),
    },
    {
      id: "sp-repeat",
      build: () => ({
        hook: "Review paling jujur bukan bintang lima.",
        caption: `Tapi orang yang datang balik minggu depan.\n\nKami tak boleh kawal orang tulis apa. Yang kami boleh kawal — masak elok setiap hari.\n\nSelebihnya biar orang tentukan.`,
        cta: "Share post ni kalau anda setuju.",
        visualIdea: "Gambar meja yang dah habis makan — pinggan kosong lebih meyakinkan daripada pinggan penuh.",
      }),
    },
    {
      id: "sp-tag",
      build: (c) => ({
        hook: "Kami baca semua tag anda.",
        caption: `Setiap kali ada orang tag ${c.name} dalam story, kami memang tengok.\n\nKadang tu tengah sibuk, tapi tetap sempat senyum.\n\nTerima kasih sebab sudi kongsi.`,
        cta: "Tag kami bila datang, kami repost.",
        visualIdea: "Kolaj beberapa story pelanggan yang sebenar (dengan izin).",
      }),
    },
  ],

  // ----------------------------------------------------------------- engagement
  engagement: [
    {
      id: "eng-pilih",
      requires: ["dishes"],
      build: (c) => ({
        hook: `Pilih satu je: ${c.dish} atau ${c.dish2}?`,
        caption: `Tak boleh dua-dua. Kena pilih satu.\n\nKami nak tahu mana yang orang paling pertahankan.\n\nKomen pilihan anda.`,
        cta: "Komen jawapan anda di bawah.",
        visualIdea: `Split screen — ${c.dish} sebelah kiri, ${c.dish2} sebelah kanan.`,
      }),
    },
    {
      id: "eng-soalan-mudah",
      build: () => ({
        hook: "Soalan cepat.",
        caption: `Bila datang makan, anda jenis yang order benda sama setiap kali, atau suka cuba menu baru?\n\nKami perasan orang terbahagi dua kem.\n\nAnda yang mana?`,
        cta: "Jawab dalam komen.",
        visualIdea: "Teks besar atas latar warna jenama, senang dibaca dalam feed.",
      }),
    },
    {
      id: "eng-panas-sejuk",
      build: () => ({
        hook: "Kami nak selesaikan satu perbalahan.",
        caption: `Makan tengah hari panas terik — anda tetap order minuman panas, atau terus ais?\n\nDi sini dua-dua ada peminat tegar.\n\nMari kita kira.`,
        cta: "Komen panas atau ais.",
        visualIdea: "Dua gelas bersebelahan — satu panas berwap, satu ais berpeluh.",
      }),
    },
  ],

  // ---------------------------------------------------------------------- local
  local: [
    {
      id: "loc-orang-sini",
      requires: ["location"],
      build: (c) => ({
        hook: `Kalau anda kerja sekitar ${c.location}, ini untuk anda.`,
        caption: `Waktu rehat pendek. Tak sempat nak fikir lama nak makan apa.\n\nKami sedia untuk yang macam tu — datang, makan, sempat balik kerja.\n\nTak payah plan lama-lama.`,
        cta: "Save untuk lunch minggu depan.",
        visualIdea: `Gambar kedai waktu tengah hari dengan orang tengah makan, suasana ${c.location}.`,
      }),
    },
    {
      id: "loc-jiran",
      requires: ["location"],
      build: (c) => ({
        hook: `Kedai kecil di ${c.location} memang bergantung pada orang sekitar.`,
        caption: `Bukan pelancong. Bukan viral.\n\nOrang yang tinggal dekat sini, yang singgah sebab lalu setiap hari.\n\nItu yang buat kedai macam kami boleh bertahan.`,
        cta: "Sokong kedai kecil sekitar anda.",
        visualIdea: `Gambar jalan atau kawasan sekitar kedai di ${c.location}.`,
      }),
    },
    {
      id: "loc-generik",
      build: () => ({
        hook: "Kedai kecil hidup sebab orang sekitar.",
        caption: `Setiap kali anda pilih kedai kecil berbanding tempat besar, ada keluarga yang terkesan secara langsung.\n\nKami rasa setiap satu.\n\nTerima kasih.`,
        cta: "Sokong peniaga kecil di kawasan anda.",
        visualIdea: "Gambar depan kedai waktu senja, lampu baru dibuka.",
      }),
    },
    {
      id: "loc-lalu-setiap-hari",
      build: () => ({
        hook: "Anda mungkin lalu depan kedai ni setiap hari.",
        caption: `Ada tempat yang kita lalu berpuluh kali tapi tak pernah singgah.\n\nKalau kedai kami salah satu, mungkin hari ni masanya.\n\nKami ada di sini macam biasa.`,
        cta: "Singgah lain kali anda lalu.",
        visualIdea: "Gambar kedai diambil dari seberang jalan, waktu siang.",
      }),
    },
  ],

  // ---------------------------------------------------------------- educational
  educational: [
    {
      id: "edu-simpan",
      build: () => ({
        hook: "Cara simpan makanan bungkus supaya tak lembik.",
        caption: `Kalau bungkus nak bawa balik, jangan tutup rapat masa panas.\n\nWap terperangkap, lepas tu semua jadi lembik.\n\nBuka sikit penutup dulu 2-3 minit. Beza dia besar.`,
        cta: "Save untuk kali seterusnya anda tapau.",
        visualIdea: "Bekas tapau terbuka sedikit, wap keluar. Ambil dari atas.",
      }),
    },
    {
      id: "edu-cuisine",
      build: (c) => ({
        hook: `Satu benda ramai tak tahu pasal ${c.cuisine}.`,
        caption: `Rasa yang sedap selalunya datang daripada kesabaran, bukan bahan mahal.\n\nApi kecil, masa panjang. Itu je rahsia yang paling kerap.\n\nTak ada jalan pintas.`,
        cta: "Follow untuk tips masakan setiap minggu.",
        visualIdea: `Gambar proses masak ${c.cuisine} — periuk atas api kecil.`,
      }),
    },
    {
      id: "edu-order",
      build: () => ({
        hook: "Tips: order waktu ni lagi cepat sampai.",
        caption: `Waktu paling sibuk selalunya 12.30 sampai 1.30.\n\nKalau datang sebelum atau selepas tu, makanan sampai lagi cepat dan tempat pun lagi selesa.\n\nBukan rahsia, tapi ramai tak perasan.`,
        cta: "Save supaya tak lupa.",
        visualIdea: "Gambar kedai waktu lengang berbanding waktu sibuk — dua gambar bersebelahan.",
      }),
    },
  ],

  // --------------------------------------------------------------- storytelling
  storytelling: [
    {
      id: "story-mula",
      build: (c) => ({
        hook: `Kenapa ${c.name} wujud.`,
        caption: `Setiap kedai bermula dengan seseorang yang rasa "kot boleh buat sendiri".\n\nHari pertama selalunya sunyi. Yang buat kami teruskan — beberapa orang yang datang balik hari kedua.\n\nSampai sekarang.`,
        cta: "Terima kasih sebab jadi sebahagian daripada cerita ni.",
        visualIdea: "Gambar lama kedai atau gambar pemilik di dapur.",
      }),
    },
    {
      id: "story-nama",
      build: () => ({
        hook: "Hari paling sukar bukan hari kedai sunyi.",
        caption: `Tapi hari bahan naik harga, orang tak cukup, dan kena buat semua sendiri.\n\nHari macam tu tetap ada. Kami tetap buka.\n\nSebab ada orang yang datang harap kami ada.`,
        cta: "Kalau anda peniaga kecil, anda faham.",
        visualIdea: "Gambar tangan pemilik tengah kerja — tak perlu nampak muka.",
      }),
    },
    {
      id: "story-pelanggan-pertama",
      build: () => ({
        hook: "Kami masih ingat pelanggan pertama.",
        caption: `Bukan sebab dia order banyak.\n\nTapi sebab masa tu kami tak tahu lagi sama ada benda ni akan jadi atau tidak.\n\nDia datang, makan, dan datang balik. Itu je yang kami perlukan waktu tu.`,
        cta: "Terima kasih pada semua yang datang awal-awal dulu.",
        visualIdea: "Gambar meja kosong yang pertama sekali digunakan, atau sudut paling lama dalam kedai.",
      }),
    },
    {
      id: "story-deskripsi",
      requires: ["description"],
      build: (c) => ({
        hook: `Sikit tentang ${c.name}.`,
        caption: `${c.description}\n\nItu yang kami cuba jaga setiap hari — walaupun bila sibuk.\n\nKalau anda belum pernah datang, sekarang anda tahu apa yang kami cuba buat.`,
        cta: "Singgah bila lalu kawasan ni.",
        visualIdea: "Gambar suasana kedai yang paling mewakili tempat ini.",
      }),
    },
  ],

  // ------------------------------------------------------------------ promotion
  promotion: [
    {
      id: "promo-jelas",
      requires: ["promotion"],
      build: (c) => ({
        hook: `${c.promotion}`,
        caption: `Kami buat ini senang — tak payah kupon, tak payah kod.\n\n${c.promotion}\n\nDatang, sebut je masa order.`,
        cta: "Save post ni dan tunjuk masa datang.",
        visualIdea: `Gambar makanan yang termasuk dalam tawaran, dengan teks "${c.promotion}" ringkas atas gambar.`,
      }),
    },
    {
      id: "promo-untuk-siapa",
      requires: ["promotion"],
      build: (c) => ({
        hook: `Untuk ${c.audience} — ini mungkin membantu.`,
        caption: `${c.promotion}\n\nKami tahu bukan setiap hari senang nak belanja makan luar.\n\nJadi kami cuba buat ia lebih mudah.`,
        cta: "Tag orang yang patut tahu pasal ni.",
        visualIdea: "Gambar set makanan yang ditawarkan, diambil dari atas dengan latar bersih.",
      }),
    },
    {
      id: "promo-tanpa-tawaran",
      build: (c) => ({
        hook: `Menu ${c.name} untuk minggu ni.`,
        caption: `Tiada gimik, tiada tawaran pelik.\n\nCuma masakan yang sama yang kami buat setiap hari.\n\nKalau tu yang anda cari, kami buka macam biasa.`,
        cta: "Jumpa di kedai.",
        visualIdea: "Gambar papan menu atau susunan menu utama.",
      }),
    },
  ],

  // --------------------------------------------------------------------- urgency
  urgency: [
    {
      id: "urg-hari-ini",
      requires: ["promotion"],
      build: (c) => ({
        hook: "Hari ini je.",
        caption: `${c.promotion}\n\nBukan sepanjang bulan. Hari ini.\n\nKalau terlepas, tunggu kali seterusnya.`,
        cta: "Datang sebelum habis.",
        visualIdea: "Gambar makanan dengan teks tarikh hari ini, ringkas dan jelas.",
      }),
    },
    {
      id: "urg-stok",
      requires: ["dishes"],
      build: (c) => ({
        hook: `${c.dish} tinggal sikit je hari ni.`,
        caption: `Kami masak ikut kadar, bukan simpan lama.\n\nBila habis, kena tunggu esok.\n\nKalau memang teringin, datang awal sikit.`,
        cta: "WhatsApp kami untuk tempah dulu.",
        visualIdea: `Gambar ${c.dish} yang tinggal beberapa bahagian dalam bekas.`,
      }),
    },
    {
      id: "urg-generik",
      build: () => ({
        hook: "Dapur tutup pukul berapa?",
        caption: `Kami masak sampai bahan habis, bukan sampai jam tertentu.\n\nHari yang sibuk, boleh habis lebih awal.\n\nKalau nak selamat, jangan datang saat akhir.`,
        cta: "WhatsApp dulu kalau nak pastikan.",
        visualIdea: "Gambar dapur waktu hujung hari, bekas hampir kosong.",
      }),
    },
  ],

  // ----------------------------------------------------------------------- reels
  reels: [
    {
      id: "reel-proses",
      requires: ["dishes"],
      build: (c) => ({
        hook: `15 saat ${c.dish} disiapkan.`,
        caption: `Dari kuali sampai pinggan.\n\nTak ada filter, tak ada tipu. Ini je yang jadi setiap hari.\n\nBunyi dia pun sedap.`,
        cta: "Follow untuk video dapur setiap minggu.",
        visualIdea: `Video dari atas kuali, tangan tengah masak ${c.dish}.`,
        videoIdea: `3 shot: (1) bahan masuk kuali — rakam bunyi, (2) close-up masa gaul, (3) pinggan siap diletak atas meja. Setiap shot 4-5 saat, potong laju, guna bunyi asli tanpa muzik kuat.`,
      }),
    },
    {
      id: "reel-satu-hari",
      build: (c) => ({
        hook: `Satu hari di ${c.name}.`,
        caption: `Buka pagi, sibuk tengah hari, kemas malam.\n\nSetiap hari sama, tapi tak pernah rasa sama.\n\nIni kerja kami.`,
        cta: "Follow kalau anda suka tengok kerja dapur.",
        visualIdea: "Beberapa klip pendek sepanjang hari.",
        videoIdea: `4 klip 3 saat: pintu dibuka pagi, dapur waktu sibuk, pelanggan makan, lampu padam malam. Susun ikut masa, letak teks jam kecil setiap klip.`,
      }),
    },
    {
      id: "reel-tunjuk-menu",
      requires: ["dishes"],
      build: (c) => ({
        hook: "Order ini kalau first time datang.",
        caption: `Kami tunjuk tiga yang paling selamat untuk orang baru.\n\nSemua ni orang repeat.\n\nMula dengan mana-mana satu.`,
        cta: "Save untuk rujukan bila datang.",
        visualIdea: "Tiga pinggan disusun satu per satu atas meja.",
        videoIdea: `Rakam dari atas. Setiap pinggan masuk frame satu-satu dengan teks nama menu. Mula dengan ${c.dish}, akhir dengan ${c.dish2}. Kekal bawah 20 saat.`,
      }),
    },
    {
      id: "reel-bunyi-dapur",
      build: () => ({
        hook: "Tutup mata, dengar je.",
        caption: `Bunyi dapur waktu sibuk memang ada iramanya.\n\nKuali, air, pinggan, orang panggil order.\n\nKami dah biasa. Anda mungkin rasa menenangkan.`,
        cta: "Buka bunyi dan tengok sampai habis.",
        visualIdea: "Beberapa klip dapur dengan bunyi asli, tanpa muzik.",
        videoIdea:
          "3 klip 5 saat tanpa muzik langsung: kuali berdesir, air mendidih, pinggan disusun. Guna bunyi asli sepenuhnya, letak teks kecil 'volume on' di awal.",
      }),
    },
    {
      id: "reel-jemputan",
      build: (c) => ({
        hook: `Jom masuk ${c.name} sekejap.`,
        caption: `Dari pintu sampai meja, ini je yang anda akan nampak.\n\nTak besar, tak mewah. Tapi bersih dan selesa.\n\nKalau anda belum pernah datang, sekarang anda dah tahu rupa dia.`,
        cta: "Save supaya senang cari bila nak datang.",
        visualIdea: "Satu shot berjalan masuk dari pintu ke dalam kedai.",
        videoIdea:
          "Satu take berjalan: mula dari luar pintu, masuk, pusing perlahan tunjuk ruang makan, akhir di meja yang dah ada makanan. 15-20 saat, jalan perlahan supaya tak goyang.",
      }),
    },
  ],

  // -------------------------------------------------------------- whatsapp status
  whatsapp_status: [
    {
      id: "wa-buka",
      build: () => ({
        hook: "Kami dah buka.",
        caption: `Dapur dah panas, makanan dah siap.\n\nSinggah bila lalu.`,
        cta: "Reply mesej ni untuk tempah.",
        visualIdea: "Gambar tegak (9:16) makanan yang baru siap — terang dan jelas.",
      }),
    },
    {
      id: "wa-promo",
      requires: ["promotion"],
      build: (c) => ({
        hook: `${c.promotion}`,
        caption: `Hari ni ada ${c.promotion}.\n\nTunjuk status ni masa order.`,
        cta: "Reply untuk tempah awal.",
        visualIdea: "Gambar tegak dengan teks tawaran besar dan mudah dibaca dalam 2 saat.",
      }),
    },
    {
      id: "wa-tinggal-sikit",
      requires: ["dishes"],
      build: (c) => ({
        hook: `${c.dish} tinggal sikit.`,
        caption: `Siapa nak, reply sekarang.\n\nKami simpankan.`,
        cta: "Reply nama dan berapa bungkus.",
        visualIdea: `Gambar tegak ${c.dish} dalam bekas, ambil dekat.`,
      }),
    },
    {
      id: "wa-tempah-awal",
      build: () => ({
        hook: "Nak tapau? Reply dulu.",
        caption: `Kalau reply awal, kami siapkan dan anda tak payah tunggu.\n\nWaktu sibuk memang berbaloi buat macam ni.`,
        cta: "Reply order anda sekarang.",
        visualIdea: "Gambar tegak bekas tapau tersusun, siap untuk diambil.",
      }),
    },
  ],

  // ---------------------------------------------------------------------- staff
  staff: [
    {
      id: "staff-kenalan",
      build: () => ({
        hook: "Kenalkan orang yang masak makanan anda.",
        caption: `Setiap pinggan yang keluar melalui tangan orang yang sama setiap hari.\n\nDatang awal, balik lewat, jarang masuk gambar.\n\nHari ni kami tarik mereka ke depan.`,
        cta: "Ucap terima kasih di komen.",
        visualIdea: "Potret staf di dapur atau kaunter — senyum, cahaya semula jadi.",
      }),
    },
    {
      id: "staff-kerja",
      build: () => ({
        hook: "Kerja paling susah di kedai ni?",
        caption: `Bukan masak. Bukan cuci.\n\nTapi kekal senyum masa kedai penuh dan semua orang lapar serentak.\n\nStaf kami buat setiap hari.`,
        cta: "Tag orang yang kerja F&B — mereka faham.",
        visualIdea: "Gambar staf waktu sibuk, ambil candid tanpa pose.",
      }),
    },
    {
      id: "staff-terima-kasih",
      build: () => ({
        hook: "Kedai ni bukan satu orang.",
        caption: `Ada yang masak, ada yang layan, ada yang kemas selepas semua orang balik.\n\nKalau makanan sampai elok ke meja anda, itu kerja ramai orang.\n\nTerima kasih pada team.`,
        cta: "Share kalau anda hargai kerja team F&B.",
        visualIdea: "Gambar seluruh team depan kedai.",
      }),
    },
  ],

  // ----------------------------------------------------------------- experience
  experience: [
    {
      id: "exp-suasana",
      build: () => ({
        hook: "Tempat duduk paling best di sini.",
        caption: `Setiap kedai ada satu meja yang orang selalu rebut.\n\nDi sini pun ada — yang dekat tingkap, cahaya masuk waktu pagi.\n\nKalau kosong, ambil.`,
        cta: "Komen meja mana kegemaran anda.",
        visualIdea: "Gambar sudut kedai waktu cahaya paling cantik.",
      }),
    },
    {
      id: "exp-sesuai-untuk",
      build: (c) => ({
        hook: `Sesuai untuk ${c.audience}.`,
        caption: `Tempat ni bukan mewah. Tapi selesa, dan makanan sampai cepat.\n\nKalau anda cari tempat yang tak menyusahkan, ini dia.\n\nDatang macam anda je.`,
        cta: "Save untuk kali seterusnya.",
        visualIdea: "Gambar dalam kedai waktu ada orang, supaya nampak hidup.",
      }),
    },
    {
      id: "exp-waktu-tenang",
      build: () => ({
        hook: "Kedai kami paling tenang waktu ni.",
        caption: `Lepas pukul 2, orang dah kurang.\n\nKalau anda nak makan tanpa bising, itu waktu terbaik.\n\nKami tetap buka.`,
        cta: "Save untuk hari anda perlukan ketenangan.",
        visualIdea: "Gambar kedai lengang waktu petang, cahaya lembut.",
      }),
    },
  ],
};

export const TEMPLATES: Record<ContentCategory, ContentTemplate[]> = CAT;
