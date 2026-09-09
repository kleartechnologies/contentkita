/**
 * A zip file, written by hand.
 *
 * ## Why this exists
 *
 * "Muat turun semua" is the difference between a month of content and thirty
 * downloads. A browser that is handed thirty `<a download>` clicks in a row
 * blocks all but the first, and an owner who has to press Download thirty
 * times has been given homework again.
 *
 * ## Why it is written here rather than installed
 *
 * The only thing in the archive is PNGs, and a PNG is already deflated — a
 * compressing zip writer would spend a phone's battery re-compressing
 * incompressible data to save nothing. Stored entries need no deflate, and
 * that is the whole reason this file is short enough to be worth owning: a
 * local header, a central directory and an end record, none of which have
 * changed since 1989.
 *
 * Everything below writes the classic 32-bit format. That caps an archive at
 * 4 GB and 65,535 entries; thirty posters at a couple of megabytes each are
 * three orders of magnitude inside both, and the caller is the only thing that
 * decides what goes in.
 */

export interface ZipEntry {
  /** The path inside the archive, e.g. `hari-01.png`. */
  name: string;
  data: Uint8Array;
}

/* ---------------------------------- crc32 --------------------------------- */

/**
 * The CRC-32 table, built once on first use.
 *
 * Built rather than pasted: 256 constants are 256 chances for a typo that
 * produces an archive every unzipper rejects with "corrupt", and the loop that
 * generates them is four lines.
 */
let TABLE: Uint32Array | null = null;

function table(): Uint32Array {
  if (TABLE) return TABLE;
  const next = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    next[i] = c >>> 0;
  }
  TABLE = next;
  return next;
}

export function crc32(bytes: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* --------------------------------- writing -------------------------------- */

/**
 * MS-DOS date and time, which is what a zip entry records.
 *
 * Two-second resolution and a 1980 epoch, because that is what the format
 * says. A date before 1980 cannot be expressed, so it is clamped rather than
 * wrapped — an archive stamped 2107 is stranger than one stamped 1980.
 */
function dosStamp(when: Date): { date: number; time: number } {
  const year = Math.max(when.getFullYear(), 1980);
  return {
    date:
      ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    time:
      (when.getHours() << 11) |
      (when.getMinutes() << 5) |
      Math.floor(when.getSeconds() / 2),
  };
}

/** Names are stored as UTF-8, and flagged as such so unzippers believe it. */
const UTF8 = new TextEncoder();

class Writer {
  private parts: Uint8Array[] = [];
  private length = 0;

  get offset(): number {
    return this.length;
  }

  push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  join(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/**
 * Packs the entries into a stored (uncompressed) zip archive.
 *
 * Deterministic apart from the timestamp, which the caller may pin — the tests
 * do, so the same posters produce the same bytes.
 */
export function zipBytes(
  entries: readonly ZipEntry[],
  now: Date = new Date(),
): Uint8Array {
  const { date, time } = dosStamp(now);
  const body = new Writer();
  const dir = new Writer();

  for (const entry of entries) {
    const name = UTF8.encode(entry.name);
    const sum = crc32(entry.data);
    const at = body.offset;

    body.u32(0x04034b50); // local file header
    body.u16(20); // version needed: 2.0
    body.u16(0x0800); // flags: names are UTF-8
    body.u16(0); // method: stored
    body.u16(time);
    body.u16(date);
    body.u32(sum);
    body.u32(entry.data.length); // compressed size
    body.u32(entry.data.length); // uncompressed size
    body.u16(name.length);
    body.u16(0); // extra field length
    body.push(name);
    body.push(entry.data);

    dir.u32(0x02014b50); // central directory header
    dir.u16(20); // version made by
    dir.u16(20); // version needed
    dir.u16(0x0800);
    dir.u16(0);
    dir.u16(time);
    dir.u16(date);
    dir.u32(sum);
    dir.u32(entry.data.length);
    dir.u32(entry.data.length);
    dir.u16(name.length);
    dir.u16(0); // extra
    dir.u16(0); // comment
    dir.u16(0); // disk number
    dir.u16(0); // internal attributes
    dir.u32(0); // external attributes
    dir.u32(at); // where the local header is
    dir.push(name);
  }

  const out = new Writer();
  out.push(body.join());
  // Where the central directory starts and how long it is. Both are read
  // before the end record is appended: `out.offset` afterwards would include
  // the end record itself, and an unzipper handed that size looks for the
  // directory eight bytes past where it stops.
  const dirAt = out.offset;
  const dirSize = dir.offset;
  out.push(dir.join());

  out.u32(0x06054b50); // end of central directory
  out.u16(0); // this disk
  out.u16(0); // disk the directory starts on
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(dirSize);
  out.u32(dirAt);
  out.u16(0); // comment length
  return out.join();
}

/** The archive as a file the browser can hand to the owner. */
export function zipBlob(entries: readonly ZipEntry[]): Blob {
  const bytes = zipBytes(entries);
  return new Blob([bytes as unknown as BlobPart], { type: "application/zip" });
}
