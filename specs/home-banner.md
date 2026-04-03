# HomeBanner Spec

## Overview

Dokumen ini adalah source of truth untuk MVP **Home Banner** yang akan menggantikan dua blok banner statis pada home scene.

Fokus dokumen ini adalah **backend Supabase** dan **admin panel Refine** yang harus siap **sebelum** implementasi frontend dimulai.

Tujuan MVP:

- menyediakan dua banner home yang dikelola operations/admin
- memungkinkan perubahan konten tanpa release app baru
- mendukung banner dengan CTA, banner informasional, dan banner branding/media-only
- menjaga implementasi tetap kecil, aman, dan mudah divalidasi

## Product Goal

Banner home dipakai untuk menampilkan konten prioritas pada halaman home, misalnya:

- promo ringan
- informasi operasional
- ajakan ke halaman tertentu di dalam app
- materi branding visual tanpa CTA

Banner ini **bukan** sistem campaign penuh. MVP hanya mendukung **dua placement home tetap** dan maksimal **satu banner aktif per placement**.

## Why Naming Was Revised

Naming lama seperti `home_primary` dan `home_secondary` dianggap kurang tepat karena:

- menjelaskan urutan, bukan placement yang nyata di UI
- menjadi ambigu kalau layout berubah
- kurang jelas untuk operations/admin

Hasil research dan Oracle merekomendasikan naming yang lebih eksplisit terhadap placement yang benar-benar ada di home screen.

### Final Naming Decision

- **table**: `public.home_banners`
- **admin resource**: `home-banners`
- **placement field**: `placement_key`
- **placement values MVP**:
  - `home_banner_top`
  - `home_banner_bottom`

Alasan:

- tetap home-scoped, jadi belum perlu table generik seperti `banners` atau `app_banners`
- lebih jelas dari `slot`
- lebih jelas dari `home_primary/home_secondary`
- cocok dengan dua placement nyata di `scenes/home/Home.tsx`

## Current UI Mapping

Home screen saat ini punya dua banner statis:

1. banner atas setelah search
2. banner bawah setelah latest products

Mapping placement MVP:

- `home_banner_top` → banner atas
- `home_banner_bottom` → banner bawah

Dokumen ini tidak mengikat banner ke use case tertentu seperti order/status atau doctor discovery. Placement hanya menentukan **lokasi tampil**, bukan **jenis isi**.

## MVP Scope

### In Scope

- satu tabel baru untuk banner di Supabase
- dua placement banner:
  - `home_banner_top`
  - `home_banner_bottom`
- maksimal satu banner aktif per placement
- content model generik untuk:
  - promotional banner
  - informational banner
  - branding banner
- CTA opsional dengan dua mode:
  - `none`
  - `route`
- target CTA hanya untuk route internal yang diizinkan
- media image dari bucket Supabase `media`
- Refine admin CRUD sederhana untuk mengelola banner
- validasi data minimum di database dan admin form
- RLS untuk read mobile app dan write admin

### Out of Scope

- carousel atau multi-banner slider per placement
- external URL CTA
- analytics impression/click
- audience segmentation
- localization / multi-language banner
- realtime subscription
- custom warna, typography, spacing dari admin
- advanced scheduling system
- personalized banner per user
- app-wide banner system di luar home

## Current Constraints and Decisions

- app stack: Expo React Native + Tamagui + strict TypeScript
- arsitektur frontend: `scene -> hook -> service -> data source`
- backend: Supabase
- admin: Refine
- bucket media existing: `media` (public)
- keputusan database yang sudah dikunci:
  - **pakai table baru di `public`**
  - **jangan pakai `public.settings`**
  - **jangan bikin schema database baru untuk MVP**

## Assumptions

- bucket media untuk MVP tetap `media`
- banner image adalah asset publik, jadi bucket public masih dapat diterima untuk MVP
- Refine admin adalah jalur utama untuk create/edit/delete banner
- route CTA MVP dibatasi ke route internal sederhana tanpa parameter bebas dari admin

