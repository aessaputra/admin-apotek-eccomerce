import { describe, expect, it } from "vitest";

import {
  buildMergedRatesResponse,
  buildRatesRequestPayloads,
  shouldUseCoordinateOriginForRates,
} from "../biteship-rates";

const baseSettings = {
  enabled_couriers: "jne,jnt,sicepat,gojek,grab,lalamove",
  origin_area_id: "STORE-AREA-ID",
  origin_postal_code: "12345",
  origin_latitude: -6.145632,
  origin_longitude: 106.226614,
};

describe("shouldUseCoordinateOriginForRates", () => {
  it("returns true when instant-capable couriers are enabled and destination coordinates are present", () => {
    expect(
      shouldUseCoordinateOriginForRates(baseSettings, {
        destination_area_id: "DEST-AREA-ID",
        destination_latitude: -6.2088,
        destination_longitude: 106.8456,
      }, "grab"),
    ).toBe(true);
  });

  it("returns false when destination coordinates are missing", () => {
    expect(
      shouldUseCoordinateOriginForRates(baseSettings, {
        destination_area_id: "DEST-AREA-ID",
      }, "grab"),
    ).toBe(false);
  });

  it("returns false when store origin coordinates are missing", () => {
    expect(
      shouldUseCoordinateOriginForRates(
        {
          ...baseSettings,
          origin_latitude: null,
          origin_longitude: null,
        },
        {
          destination_area_id: "DEST-AREA-ID",
          destination_latitude: -6.2088,
          destination_longitude: 106.8456,
        },
        "grab",
      ),
    ).toBe(false);
  });

  it("returns false when requested couriers are non-instant only", () => {
    expect(
      shouldUseCoordinateOriginForRates(baseSettings, {
        destination_area_id: "DEST-AREA-ID",
        destination_latitude: -6.2088,
        destination_longitude: 106.8456,
      }, "jne,sicepat"),
    ).toBe(false);
  });
});

describe("buildRatesRequestPayloads", () => {
  it("builds one standard area payload for standard-only couriers", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_area_id: "DEST-AREA-ID",
          destination_postal_code: "54321",
          destination_latitude: -6.2088,
          destination_longitude: 106.8456,
          items: [],
        },
        " jne, JNE, sicepat ",
      ),
    ).toEqual({
      requests: [
        {
          group: "standard",
          couriers: "jne,sicepat",
          payload: {
            items: [],
            origin_area_id: "STORE-AREA-ID",
            destination_area_id: "DEST-AREA-ID",
            couriers: "jne,sicepat",
          },
        },
      ],
      skipped: [],
    });
  });

  it("builds one coordinate payload for instant-only couriers without area or postal fields", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_area_id: "DEST-AREA-ID",
          destination_postal_code: "54321",
          destination_latitude: -6.2088,
          destination_longitude: 106.8456,
          items: [],
        },
        "grab,gojek",
      ),
    ).toEqual({
      requests: [
        {
          group: "instant",
          couriers: "grab,gojek",
          payload: {
            items: [],
            origin_latitude: -6.145632,
            origin_longitude: 106.226614,
            destination_latitude: -6.2088,
            destination_longitude: 106.8456,
            couriers: "grab,gojek",
          },
        },
      ],
      skipped: [],
    });
  });

  it("splits mixed couriers into standard area/postal and instant coordinate payloads", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_area_id: "DEST-AREA-ID",
          destination_postal_code: "54321",
          destination_latitude: -6.2088,
          destination_longitude: 106.8456,
          items: [],
        },
        "jne,grab,gojek",
      ),
    ).toEqual({
      requests: [
        {
          group: "standard",
          couriers: "jne",
          payload: {
            items: [],
            origin_area_id: "STORE-AREA-ID",
            destination_area_id: "DEST-AREA-ID",
            couriers: "jne",
          },
        },
        {
          group: "instant",
          couriers: "grab,gojek",
          payload: {
            items: [],
            origin_latitude: -6.145632,
            origin_longitude: 106.226614,
            destination_latitude: -6.2088,
            destination_longitude: 106.8456,
            couriers: "grab,gojek",
          },
        },
      ],
      skipped: [],
    });
  });

  it("excludes and reports instant couriers when destination coordinates are missing but still builds standard payload", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_area_id: "DEST-AREA-ID",
          items: [],
        },
        "jne,grab,lalamove",
      ),
    ).toEqual({
      requests: [
        {
          group: "standard",
          couriers: "jne",
          payload: {
            items: [],
            origin_area_id: "STORE-AREA-ID",
            destination_area_id: "DEST-AREA-ID",
            couriers: "jne",
          },
        },
      ],
      skipped: [
        {
          group: "instant",
          couriers: "grab,lalamove",
          reason:
            "Missing destination_latitude or destination_longitude for instant Biteship rates payload.",
        },
      ],
    });
  });

  it("uses strict origin and destination postal fallbacks when area ids are absent", () => {
    expect(
      buildRatesRequestPayloads(
        {
          ...baseSettings,
          origin_area_id: null,
          origin_postal_code: " 12345 ",
        },
        {
          destination_postalcode: "54321",
          items: [],
        },
        "jne",
      ),
    ).toEqual({
      requests: [
        {
          group: "standard",
          couriers: "jne",
          payload: {
            items: [],
            origin_postal_code: 12345,
            destination_postal_code: 54321,
            couriers: "jne",
          },
        },
      ],
      skipped: [],
    });
  });

  it("rejects invalid origin postal codes before building standard rate payloads", () => {
    expect(() =>
      buildRatesRequestPayloads(
        {
          ...baseSettings,
          origin_area_id: null,
          origin_latitude: null,
          origin_longitude: null,
          origin_postal_code: "40181.0",
        },
        {
          destination_area_id: "DEST-AREA-ID",
          items: [],
        },
        "jne",
      ),
    ).toThrow(
      "Missing origin_postal_code in settings table. Configure a valid 5-digit Indonesian shipping origin postal code before requesting Biteship rates.",
    );
  });

  it("rejects invalid destination postal code fallbacks before building standard rate payloads", () => {
    expect(() =>
      buildRatesRequestPayloads(
        {
          ...baseSettings,
          origin_area_id: null,
        },
        {
          destination_postal_code: "54321.0",
          items: [],
        },
        "jne",
      ),
    ).toThrow("destination_postal_code must be a valid 5-digit Indonesian postal code.");
  });

  it("reports standard group when destination area and postal fallback are missing", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_latitude: -6.2088,
          destination_longitude: 106.8456,
          items: [],
        },
        "jne,grab",
      ),
    ).toEqual({
      requests: [
        {
          group: "instant",
          couriers: "grab",
          payload: {
            items: [],
            origin_latitude: -6.145632,
            origin_longitude: 106.226614,
            destination_latitude: -6.2088,
            destination_longitude: 106.8456,
            couriers: "grab",
          },
        },
      ],
      skipped: [
        {
          group: "standard",
          couriers: "jne",
          reason:
            "Missing destination_area_id or destination_postal_code for standard Biteship rates payload.",
        },
      ],
    });
  });
});

