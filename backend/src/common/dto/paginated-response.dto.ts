import { ApiProperty } from '@nestjs/swagger';

/**
 * Pagination fields shared by list responses (GEN-05). Swagger cannot
 * describe generics, so each list declares a subclass with a typed `items`.
 */
export abstract class PaginatedResponseDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
