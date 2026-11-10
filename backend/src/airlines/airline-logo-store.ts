export const AIRLINE_LOGO_STORE = Symbol('AIRLINE_LOGO_STORE');

/**
 * Boundary for Person 8's shared image-upload module (FLT-01, GEN-08).
 * TODO(Person 8): bind this token to the upload service when that module is merged.
 */
export interface AirlineLogoStore {
  upload(file: unknown, airlineId: string): Promise<string>;
  remove(logoUrl: string): Promise<void>;
}
