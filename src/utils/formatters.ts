export const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function cleanStreetAddress(
  street: string,
  city: string,
  province: string,
  postal: string,
  district?: string,
): string {
  let cleaned = (street ?? "").trim();

  cleaned = cleaned.replace(/,\s*(indonesia|id)$/i, "");

  const removeTrailingToken = (token: string) => {
    if (!token) return;
    const normToken = token
      .replace(/^(kota|kabupaten|kab\.|kecamatan|kec\.|provinsi|prov\.)\s+/i, "")
      .trim();
    if (!normToken) return;

    const escaped = normToken.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(
      `,?\\s*(kota|kabupaten|kab\\.|kecamatan|kec\\.)?\\s*${escaped}$`,
      "i",
    );
    cleaned = cleaned.replace(regex, "").trim();
  };

  removeTrailingToken(postal);
  removeTrailingToken(province);
  removeTrailingToken(city);
  if (district) {
    removeTrailingToken(district);
  }

  return cleaned;
}

export function formatAddress(address?: {
  street_address?: string | null;
  area_name?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
} | null): string {
  if (!address) return "";
  const street = address.street_address || "";
  const city = address.city || "";
  const province = address.province || "";
  const postal = address.postal_code || "";
  const district = address.area_name ? address.area_name.split(",")[0].trim() : undefined;

  const cleanedStreet = cleanStreetAddress(street, city, province, postal, district);

  const isDistrictRedundant = district && (
    district.toLowerCase() === city.toLowerCase() ||
    district.toLowerCase() === `kecamatan ${city.toLowerCase()}`
  );
  const displayDistrict = (district && !isDistrictRedundant) ? district : undefined;

  return [
    cleanedStreet,
    displayDistrict,
    city,
    province,
    postal,
    address.country_code,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

