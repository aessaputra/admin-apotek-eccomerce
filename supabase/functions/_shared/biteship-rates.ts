import { parseBiteshipPostalCode } from "./biteship-postal-code.ts";
import {
  INSTANT_CAPABLE_COURIER_COMPANIES,
  normalizeBiteshipCourierCompanies,
} from "./biteship-courier-contract.ts";

export interface RatesOriginSettings {
  enabled_couriers: string | null;
  origin_area_id: string | null;
  origin_postal_code: string | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
}

export type RatesRequestGroup = "standard" | "instant";

export interface RatesRequestEntry {
  group: RatesRequestGroup;
  couriers: string;
  payload: Record<string, unknown>;
}

export interface RatesRequestDiagnostic {
  group: RatesRequestGroup;
  couriers: string;
  reason: string;
}

export interface BuildRatesRequestPayloadsResult {
  requests: RatesRequestEntry[];
  skipped: RatesRequestDiagnostic[];
}

export interface RatesExecutionSuccess {
  group: RatesRequestGroup;
  couriers: string;
  status: number;
  data: unknown;
}

export interface RatesExecutionFailure {
  group: RatesRequestGroup;
  couriers: string;
  status?: number;
  error: unknown;
}

export interface MergedRatesResponse {
  status: number;
  body: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    const parsedValue = Number(trimmedValue);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
}

function getDestinationCoordinates(
  payload: Record<string, unknown>,
): { latitude: number; longitude: number } | null {
  const destinationLatitude = toFiniteNumber(payload.destination_latitude);
  const destinationLongitude = toFiniteNumber(payload.destination_longitude);

  if (destinationLatitude === null || destinationLongitude === null) {
    return null;
  }

  return {
    latitude: destinationLatitude,
    longitude: destinationLongitude,
  };
}

function getStoreOriginCoordinates(
  settings: RatesOriginSettings,
): { latitude: number; longitude: number } | null {
  if (
    typeof settings.origin_latitude !== "number" ||
    !Number.isFinite(settings.origin_latitude) ||
    typeof settings.origin_longitude !== "number" ||
    !Number.isFinite(settings.origin_longitude)
  ) {
    return null;
  }

  return {
    latitude: settings.origin_latitude,
    longitude: settings.origin_longitude,
  };
}

function getRequiredOriginPostalCode(settings: RatesOriginSettings): number {
  try {
    return parseBiteshipPostalCode(
      settings.origin_postal_code,
      "origin_postal_code",
    );
  } catch {
    throw new Error(
      "Missing origin_postal_code in settings table. Configure a valid 5-digit Indonesian shipping origin postal code before requesting Biteship rates.",
    );
  }
}

function getStandardOriginFields(
  settings: RatesOriginSettings,
): Record<string, string | number> {
  const originAreaId = settings.origin_area_id?.trim() ?? "";
  if (originAreaId) {
    return { origin_area_id: originAreaId };
  }

  return {
    origin_postal_code: getRequiredOriginPostalCode(settings),
  };
}

function getStandardDestinationFields(
  payload: Record<string, unknown>,
): Record<string, string | number> | null {
  const destinationAreaId =
    typeof payload.destination_area_id === "string"
      ? payload.destination_area_id.trim()
      : "";
  if (destinationAreaId) {
    return { destination_area_id: destinationAreaId };
  }

  const rawDestinationPostalCode =
    payload.destination_postal_code ?? payload.destination_postalcode;
  if (rawDestinationPostalCode === null || rawDestinationPostalCode === undefined) {
    return null;
  }

  return {
    destination_postal_code: parseBiteshipPostalCode(
      typeof rawDestinationPostalCode === "string" ||
        typeof rawDestinationPostalCode === "number"
        ? rawDestinationPostalCode
        : undefined,
      "destination_postal_code",
    ),
  };
}

function getPayloadWithoutLocationFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    couriers: _couriers,
    origin_area_id: _originAreaId,
    origin_postal_code: _originPostalCode,
    origin_latitude: _originLatitude,
    origin_longitude: _originLongitude,
    origin_coordinate: _originCoordinate,
    destination_area_id: _destinationAreaId,
    destination_postal_code: _destinationPostalCode,
    destination_postalcode: _destinationPostalcode,
    destination_latitude: _destinationLatitude,
    destination_longitude: _destinationLongitude,
    destination_coordinate: _destinationCoordinate,
    ...basePayload
  } = payload;

  return basePayload;
}

function hasInstantCapableCouriers(enabledCouriers: string | null): boolean {
  return normalizeBiteshipCourierCompanies(enabledCouriers).some((value) =>
    INSTANT_CAPABLE_COURIER_COMPANIES.has(value),
  );
}