Jika salah satu asumsi ini berubah, spec harus direvisi sebelum implementasi.

## Key Decisions

### Decision 1 — Keep the table home-scoped

Kita memilih `public.home_banners` dan tidak membuat table generic seperti `banners` atau `app_banners`.

Alasan:

- kebutuhan saat ini masih khusus home
- lebih kecil scope-nya untuk operation dan backend
- menghindari abstraksi terlalu dini

### Decision 2 — Store only `media_path`, not bucket per row

Kita memilih menyimpan hanya `media_path` di row banner.

Alasan:

- bucket MVP sudah tetap: `media`
- menyimpan `media_bucket` di setiap row menambah risiko inkonsistensi
- service/config layer lebih tepat memegang bucket name

### Decision 3 — Use text + check constraints

Kita memilih `text` + `CHECK` constraints untuk `placement_key`, `intent`, dan `cta_kind`, bukan Postgres enum.

Alasan:

- lebih ringan untuk MVP
- lebih mudah diubah saat value berkembang
- tetap aman selama constraint database tegas

Alasan tidak menggunakan `settings`:

- `settings` adalah singleton config store, bukan content entity
- banner butuh row terpisah, status aktif, placement, media, dan validasi CTA
- Refine CRUD lebih bersih jika satu row = satu banner

## Data Model

### Table Name

`public.home_banners`

### Purpose

Menyimpan banner yang dikelola admin untuk dua placement pada halaman home.

### MVP Columns

| Column          | Type          | Required | Description                                                                 |
| --------------- | ------------- | -------: | --------------------------------------------------------------------------- |
| `id`            | `uuid`        |      yes | Primary key banner                                                          |
| `placement_key` | `text`        |      yes | Placement banner. Nilai MVP: `home_banner_top` atau `home_banner_bottom`    |
| `intent`        | `text`        |      yes | Klasifikasi editorial: `promotional`, `informational`, `branding`           |
| `title`         | `text`        |       no | Judul banner                                                                |
| `body`          | `text`        |       no | Deskripsi atau pesan banner                                                 |
| `media_path`    | `text`        |       no | Path object di bucket, misalnya `banners/home_banner_top/top-campaign.webp` |
| `cta_kind`      | `text`        |      yes | Nilai yang diizinkan: `none` atau `route`                                   |
| `cta_label`     | `text`        |       no | Label tombol CTA jika `cta_kind = route`                                    |
| `cta_route`     | `text`        |       no | Route internal yang dituju jika `cta_kind = route`                          |
| `is_active`     | `boolean`     |      yes | Menandai banner aktif/tidak aktif                                           |
| `created_at`    | `timestamptz` |      yes | Timestamp pembuatan                                                         |
| `updated_at`    | `timestamptz` |      yes | Timestamp perubahan terakhir                                                |

### Table Plan

Bagian ini adalah rencana tabel final untuk MVP yang akan diturunkan ke migration Supabase.

#### Planned Table

`public.home_banners`

#### Planned Columns

| Column          | Planned Type  | Nullability | Default             | Notes                                                   |
| --------------- | ------------- | ----------- | ------------------- | ------------------------------------------------------- |
| `id`            | `uuid`        | not null    | `gen_random_uuid()` | Primary key                                             |
| `placement_key` | `text`        | not null    | none                | Hanya boleh `home_banner_top` atau `home_banner_bottom` |
| `intent`        | `text`        | not null    | none                | Hanya boleh `promotional`, `informational`, `branding`  |
| `title`         | `text`        | null        | none                | Opsional, simpan `NULL` bila kosong                     |
| `body`          | `text`        | null        | none                | Opsional, simpan `NULL` bila kosong                     |
| `media_path`    | `text`        | null        | none                | Opsional, simpan path object storage                    |
| `cta_kind`      | `text`        | not null    | none                | Hanya boleh `none` atau `route`                         |
| `cta_label`     | `text`        | null        | none                | Wajib jika `cta_kind = route`, selain itu `NULL`        |
| `cta_route`     | `text`        | null        | none                | Wajib jika `cta_kind = route`, selain itu `NULL`        |
| `is_active`     | `boolean`     | not null    | `false`             | Aktivasi banner                                         |
| `created_at`    | `timestamptz` | not null    | `now()`             | Audit timestamp                                         |
| `updated_at`    | `timestamptz` | not null    | `now()`             | Audit timestamp                                         |

