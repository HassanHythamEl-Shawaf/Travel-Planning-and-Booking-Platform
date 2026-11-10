import { ConflictException, NotImplementedException } from '@nestjs/common';
import { Types } from 'mongoose';

import { AirlinesService } from './airlines.service';
import { CreateAirlineDto, UpdateAirlineDto } from './dto/airline.dto';

const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) });
const leanExec = (value: unknown) => ({ lean: () => exec(value) });

describe('AirlinesService', () => {
  let model: Record<string, jest.Mock>;
  let service: AirlinesService;

  const id = new Types.ObjectId();
  const stored = {
    _id: id,
    name: 'Cairo Air',
    code: 'CA',
    logoUrl: null,
    isActive: true,
    createdAt: new Date('2026-11-10T10:00:00.000Z'),
    updatedAt: new Date('2026-11-10T10:00:00.000Z'),
  };

  beforeEach(() => {
    model = {
      create: jest.fn().mockResolvedValue(stored),
      findById: jest.fn().mockReturnValue(leanExec(stored)),
      findByIdAndUpdate: jest.fn().mockReturnValue(leanExec(stored)),
    };
    service = new AirlinesService(model as never, null);
  });

  it('creates an active airline with a null logo until upload integration exists', async () => {
    const dto: CreateAirlineDto = { name: 'Cairo Air', code: 'CA' };

    await expect(service.create(dto)).resolves.toMatchObject({
      id: id.toString(),
      name: 'Cairo Air',
      code: 'CA',
      isActive: true,
      logoUrl: null,
    });
    expect(model.create).toHaveBeenCalledWith({
      name: 'Cairo Air',
      code: 'CA',
      isActive: true,
      logoUrl: null,
    });
  });

  it('maps a stored airline profile', async () => {
    await expect(service.findOne(id.toString())).resolves.toMatchObject({
      id: id.toString(),
      name: 'Cairo Air',
      code: 'CA',
    });
  });

  it('updates only profile fields and never changes isActive', async () => {
    const dto: UpdateAirlineDto = { name: 'Cairo Airways', code: 'CW' };

    await service.update(id.toString(), dto);

    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      id.toString(),
      { name: 'Cairo Airways', code: 'CW' },
      { returnDocument: 'after', runValidators: true },
    );
  });

  it('rejects duplicate airline codes', async () => {
    model.create.mockRejectedValue({ code: 11000 });

    await expect(
      service.create({ name: 'Cairo Air', code: 'CA' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not accept a direct logo URL before Person 8 integration', async () => {
    await expect(
      service.create({
        name: 'Cairo Air',
        code: 'CA',
        logoUrl: 'https://example.com/logo.png',
      }),
    ).rejects.toBeInstanceOf(NotImplementedException);
    expect(model.create).not.toHaveBeenCalled();
  });
});
