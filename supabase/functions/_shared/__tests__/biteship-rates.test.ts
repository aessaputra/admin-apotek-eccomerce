import { describe, expect, it } from "vitest";

import {
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
  it("uses coordinate-aware origin for instant couriers when destination coordinates are present", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_area_id: "DEST-AREA-ID",
          destination_latitude: -6.2088,
          destination_longitude: 106.8456,
          items: [],
        },
        "grab,gojek",
      ),
    ).toEqual([
      {
        destination_area_id: "DEST-AREA-ID",
        destination_latitude: -6.2088,
        destination_longitude: 106.8456,
        items: [],
        origin_latitude: -6.145632,
        origin_longitude: 106.226614,
        couriers: "grab,gojek",
      },
    ]);
  });

  it("keeps non-instant requests on the legacy origin precedence with area id first", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_area_id: "DEST-AREA-ID",
          destination_latitude: -6.2088,
          destination_longitude: 106.8456,
          items: [],
        },
        "jne,sicepat",
      ),
    ).toEqual([
      {
        destination_area_id: "DEST-AREA-ID",
        destination_latitude: -6.2088,
        destination_longitude: 106.8456,
        items: [],
        origin_area_id: "STORE-AREA-ID",
        couriers: "jne,sicepat",
      },
    ]);
  });

  it("falls back to store coordinates for non-instant requests when area id is unavailable", () => {
    expect(
      buildRatesRequestPayloads(
        {
          ...baseSettings,
          origin_area_id: null,
        },
        {
          destination_area_id: "DEST-AREA-ID",
          items: [],
        },
        "jne",
      ),
    ).toEqual([
      {
        destination_area_id: "DEST-AREA-ID",
        items: [],
        origin_latitude: -6.145632,
        origin_longitude: 106.226614,
        couriers: "jne",
      },
    ]);
  });

  it("falls back to postal code for non-instant requests when area id and coordinates are unavailable", () => {
    expect(
      buildRatesRequestPayloads(
        {
          ...baseSettings,
          origin_area_id: null,
          origin_latitude: null,
          origin_longitude: null,
        },
        {
          destination_area_id: "DEST-AREA-ID",
          items: [],
        },
        "jne",
      ),
    ).toEqual([
      {
        destination_area_id: "DEST-AREA-ID",
        items: [],
        origin_postal_code: 12345,
        couriers: "jne",
      },
    ]);
  });

  it("uses a single coordinate-origin payload for mixed courier requests when instant couriers need coordinates", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_area_id: "DEST-AREA-ID",
          destination_latitude: -6.2088,
          destination_longitude: 106.8456,
          items: [],
        },
        "jne,grab,lalamove",
      ),
    ).toEqual([
      {
        destination_area_id: "DEST-AREA-ID",
        destination_latitude: -6.2088,
        destination_longitude: 106.8456,
        items: [],
        origin_latitude: -6.145632,
        origin_longitude: 106.226614,
        couriers: "jne,grab,lalamove",
      },
    ]);
  });

  it("keeps a single standard-origin payload for mixed courier requests when destination coordinates are unavailable", () => {
    expect(
      buildRatesRequestPayloads(
        baseSettings,
        {
          destination_area_id: "DEST-AREA-ID",
          items: [],
        },
        "jne,grab,lalamove",
      ),
    ).toEqual([
      {
        destination_area_id: "DEST-AREA-ID",
        items: [],
        origin_area_id: "STORE-AREA-ID",
        couriers: "jne,grab,lalamove",
      },
    ]);
  });
});
