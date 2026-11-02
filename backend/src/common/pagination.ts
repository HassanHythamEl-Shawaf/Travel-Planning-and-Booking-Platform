import { BadRequestException } from '@nestjs/common';

export const DEFAULT_PAGE_SIZE = 10;

export interface Pagination {
  page: number;
  limit: typeof DEFAULT_PAGE_SIZE;
  skip: number;
}

export function getPagination(pageValue: string | number = 1): Pagination {
  if (typeof pageValue === 'string' && !/^\d+$/.test(pageValue)) {
    throw new BadRequestException('Page must be a positive integer');
  }

  const page = typeof pageValue === 'number' ? pageValue : Number(pageValue);

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger((page - 1) * DEFAULT_PAGE_SIZE)
  ) {
    throw new BadRequestException('Page must be a positive integer');
  }

  return {
    page,
    limit: DEFAULT_PAGE_SIZE,
    skip: (page - 1) * DEFAULT_PAGE_SIZE,
  };
}
