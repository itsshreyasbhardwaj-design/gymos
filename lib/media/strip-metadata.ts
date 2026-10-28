/**
 * Metadata stripping for uploaded images.
 *
 * Phone photos carry EXIF, which routinely includes GPS coordinates, the device
 * serial and the exact capture time. None of that is needed to keep a personal
 * journal, so it is removed before the bytes are ever written to disk.
 *
 * This is a real parser over the container formats, not a re-encode: it walks the
 * segment/chunk structure and drops the metadata blocks, leaving image data intact.
 * Zero dependencies, which is why it covers JPEG, PNG and WebP rather than every
 * format in existence — `stripImageMetadata` reports what it actually did.
 */

export interface StripResult {
  bytes: Buffer;
  /** True only when the format was understood and metadata blocks were removed. */
  /** True only when metadata was actually found and removed. */
  stripped: boolean;
  format: 'jpeg' | 'png' | 'webp' | 'mpeg' | 'unknown';
  removedBlocks: string[];
  bytesRemoved: number;
}

export function stripImageMetadata(input: Buffer): StripResult {
  if (isJpeg(input)) return stripJpeg(input);
  if (isPng(input)) return stripPng(input);
  if (isWebp(input)) return stripWebp(input);
  return { bytes: input, stripped: false, format: 'unknown', removedBlocks: [], bytesRemoved: 0 };
}

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
const isPng = (b: Buffer) =>
  b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
const isWebp = (b: Buffer) =>
  b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' &&
  b.subarray(8, 12).toString('ascii') === 'WEBP';

/**
 * JPEG: drop every APPn application segment (EXIF lives in APP1, XMP in APP1,
 * Photoshop/IPTC in APP13) and the COM comment segment. Structural markers and the
 * compressed scan data are left untouched.
 */
function stripJpeg(input: Buffer): StripResult {
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  const removed: string[] = [];
  let i = 2;

  while (i < input.length - 1) {
    if (input[i] !== 0xff) {
      // Not at a marker boundary; copy the remainder verbatim rather than guess.
      out.push(input.subarray(i));
      break;
    }
    const marker = input[i + 1] as number;

    // Start of scan: everything from here is entropy-coded image data.
    if (marker === 0xda) {
      out.push(input.subarray(i));
      break;
    }
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(input.subarray(i, i + 2));
      i += 2;
      continue;
    }

    const length = input.readUInt16BE(i + 2);
    const segmentEnd = i + 2 + length;
    if (length < 2 || segmentEnd > input.length) {
      out.push(input.subarray(i));
      break;
    }

    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (isApp || isComment) {
      removed.push(isComment ? 'COM' : `APP${marker - 0xe0}`);
    } else {
      out.push(input.subarray(i, segmentEnd));
    }
    i = segmentEnd;
  }

  const bytes = Buffer.concat(out);
  return {
    bytes,
    stripped: removed.length > 0,
    format: 'jpeg',
    removedBlocks: [...new Set(removed)],
    bytesRemoved: input.length - bytes.length,
  };
}

/** PNG: keep only the chunks an image needs; drop text, EXIF and timestamp chunks. */
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP',
  'bKGD', 'pHYs', 'sBIT', 'hIST', 'acTL', 'fcTL', 'fdAT',
]);

function stripPng(input: Buffer): StripResult {
  const out: Buffer[] = [input.subarray(0, 8)];
  const removed: string[] = [];
  let i = 8;

  while (i + 8 <= input.length) {
    const length = input.readUInt32BE(i);
    const type = input.subarray(i + 4, i + 8).toString('ascii');
    const chunkEnd = i + 12 + length;
    if (chunkEnd > input.length) break;

    if (PNG_KEEP.has(type)) out.push(input.subarray(i, chunkEnd));
    else removed.push(type);

    i = chunkEnd;
    if (type === 'IEND') break;
  }

  const bytes = Buffer.concat(out);
  return {
    bytes,
    stripped: removed.length > 0,
    format: 'png',
    removedBlocks: [...new Set(removed)],
    bytesRemoved: input.length - bytes.length,
  };
}

