import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';

import {
  FlightInventoryHold,
  InventoryHoldStatus,
} from './schemas/flight-inventory-hold.schema';
import { Flight, FlightStatus } from './schemas/flight.schema';

export interface FlightInventory {
  flightId: string;
  cabinId: string;
  seatsTotal: number;
  seatsBooked: number;
  seatsHeld: number;
  seatsAvailable: number;
}

export interface FlightInventoryHoldResult {
  holdId: string;
  flightId: string;
  cabinId: string;
  seats: number;
  expiresAt: Date;
}

export interface FlightInventoryReader {
  checkAvailability(flightId: string, cabinId: string): Promise<FlightInventory>;
  createHold(
    flightId: string,
    cabinId: string,
    seats: number,
    expiresAt: Date,
  ): Promise<FlightInventoryHoldResult>;
  confirmInventory(holdId: string): Promise<void>;
  releaseHold(holdId: string): Promise<void>;
  releaseFlightHolds(flightId: string): Promise<void>;
}

export const FLIGHT_INVENTORY = Symbol('FLIGHT_INVENTORY');

@Injectable()
export class FlightInventoryService implements FlightInventoryReader {
  constructor(
    @InjectModel(Flight.name)
    private readonly flightModel: Model<Flight>,
    @InjectModel(FlightInventoryHold.name)
    private readonly holdModel: Model<FlightInventoryHold>,
  ) {}

  async checkAvailability(
    flightId: string,
    cabinId: string,
  ): Promise<FlightInventory> {
    const flight = await this.findFlight(flightId);
    const cabin = flight.cabins.find(
      (candidate) => String(candidate._id) === cabinId,
    );
    if (!cabin) throw new NotFoundException('Cabin not found');
    const seatsBooked = cabin.seatsBooked ?? 0;
    const seatsHeld = cabin.seatsHeld ?? 0;
    return {
      flightId,
      cabinId,
      seatsTotal: cabin.seatCount,
      seatsBooked,
      seatsHeld,
      seatsAvailable: cabin.seatCount - seatsBooked - seatsHeld,
    };
  }

  async createHold(
    flightId: string,
    cabinId: string,
    seats: number,
    expiresAt: Date,
  ): Promise<FlightInventoryHoldResult> {
    this.validateSeatRequest(flightId, cabinId, seats, expiresAt);
    const cabinObjectId = new Types.ObjectId(cabinId);
    // MongoDB only allows $expr at the top level of a filter, so the cabin is
    // matched by _id in $elemMatch (which also sets the positional `cabins.$`
    // for the update) and the seat check runs over the cabins array in a
    // top-level $expr. Both happen in one findOneAndUpdate, so the check and
    // the increment stay atomic under concurrent requests.
    const flight = await this.flightModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(flightId),
          status: FlightStatus.SCHEDULED,
          cabins: { $elemMatch: { _id: cabinObjectId } },
          $expr: {
            $anyElementTrue: [
              {
                $map: {
                  input: '$cabins',
                  as: 'cabin',
                  in: {
                    $and: [
                      { $eq: ['$$cabin._id', cabinObjectId] },
                      {
                        $gte: [
                          {
                            $subtract: [
                              '$$cabin.seatCount',
                              {
                                $add: [
                                  { $ifNull: ['$$cabin.seatsBooked', 0] },
                                  { $ifNull: ['$$cabin.seatsHeld', 0] },
                                  seats,
                                ],
                              },
                            ],
                          },
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
        { $inc: { 'cabins.$.seatsHeld': seats } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (!flight) {
      throw new ConflictException(
        'Flight is not scheduled or does not have enough available seats',
      );
    }

    const holdId = randomUUID();
    try {
      await this.holdModel.create({
        holdId,
        flightId: new Types.ObjectId(flightId),
        cabinId: new Types.ObjectId(cabinId),
        seats,
        status: InventoryHoldStatus.HELD,
        expiresAt,
      });
    } catch (error) {
      await this.releaseSeats(flightId, cabinId, seats);
      throw error;
    }
    return { holdId, flightId, cabinId, seats, expiresAt };
  }

  async confirmInventory(holdId: string): Promise<void> {
    const hold = await this.holdModel.findOneAndUpdate(
      { holdId, status: InventoryHoldStatus.HELD, expiresAt: { $gt: new Date() } },
      { $set: { status: InventoryHoldStatus.CONFIRMED } },
      { returnDocument: 'after' },
    ).lean().exec();
    if (!hold) throw new ConflictException('Hold is missing, expired or finalized');
    // $elemMatch makes both conditions apply to the same cabin, so the
    // positional `cabins.$` below updates the held cabin and no other.
    const updated = await this.flightModel.updateOne(
      {
        _id: hold.flightId,
        cabins: {
          $elemMatch: { _id: hold.cabinId, seatsHeld: { $gte: hold.seats } },
        },
      },
      {
        $inc: {
          'cabins.$.seatsHeld': -hold.seats,
          'cabins.$.seatsBooked': hold.seats,
        },
      },
    ).exec();
    if (updated.modifiedCount !== 1) {
      await this.holdModel.updateOne(
        { holdId, status: InventoryHoldStatus.CONFIRMED },
        { $set: { status: InventoryHoldStatus.HELD } },
      ).exec();
      throw new ConflictException('Held seats are no longer available');
    }
  }

  async releaseHold(holdId: string): Promise<void> {
    const hold = await this.holdModel.findOneAndUpdate(
      { holdId, status: InventoryHoldStatus.HELD },
      { $set: { status: InventoryHoldStatus.RELEASED } },
      { returnDocument: 'after' },
    ).lean().exec();
    if (!hold) return;
    await this.releaseSeats(
      hold.flightId.toString(),
      hold.cabinId.toString(),
      hold.seats,
    );
  }

  async releaseFlightHolds(flightId: string): Promise<void> {
    const holds = await this.holdModel
      .find({ flightId: new Types.ObjectId(flightId), status: InventoryHoldStatus.HELD })
      .lean()
      .exec();
    for (const hold of holds) {
      await this.releaseHold(hold.holdId);
    }
  }

  private async releaseSeats(
    flightId: string,
    cabinId: string,
    seats: number,
  ): Promise<void> {
    await this.flightModel.updateOne(
      {
        _id: new Types.ObjectId(flightId),
        cabins: {
          $elemMatch: {
            _id: new Types.ObjectId(cabinId),
            seatsHeld: { $gte: seats },
          },
        },
      },
      { $inc: { 'cabins.$.seatsHeld': -seats } },
    ).exec();
  }

  private async findFlight(flightId: string): Promise<Flight> {
    if (!Types.ObjectId.isValid(flightId)) {
      throw new BadRequestException('Invalid flight id');
    }
    const flight = await this.flightModel.findById(flightId).lean().exec();
    if (!flight) throw new NotFoundException('Flight not found');
    return flight;
  }

  private validateSeatRequest(
    flightId: string,
    cabinId: string,
    seats: number,
    expiresAt: Date,
  ): void {
    if (!Types.ObjectId.isValid(flightId) || !Types.ObjectId.isValid(cabinId)) {
      throw new BadRequestException('Invalid flight or cabin id');
    }
    if (!Number.isInteger(seats) || seats < 1) {
      throw new BadRequestException('Seats must be a positive whole number');
    }
    if (!(expiresAt instanceof Date) || expiresAt <= new Date()) {
      throw new BadRequestException('Hold expiry must be in the future');
    }
  }
}
