export const formatDisplayLabel = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(" ");
};

export const hasMeaningfulValue = (value: string | null | undefined) => Boolean(value?.trim());

export const getMeaningfulValue = (value: string | null | undefined) => {
  const trimmedValue = value?.trim();

  return trimmedValue || "-";
};

export const formatBiteshipStatusLabel = (value: string | null | undefined) => {
  if (!value) {
    return "-";
  }

  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};
