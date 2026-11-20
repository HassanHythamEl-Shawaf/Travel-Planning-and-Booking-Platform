import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { UserRole } from '../users/schemas/user.schema';
import { BlogImageCleaner } from './blog-image-cleaner';
import { PostImagesService } from './post-images.service';

const query = (value: unknown) => ({
  lean: () => ({ exec: () => Promise.resolve(value) }),
});

describe('PostImagesService (BLG-10, GEN-08, D15)', () => {
  const postId = new Types.ObjectId();
  const authorId = new Types.ObjectId();
  const author = { sub: authorId.toString(), role: UserRole.USER };
  const file = {
    originalname: 'nile.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('jpg'),
  };
  const images = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ imageId: `i${i}`, url: `/u/i${i}` }));

  let post: Record<string, unknown>;
  let postModel: { findOneAndUpdate: jest.Mock };
  let posts: { loadOwned: jest.Mock };
  let store: { upload: jest.Mock; delete: jest.Mock };
  let service: PostImagesService;

  const build = (bound: boolean) =>
    new PostImagesService(
      postModel as never,
      posts as never,
      new BlogImageCleaner(bound ? (store as never) : null),
      bound ? (store as never) : null,
    );

  beforeEach(() => {
    post = { _id: postId, authorId, images: images(1) };
    postModel = {
      findOneAndUpdate: jest
        .fn()
        .mockImplementation(() =>
          query({ ...post, images: [...(post.images as object[]), { imageId: 'new', url: '/u/new' }] }),
        ),
    };
    posts = {
      loadOwned: jest.fn().mockImplementation(() => Promise.resolve({ post })),
    };
    store = {
      upload: jest.fn().mockResolvedValue({ imageId: 'new', url: '/u/new' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = build(true);
  });

  it('answers 501 until the upload module is bound', async () => {
    service = build(false);
    await expect(service.add(postId.toString(), author, file)).rejects.toThrow(
      new NotImplementedException('Image upload not available yet'),
    );
    await expect(
      service.remove(postId.toString(), 'i0', author),
    ).rejects.toThrow(NotImplementedException);
    expect(posts.loadOwned).not.toHaveBeenCalled();
  });

  it('uploads through the store and appends the image (first stays the cover)', async () => {
    const result = await service.add(postId.toString(), author, file);
    expect(store.upload).toHaveBeenCalledWith(file, {
      type: 'post',
      id: postId.toString(),
    });
    expect(postModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: postId, authorId, 'images.4': { $exists: false } },
      { $push: { images: { imageId: 'new', url: '/u/new' } } },
      { returnDocument: 'after' },
    );
    expect(result.images.map((i) => i.imageId)).toEqual(['i0', 'new']);
  });

  it('answers 400 without a file', async () => {
    await expect(
      service.add(postId.toString(), author, undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a sixth image before uploading', async () => {
    post = { ...post, images: images(5) };
    await expect(service.add(postId.toString(), author, file)).rejects.toThrow(
      new BadRequestException('A post can have at most 5 images'),
    );
    expect(store.upload).not.toHaveBeenCalled();
  });

  it('deletes the uploaded file when a concurrent upload filled the post', async () => {
    postModel.findOneAndUpdate.mockReturnValue(query(null));
    await expect(service.add(postId.toString(), author, file)).rejects.toThrow(
      BadRequestException,
    );
    expect(store.delete).toHaveBeenCalledWith('new');
  });

  it('passes the store\'s type/size errors through', async () => {
    store.upload.mockRejectedValue(new BadRequestException('Only JPG or PNG'));
    await expect(service.add(postId.toString(), author, file)).rejects.toThrow(
      'Only JPG or PNG',
    );
  });

  it('propagates 403/404 from the ownership check', async () => {
    posts.loadOwned.mockRejectedValue(new ForbiddenException());
    await expect(service.add(postId.toString(), author, file)).rejects.toThrow(
      ForbiddenException,
    );
    expect(store.upload).not.toHaveBeenCalled();
  });

  it('removes the image from the post, then the file', async () => {
    postModel.findOneAndUpdate.mockReturnValue(query({ ...post, images: [] }));
    const result = await service.remove(postId.toString(), 'i0', author);
    expect(postModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: postId, authorId, 'images.imageId': 'i0' },
      { $pull: { images: { imageId: 'i0' } } },
      { returnDocument: 'after' },
    );
    expect(store.delete).toHaveBeenCalledWith('i0');
    expect(result.images).toEqual([]);
  });

  it('answers 404 for an image that is not on the post', async () => {
    postModel.findOneAndUpdate.mockReturnValue(query(null));
    await expect(
      service.remove(postId.toString(), 'nope', author),
    ).rejects.toThrow(NotFoundException);
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('still answers 200 when the file delete fails', async () => {
    store.delete.mockRejectedValue(new Error('disk'));
    postModel.findOneAndUpdate.mockReturnValue(query({ ...post, images: [] }));
    await expect(
      service.remove(postId.toString(), 'i0', author),
    ).resolves.toEqual({ images: [] });
  });
});

describe('BlogImageCleaner', () => {
  it('does nothing while unbound', async () => {
    await expect(new BlogImageCleaner(null).deleteFiles(['a'])).resolves.toBeUndefined();
  });

  it('deletes every file and swallows failures', async () => {
    const store = {
      upload: jest.fn(),
      delete: jest
        .fn()
        .mockRejectedValueOnce(new Error('disk'))
        .mockResolvedValue(undefined),
    };
    await new BlogImageCleaner(store).deleteFiles(['a', 'b']);
    expect(store.delete.mock.calls).toEqual([['a'], ['b']]);
  });
});
