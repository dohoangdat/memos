/**
 * Writes the length into a WebM recording (fork). Chrome's MediaRecorder leaves the Duration out
 * of the file, so players guess (a 3-second note shows as 14:59, or as live). This adds the
 * Duration element to the Segment's Info, in milliseconds (the default timecode scale).
 * Anything unexpected returns the recording unchanged.
 */
const INFO_ID = [0x15, 0x49, 0xa9, 0x66];
const DURATION_ID = [0x44, 0x89];
const TIMECODE_SCALE_ID = [0x2a, 0xd7, 0xb1];

const findId = (bytes: Uint8Array, id: number[], from = 0, to = bytes.length) => {
  for (let index = from; index <= to - id.length; index++) {
    if (id.every((byte, offset) => bytes[index + offset] === byte)) return index;
  }
  return -1;
};

/** An EBML variable-length size: its value and how many bytes it takes. */
const readVint = (bytes: Uint8Array, at: number): { value: number; length: number } | null => {
  const first = bytes[at];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8) return null;
  let value = first & (0xff >> length);
  for (let index = 1; index < length; index++) value = value * 256 + bytes[at + index];
  return { value, length };
};

const vint8 = (value: number) => {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let index = 7; index >= 1; index--) {
    out[index] = value % 256;
    value = Math.floor(value / 256);
  }
  return out;
};

export async function fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.type.includes("webm") || !(durationMs > 0)) return blob;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = findId(bytes, INFO_ID, 0, Math.min(bytes.length, 4096));
    if (info < 0) return blob;
    const size = readVint(bytes, info + 4);
    if (!size) return blob;
    const contentStart = info + 4 + size.length;
    const contentEnd = contentStart + size.value;
    if (findId(bytes, DURATION_ID, contentStart, contentEnd) >= 0) return blob;
    // A non-default timecode scale would change the unit; leave such files alone.
    const scale = findId(bytes, TIMECODE_SCALE_ID, contentStart, contentEnd);
    if (scale >= 0) {
      const scaleSize = readVint(bytes, scale + 3);
      let value = 0;
      for (let index = 0; scaleSize && index < scaleSize.value; index++) value = value * 256 + bytes[scale + 3 + scaleSize.length + index];
      if (value !== 1_000_000) return blob;
    }
    const duration = new Uint8Array(11);
    duration.set(DURATION_ID);
    duration[2] = 0x88; // 8-byte float
    new DataView(duration.buffer).setFloat64(3, durationMs);
    const parts = [
      bytes.subarray(0, info + 4),
      vint8(size.value + duration.length),
      bytes.subarray(contentStart, contentEnd),
      duration,
      bytes.subarray(contentEnd),
    ];
    return new Blob(parts, { type: blob.type });
  } catch {
    return blob;
  }
}