describe("buildMergedRatesResponse", () => {
  it("merges successful pricing arrays and preserves warnings for partial failures", () => {
    expect(
      buildMergedRatesResponse(
        [
          {
            group: "standard",
            couriers: "jne",
            status: 200,
            data: {
              success: true,
              pricing: [
                {
                  courier_code: "jne",
                  courier_service_code: "reg",
                  price: 12000,
                },
              ],
            },
          },
          {
            group: "instant",
            couriers: "grab",
            status: 200,
            data: {
              success: true,
              pricing: [
                {
                  courier_code: "grab",
                  courier_service_code: "instant",
                  price: 22000,
                },
              ],
            },
          },
        ],
        [
          {
            group: "instant",
            couriers: "gojek",
            status: 422,
            error: { message: "coordinate not serviceable" },
          },
        ],
        [],
      ),
    ).toEqual({
      status: 200,
      body: {
        success: true,
        pricing: [
          {
            courier_code: "jne",
            courier_service_code: "reg",
            price: 12000,
          },
          {
            courier_code: "grab",
            courier_service_code: "instant",
            price: 22000,
          },
        ],
        warnings: [
          {
            group: "instant",
            couriers: "gojek",
            status: 422,
            error: { message: "coordinate not serviceable" },
          },
        ],
      },
    });
  });

  it("returns actionable diagnostics and upstream status when all groups fail", () => {
    expect(
      buildMergedRatesResponse(
        [],
        [
          {
            group: "standard",
            couriers: "jne",
            status: 503,
            error: { message: "upstream unavailable" },
          },
        ],
        [
          {
            group: "instant",
            couriers: "grab",
            reason:
              "Missing destination_latitude or destination_longitude for instant Biteship rates payload.",
          },
        ],
      ),
    ).toEqual({
      status: 503,
      body: {
        success: false,
        error:
          "No Biteship rates payloads succeeded. Check courier groups, destination coordinates, destination area/postal data, and Biteship upstream response.",
        diagnostics: [
          {
            group: "instant",
            couriers: "grab",
            reason:
              "Missing destination_latitude or destination_longitude for instant Biteship rates payload.",
          },
          {
            group: "standard",
            couriers: "jne",
            status: 503,
            error: { message: "upstream unavailable" },
          },
        ],
        upstream_error: { message: "upstream unavailable" },
      },
    });
  });
});
