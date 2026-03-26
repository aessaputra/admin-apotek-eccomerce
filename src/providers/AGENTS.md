# Providers Module

**Purpose:** Core infrastructure for authentication, data operations, and Supabase client configuration.

## Files

| File | Role |
|------|------|
| `auth.ts` | Supabase auth provider with admin-only access control |
| `data.ts` | Data provider with storage cleanup on delete |
| `supabase-client.ts` | Supabase browser client initialization |
| `constants.ts` | Storage bucket names and configuration |

## Authentication Flow (auth.ts)

```
Login → Supabase signInWithPassword → Check profiles.role === 'admin'
  ↓
Non-admin? → Sign out → Reject ("Access denied")
  ↓
Admin? → Return success → Redirect to "/"
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `getProfileRole(userId)` | Fetch user role from profiles table |
| `getProfileIdentity(userId)` | Get full_name, avatar_url for identity |
| `rejectNonAdmin()` | Standard rejection response for non-admins |
| `toAuthError(error)` | Normalize Supabase errors to AuthProvider format |

### Admin-Only Pattern

```typescript
// Login checks admin role
const role = await getProfileRole(data.user.id);
if (role !== ADMIN_ROLE) {
  await supabaseClient.auth.signOut();
  return rejectNonAdmin();
}
```

## Data Provider (data.ts)

Extends `@refinedev/supabase` dataProvider with **automatic storage cleanup**:

### Delete Flow

```
deleteOne("categories", id)
  → Get category → Extract logo_url
  → Delete from storage bucket
  → Delete from database

deleteOne("products", id)
  → Get product with product_images
  → Delete all images from storage
  → Delete from database
```

### Storage Buckets

| Bucket | Used For |
|--------|----------|
| `category-logos` | Category logo images |
| `product-images` | Product gallery images |

### Import Pattern

```typescript
import { dataProvider } from "./data";
import { supabaseClient } from "./supabase-client";
import authProvider from "./auth";
```

## Supabase Client (supabase-client.ts)

Creates browser-side Supabase client using environment variables:

```typescript
export const supabaseClient = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

## Anti-Patterns

- **NEVER** use `SUPABASE_SERVICE_ROLE_KEY` here - that's for Edge Functions only
- **NEVER** bypass `authProvider.check` - all pages require authentication
- **NEVER** expose error details to non-admin users

## Related

- **Storage utilities:** `src/utils/storage.ts` - Path extraction, file validation
- **Upload hooks:** `src/hooks/useSupabaseUpload.ts` - Reusable upload component logic
- **Edge Functions:** `supabase/functions/` - Server-side logic with service role key