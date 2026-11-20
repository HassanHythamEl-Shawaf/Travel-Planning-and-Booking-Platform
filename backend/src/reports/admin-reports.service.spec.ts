import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

import { getPagination } from '../common/pagination';
import { AdminReportsService, DELETED_USER } from './admin-reports.service';
import { ReportReason, ReportStatus } from './report.constants';

const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) });

describe('AdminReportsService (GEN-09, GEN-10)', () => {
  const reporter = new Types.ObjectId();
  const author = new Types.ObjectId();
  const goneUser = new Types.ObjectId();
  const postId = new Types.ObjectId();
  const reviewId = new Types.ObjectId();
  const createdAt = new Date('2026-11-05T10:00:00Z');

  let reportModel: Record<string, jest.Mock>;
  let userModel: { find: jest.Mock };
  let chain: Record<string, jest.Mock>;
  let service: AdminReportsService;

  const doc = (
    targetType: string,
    targetId: Types.ObjectId,
    reporterId: Types.ObjectId,
    authorId: Types.ObjectId,
  ) => ({
    _id: new Types.ObjectId(),
    reporterId,
    targetType,
    targetId,
    reason: ReportReason.SPAM,
    details: null,
    status: ReportStatus.OPEN,
    snapshot: { title: 'Aswan', excerpt: 'shop', authorId },
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt,
  });

  beforeEach(() => {
    chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnValue(exec([])),
    };
    reportModel = {
      find: jest.fn().mockReturnValue(chain),
      countDocuments: jest.fn().mockReturnValue(exec(0)),
      aggregate: jest.fn().mockReturnValue(exec([])),
    };
    userModel = {
      find: jest.fn().mockReturnValue({ lean: () => exec([]) }),
    };
    service = new AdminReportsService(
      reportModel as never,
      userModel as never,
    );
  });

  it('defaults to open reports, newest first', async () => {
    await service.list({}, getPagination(1));
    expect(reportModel.find).toHaveBeenCalledWith({
      status: ReportStatus.OPEN,
    });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    // An empty page makes no lookups.
    expect(userModel.find).not.toHaveBeenCalled();
    expect(reportModel.aggregate).not.toHaveBeenCalled();
  });

  it('applies every filter; "all" drops the status filter', async () => {
    const from = new Date('2026-11-01');
    const to = new Date('2026-11-30');
    await service.list(
      {
        status: 'all',
        targetType: 'review',
        reason: ReportReason.HARASSMENT,
        targetId: reviewId.toString(),
        from,
        to,
      },
      getPagination(3),
    );
    expect(reportModel.find).toHaveBeenCalledWith({
      targetType: 'review',
      reason: ReportReason.HARASSMENT,
      targetId: reviewId,
      createdAt: { $gte: from, $lte: to },
    });
    expect(chain.skip).toHaveBeenCalledWith(20);

    await service.list(
      { status: ReportStatus.DISMISSED },
      getPagination(1),
    );
    expect(reportModel.find).toHaveBeenLastCalledWith({
      status: ReportStatus.DISMISSED,
    });
  });

  it('rejects "from" after "to"', async () => {
    await expect(
      service.list(
        { from: new Date('2026-12-01'), to: new Date('2026-11-01') },
        getPagination(1),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(reportModel.find).not.toHaveBeenCalled();
  });

  it('adds names from one $in query and open counts from one grouped count', async () => {
    chain.lean.mockReturnValue(
      exec([
        doc('post', postId, reporter, author),
        doc('post', postId, goneUser, author),
        doc('review', reviewId, reporter, goneUser),
      ]),
    );
    reportModel.countDocuments.mockReturnValue(exec(3));
    userModel.find.mockReturnValue({
      lean: () =>
        exec([
          { _id: reporter, name: 'Bob', email: 'bob@example.com' },
          { _id: author, name: 'Alice', email: 'alice@example.com' },
        ]),
    });
    reportModel.aggregate.mockReturnValue(
      exec([
        { _id: { targetType: 'post', targetId: postId }, count: 2 },
        { _id: { targetType: 'review', targetId: reviewId }, count: 1 },
      ]),
    );

    const result = await service.list({}, getPagination(1));

    expect(userModel.find).toHaveBeenCalledTimes(1);
    const ids = userModel.find.mock.calls[0][0]._id.$in.map(String);
    expect(ids.sort()).toEqual(
      [reporter, author, goneUser].map(String).sort(),
    );
    expect(reportModel.aggregate).toHaveBeenCalledTimes(1);
    const [match] = reportModel.aggregate.mock.calls[0][0];
    expect(match.$match.status).toBe(ReportStatus.OPEN);
    expect(match.$match.$or).toHaveLength(2);

    expect(result.total).toBe(3);
    expect(result.items[0]).toEqual({
      id: expect.any(String),
      targetType: 'post',
      targetId: postId.toString(),
      reason: ReportReason.SPAM,
      details: null,
      status: ReportStatus.OPEN,
      reporter: {
        id: reporter.toString(),
        name: 'Bob',
        email: 'bob@example.com',
      },
      snapshot: {
        title: 'Aswan',
        excerpt: 'shop',
        authorId: author.toString(),
        authorName: 'Alice',
      },
      openReportsOnTarget: 2,
      createdAt,
      resolvedBy: null,
      resolvedAt: null,
      resolutionNote: null,
    });
    expect(result.items[1].reporter).toEqual({
      id: goneUser.toString(),
      name: DELETED_USER,
      email: null,
    });
    expect(result.items[2].snapshot.authorName).toBe(DELETED_USER);
    expect(result.items[2].openReportsOnTarget).toBe(1);
  });
});