#### Planned Constraint Direction

- primary key pada `id`
- `CHECK` constraint untuk `placement_key`
- `CHECK` constraint untuk `intent`
- `CHECK` constraint untuk `cta_kind`
- `CHECK` bahwa `cta_label` dan `cta_route` harus `NULL` jika `cta_kind = none`
- `CHECK` bahwa `cta_label` dan `cta_route` wajib terisi jika `cta_kind = route`
- `CHECK` bahwa banner memiliki minimal satu payload terlihat: `title`, `body`, atau `media_path`
- semua field opsional yang tidak dipakai harus tersimpan sebagai `NULL`, bukan empty string

#### Planned Index Direction

- primary key index di `id`
- partial unique index pada `placement_key` ketika `is_active = true`

#### Planned Read Pattern

Query utama MVP yang harus dioptimalkan:

- ambil banner aktif untuk `home_banner_top`
- ambil banner aktif untuk `home_banner_bottom`

Table ini tidak dirancang untuk query analytics, reporting, atau multi-banner-per-placement pada MVP.

## Editorial Meaning of `intent`

Field `intent` dipakai sebagai classifier ringan untuk admin dan reporting sederhana. Field ini **bukan** driver untuk engine berbeda.

Allowed values:

- `promotional`
- `informational`
- `branding`

Makna:

- `promotional`: banner yang biasanya punya CTA
- `informational`: banner informasi, CTA opsional
- `branding`: banner visual atau brand communication, CTA biasanya tidak ada

Catatan penting:

- frontend tidak perlu membuat tiga sistem render berbeda hanya karena `intent`
- `intent` dipakai untuk membantu admin memahami tujuan banner

## Placement Values

### `placement_key`

Allowed values MVP:

- `home_banner_top`
- `home_banner_bottom`

Mengapa bukan `home_primary` / `home_secondary`:

- `top` dan `bottom` langsung sesuai posisi nyata di home
- lebih sedikit ambigu untuk admin
- lebih stabil untuk MVP dibanding ordinal naming

## Media Model

Spec ini **menggunakan bucket Supabase `media`** yang sudah ada.

### Media Storage Rule

Simpan:

- `media_path`

Prefix path MVP yang dipakai:

- `banners/home_banner_top/`
- `banners/home_banner_bottom/`

Jangan simpan full public URL sebagai source of truth utama di database.

Alasan:

- lebih fleksibel bila domain/CDN berubah
- lebih konsisten dengan pola storage
- lebih kecil di database
- URL bisa di-generate di service layer ketika dibutuhkan

### Media Behavior

- bucket media dikunci di layer config/service sebagai `media`
- `media_path` nullable
- banner boleh text-only, media-only, atau gabungan text + media

Contoh `media_path`:

- `banners/home_banner_top/top-ramadhan.webp`
- `banners/home_banner_bottom/bottom-brand-refresh.jpg`

## Payload Validity Rules

Banner harus memiliki **minimal satu payload yang terlihat user**.

Artinya sebuah row valid jika memiliki setidaknya salah satu dari:

- `title`
- `body`
- `media_path`

Ini penting agar branding-only banner bisa valid tanpa dipaksa punya CTA atau teks panjang.

## Database Rules

### Required Constraints

Database harus menolak data yang tidak valid.

Constraint minimum:

