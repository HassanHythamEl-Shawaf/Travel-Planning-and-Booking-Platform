import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CommentBodyDto } from './comment.dto';

const check = (content: unknown) => {
  const dto = plainToInstance(CommentBodyDto, { content });
  return { dto, errors: validateSync(dto).map((e) => e.property) };
};

describe('CommentBodyDto (BLG-05: non-empty, max 500)', () => {
  it('trims and accepts 1–500 characters', () => {
    expect(check('  hi  ')).toMatchObject({ dto: { content: 'hi' }, errors: [] });
    expect(check('a'.repeat(500)).errors).toEqual([]);
  });

  it('rejects empty, blank, 501 characters and non-strings', () => {
    for (const bad of ['', '    ', 'a'.repeat(501), 42]) {
      expect(check(bad).errors).toEqual(['content']);
    }
  });
});