export function shouldUseCoordinateOriginForRates(
  settings: RatesOriginSettings,
  payload: Record<string, unknown>,
  couriers: string | null,
): boolean {
  return (
    getStoreOriginCoordinates(settings) !== null &&
    hasInstantCapableCouriers(couriers) &&
    getDestinationCoordinates(payload) !== null
  );
}

export function buildRatesRequestPayloads(
  settings: RatesOriginSettings,
  payload: Record<string, unknown>,
  couriers: string,
): BuildRatesRequestPayloadsResult {
  const normalizedCouriers = normalizeBiteshipCourierCompanies(couriers);
  if (normalizedCouriers.length === 0) {
    return { requests: [], skipped: [] };
  }

  const standardCouriers = normalizedCouriers.filter(
    (courier) => !INSTANT_CAPABLE_COURIER_COMPANIES.has(courier),
  );
  const instantCouriers = normalizedCouriers.filter((courier) =>
    INSTANT_CAPABLE_COURIER_COMPANIES.has(courier),
  );
  const basePayload = getPayloadWithoutLocationFields(payload);
  const requests: RatesRequestEntry[] = [];
  const skipped: RatesRequestDiagnostic[] = [];

  if (standardCouriers.length > 0) {
    const standardDestinationFields = getStandardDestinationFields(payload);
    const standardCourierFilter = standardCouriers.join(",");

    if (standardDestinationFields) {
      requests.push({
        group: "standard",
        couriers: standardCourierFilter,
        payload: {
          ...basePayload,
          ...getStandardOriginFields(settings),
          ...standardDestinationFields,
          couriers: standardCourierFilter,
        },
      });
    } else {
      skipped.push({
        group: "standard",
        couriers: standardCourierFilter,
        reason:
          "Missing destination_area_id or destination_postal_code for standard Biteship rates payload.",
      });
    }
  }

  if (instantCouriers.length > 0) {
    const originCoordinates = getStoreOriginCoordinates(settings);
    const destinationCoordinates = getDestinationCoordinates(payload);
    const instantCourierFilter = instantCouriers.join(",");

    if (originCoordinates && destinationCoordinates) {
      requests.push({
        group: "instant",
        couriers: instantCourierFilter,
        payload: {
          ...basePayload,
          origin_latitude: originCoordinates.latitude,
          origin_longitude: originCoordinates.longitude,
          destination_latitude: destinationCoordinates.latitude,
          destination_longitude: destinationCoordinates.longitude,
          couriers: instantCourierFilter,
        },
      });
    } else {
      skipped.push({
        group: "instant",
        couriers: instantCourierFilter,
        reason: originCoordinates
          ? "Missing destination_latitude or destination_longitude for instant Biteship rates payload."
          : "Missing origin_latitude or origin_longitude in settings for instant Biteship rates payload.",
      });
    }
  }

  return { requests, skipped };
}

function getPricingArray(data: unknown): unknown[] {
  if (!isRecord(data) || !Array.isArray(data.pricing)) {
    return [];
  }

  return data.pricing;
}

function toWarning(diagnostic: RatesRequestDiagnostic): Record<string, unknown> {
  return {
    group: diagnostic.group,
    couriers: diagnostic.couriers,
    reason: diagnostic.reason,
  };
}

function toFailureDiagnostic(
  failure: RatesExecutionFailure,
): Record<string, unknown> {
  return {
    group: failure.group,
    couriers: failure.couriers,
    status: failure.status,
    error: failure.error,
  };
}

export function buildMergedRatesResponse(
  successes: RatesExecutionSuccess[],
  failures: RatesExecutionFailure[],
  skipped: RatesRequestDiagnostic[],
): MergedRatesResponse {
  const warnings = [
    ...skipped.map(toWarning),
    ...failures.map(toFailureDiagnostic),
  ];

  if (successes.length === 0) {
    const firstFailure = failures[0];
    return {
      status: firstFailure?.status ?? 400,
      body: {
        success: false,
        error:
          "No Biteship rates payloads succeeded. Check courier groups, destination coordinates, destination area/postal data, and Biteship upstream response.",
        diagnostics: warnings,
        upstream_error: firstFailure?.error,
      },
    };
  }

  const firstSuccessData = successes.find((success) => isRecord(success.data))
    ?.data;
  const responseBody = isRecord(firstSuccessData) ? { ...firstSuccessData } : {};
  const mergedPricing = successes.flatMap((success) =>
    getPricingArray(success.data),
  );

  responseBody.success = true;
  responseBody.pricing = mergedPricing;

  if (warnings.length > 0) {
    responseBody.warnings = warnings;
  }

  return {
    status: successes[0]?.status ?? 200,
    body: responseBody,
  };
}
