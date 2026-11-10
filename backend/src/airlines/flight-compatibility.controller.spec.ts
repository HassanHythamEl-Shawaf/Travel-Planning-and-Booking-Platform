import { FlightCompatibilityController } from './flight-compatibility.controller';

describe('FlightCompatibilityController', () => {
  it('delegates the requirements-compatible airport route', async () => {
    const airlines = {
      listAirports: jest.fn().mockResolvedValue([]),
    };
    const controller = new FlightCompatibilityController(airlines as never);

    await expect(controller.listAirports()).resolves.toEqual([]);
    expect(airlines.listAirports).toHaveBeenCalledTimes(1);
  });

  it('delegates the requirements-compatible passenger export route', async () => {
    const airlines = {
      exportFlightBookings: jest.fn().mockResolvedValue('header\r\n'),
    };
    const controller = new FlightCompatibilityController(airlines as never);

    await expect(
      controller.exportFlightPassengers(
        { sub: 'moderator-1' } as never,
        'flight-1',
      ),
    ).resolves.toBe('header\r\n');
    expect(airlines.exportFlightBookings).toHaveBeenCalledWith(
      'moderator-1',
      'flight-1',
    );
  });
});