- `placement_key` disimpan sebagai `text not null` dengan `CHECK` constraint untuk nilai MVP
- `intent` disimpan sebagai `text not null` dengan `CHECK` constraint untuk nilai MVP
- `cta_kind` disimpan sebagai `text not null` dengan `CHECK` constraint untuk nilai MVP
- jika `cta_kind = none`, maka `cta_label` dan `cta_route` harus kosong/null
- jika `cta_kind = route`, maka `cta_label` dan `cta_route` wajib terisi
- `cta_route` harus mengikuti allowlist yang ditetapkan backend/admin
- sebuah banner harus punya minimal satu payload terlihat: `title`, `body`, atau `media_path`
- field opsional yang tidak dipakai harus disimpan sebagai `NULL`, bukan empty string

### Index Strategy

Index MVP harus tetap minimal.

Yang wajib:

- primary key pada `id`
- partial unique index untuk menjamin hanya satu row aktif per `placement_key`

Yang belum perlu untuk MVP:

- index `intent`
- index `cta_kind`
- index `updated_at`
- index `media_path`

### Active Banner Rule

Untuk MVP, hanya boleh ada **satu banner aktif per `placement_key`**.

Artinya backend harus menjamin:

- operations tidak bisa mengaktifkan dua banner aktif untuk placement yang sama
- frontend tidak perlu menyelesaikan konflik data yang ambigu

Perilaku bisnis final:

- boleh ada 0 banner aktif untuk sebuah placement
- boleh ada 1 banner aktif untuk sebuah placement
- tidak boleh ada 2 banner aktif untuk placement yang sama

### Audit Rule

`updated_at` harus otomatis berubah setiap ada update row.

## Row Level Security

### Intent

Mobile app hanya perlu membaca banner aktif yang valid. Admin perlu full CRUD.

### RLS Enablement

RLS harus **enabled** pada:

- `public.home_banners`
- `storage.objects`

Tidak ada akses API yang dianggap aman tanpa policy yang eksplisit.

### Table RLS vs Storage Policy

Spec ini memiliki dua lapisan security yang terpisah:

1. **Table RLS** di `public.home_banners`
   - mengatur akses ke metadata banner
   - contoh: `placement_key`, `title`, `body`, `media_path`, `cta_kind`

2. **Storage policy** di `storage.objects`
   - mengatur akses ke file media banner di bucket `media`
   - contoh: file pada prefix `banners/home_banner_top/` dan `banners/home_banner_bottom/`

Penting:

- policy pada `home_banners` **tidak** otomatis berlaku untuk file di storage
- policy pada storage **tidak** otomatis melindungi row di `home_banners`
- implementasi dianggap benar hanya jika kedua layer diatur dengan konsisten

### MVP RLS Behavior

- mobile app: boleh `SELECT` hanya untuk row yang aktif
- admin authenticated: boleh `INSERT`
- admin authenticated: boleh `UPDATE`
- admin authenticated: boleh `DELETE`

### Home Banners Policy Matrix

| Operation | Role                    | Intent                       | Direction                                                |
| --------- | ----------------------- | ---------------------------- | -------------------------------------------------------- |
| `SELECT`  | `anon`, `authenticated` | client membaca banner publik | hanya row dengan `is_active = true`                      |
| `INSERT`  | `authenticated` admin   | admin membuat banner         | hanya admin boleh insert                                 |
| `UPDATE`  | `authenticated` admin   | admin mengubah banner        | hanya admin boleh update; butuh `USING` dan `WITH CHECK` |
| `DELETE`  | `authenticated` admin   | admin menghapus banner       | hanya admin boleh delete                                 |

### Home Banners Policy Notes

- karena banner adalah konten publik, `SELECT` untuk client boleh bersifat public, tetapi tetap dibatasi ke row aktif
- `INSERT`, `UPDATE`, dan `DELETE` harus dibatasi ke admin berdasarkan signal auth yang konsisten di project
- jika memakai JWT role claim, gunakan claim yang tidak bisa dimodifikasi user biasa
- spec ini tidak mengandalkan ownership per user karena banner adalah resource global, bukan milik satu user

