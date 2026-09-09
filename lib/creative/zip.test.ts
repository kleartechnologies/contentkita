import assert from "node:assert/strict";
import test from "node:test";

import { crc32, zipBytes } from "./zip.ts";

/**
 * The archive behind "Muat turun semua".
 *
 * Written by hand, so it is read back by hand: every test below parses the
 * bytes the way an unzipper would rather than trusting the writer's own
 * arithmetic. A zip that is off by eight bytes still looks like a zip.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0
  );
}

/** Reads an archive the way an unzipper does: end record, directory, files. */
function unzip(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const end = bytes.length - 22;
  assert.equal(u32(bytes, end), 0x06054b50, "end of central directory record");

  const count = u16(bytes, end + 10);
  const size = u32(bytes, end + 12);
  const start = u32(bytes, end + 16);
  assert.equal(start + size, end, "the directory ends where the end record begins");

  const out: { name: string; data: Uint8Array }[] = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    assert.equal(u32(bytes, at), 0x02014b50, "central directory header");
    const sum = u32(bytes, at + 16);
    const length = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const localAt = u32(bytes, at + 42);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength;

    assert.equal(u32(bytes, localAt), 0x04034b50, "local file header");
    assert.equal(u16(bytes, localAt + 8), 0, "stored, not deflated");
    const localNameLength = u16(bytes, localAt + 26);
    const extra = u16(bytes, localAt + 28);
    const from = localAt + 30 + localNameLength + extra;
    const data = bytes.subarray(from, from + length);
    assert.equal(crc32(data), sum, `${name} survived the round trip`);
    out.push({ name, data });
  }
  return out;
}

test("crc32 matches the value every zip implementation agrees on", () => {
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("an archive reads back as the files that went in", () => {
  const files = [
    { name: "hari-01.png", data: enc.encode("poster satu") },
    { name: "hari-02.png", data: enc.encode("poster dua, lebih panjang sedikit") },
  ];

  const read = unzip(zipBytes(files));

  assert.deepEqual(
    read.map((entry) => entry.name),
    ["hari-01.png", "hari-02.png"],
  );
  assert.equal(dec.decode(read[0].data), "poster satu");
  assert.equal(dec.decode(read[1].data), "poster dua, lebih panjang sedikit");
});

test("a name with an accent survives, because it is written as UTF-8", () => {
  const name = "30-hari-content-—-café.png";
  const read = unzip(zipBytes([{ name, data: enc.encode("x") }]));

  assert.equal(read[0].name, name);
  // The flag that says so. Without it an unzipper reads the name as CP437 and
  // the owner gets a file called `cafÃ©`.
  const flags = u16(zipBytes([{ name, data: enc.encode("x") }]), 6);
  assert.equal(flags & 0x0800, 0x0800);
});

test("an empty archive is still a valid archive", () => {
  const bytes = zipBytes([]);
  assert.equal(bytes.length, 22);
  assert.deepEqual(unzip(bytes), []);
});

test("thirty posters pack in the order they were given", () => {
  const files = Array.from({ length: 30 }, (_, i) => ({
    name: `hari-${String(i + 1).padStart(2, "0")}.png`,
    data: enc.encode(`day ${i + 1}`),
  }));

  const read = unzip(zipBytes(files));

  assert.equal(read.length, 30);
  assert.deepEqual(
    read.map((entry) => entry.name),
    files.map((entry) => entry.name),
  );
});
