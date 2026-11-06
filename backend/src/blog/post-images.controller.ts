import {
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { UploadedImageFile } from './blog-image-store';
import { PostImagesDto } from './dto/author.dto';
import { IMAGE_UPLOAD_UNAVAILABLE, PostImagesService } from './post-images.service';
import { ID_PARAM } from './posts.controller';

@ApiTags('Blog')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({ description: 'You can see the post but are not its author' })
@ApiNotImplementedResponse({ description: IMAGE_UPLOAD_UNAVAILABLE })
@UseGuards(AuthGuard)
@Controller('posts')
export class PostImagesController {
  constructor(private readonly images: PostImagesService) {}

  @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1 } }))
  @ApiOperation({
    summary: 'Attach an image to my post (BLG-10, GEN-08)',
    description:
      'Multipart field "file": JPG or PNG, up to 5 MB, at most 5 images per post. The first image is the cover.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ type: PostImagesDto })
  @ApiBadRequestResponse({
    description:
      'Invalid id, missing file, wrong type or size, or the post already has 5 images',
  })
  @ApiNotFoundResponse({ description: 'Post not found, or not visible to you' })
  add(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<PostImagesDto> {
    return this.images.add(id, user, file);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remove an image from my post (BLG-10)',
    description: 'Removes it from the post, then deletes the file.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'imageId', example: 'a1b2c3d4' })
  @ApiOkResponse({ type: PostImagesDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({
    description: 'Post not found or not visible to you, or the image is not on it',
  })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PostImagesDto> {
    return this.images.remove(id, imageId, user);
  }
}