### Storage Objects Policy Matrix

| Operation | Role                    | Intent                            | Direction                                                 |
| --------- | ----------------------- | --------------------------------- | --------------------------------------------------------- |
| `SELECT`  | `anon`, `authenticated` | client mengunduh asset banner     | public read hanya untuk object banner pada bucket `media` |
| `INSERT`  | `authenticated` admin   | admin upload asset banner         | hanya admin boleh upload ke prefix banner                 |
| `UPDATE`  | `authenticated` admin   | admin replace/upsert asset banner | hanya admin boleh update object banner                    |
| `DELETE`  | `authenticated` admin   | admin hapus asset banner          | hanya admin boleh delete object banner                    |

### Storage Policy Notes

- storage policy harus membatasi `bucket_id = 'media'`
- storage policy harus membatasi prefix banner saja, bukan seluruh isi bucket `media`
- pembatasan prefix MVP mengikuti:
  - `banners/home_banner_top/`
  - `banners/home_banner_bottom/`
- public read hanya berlaku untuk object banner pada prefix tersebut
- write access untuk storage harus mengikuti rule admin yang sama dengan `home_banners`

### Service Role Caveat

`service_role` Supabase akan bypass semua RLS policy.

Artinya:

- aman dipakai hanya di backend atau edge function yang terpercaya
- tidak boleh pernah terekspos ke client app atau admin client-side bundle
- jika Refine admin write dijalankan via backend dengan `service_role`, maka authorization admin harus dipastikan di layer backend, bukan diserahkan ke RLS

### Common RLS Mistakes to Avoid

- menganggap `storage.objects` otomatis mengikuti policy `home_banners`
- membuat `SELECT` terlalu permisif tanpa filter `is_active = true`
- lupa menulis policy untuk semua operasi `SELECT`, `INSERT`, `UPDATE`, `DELETE`
- lupa bahwa `UPDATE` memerlukan `USING` dan `WITH CHECK`
- memakai metadata auth yang bisa diubah user biasa sebagai dasar admin check
- mengekspos `service_role` ke client code

### RLS Testing Checklist

- pastikan RLS enabled pada `public.home_banners`
- pastikan policy `SELECT` hanya mengembalikan banner aktif untuk client non-admin
- pastikan non-admin tidak bisa `INSERT`, `UPDATE`, atau `DELETE` banner
- pastikan admin bisa `INSERT`, `UPDATE`, dan `DELETE` banner
- pastikan storage `SELECT` public hanya berlaku untuk prefix banner
- pastikan non-admin tidak bisa upload/update/delete object banner
- pastikan admin bisa upload/update/delete object banner
- pastikan tidak ada penggunaan `service_role` di client-side code

### Admin Identification

Admin sebaiknya ditentukan dengan rule yang konsisten dengan sistem auth Anda saat ini, misalnya melalui:

- role pada `profiles`
- atau claim auth yang memang sudah menjadi standar di project

Aturan final harus konsisten dengan pola auth existing dan tidak membuat jalur bypass khusus untuk banner.

## CTA Specification

### Purpose of CTA

CTA adalah tombol aksi opsional pada banner.

CTA hanya digunakan jika banner memang mengarahkan user ke langkah berikutnya.

Contoh:

- `Pesanan Anda sedang diproses` → CTA `Lihat Pesanan`
- `Produk favorit Anda ada di keranjang` → CTA `Buka Keranjang`
- branding visual → tanpa CTA

### MVP CTA Rule

Untuk MVP:

- hanya `none`
- atau `route`
- tidak ada external URL
- tidak ada route parameter bebas dari admin

### Route Allowlist Mechanism

Spec ini mengunci **mekanisme** allowlist, bukan seluruh daftar route final di hardcode pada model data.

Route internal MVP yang saat ini paling aman untuk CTA:

- `orders`
- `cart`
- `home/details`

Route final harus diambil dari konfigurasi/allowlist backend-admin yang konsisten dengan route app yang tersedia saat implementasi.

