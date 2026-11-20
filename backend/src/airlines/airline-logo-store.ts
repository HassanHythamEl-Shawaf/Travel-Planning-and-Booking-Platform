export const AIRLINE_LOGO_STORE = Symbol('AIRLINE_LOGO_STORE');

/**
 * Boundary for Person 8's shared image-upload module (FLT-01, GEN-08).
 * Bound to AirlineLogoUploadAdapter in AirlinesModule.
 */
export interface AirlineLogoStore {
  upload(file: unknown, airlineId: string): Promise<string>;
  /** Deletes the logo file, only if it was uploaded for this airline. */
  remove(logoUrl: string, airlineId: string): Promise<void>;
}
