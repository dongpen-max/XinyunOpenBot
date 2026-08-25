import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { DATA_DIR } from "./config.js";
export const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MIMES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
};
export function extensionForMime(mime) {
    if (!mime)
        return null;
    return IMAGE_MIMES[mime.split(";")[0].trim().toLowerCase()] ?? null;
}
function mimeForExt(ext) {
    switch (ext) {
        case ".png": return "image/png";
        case ".jpg": return "image/jpeg";
        case ".gif": return "image/gif";
        case ".webp": return "image/webp";
        default: return "application/octet-stream";
    }
}
export function ensureAttachmentsDir() {
    mkdirSync(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });
}
export function saveImage(bytes, mime) {
    const normalized = mime.split(";")[0].trim().toLowerCase();
    const extension = extensionForMime(normalized);
    if (!extension)
        throw Object.assign(new Error("不支持的图片类型"), { status: 400 });
    if (bytes.byteLength === 0)
        throw Object.assign(new Error("图片内容为空"), { status: 400 });
    if (bytes.byteLength > IMAGE_MAX_BYTES) {
        throw Object.assign(new Error(`图片超过 ${IMAGE_MAX_BYTES} 字节限制`), { status: 413 });
    }
    ensureAttachmentsDir();
    const filename = `${randomUUID()}${extension}`;
    const path = join(ATTACHMENTS_DIR, filename);
    writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
    return { path, mime: normalized, bytes: bytes.byteLength };
}
export function readAttachment(name) {
    if (!/^[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/.test(name))
        return null;
    const path = join(ATTACHMENTS_DIR, name);
    try {
        return { bytes: readFileSync(path), mime: mimeForExt(extname(path)) };
    }
    catch {
        return null;
    }
}
