# HomeBanner Admin Operation Spec

## Overview

Dokumen ini mengatur **operational workflow di Refine admin** untuk Home Banner.

Dokumen ini melengkapi:

- `HomeBanner Spec.md` → source of truth untuk backend, schema, storage, dan RLS
- `HomeBanner Presentation Spec.md` → source of truth untuk rendering frontend

Dokumen ini fokus pada:

- bagaimana operations mengelola banner di Refine
- bagaimana admin upload image dengan ukuran yang benar
- validation dan helper text yang harus ada di form
- workflow publish/unpublish yang aman

## Goal

Admin operation harus bisa:

- membuat banner dengan benar tanpa perlu memahami detail frontend code
- upload image dengan proporsi yang cocok untuk mobile
- memilih placement yang tepat
- memahami kapan banner akan tampil sebagai content banner atau image-only banner
- menghindari upload asset yang secara visual buruk atau terpotong

## Scope

### In Scope

- list page behavior
- create/edit form behavior
- field-level helper text
- media upload guidance
- validation UX
- publish/unpublish workflow
- operation checklist

### Out of Scope

- perubahan schema backend
- perubahan RLS backend
- perubahan kontrak payload frontend
- carousel management
- analytics dashboard
- scheduling UI lanjutan

## Admin Resource

- resource name: `home-banners`
- backend table: `public.home_banners`

## Placement Options

Admin hanya boleh memilih:

- `home_banner_top`
- `home_banner_bottom`

### Placement Meaning

#### `home_banner_top`

- banner utama di bagian atas home
- cocok untuk promo ringan, informasi cepat, atau branding visual yang ringkas
- secara visual sebaiknya lebih cepat dipindai

#### `home_banner_bottom`

- banner kedua di bagian bawah setelah latest products
- cocok untuk secondary campaign, branding visual, atau informasi tambahan
- bisa sedikit lebih visual dibanding top banner

## Banner Modes Explained to Admin

Admin tidak perlu memilih mode render manual. Frontend akan menentukan mode berdasarkan payload.

### Mode 1 — Content Banner

Terjadi jika admin mengisi salah satu:

- `title`
- `body`

Behavior di app:

- image menjadi visual utama jika tersedia
- text dirender di bagian bawah banner
- CTA dirender di bawah text jika valid

### Mode 2 — Image-Only Banner

Terjadi jika:

- `title` kosong
- `body` kosong
- CTA kosong / tidak valid
- `media_path` terisi

Behavior di app:

- banner tampil sebagai full-image treatment
- tidak ada text block kosong

### Important Note

Admin **tidak perlu** memilih mode render.
Mode render ditentukan otomatis dari field yang diisi.

## List Page Requirements

Kolom minimum yang harus tampil di list page:

- placement
- intent
- title
- CTA status
- image status
- active status
- updated_at
- actions

### Recommended Badges

- Placement badge:
  - `Top`
  - `Bottom`
- Intent badge:
  - `Promotional`
  - `Informational`
  - `Branding`
- CTA badge:
  - `With CTA`
  - `No CTA`
- Media badge:
  - `With Image`
  - `No Image`
- Status badge:
  - `Active`
  - `Inactive`

## Create/Edit Form Fields

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

## Field Behavior

### `placement_key`

- type: select
- required: yes
- options:
  - `home_banner_top`
  - `home_banner_bottom`

Helper text:

- `Top = banner atas home. Bottom = banner bawah setelah latest products.`

### `intent`

- type: select
- required: yes
- options:
  - `promotional`
  - `informational`
  - `branding`

Helper text:

- `Promotional = mendorong aksi user.`
- `Informational = menyampaikan informasi.`
- `Branding = fokus visual/brand, CTA biasanya tidak dipakai.`

### `title`

- type: text input
- required: no
- max recommendation: singkat, 1–2 baris mobile

Helper text:

- `Jika title atau body diisi, frontend akan menampilkan text di bagian bawah banner.`

### `body`

- type: textarea ringan / text input multiline
- required: no

Helper text:

- `Gunakan body singkat. Hindari copy panjang karena banner adalah area scan cepat.`

### `media_path`

- type: upload or pick existing object
- required: no, tetapi strongly recommended untuk branding banner

Helper text:

- `Gunakan image yang sesuai placement. Path akan berada di bucket media dengan prefix banner yang benar.`

### `cta_kind`

- type: select
- required: yes
- options:
  - `none`
  - `route`

Behavior:

- jika `none`, field CTA lain disembunyikan atau di-clear
- jika `route`, field `cta_label` dan `cta_route` wajib diisi

### `cta_label`

- type: short text input
- required: hanya jika `cta_kind = route`

Helper text:

- `Gunakan label singkat seperti Shop, Explore, Lihat Pesanan.`

### `cta_route`

