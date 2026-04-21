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
