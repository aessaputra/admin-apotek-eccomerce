# Migration History Reconciliation

## Context

Pada pemulihan contract checkout live Supabase, schema dan Edge Function berhasil dipulihkan, tetapi metadata migration live tidak lagi 1:1 dengan file migration kanonis di repo.

Masalah ini bersifat **auditability / traceability only**.

- Runtime live checkout sudah pulih.
- Schema live yang dibutuhkan sudah ada.
- Edge Function live yang dibutuhkan sudah aktif.
- Yang tidak sejajar hanyalah histori metadata di `supabase_migrations.schema_migrations`.

## Canonical local migrations

Tiga file migration kanonis untuk pemulihan contract checkout di repo ini adalah:

1. `20260417193000_add_transactional_checkout_aggregate.sql`
2. `20260417194500_harden_snap_token_and_cart_cleanup.sql`
3. `20260417200500_fix_checkout_cart_snapshot_and_snap_timeout.sql`

File-file di atas adalah source of truth di repo.

## Recorded live migration metadata

Setelah restorasi live, metadata di `supabase_migrations.schema_migrations` mencatat tiga entri sintetis berikut:

1. `20260418070050 / add_transactional_checkout_aggregate`
2. `20260418070210 / fix_checkout_cart_snapshot_and_snap_timeout`
3. `20260418070305 / finalize_checkout_cart_snapshot`

Ketiga entri ini valid sebagai jejak eksekusi live, tetapi tidak identik dengan versi/nama file migration lokal.

## Reconciliation mapping

### Direct name / intent matches

- Live `20260418070050 / add_transactional_checkout_aggregate`
  - canonical local: `20260417193000_add_transactional_checkout_aggregate.sql`

- Live `20260418070210 / fix_checkout_cart_snapshot_and_snap_timeout`
  - canonical local: `20260417200500_fix_checkout_cart_snapshot_and_snap_timeout.sql`

### Non-1:1 entries

- Canonical local `20260417194500_harden_snap_token_and_cart_cleanup.sql`
  - **tidak memiliki pasangan metadata live 1:1**
  - namun objek schema yang diperlukannya dipulihkan di live, termasuk:
    - `public.snap_token_generation_locks`
    - `public.acquire_snap_token_generation_lock(...)`
    - `public.release_snap_token_generation_lock(...)`

- Live `20260418070305 / finalize_checkout_cart_snapshot`
  - **tidak memiliki file migration lokal kanonis 1:1**
  - perlakukan sebagai artefak restorasi live pasca-insiden
  - jangan jadikan nama/versi ini sebagai acuan kanonis di repo

## Operational decision

Keputusan operasional yang diambil untuk mengurangi residual risk adalah:

- **Jangan edit manual row histori live di `supabase_migrations.schema_migrations`.**
- **Jangan rename atau menambah file migration sintetis di repo hanya agar “match” dengan live metadata.**
- **Gunakan file ini sebagai catatan rekonsiliasi resmi** ketika operator berikutnya perlu memahami mengapa histori live dan histori repo tidak persis sama.

Alasan keputusan ini:

1. runtime live sudah pulih,
2. residual risk hanya pada traceability,
3. surgery pada histori migration live berisiko menambah drift baru.

## Current expected live state

Pada state yang direkonsiliasi ini, komponen live yang harus ada adalah:

- Edge Functions
  - `create-checkout-order` active
  - `create-snap-token` active

- Database objects
  - `public.create_checkout_order_aggregate(...)`
  - `public.acquire_snap_token_generation_lock(...)`
  - `public.release_snap_token_generation_lock(...)`
  - `public.snap_token_generation_locks`

Jika di masa depan diperlukan parity histori migration yang lebih ketat untuk compliance atau operasi, lakukan lewat prosedur rekonsiliasi baru yang terdokumentasi — **bukan** dengan update/delete manual pada histori live yang ada sekarang.

