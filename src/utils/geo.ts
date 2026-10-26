/**
 * Geo utility — pure functions for geographic calculations.
 * No side effects, no I/O.
 */

const EARTH_RADIUS_METERS = 6371000;

/**
 * Validates a latitude/longitude parameter and throws a descriptive error if out of range.
 */
function validateCoordinate(
  value: number,
  name: string,
  min: number,
  max: number
): void {
  if (value < min || value > max) {
    throw new RangeError(
      `Invalid parameter "${name}": ${value} is out of range [${min}, ${max}]`
    );
  }
}

/**
 * Calculates the great-circle distance between two geographic coordinates
 * using the Haversine formula.
 *
 * @param lat1 - Latitude of point 1 in degrees, must be in [-90, 90]
 * @param lng1 - Longitude of point 1 in degrees, must be in [-180, 180]
 * @param lat2 - Latitude of point 2 in degrees, must be in [-90, 90]
 * @param lng2 - Longitude of point 2 in degrees, must be in [-180, 180]
 * @returns Distance in meters between the two points
 * @throws {RangeError} If any parameter is outside its valid range
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  validateCoordinate(lat1, "lat1", -90, 90);
  validateCoordinate(lng1, "lng1", -180, 180);
  validateCoordinate(lat2, "lat2", -90, 90);
  validateCoordinate(lng2, "lng2", -180, 180);

  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}
