import { BadRequestException } from '@nestjs/common';

import { DEFAULT_PAGE_SIZE, getPagination } from './pagination';

describe('getPagination', () => {
  it('uses the fixed page size and calculates the offset', () => {
    expect(getPagination('3')).toEqual({
      page: 3,
      limit: DEFAULT_PAGE_SIZE,
      skip: 20,
    });
  });

  it.each(['0', '-1', '1.5', 'not-a-page'])(
    'rejects invalid page value %s',
    (page) => {
      expect(() => getPagination(page)).toThrow(BadRequestException);
    },
  );
});