- type: select
- required: hanya jika `cta_kind = route`
- options MVP:
  - `orders`
  - `cart`
  - `home/details`

### `is_active`

- type: toggle / switch
- required: yes

Helper text:

- `Hanya satu banner aktif diperbolehkan untuk setiap placement.`

## Media Upload Guidance

### Bucket and Prefix

Bucket:

- `media`

Prefix:

- `banners/home_banner_top/`
- `banners/home_banner_bottom/`

Admin tidak perlu mengetik path manual jika upload flow bisa mengisinya otomatis.

## Recommended Upload Sizes

### `home_banner_top`

- ratio: **3:1**
- recommended size: **720 × 240 px**
- tolerance: sekitar ±5%

### `home_banner_bottom`

- ratio: **2:1**
- recommended size: **720 × 360 px**
- tolerance: sekitar ±5%

## Recommended File Rules

- format: `WebP` atau `JPEG`
- max size: **200 KB** untuk MVP
- image harus cukup tajam untuk mobile retina

## Safe Area Guidance for Admin

### Top Banner Safe Area

- simpan text/logo penting di area **bawah-kiri**
- hindari elemen penting terlalu dekat ke pinggir kanan
- hindari elemen penting terlalu dekat ke atas

### Bottom Banner Safe Area

- simpan text/logo penting di area **bawah-kiri**
- image focal point sebaiknya di tengah/kanan
- hindari elemen penting di area paling tepi karena `cover` bisa memotong image

### Practical Rule

Untuk kedua placement:

- area kiri-bawah adalah area paling aman untuk text/logo penting
- area kanan lebih aman untuk visual atau focal image

## Admin Media Workflow

MVP mendukung dua workflow:

### 1. Upload New Image

Use case:

- campaign baru
- asset baru belum ada di bucket

Flow:

1. pilih placement
2. upload file dengan ratio yang sesuai
3. simpan object ke prefix placement yang benar
4. isi `media_path` otomatis

### 2. Pick Existing Image

Use case:

- re-use asset lama
- seasonal banner yang dipakai ulang

Flow:

1. pilih placement
2. browse existing object dari prefix placement yang sesuai
3. pilih object
4. isi `media_path` otomatis

## Validation Rules in Admin UI

Refine form sebaiknya memberi:

### Hard Validation

- `placement_key` wajib valid
- `intent` wajib valid
- jika `cta_kind = route`, maka `cta_label` wajib diisi
- jika `cta_kind = route`, maka `cta_route` wajib dipilih
- banner tidak boleh kosong total tanpa `title`, `body`, dan `media_path`

### Soft Validation / Warning

- warn jika ratio image tidak sesuai rekomendasi placement
- warn jika file terlalu besar
- warn jika title/body terlalu panjang untuk mobile banner
- warn jika admin membuat branding banner tanpa image

## Preview Requirements

Idealnya admin form memiliki preview sederhana:

- preview top banner
- preview bottom banner
- preview image-only mode ketika text/CTA kosong

Preview tidak harus pixel-perfect, tapi harus cukup untuk menunjukkan:

- crop risk
- text readability
- CTA visibility

## Activation Workflow

### Safe Operational Flow

1. buat atau edit banner
2. isi text/body/CTA jika diperlukan
3. upload atau pilih image yang benar
4. cek preview
5. aktifkan banner

### Important Rule

Jika admin mengaktifkan banner baru di placement yang sama:

- sistem harus tetap menjaga satu banner aktif per placement
- admin sebaiknya memahami bahwa banner lama akan tergantikan atau harus dibuat inactive

## Operational Checklist

Sebelum menekan save/publish, admin harus bisa memeriksa:

- placement sudah benar
- intent sudah benar
- image ratio sudah sesuai
- file size masih aman
- text singkat dan mudah dibaca
- CTA hanya dipakai jika memang perlu
- route CTA benar
- preview terlihat aman
- banner aktif hanya untuk placement yang tepat

## UX Copy Recommendations

### Good Copy

- singkat
- jelas
- satu aksi utama

Contoh CTA bagus:

- `Shop Now`
- `Explore`
- `Lihat Pesanan`

### Copy to Avoid

- terlalu panjang
- terlalu banyak kalimat
- CTA generik yang tidak jelas

Contoh buruk:

- `Click here for more information and details`
- `Discover everything you need today in our complete catalog`

## Non-Goals

Admin spec ini tidak mencakup:

- multi-slide carousel setup
- autoplay banner
- advanced personalization
- A/B testing setup
- analytics reporting

## Acceptance Criteria

Spec ini siap dipakai jika:

- admin field behavior sudah jelas
- media guidance per placement sudah jelas
- helper text inti sudah jelas
- validation hard vs soft sudah jelas
- operation workflow upload/pick existing sudah jelas
- activation flow sudah jelas