import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(LIB_DIR, '..', '..');

export const DEFAULT_FAVICON_SOURCE = path.join(ROOT_DIR, 'src', 'assets', 'favicon_1254x1254.png');
export const DEFAULT_PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export interface IcoFrame {
  size: number;
  buffer: Buffer;
}

export interface FaviconSuiteResult {
  sourcePath: string;
  outDir: string;
  files: string[];
}

const PNG_SPECS: readonly { filename: string; size: number }[] = [
  { filename: 'favicon-48x48.png', size: 48 },
  { filename: 'favicon-96x96.png', size: 96 },
  { filename: 'apple-touch-icon.png', size: 180 },
  { filename: 'favicon-192x192.png', size: 192 },
  { filename: 'favicon-512x512.png', size: 512 },
];

const ICO_SIZES: readonly number[] = [48, 96];

/**
 * Packs 32-bit RGBA PNG buffers (>= 48x48 only: 48x48 and 96x96) into a spec-compliant
 * `.ico` container so neither Google Search nor desktop tabs ever select blurry <48px frames.
 */
export function encodeMultiSizeIco(frames: readonly IcoFrame[]): Buffer {
  const headerSize = 6;
  const dirEntrySize = 16;
  const totalHeaderBytes = headerSize + dirEntrySize * frames.length;
  const totalBytes = totalHeaderBytes + frames.reduce((sum, item) => sum + item.buffer.length, 0);

  const out = Buffer.alloc(totalBytes);
  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(frames.length, 4);

  let dataOffset = totalHeaderBytes;
  frames.forEach((frame, idx) => {
    const entryOffset = headerSize + idx * dirEntrySize;
    out.writeUInt8(frame.size >= 256 ? 0 : frame.size, entryOffset);
    out.writeUInt8(frame.size >= 256 ? 0 : frame.size, entryOffset + 1);
    out.writeUInt8(0, entryOffset + 2);
    out.writeUInt8(0, entryOffset + 3);
    out.writeUInt16LE(1, entryOffset + 4);
    out.writeUInt16LE(32, entryOffset + 6);
    out.writeUInt32LE(frame.buffer.length, entryOffset + 8);
    out.writeUInt32LE(dataOffset, entryOffset + 12);

    frame.buffer.copy(out, dataOffset);
    dataOffset += frame.buffer.length;
  });

  return out;
}

export async function generateFaviconSuite(options?: {
  sourcePath?: string;
  outDir?: string;
}): Promise<FaviconSuiteResult> {
  const sourcePath = options?.sourcePath ?? DEFAULT_FAVICON_SOURCE;
  const outDir = options?.outDir ?? DEFAULT_PUBLIC_DIR;

  const sourceBuffer = await fs.readFile(sourcePath);
  const meta = await sharp(sourceBuffer).metadata();
  if (!meta.width || !meta.height || meta.width !== meta.height || meta.width < 512) {
    throw new Error(
      `Expected square high-res master favicon (>= 512x512), found ${meta.width}x${meta.height} at ${sourcePath}`,
    );
  }

  await fs.mkdir(outDir, { recursive: true });

  await Promise.all(
    PNG_SPECS.map(async ({ filename, size }) => {
      await sharp(sourceBuffer)
        .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(path.join(outDir, filename));
    }),
  );

  const icoFrames = await Promise.all(
    ICO_SIZES.map(async (size) => {
      const buffer = await sharp(sourceBuffer)
        .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
        .ensureAlpha()
        .png({ compressionLevel: 9 })
        .toBuffer();
      return { size, buffer };
    }),
  );

  const icoBuffer = encodeMultiSizeIco(icoFrames);
  await fs.writeFile(path.join(outDir, 'favicon.ico'), icoBuffer);

  return {
    sourcePath,
    outDir,
    files: ['favicon.ico', ...PNG_SPECS.map((s) => s.filename)],
  };
}
