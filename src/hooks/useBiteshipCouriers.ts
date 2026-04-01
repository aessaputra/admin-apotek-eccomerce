import { useState, useEffect, useCallback } from "react";
import { supabaseClient } from "../providers/supabase-client";
import {
  BITESHIP_FALLBACK_COURIER_SERVICES,
  type CourierServiceOption,
} from "../constants/couriers";

interface BiteshipCourier {
  courier_code: string;
  courier_name: string;
  courier_service_code: string;
  courier_service_name: string;
  description?: string;
  image_url?: string;
}

interface NormalizedBiteshipCourier extends BiteshipCourier {
  courier_code: string;
  courier_name: string;
  courier_service_code: string;
  courier_service_name: string;
  description?: string;
  image_url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBiteshipCourier(value: unknown): value is BiteshipCourier {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.courier_code === "string" &&
    value.courier_code.trim().length > 0 &&
    typeof value.courier_name === "string" &&
    value.courier_name.trim().length > 0 &&
    typeof value.courier_service_code === "string" &&
    value.courier_service_code.trim().length > 0 &&
    typeof value.courier_service_name === "string" &&
    value.courier_service_name.trim().length > 0 &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.image_url === undefined || typeof value.image_url === "string")
  );
}

function normalizeBiteshipCourier(courier: BiteshipCourier): NormalizedBiteshipCourier {
  const courierCode = courier.courier_code.trim().toLowerCase();
  const courierName = courier.courier_name.trim();
  const courierServiceCode = courier.courier_service_code.trim().toLowerCase();
  const courierServiceName = courier.courier_service_name.trim();
  const description = courier.description?.trim();
  const imageUrl = courier.image_url?.trim();

  return {
    courier_code: courierCode,
    courier_name: courierName,
    courier_service_code: courierServiceCode,
    courier_service_name: courierServiceName,
    ...(description ? { description } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
  };
}

function parseBiteshipCouriers(value: unknown): NormalizedBiteshipCourier[] {
  if (!Array.isArray(value)) {
    console.warn("[useBiteshipCouriers] Expected courier array response", {
      receivedType: typeof value,
    });
    return [];
  }

  const validCouriers: NormalizedBiteshipCourier[] = [];
  const seenCourierServices = new Set<string>();
  const duplicateCourierServices = new Set<string>();
  let invalidCount = 0;

  for (const item of value) {
    if (isBiteshipCourier(item)) {
      const normalizedCourier = normalizeBiteshipCourier(item);
      const selectionKey = `${normalizedCourier.courier_code}:${normalizedCourier.courier_service_code}`;

      if (seenCourierServices.has(selectionKey)) {
        duplicateCourierServices.add(selectionKey);
        continue;
      }

      seenCourierServices.add(selectionKey);
      validCouriers.push(normalizedCourier);
    } else {
      invalidCount += 1;
    }
  }

  if (invalidCount > 0) {
    console.warn("[useBiteshipCouriers] Ignored invalid courier items", {
      invalidCount,
      validCount: validCouriers.length,
    });
  }

  if (duplicateCourierServices.size > 0) {
    console.warn("[useBiteshipCouriers] Ignored duplicate courier services", {
      duplicateCount: duplicateCourierServices.size,
      duplicateCourierServices: Array.from(duplicateCourierServices).sort(),
      uniqueCount: validCouriers.length,
    });
  }

  return validCouriers;
}

/**
 * Hook to fetch available couriers from Biteship API.
 * Falls back to static courier list if API fails or returns empty.
 */
export function useBiteshipCouriers() {
  const [couriers, setCouriers] = useState<CourierServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const fetchCouriers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setIsFallback(true);
        setError("Authentication required to load live courier services");
        setCouriers(BITESHIP_FALLBACK_COURIER_SERVICES);
        setLoading(false);
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/biteship`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "couriers" }),
        }
      );

      if (!response.ok) {
        console.warn("[useBiteshipCouriers] API request failed, using fallback");
        setIsFallback(true);
        setError("Unable to load live courier services from Biteship");
        setCouriers(BITESHIP_FALLBACK_COURIER_SERVICES);
        setLoading(false);
        return;
      }

      const rawData: unknown = await response.json();
      const data = parseBiteshipCouriers(rawData);

      if (data.length === 0) {
        console.warn("[useBiteshipCouriers] No valid couriers in response, using fallback");
        setIsFallback(true);
        setError("Live courier services are unavailable right now");
        setCouriers(BITESHIP_FALLBACK_COURIER_SERVICES);
        setLoading(false);
        return;
      }

      const courierOptions: CourierServiceOption[] = data.map((courier) => ({
        key: `${courier.courier_code}:${courier.courier_service_code}`,
        companyCode: courier.courier_code,
        companyLabel: courier.courier_name,
        serviceCode: courier.courier_service_code,
        serviceLabel: courier.courier_service_name,
        description: courier.description || courier.courier_service_name,
      }));

      setIsFallback(false);
      setCouriers(courierOptions);
    } catch (err) {
      console.error("[useBiteshipCouriers] Error fetching couriers:", err);
      setError(err instanceof Error ? err.message : "Failed to load couriers");
      setIsFallback(true);
      setCouriers(BITESHIP_FALLBACK_COURIER_SERVICES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCouriers();
  }, [fetchCouriers]);

  return { couriers, loading, error, isFallback, refetch: fetchCouriers };
}
