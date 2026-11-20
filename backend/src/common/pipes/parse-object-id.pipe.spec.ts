import { BadRequestException } from '@nestjs/common';

import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();

  it('accepts a 24-character hex id', () => {
    expect(pipe.transform('6650f1c2a1b2c3d4e5f60718')).toBe(
      '6650f1c2a1b2c3d4e5f60718',
    );
  });

  it.each(['abc', '123456789012', 'zzzzzzzzzzzzzzzzzzzzzzzz', ''])(
    'rejects %p with 400',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});
