/** Upload policy: explicit extension + MIME allowlist, size cap, and magic-byte sniffing for binary types. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_FILES_PER_UPLOAD = 5;

export const ALLOWED: Record<string, { mime: string; magic?: number[][] }> = {
  pdf: { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  gif: { mime: "image/gif", magic: [[0x47, 0x49, 0x46, 0x38]] },
  webp: { mime: "image/webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  txt: { mime: "text/plain" },
  md: { mime: "text/markdown" },
  csv: { mime: "text/csv" },
  zip: { mime: "application/zip", magic: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", magic: [[0x50, 0x4b, 0x03, 0x04]] },
};

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.normalize("NFKC").replace(/[^\p{L}\p{N}_.\- ()]+/gu, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return cleaned || "file";
}

export type FileCheck = { ok: true; ext: string; mime: string; name: string } | { ok: false; reason: string };

/** Validates a file by name, declared size and its first bytes. The stored MIME comes from the allowlist, never the client. */
export function checkUpload(name: string, size: number, head: Uint8Array): FileCheck {
  const clean = sanitizeFileName(name);
  const ext = clean.includes(".") ? clean.split(".").pop()!.toLowerCase() : "";
  const rule = ALLOWED[ext];
  if (!rule) return { ok: false, reason: `File type .${ext || "?"} is not allowed. Allowed: ${Object.keys(ALLOWED).join(", ")}` };
  if (size <= 0) return { ok: false, reason: "File is empty" };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` };
  if (rule.magic && !rule.magic.some((sig) => sig.every((b, i) => head[i] === b))) {
    return { ok: false, reason: `File contents don't match the .${ext} type` };
  }
  if (!rule.magic) {
    // Text types: reject obvious binaries (NUL bytes in the first chunk).
    if (head.slice(0, 1024).includes(0)) return { ok: false, reason: "Text file contains binary data" };
  }
  return { ok: true, ext, mime: rule.mime, name: clean };
}
