import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreatePostDto, ListPostsQueryDto, UpdatePostDto } from './post.dto';

const errors = (cls: new () => object, plain: object) =>
  validateSync(plainToInstance(cls, plain) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);

describe('Post DTOs (D2)', () => {
  const valid = { title: 'Aswan', content: 'Body' };

  it('accepts a minimal post', () => {
    expect(errors(CreatePostDto, valid)).toEqual([]);
  });

  it('trims the title and enforces 3–150 characters', () => {
    expect(errors(CreatePostDto, { ...valid, title: '  ab  ' })).toEqual([
      'title',
    ]);
    expect(errors(CreatePostDto, { ...valid, title: '  abc  ' })).toEqual([]);
    expect(errors(CreatePostDto, { ...valid, title: 'a'.repeat(150) })).toEqual(
      [],
    );
    expect(errors(CreatePostDto, { ...valid, title: 'a'.repeat(151) })).toEqual(
      ['title'],
    );
  });

  it('enforces content 1–20,000 characters and not blank', () => {
    expect(errors(CreatePostDto, { ...valid, content: '' })).toEqual([
      'content',
    ]);
    expect(errors(CreatePostDto, { ...valid, content: '   ' })).toEqual([
      'content',
    ]);
    expect(
      errors(CreatePostDto, { ...valid, content: 'a'.repeat(20_000) }),
    ).toEqual([]);
    expect(
      errors(CreatePostDto, { ...valid, content: 'a'.repeat(20_001) }),
    ).toEqual(['content']);
  });

  it('accepts only draft or published', () => {
    expect(errors(CreatePostDto, { ...valid, status: 'archived' })).toEqual([
      'status',
    ]);
  });

  it('requires tags to be an array of strings', () => {
    expect(errors(CreatePostDto, { ...valid, tags: 'egypt' })).toEqual([
      'tags',
    ]);
    expect(errors(CreatePostDto, { ...valid, tags: [1] })).toEqual(['tags']);
  });

  it('makes every field optional on update', () => {
    expect(errors(UpdatePostDto, {})).toEqual([]);
    expect(errors(UpdatePostDto, { title: 'ab' })).toEqual(['title']);
  });

  it('limits q to 100 characters and validates authorId', () => {
    expect(errors(ListPostsQueryDto, { q: 'a'.repeat(100) })).toEqual([]);
    expect(errors(ListPostsQueryDto, { q: 'a'.repeat(101) })).toEqual(['q']);
    expect(errors(ListPostsQueryDto, { authorId: 'nope' })).toEqual([
      'authorId',
    ]);
  });
});
