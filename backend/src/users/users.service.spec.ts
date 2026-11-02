import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const exec = jest.fn();
  const lean = jest.fn(() => ({ exec }));
  const findOneAndUpdate = jest.fn(() => ({ lean }));

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getModelToken(User.name),
          useValue: { findOneAndUpdate },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('records failed attempts with one conditional database update', async () => {
    const now = new Date();
    exec.mockResolvedValue({
      failedLoginAttempts: 5,
      lockUntil: new Date(now.getTime() + 15 * 60 * 1000),
    });

    await service.recordFailedLogin(' USER@example.com ', now);

    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      email: 'user@example.com',
      status: 'active',
    });
    expect(update).toHaveLength(2);
    expect(update[1]).toHaveProperty(
      '$set.lockUntil.$cond.1.$dateAdd.amount',
      15,
    );
    expect(options).toMatchObject({
      new: true,
      projection: { failedLoginAttempts: 1, lockUntil: 1 },
    });
  });
});
