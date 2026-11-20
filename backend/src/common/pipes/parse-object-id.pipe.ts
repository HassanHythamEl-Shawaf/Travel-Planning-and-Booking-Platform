import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

/** Rejects a malformed id with 400 before any database call. */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (
      typeof value !== 'string' ||
      !/^[0-9a-fA-F]{24}$/.test(value) ||
      !Types.ObjectId.isValid(value)
    ) {
      throw new BadRequestException('Invalid id');
    }
    return value;
  }
}
