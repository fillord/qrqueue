/** Mirrors backend validate_geo_fields: all three geo fields or none of them. */
export function geoFieldsValid(
  latitude: string,
  longitude: string,
  geoRadiusM: string,
): boolean {
  const provided = [latitude.trim() !== '', longitude.trim() !== '', geoRadiusM.trim() !== '']
  return provided.every((p) => p) || provided.every((p) => !p)
}
