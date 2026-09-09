/**
 * What may be uploaded, and under what name.
 *
 * Pure and dependency-free so it can be unit-tested without a network, a
 * browser or the Firebase SDK — and so the rules an owner is judged against are
 * readable in one place.
 *
 * These same limits are enforced independently in `storage.rules`. This copy
 * gives the owner a clear message before a byte leaves their phone; the rules
 * copy is what actually stops a bad upload, because anything running in a
 * browser can be bypassed.
 */

export type UploadKind = "logo" | "menu";

interface KindSpec {
  folder: string;
  accept: readonly string[];
  /** What the file picker offers, in the same order. */
  acceptAttribute: string;
  maxBytes: number;
  /** Shown when the type is wrong, in the owner's language. */
  typeMessage: string;
  sizeMessage: string;
}

export const MB = 1024 * 1024;

export const UPLOAD_SPECS: Record<UploadKind, KindSpec> = {
  logo: {
    folder: "logo",
    accept: ["image/png", "image/jpeg"],
    acceptAttribute: "image/png,image/jpeg",
    maxBytes: 2 * MB,
    typeMessage: "Logo kena dalam format PNG atau JPG.",
    sizeMessage: "Saiz logo kena bawah 2MB.",
  },
  menu: {
    folder: "menus",
    accept: ["image/png", "image/jpeg", "application/pdf"],
    acceptAttribute: "image/png,image/jpeg,application/pdf",
    maxBytes: 5 * MB,
    typeMessage: "Menu kena dalam format PNG, JPG atau PDF.",
    sizeMessage: "Saiz fail menu kena bawah 5MB.",
  },
};

/** The parts of a `File` this module needs, so validation is testable offline. */
export interface UploadCandidate {
  name: string;
  type: string;
  size: number;
}

/**
 * `null` means the file is acceptable. Anything else is a message to show.
 *
 * Note the empty-file check: some Android file pickers hand back a zero-byte
 * placeholder for a file that is still syncing from cloud storage, and
 * uploading it would silently replace a good logo with nothing.
 */
export function validateUpload(
  kind: UploadKind,
  file: UploadCandidate,
): string | null {
  const spec = UPLOAD_SPECS[kind];
  if (file.size === 0) return "Fail ini kosong. Cuba pilih fail lain.";
  if (!spec.accept.includes(file.type)) return spec.typeMessage;
  if (file.size > spec.maxBytes) return spec.sizeMessage;
  return null;
}

/**
 * A safe object name derived from the owner's filename.
 *
 * Only the extension and a slug of the stem survive, so nothing in the path can
 * come from unfiltered user input. The timestamp prefix keeps two uploads of
 * `menu.pdf` from overwriting each other mid-upload, which matters because the
 * old object is only deleted once the new one has landed.
 */
export function objectName(original: string, now = Date.now()): string {
  const dot = original.lastIndexOf(".");
  const stem = (dot > 0 ? original.slice(0, dot) : original)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const ext = (dot > 0 ? original.slice(dot + 1) : "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 5);
  return `${now}-${stem || "fail"}${ext ? `.${ext}` : ""}`;
}

export function storagePath(uid: string, kind: UploadKind, name: string): string {
  return `restaurants/${uid}/${UPLOAD_SPECS[kind].folder}/${name}`;
}