## Refine Admin Specification

### Resource

Resource admin: `home-banners`

### Admin Responsibilities

Refine dipakai oleh operations/admin untuk:

- melihat daftar banner
- membuat banner baru
- mengubah banner existing
- mengaktifkan atau menonaktifkan banner
- menghapus banner yang tidak dibutuhkan

### List Page

Kolom minimum yang harus terlihat:

- placement_key
- intent
- title
- cta_kind
- cta_route
- is_active
- updated_at
- actions

### Create/Edit Form

Field minimum:

- `placement_key`
- `intent`
- `title`
- `body`
- `media_path`
- `cta_kind`
- `cta_label`
- `cta_route`
- `is_active`

### Admin Validation Rules

- `placement_key` wajib dipilih dari daftar nilai yang diizinkan
- `intent` wajib dipilih dari daftar nilai yang diizinkan
- jika `cta_kind = none`, field CTA disembunyikan atau di-clear otomatis
- jika `cta_kind = route`, `cta_label` wajib diisi
- jika `cta_kind = route`, `cta_route` wajib dipilih dari allowlist, bukan text bebas
- admin tidak boleh menyimpan data CTA yang setengah lengkap
- admin tidak boleh menyimpan banner kosong tanpa `title`, `body`, dan `media_path`
- admin harus mengirim field opsional yang kosong sebagai `NULL`, bukan empty string

### Recommended Admin UX

- gunakan select sederhana untuk `placement_key`
- gunakan select sederhana untuk `intent`
- gunakan upload/select media flow yang mengarah ke bucket `media`
- dukung dua alur media MVP: upload file baru atau pilih object existing dari prefix banner
- gunakan select sederhana untuk `cta_kind`
- gunakan select sederhana untuk `cta_route`
- gunakan switch/toggle untuk `is_active`
- tampilkan helper text yang menjelaskan fungsi intent dan CTA

Helper text yang disarankan:

- `Promotional: banner yang biasanya mendorong aksi user.`
- `Informational: banner untuk informasi, CTA opsional.`
- `Branding: banner visual/branding, CTA biasanya tidak digunakan.`
- `CTA dipakai jika banner harus mengarahkan user ke halaman tertentu.`

## Backend Read Contract

Frontend harus mengonsumsi kontrak backend yang sederhana dan stabil.

### Read Behavior

Backend/frontend service read path untuk MVP harus:

- mencari banner berdasarkan `placement_key`
- hanya mengambil banner aktif
- mengembalikan paling banyak satu row aktif untuk setiap placement

Home screen harus dapat merender:

- 0 banner
- 1 banner
- atau 2 banner

Tergantung row aktif yang tersedia pada masing-masing placement.

Jika tidak ada banner aktif untuk sebuah placement:

- response untuk placement itu boleh kosong
- frontend harus treat sebagai `no banner`

Jika ada data invalid di database:

- backend sebaiknya mencegahnya lewat constraint
- admin validation harus menangkapnya lebih awal

## Frontend Contract Expectations

Dokumen ini fokus pada backend/admin, tetapi backend harus menyiapkan kontrak yang cocok untuk frontend nanti.

Frontend nantinya diharapkan menerima bentuk data yang secara logika berisi:

- `id`
- `placement_key`
- `intent`
- `title`
- `body`
- `media_path`
- `cta_kind`
- `cta_label`
- `cta_route`

Frontend behavior yang diasumsikan:

- jika tidak ada banner aktif untuk sebuah placement, placement itu hilang
- jika `cta_kind = none`, banner tampil tanpa tombol
- jika `cta_kind = route`, banner tampil dengan tombol
- jika route tidak valid, frontend harus fail safe dan tidak crash
- jika banner hanya punya media, frontend tetap bisa merender branding banner

## Generic Banner Behavior

Spec ini secara eksplisit mendukung tiga bentuk banner:

### 1. Promotional Banner

Contoh:

- judul + body + CTA
- media optional

