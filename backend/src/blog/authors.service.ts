import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { Pagination } from '../common/pagination';
import { AccountStatus, User, UserRole } from '../users/schemas/user.schema';
import { AUTHOR_ITINERARIES_MAX } from './blog.constants';
import { AuthorPageDto } from './dto/author.dto';
import { PostsService } from './posts.service';
import { PublicItineraryReader } from './public-itinerary.reader';

interface AuthorRow {
  _id: Types.ObjectId;
  name: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: Date;
}

/** BLG-12 (D16). */
@Injectable()
export class AuthorsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly posts: PostsService,
    private readonly itineraries: PublicItineraryReader,
  ) {}

  /**
   * Unknown, deactivated, admin and moderator accounts → 404. Suspended
   * authors stay visible (ACC-16).
   */
  async findOne(id: string, page: Pagination): Promise<AuthorPageDto> {
    const user = await this.userModel
      .findById(id, { name: 1, role: 1, status: 1, createdAt: 1 })
      .lean<AuthorRow>()
      .exec();
    if (
      !user ||
      user.role !== UserRole.USER ||
      user.status === AccountStatus.DEACTIVATED
    ) {
      throw new NotFoundException('Author not found');
    }

    const [posts, publicItineraries] = await Promise.all([
      this.posts.listPublished({ authorId: id }, page),
      this.itineraries.listPublicByOwner(user._id, AUTHOR_ITINERARIES_MAX),
    ]);

    return {
      id,
      name: user.name,
      joinedAt: user.createdAt,
      publishedPostCount: posts.total,
      posts,
      publicItineraries,
    };
  }
}
