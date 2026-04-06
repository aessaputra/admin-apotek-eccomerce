export const HOME_BANNER_PLACEMENTS = [
  "home_banner_top",
  "home_banner_bottom",
] as const;

export const HOME_BANNER_INTENTS = [
  "promotional",
  "informational",
  "branding",
] as const;

export const HOME_BANNER_CTA_KINDS = ["none", "route"] as const;

export const HOME_BANNER_CTA_ROUTES = [
  "home/all-products",
] as const;

export type HomeBannerPlacementKey = (typeof HOME_BANNER_PLACEMENTS)[number];
export type HomeBannerIntent = (typeof HOME_BANNER_INTENTS)[number];
export type HomeBannerCtaKind = (typeof HOME_BANNER_CTA_KINDS)[number];
export type HomeBannerCtaRoute = (typeof HOME_BANNER_CTA_ROUTES)[number];

export const HOME_BANNER_ALLOWED_IMAGE_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
] as const;

export interface HomeBannerMediaSpec {
  aspectRatio: number;
  recommendedWidth: number;
  recommendedHeight: number;
  tolerancePercent: number;
  recommendedMaxFileSizeKb: number;
}

export const HOME_BANNER_MEDIA_SPECS: Record<HomeBannerPlacementKey, HomeBannerMediaSpec> = {
  home_banner_top: {
    aspectRatio: 3,
    recommendedWidth: 720,
    recommendedHeight: 240,
    tolerancePercent: 5,
    recommendedMaxFileSizeKb: 100,
  },
  home_banner_bottom: {
    aspectRatio: 2,
    recommendedWidth: 720,
    recommendedHeight: 360,
    tolerancePercent: 5,
    recommendedMaxFileSizeKb: 100,
  },
};

export function isHomeBannerPlacementKey(value: unknown): value is HomeBannerPlacementKey {
  return typeof value === "string" && HOME_BANNER_PLACEMENTS.includes(value as HomeBannerPlacementKey);
}

export function getHomeBannerStoragePrefix(placementKey: HomeBannerPlacementKey): string {
  return `banners/${placementKey}/`;
}

export function isMediaPathAllowedForPlacement(
  mediaPath: string | null | undefined,
  placementKey: HomeBannerPlacementKey
): boolean {
  if (!mediaPath) {
    return true;
  }

  return mediaPath.startsWith(getHomeBannerStoragePrefix(placementKey));
}

export function getHomeBannerMediaSpec(placementKey: HomeBannerPlacementKey): HomeBannerMediaSpec {
  return HOME_BANNER_MEDIA_SPECS[placementKey];
}

export function getHomeBannerAspectRatioDifferencePercent(
  placementKey: HomeBannerPlacementKey,
  width: number,
  height: number
): number {
  if (width <= 0 || height <= 0) {
    return 100;
  }

  const spec = getHomeBannerMediaSpec(placementKey);
  const actualAspectRatio = width / height;

  return Math.abs(actualAspectRatio - spec.aspectRatio) / spec.aspectRatio * 100;
}
