import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";

import type { AssetRef } from "../content/types.ts";
import { readSignature } from "../creative/browser.ts";
import { firebaseStorage } from "./client";
import {
  objectName,
  storagePath,
  validateUpload,
  type UploadKind,
} from "./upload-rules";

export * from "./upload-rules";

/**
 * Uploads for the two files an owner gives us: their logo and their menu.
 *
 * Everything lives under `restaurants/{uid}/…`, which is the same ownership
 * boundary Firestore uses. The path is not a secret and is not treated as one —
 * `storage.rules` authorises every read and write against the uid in the path,
 * so knowing another owner's path gets a stranger nothing.
 *
 * What may be uploaded lives in `upload-rules.ts`, which has no SDK dependency
 * and is unit-tested directly.
 */

export interface UploadOptions {
  /** 0-100. Real bytes transferred, not a simulated animation. */
  onProgress?: (percent: number) => void;
}

/**
 * Uploads one file and returns the reference to store on the restaurant.
 *
 * Resumable rather than a single `uploadBytes` call so the progress an owner
 * sees is the actual transfer — on a phone connection a 5MB menu is not
 * instant, and a fake bar that jumps to 90% and stops is worse than none.
 */
export async function uploadAsset(
  uid: string,
  kind: UploadKind,
  file: File,
  options: UploadOptions = {},
): Promise<AssetRef> {
  const problem = validateUpload(kind, file);
  if (problem) throw new Error(problem);

  const path = storagePath(uid, kind, objectName(file.name));
  const object = ref(firebaseStorage(), path);

  const task = uploadBytesResumable(object, file, { contentType: file.type });
  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (!snapshot.totalBytes) return;
        options.onProgress?.(
          Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
        );
      },
      reject,
      () => resolve(),
    );
  });

  // Read while the file is still in hand. This is the only moment in the
  // product where a picture is decoded somewhere that can also look at it, and
  // composition is pure and synchronous everywhere afterwards — so a crop that
  // knows where the food is either gets its numbers here or never gets them.
  // A file that will not decode, or a logo or a menu PDF, yields nothing and
  // composes exactly as it did before signatures existed.
  const signature = kind === "creative" ? await readSignature(file) : null;

  return {
    path,
    url: await getDownloadURL(object),
    name: file.name,
    contentType: file.type,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    ...(signature ? { signature } : {}),
  };
}

/**
 * Removes a stored file. Missing objects are not an error.
 *
 * A delete that fails must never block the owner: if the object is already gone
 * — or the rules refuse — the important thing is that the restaurant document
 * stops pointing at it. The orphaned bytes are a cleanup problem, not theirs.
 */
export async function deleteAsset(asset: AssetRef | null): Promise<void> {
  if (!asset?.path) return;
  try {
    await deleteObject(ref(firebaseStorage(), asset.path));
  } catch {
    // Deliberately swallowed. See above.
  }
}
