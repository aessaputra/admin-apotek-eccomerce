import { useQuery } from "@tanstack/react-query";
import { supabaseClient } from "../providers/supabase-client";
import { MEDIA_BUCKET, resolveStoragePublicUrl } from "../utils/storage";

export const STORE_BRANDING_QUERY_KEY = ["store-branding"] as const;

interface StoreBrandingRow {
  store_name: string | null;
  primary_logo_url: string | null;
}

function normalizeBrandingValue(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : null;
}

interface StoreBrandingData {
  storeName: string | null;
  primaryLogoUrl: string | null;
}

async function fetchStoreBranding(): Promise<StoreBrandingData> {
  const { data, error } = await supabaseClient
    .from("settings")
    .select("store_name, primary_logo_url")
    .eq("id", 1)
    .maybeSingle<StoreBrandingRow>();

  if (error) {
    throw error;
  }

  return {
    storeName: normalizeBrandingValue(data?.store_name),
    primaryLogoUrl: resolveStoragePublicUrl(normalizeBrandingValue(data?.primary_logo_url), MEDIA_BUCKET),
  };
}

export function useStoreBranding() {
  const query = useQuery({
    queryKey: STORE_BRANDING_QUERY_KEY,
    queryFn: fetchStoreBranding,
    staleTime: 60_000,
  });

  return {
    ...query,
    storeName: query.data?.storeName ?? null,
    primaryLogoUrl: query.data?.primaryLogoUrl ?? null,
  };
}