### 2. Informational Banner

Contoh:

- judul + body
- tanpa CTA
- media optional

### 3. Branding Banner

Contoh:

- media-only
- atau media + title singkat
- tanpa CTA

Catatan penting:

- banner **tidak** dibatasi untuk order/status atau doctor discovery
- isi banner sepenuhnya bisa dikelola operations/admin selama masih sesuai field model MVP

## Operational Workflow

Workflow operations yang diharapkan pada MVP:

1. admin membuka resource `home-banners`
2. admin memilih placement `home_banner_top` atau `home_banner_bottom`
3. admin memilih intent banner
4. admin mengisi konten text/media sesuai kebutuhan
5. admin menentukan apakah banner memakai CTA route atau tidak
6. admin mengaktifkan banner
7. mobile app membaca banner aktif per placement dan menampilkannya

Jika operations ingin mengganti banner:

- edit row aktif yang ada, atau
- nonaktifkan row lama lalu aktifkan row baru

Namun hasil akhirnya tetap harus memenuhi aturan bisnis:

- hanya satu banner aktif per placement

## Dependencies Before Frontend Implementation

Sebelum frontend mulai implementasi, backend/admin harus menyiapkan:

- table `public.home_banners`
- check constraint `placement_key`
- check constraint `intent`
- check constraint `cta_kind`
- constraint validasi field
- rule satu banner aktif per placement
- partial unique index untuk active banner per placement
- RLS untuk read app dan write admin
- storage policy terpisah untuk prefix banner di bucket `media`
- auto-update `updated_at`
- integrasi media bucket `media`
- Refine resource `home-banners`
- create/edit/list flow yang berfungsi
- setidaknya satu seed/test banner untuk `home_banner_top`
- setidaknya satu seed/test banner untuk `home_banner_bottom`

## Acceptance Criteria

Spec ini dianggap siap dipakai jika semua berikut jelas:

- nama table final sudah dikunci
- nama field placement final sudah dikunci
- nilai placement MVP final sudah dikunci
- kolom MVP sudah dikunci
- rule validasi CTA sudah dikunci
- media model path-only sudah dikunci
- intent field dan maknanya sudah jelas
- RLS intent sudah jelas
- admin form fields sudah jelas
- single-active-banner-per-placement rule sudah jelas
- backend bisa menyediakan satu active banner atau empty result per placement

## Spec Review Checklist

Spec ini baru dianggap siap dipakai implementasi jika:

- tidak ada ambiguitas tentang siapa yang bisa read/write row banner
- tidak ada ambiguitas tentang siapa yang bisa read/write file storage banner
- data model MVP bisa dijelaskan tanpa menyebut fitur non-MVP
- semua field opsional jelas kapan `NULL` dan kapan wajib terisi
- prefix storage banner sudah final
- admin workflow create/edit/activate sudah jelas
- non-goals tetap sempit dan tidak bocor ke campaign system

## Non-Goals

Dokumen ini tidak mendesain:

- UI detail frontend component
- carousel behavior
- analytics schema
- localization strategy
- advanced scheduling system
- experiment / A/B testing
- app-wide banner orchestration

## Open Questions

Pertanyaan yang masih perlu dikonfirmasi sebelum implementasi backend final:

1. Apakah route allowlist MVP final tetap `orders`, `cart`, dan `home/details`?
2. Apakah admin akan upload file melalui Refine langsung, atau memilih object yang sudah ada di bucket `media`, atau keduanya sejak MVP?
3. Apakah admin write akan lewat client-auth + RLS, atau lewat backend/service-role yang memerlukan authorization terpisah?

## Final Recommendation

Mulai dari MVP yang sempit tapi benar:

- satu table home-scoped
- dua placement home yang eksplisit
- satu active banner per placement
- media dari bucket `media`
- CTA internal opsional
- banner bisa promotional, informational, atau branding

Jangan melompat ke campaign system penuh sebelum kontrak backend/admin dasar ini stabil.