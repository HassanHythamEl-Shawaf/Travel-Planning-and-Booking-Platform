import { JPEG_BYTES, PNG_BYTES } from '../../test/fixtures/images';
import { detectImageType, isUploadedFile } from './image-file';

describe('detectImageType (GEN-08)', () => {
  it('recognises JPEG and PNG by their first bytes', () => {
    expect(detectImageType(JPEG_BYTES)).toBe('jpg');
    expect(detectImageType(PNG_BYTES)).toBe('png');
  });

  it('rejects other content, whatever the file is called', () => {
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('%PDF-1.7'))).toBeNull();
  });

  it('rejects files shorter than a signature', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(PNG_BYTES.subarray(0, 7))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('isUploadedFile', () => {
  it('accepts objects with a Buffer and rejects anything else', () => {
    expect(isUploadedFile({ buffer: JPEG_BYTES })).toBe(true);
    expect(isUploadedFile({ buffer: 'not a buffer' })).toBe(false);
    expect(isUploadedFile(undefined)).toBe(false);
    expect(isUploadedFile(null)).toBe(false);
  });
});