/** WebP: drop the EXIF and XMP RIFF chunks, rewriting the container size. */
function stripWebp(input: Buffer): StripResult {
  const removed: string[] = [];
  const chunks: Buffer[] = [];
  let i = 12;

  while (i + 8 <= input.length) {
    const fourcc = input.subarray(i, i + 4).toString('ascii');
    const size = input.readUInt32LE(i + 4);
    const padded = size + (size % 2);
    const chunkEnd = i + 8 + padded;
    if (chunkEnd > input.length) break;

    if (fourcc === 'EXIF' || fourcc === 'XMP ') removed.push(fourcc.trim());
    else chunks.push(input.subarray(i, chunkEnd));

    i = chunkEnd;
  }

  if (removed.length === 0) {
    return { bytes: input, stripped: false, format: 'webp', removedBlocks: [], bytesRemoved: 0 };
  }

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  const bytes = Buffer.concat([header, body]);

  return {
    bytes,
    stripped: removed.length > 0,
    format: 'webp',
    removedBlocks: removed,
    bytesRemoved: input.length - bytes.length,
  };
}

/* ------------------------------------------------------------------- audio */

const ID3V1_SIZE = 128;

/**
 * Strips ID3 tags from an MPEG audio file.
 *
 * Browser recordings (WebM/Ogg/MP4 from MediaRecorder) carry no user metadata, but an
 * uploaded MP3 routinely carries ID3 frames, which can hold a name, a comment or
 * cover art. Both tag versions sit at the ends of the file and are safe to cut: ID3v2
 * is a length-prefixed header at the front, ID3v1 a fixed 128-byte trailer.
 *
 * Other containers are returned untouched, and `stripped` stays false — this function
 * never claims to have cleaned a format it does not understand.
 */
export function stripAudioMetadata(input: Buffer, mimeType: string): StripResult {
  if (mimeType !== 'audio/mpeg' && mimeType !== 'audio/mp3') {
    return { bytes: input, stripped: false, format: 'unknown', removedBlocks: [], bytesRemoved: 0 };
  }

  let start = 0;
  let end = input.length;
  const removed: string[] = [];

  // ID3v2: "ID3" + version(2) + flags(1) + syncsafe size(4), the size excluding the
  // 10-byte header itself.
  while (
    end - start >= 10 &&
    input[start] === 0x49 &&
    input[start + 1] === 0x44 &&
    input[start + 2] === 0x33
  ) {
    const b6 = input[start + 6] ?? 0;
    const b7 = input[start + 7] ?? 0;
    const b8 = input[start + 8] ?? 0;
    const b9 = input[start + 9] ?? 0;
    // Each size byte is 7-bit ("syncsafe"); a high bit set means this is not a tag.
    if ((b6 | b7 | b8 | b9) & 0x80) break;
    const size = (b6 << 21) | (b7 << 14) | (b8 << 7) | b9;
    const next = start + 10 + size;
    if (size <= 0 || next > end) break;
    removed.push('ID3v2');
    start = next;
  }

  if (
    end - start >= ID3V1_SIZE &&
    input[end - ID3V1_SIZE] === 0x54 &&
    input[end - ID3V1_SIZE + 1] === 0x41 &&
    input[end - ID3V1_SIZE + 2] === 0x47
  ) {
    removed.push('ID3v1');
    end -= ID3V1_SIZE;
  }

  if (removed.length === 0) {
    return { bytes: input, stripped: false, format: 'mpeg', removedBlocks: [], bytesRemoved: 0 };
  }
  const bytes = input.subarray(start, end);
  return {
    bytes: Buffer.from(bytes),
    stripped: true,
    format: 'mpeg',
    removedBlocks: [...new Set(removed)],
    bytesRemoved: input.length - bytes.length,
  };
}
