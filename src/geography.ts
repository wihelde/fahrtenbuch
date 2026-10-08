/** Great-circle distance on the mean-radius Earth, shared by search and round-trip detection. */
export function endpointDistanceMeters(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
) {
  const radians = Math.PI / 180;
  const a =
    Math.sin(((endLat - startLat) * radians) / 2) ** 2 +
    Math.cos(startLat * radians) *
      Math.cos(endLat * radians) *
      Math.sin(((endLng - startLng) * radians) / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
