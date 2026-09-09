/**
 * A local stand-in for the OpenAI chat-completions API.
 *
 * The production key lives only in the Netlify environment, so the end-to-end
 * flow cannot be driven against the real provider from a developer machine.
 * This serves the same request and response shape on localhost, which lets the
 * browser → /api/generate → provider path be exercised in full: auth, request
 * decoding, prompting, JSON parsing, validation, persistence and rendering.
 *
 * What it does NOT test is the only thing it cannot: whether a real model writes
 * good Malay copy. It writes deliberately plain, claim-free sentences that the
 * anti-hallucination validator accepts.
 *
 *   node scripts/stub-openai.mjs [port]
 *
 * Point the app at it with OPENAI_BASE_URL=http://127.0.0.1:<port>/v1
 */

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8117);

/** Bumped per response so a regenerated day never repeats its own text. */
let nonce = 0;

/**
 * The days the prompt asked for.
 *
 * The schedule is rendered as "Hari 7 | storytelling | instagram", so the day
 * numbers and their video requirement can be read straight back out of it
 * rather than guessed.
 */
function requestedDays(prompt) {
  const days = [];
  const line = /^Hari (\d+) \| ([a-z_]+) \| ([a-z]+)(.*)$/gm;
  let match;
  while ((match = line.exec(prompt)) !== null) {
    days.push({
      day: Number(match[1]),
      category: match[2],
      platform: match[3],
      wantsVideo: match[4].includes("perlukan videoIdea"),
    });
  }
  return days;
}

const OPENERS = [
  "Dapur dah panas sejak pagi tadi",
  "Ada satu benda kecil yang kami buat setiap hari",
  "Bunyi kuali tu memang tak boleh tipu",
  "Kalau anda lalu depan kedai kami petang ni",
  "Ramai tanya kenapa rasa dia lain sikit",
  "Hari ni kami nak kongsi sesuatu yang ringkas",
];

const BODIES = [
  "Kami masak ikut cara yang sama sejak mula. Tak ada rahsia besar, cuma buat betul-betul setiap kali.\n\nOrang datang, makan, balik senyum. Itu je yang kami mahu.",
  "Setiap pinggan disiapkan bila anda pesan. Sebab tu kami tak sediakan awal-awal.\n\nSedikit lambat, tapi panas.",
  "Dapur kami kecil. Semua orang kena tolong semua benda, dan itu yang buat kerja ni seronok.\n\nDatang tengok sendiri kalau sempat.",
];

const CTAS = [
  "Save post ni untuk rujukan nanti.",
  "Komen satu perkataan kalau anda setuju.",
  "Share dengan orang yang anda selalu ajak makan.",
  "Tanya kami apa-apa dalam komen.",
];

const VISUALS = [
  "Ambil dari atas, cahaya siang dari tingkap kiri, latar kayu.",
  "Rapat pada makanan, fokus pada tekstur, latar belakang kabur.",
  "Ambil dari paras mata semasa hidangan diletak di meja.",
];

function pick(list, n) {
  return list[n % list.length];
}

function makeDay(slot, seed) {
  const n = slot.day + seed;
  return {
    day: slot.day,
    objective: "Buat orang ingat kedai kami dan rasa nak singgah.",
    hook: `${pick(OPENERS, n)} (${slot.day}).`,
    caption: pick(BODIES, n),
    cta: pick(CTAS, n),
    visualIdea: pick(VISUALS, n),
    // Always supplied: a day that does not need one simply ignores it, and a
    // missing one on a video day would fail validation for the wrong reason.
    videoIdea: "Shot 1: dapur. Shot 2: tangan menyusun. Shot 3: pinggan siap.",
    designDirection: "Warna hangat, teks minimum di bahagian bawah gambar.",
    hashtags: ["makananmalaysia", "kedaimakan"],
  };
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
    res.writeHead(404).end("not found");
    return;
  }
  // The route must send a key even to a stub; an unauthenticated call here
  // would hide a missing OPENAI_API_KEY rather than surface it.
  if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "no key" } }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let prompt = "";
    try {
      const parsed = JSON.parse(body);
      prompt = parsed.messages?.map((m) => m.content).join("\n") ?? "";
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }

    const slots = requestedDays(prompt);
    const seed = nonce++;
    const items = slots.map((slot) => makeDay(slot, seed));

    console.log(`  stub: ${items.length} day(s) -> ${items.map((i) => i.day).join(",")}`);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: JSON.stringify({ items }) } },
        ],
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`stub OpenAI listening on http://127.0.0.1:${port}/v1`);
});
