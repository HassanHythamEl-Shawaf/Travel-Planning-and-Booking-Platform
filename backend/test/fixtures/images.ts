/**
 * Tiny test "images" for GEN-08 tests: the real JPEG/PNG signatures
 * followed by a few bytes. Enough for the upload module, which checks the
 * signature, size and nothing else.
 */
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

export const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

/** A JPEG of exactly `bytes` bytes. */
export function jpegOfSize(bytes: number): Buffer {
  const buffer = Buffer.alloc(bytes);
  JPEG_BYTES.copy(buffer);
  return buffer;
}