## 2026-04-21 customer completion migration alignment

Pada 2026-04-21 dua migration customer-completion berikut awalnya ada di repo dengan timestamp lokal:

1. `20260421090428_add_customer_completion_stage.sql`
2. `20260421095013_refine_customer_order_bucket_derivation.sql`

Saat didorong ke remote melalui MCP Supabase, histori live mencatat dua versi berikut di `supabase_migrations.schema_migrations`:

1. `20260421111409 / add_customer_completion_stage`
2. `20260421111439 / refine_customer_order_bucket_derivation`

Berbeda dengan rekonsiliasi insiden checkout di atas, pasangan ini bersifat **1:1** terhadap intent dan isi migration lokal. Karena schema live sudah benar dan mismatch hanya pada versi file lokal, keputusan operasional yang diambil adalah:

- **jangan edit manual histori live**, dan
- **selaraskan filename migration lokal ke versi remote** agar workflow `supabase migration list` / `db push` kembali konsisten.

Hasil kanonis repo setelah penyelarasan:

1. `20260421111409_add_customer_completion_stage.sql`
2. `20260421111439_refine_customer_order_bucket_derivation.sql`

## 2026-07-03 constraint migrations reconciliation

On 2026-07-03, the remote `supabase_migrations.schema_migrations` table contained 31 entries that did not have corresponding canonical files in the repo. These entries appeared to be auto-generated or applied outside the canonical workflow and covered constraints such as `product_images_sort_order_max_chk`, `order_items_quantity_positive_chk`, and `order_items_source_cart_item_id_fkey`.

### Remote-only entries removed from history

The following 31 remote-only entries were marked `reverted` using `supabase migration repair --status reverted` so that local/remote history parity could be restored and the normal `db push`/`db pull` workflow could function:

- `20260703080532`
- `20260703081305`
- `20260703083145`
- `20260703085636`
- `20260703085814`
- `20260703090423`
- `20260703093114`
- `20260703093537`
- `20260703095302`
- `20260703100752`
- `20260703100916`
- `20260703101452`
- `20260703101733`
- `20260703102000`
- `20260703102237`
- `20260703102455`
- `20260703102558`
- `20260703103533`
- `20260703105500`
- `20260703105832`
- `20260703110025`
- `20260703110223`
- `20260703111119`
- `20260703113522`
- `20260703113850`
- `20260703115839`
- `20260703130604`
- `20260703131105`
- `20260703132026`
- `20260703140000`
- `20260703141844`

Marking these as `reverted` only removed the metadata rows; it did **not** roll back any schema objects. The required constraints remain present in the live database.

### Canonical local migrations added

Two canonical migrations were added to the repo to represent the intended schema changes:

1. `20260703133123_add_product_images_sort_order_max_constraint.sql`
2. `20260703140000_fix_order_items_constraints.sql`

A migration test was also added:

- `supabase/migrations/__tests__/order-items-constraints-migration.test.ts`

### Why this exception was made

The previous operational decision was to avoid manual edits to live migration history. That still applies for typical drift. In this case, the drift was large (31 entries), the remote-only entries had no canonical source files, and the absence of parity blocked `db push` entirely. Restoring parity via `migration repair` was the least-risk path because:

1. The live schema already contained the required constraints.
2. The two canonical local migrations use guarded SQL (`if not exists`, `drop constraint if exists`) so they are safe to re-apply.
3. A clean history is required for future `db push`/`db pull` operations.

### Current expected live state

After reconciliation, the following constraints must exist in the live database:

- `public.product_images.product_images_sort_order_max_chk` (`sort_order <= 9`)
- `public.order_items.order_items_quantity_positive_chk` (`quantity > 0`)
- `public.order_items.order_items_source_cart_item_id_fkey` (FK to `public.cart_items(id)` with `ON DELETE SET NULL`)

If any of these constraints are missing in a fresh restore, re-apply the two canonical migrations above.
