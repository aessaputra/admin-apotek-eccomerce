# Components Module

**Purpose:** Reusable Ant Design UI, media inputs, maps/location widgets, courier selection, layout, and header notifications.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Upload UI | `avatar-upload/`, `category-logo-upload/`, `product-image-upload/`, `home-banner-media-input/`, `home-banner-media-library/` | Pair with `src/hooks/useSupabaseUpload.ts` and `src/utils/storage.ts` |
| Header notifications | `header/notifications/` | Local component + hook + types + tests |
| Courier service selection | `courier-picker-modal/` | Exports UI plus helper functions from folder `index.tsx` |
| Biteship area search | `biteship-area-search/` | Used by settings/location flows |
| Google Maps picker | `map-location-picker/` | Coordinates, Places autocomplete, API-key fallback |
| Layout/title behavior | `layout/` | Shell-level display components |

## CONVENTIONS

- Component folders usually expose their public API from `index.tsx`.
- Deep feature folders may colocate `Component.tsx`, `useFeatureHook.ts`, `types.ts`, and `__tests__/`.
- It is acceptable to export pure helper functions from a component `index.tsx` when tests import the folder public API.
- Component tests live under local `__tests__/` folders and often use `vi.hoisted` with Refine/Supabase/AntD mocks.
- Prefer AntD primitives already used in nearby components; keep browser-only APIs behind fallbacks for tests/jsdom.

## HOTSPOTS

- `courier-picker-modal/index.tsx`: legacy courier normalization, wildcard selection, grouping, search, read-only states.
- `map-location-picker/index.tsx`: Google Maps/Places session tokens, debounce, coordinate normalization, fallback UI.
- `header/notifications/useAdminOrderNotifications.ts`: Supabase query/realtime subscription and dedupe behavior.

## ANTI-PATTERNS

- **NEVER** put service-role or server-only secrets in component props/env.
- **NEVER** bypass shared storage validation for upload/media components.
- **NEVER** duplicate courier parsing logic outside `src/constants/couriers.ts`.
- **NEVER** make map components fail hard when the Google Maps API key is unavailable in tests/local dev.
