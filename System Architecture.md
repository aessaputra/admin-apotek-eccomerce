# System Architecture — Apotek E-commerce

> Dokumen arsitektur sistem untuk project Apotek E-commerce yang terdiri dari Frontend React Native (mobile), Admin Panel Refine, dan Backend/Database Supabase.

---

## 1. Gambaran Umum

Sistem Apotek E-commerce adalah solusi lengkap untuk menjual produk apotek secara daring. Terdiri dari tiga komponen utama yang berbagi satu backend Supabase:

| Komponen | Teknologi | Peran |
|----------|-----------|-------|
| **Mobile App** | React Native | Aplikasi konsumen (browse, order, profil) |
| **Admin Panel** | Refine + Ant Design | Manajemen produk, pesanan, pelanggan |
| **Backend** | Supabase | Database, Auth, Storage, Realtime |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        APOTEK E-COMMERCE ECOSYSTEM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────────┐         ┌──────────────────────┐                 │
│   │   MOBILE APP         │         │   ADMIN PANEL        │                 │
│   │   React Native       │         │   Refine + Ant Design│                 │
│   │                      │         │                      │                 │
│   │ • Browse produk      │         │ • CRUD produk        │                 │
│   │ • Keranjang          │         │ • CRUD kategori      │                 │
│   │ • Checkout / Order   │         │ • Kelola pesanan     │                 │
│   │ • Profil customer    │         │ • Kelola pelanggan   │                 │
│   │ • Auth (customer)    │         │ • Auth (admin only)  │                 │
│   └──────────┬───────────┘         └──────────┬───────────┘                 │
│              │                                │                              │
│              │    Supabase JS Client          │    Supabase JS Client        │
│              │    (AsyncStorage/SecureStore)  │    (localStorage)            │
│              │                                │                              │
│              └────────────────┬───────────────┘                              │
│                               │                                              │
│                               ▼                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                         SUPABASE                                      │  │
│   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │  │
│   │  │ PostgreSQL  │ │   Auth      │ │  Storage    │ │   Realtime      │  │  │
│   │  │ + RLS       │ │ (JWT)       │ │  (S3)       │ │   (WebSocket)   │  │  │
│   │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Diagram Arsitektur (Mermaid)

### 2.1 High-Level Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Applications"]
        RN["📱 React Native\n(Mobile App)"]
        ADMIN["🖥️ Admin Panel\n(Refine)"]
    end

    subgraph Supabase["Supabase Backend"]
        AUTH["Auth\n(JWT, OAuth)"]
        DB[(PostgreSQL\n+ RLS)]
        STORAGE["Storage\n(Buckets)"]
        REALTIME["Realtime\n(WebSocket)"]
    end

    RN -->|REST/WS| AUTH
    RN -->|REST/WS| DB
    RN -->|Upload/Download| STORAGE
    RN -->|Subscribe| REALTIME

    ADMIN -->|REST/WS| AUTH
    ADMIN -->|REST/WS| DB
    ADMIN -->|Upload/Delete| STORAGE
    ADMIN -->|Subscribe| REALTIME
```

### 2.2 Data Flow — Order Creation

```mermaid
sequenceDiagram
    participant M as Mobile App
    participant S as Supabase
    participant A as Admin Panel

    M->>S: Auth: signIn (customer)
    S-->>M: JWT + session

    M->>S: POST orders (insert)
    S->>S: RLS check (customer)
    S-->>M: Order created

    S->>A: Realtime: new order
    A->>A: LiveProvider updates UI
```

### 2.3 Authentication Flow

```mermaid
flowchart LR
    subgraph Customer["Customer (Mobile)"]
        C1[Register/Login] --> C2[JWT + Refresh Token]
        C2 --> C3[AsyncStorage/SecureStore]
    end

    subgraph Admin["Admin (Web)"]
        A1[Login Email/Pass] --> A2[Check role = admin]
        A2 --> A3[JWT + Session]
        A3 --> A4[localStorage]
    end

    C3 --> API[Supabase API]
    A4 --> API
```

### 2.4 Checkout & Payment Flow (Midtrans)

```mermaid
flowchart TB
    subgraph Mobile["Mobile App"]
        M1[User Checkout]
        M2[Insert Order ke Supabase]
        M3[Panggil Edge Function]
        M4[Buka Snap Payment]
        M5[User Bayar]
    end

    subgraph Supabase["Supabase"]
        EF1["Edge Function\ncreate-snap-token"]
        EF2["Edge Function\nmidtrans-webhook"]
        DB[(PostgreSQL\norders)]
    end

    subgraph Midtrans["Midtrans"]
        MT1[Snap API]
        MT2[Payment Page\nBank/EWallet/QRIS]
    end

    M1 --> M2
    M2 --> M3
    M3 --> EF1
    EF1 -->|Server Key| MT1
    MT1 -->|snap_token| EF1
    EF1 -->|token| M3
    M3 --> M4
    M4 --> MT2
    M5 --> MT2
    MT2 -->|Webhook POST| EF2
    EF2 --> DB
```

```mermaid
sequenceDiagram
    participant M as Mobile App
    participant S as Supabase
    participant EF as Edge Function
    participant MT as Midtrans
    participant A as Admin Panel

    M->>S: Insert order (status: pending)
    S-->>M: order_id

    M->>EF: create-snap-token(order_id, amount, customer)
    EF->>MT: POST /snap/v1/transactions
    MT-->>EF: snap_token
    EF-->>M: snap_token

    M->>MT: Buka Snap UI (WebView)
    Note over M,MT: User pilih metode & bayar

    MT->>EF: Webhook: transaction_status
    EF->>S: Update orders (payment_status, status)
    S->>A: Realtime: order updated
```

**Transaction Status Mapping (Midtrans → Supabase):**

| Midtrans `transaction_status` | `payment_status` | `status` (order) |
|------------------------------|------------------|------------------|
| `capture`, `settlement`      | success          | paid / processing |
| `pending`                    | pending          | pending          |
| `deny`, `expire`, `cancel`   | failed           | cancelled        |

### 2.5 Shipping Flow (Raja Ongkir)

```mermaid
flowchart TB
    subgraph Mobile["Mobile App"]
        M1[Checkout: Input Alamat]
        M2[Dapat origin & destination ID]
        M3[Panggil Edge Function\ncalculate-shipping-cost]
        M4[Tampilkan pilihan kurir]
        M5[User pilih layanan]
        M6[Simpan ke order]
    end

    subgraph Supabase["Supabase"]
        EF1["Edge Function\nrajaongkir-cost"]
        EF2["Edge Function\nrajaongkir-tracking"]
        DB[(orders)]
    end

    subgraph RajaOngkir["Raja Ongkir API"]
        RO1[Province / City / Destination]
        RO2[Calculate Domestic Cost]
        RO3[Waybill Tracking]
    end

    M1 --> M2
    M2 --> M3
    M3 --> EF1
    EF1 -->|origin, destination, weight, courier| RO2
    RO2 -->|list: cost, etd, service| EF1
    EF1 --> M3
    M3 --> M4 --> M5 --> M6 --> DB
    EF2 -->|waybill, courier| RO3
    RO3 --> EF2
```

```mermaid
sequenceDiagram
    participant M as Mobile App
    participant EF as Edge Function
    participant RO as Raja Ongkir
    participant S as Supabase

    M->>M: User pilih alamat (province, city)
    M->>EF: get-shipping-cost(origin_id, dest_id, weight, couriers)
    EF->>RO: POST /calculate/domestic-cost
    RO-->>EF: List layanan (JNE REG 15k, JNT 12k, ...)
    EF-->>M: Shipping options

    M->>M: User pilih kurir + layanan
    M->>S: Insert order (+ shipping_cost, courier, service, etd, address)

    Note over M,S: Setelah order dikirim
    M->>EF: track-shipment(waybill, courier)
    EF->>RO: POST /waybill
    RO-->>EF: Status pengiriman
    EF-->>M: Tracking manifest
```

**Dua Metode Pencarian Lokasi:**

| Metode | Alur | Use Case |
|--------|------|----------|
| **Step-by-Step** | Province → City → District → Subdistrict | Form dropdown berjenjang |
| **Direct Search** | Cari nama kota/kecamatan/kode pos | Autocomplete, pencarian langsung |

**Field Shipping pada Order:**

| Field | Keterangan |
|-------|------------|
| `shipping_cost` | Ongkos kirim (dari Raja Ongkir) |
| `courier_code` | Kode kurir (jne, jnt, pos, tiki, sicepat, dll) |
| `courier_service` | Nama layanan (REG, OKE, YES, dll) |
| `shipping_etd` | Perkiraan waktu sampai |
| `shipping_address_id` | FK ke `addresses` (alamat pengiriman) |
| `origin_city_id` | City ID asal (warehouse/store) |
| `destination_city_id` | City ID tujuan |
| `waybill_number` | Nomor resi (diisi admin setelah kirim) |

---

## 3. Komponen Detail

### 3.1 Mobile App (React Native)

| Aspek | Implementasi |
|-------|--------------|
| **Framework** | React Native / Expo |
| **Supabase Client** | `@supabase/supabase-js` |
| **Auth Storage** | AsyncStorage atau Expo SecureStore (untuk sesi aman) |
| **Config** | `detectSessionInUrl: false`, `persistSession: true`, `autoRefreshToken: true` |

**Peran:**
- Autentikasi customer (register, login, forgot password)
- Browse produk & kategori
- Keranjang & checkout
- Order tracking
- Profil & edit data user

---

### 3.2 Admin Panel (Refine)

| Aspek | Implementasi |
|-------|--------------|
| **Framework** | Refine + React + Vite |
| **UI** | Ant Design |
| **Router** | React Router 7 |
| **Data Provider** | `@refinedev/supabase` |
| **Auth Provider** | Custom (role admin only) |
| **Live Provider** | Supabase Realtime |

**Peran:**
- Login admin saja (`profiles.role = 'admin'`)
- CRUD produk & kategori
- Kelola pesanan (list, update status)
- Kelola pelanggan (list, show)
- Dashboard statistik
- Upload gambar (produk, kategori, avatar)
- Profil admin & ganti password

**Refine + Supabase Integration:**
- `dataProvider`: CRUD via Supabase REST/PostgREST
- `authProvider`: Supabase Auth + pengecekan role
- `liveProvider`: Supabase Realtime untuk auto-update

---

### 3.3 Supabase Backend

| Layanan | Fungsi |
|---------|--------|
| **PostgreSQL** | Database utama, schema `public` |
| **Auth** | JWT, email/password, OAuth, magic link |
| **Storage** | File upload (avatars, category logos, product images) |
| **Realtime** | Subscribe perubahan tabel (mis. orders) dengan RLS |
| **Edge Functions** | Logic server-side: cleanup orphan storage, create Midtrans Snap token, handle Midtrans webhook, **calculate Raja Ongkir cost**, **track waybill** |

### 3.4 Midtrans Payment Gateway

| Aspek | Keterangan |
|-------|------------|
| **Integrasi** | Midtrans Snap (popup/redirect payment UI) |
| **Metode Bayar** | Kartu kredit, transfer bank, e-wallet, QRIS, dll |
| **Alur** | Mobile request token via Edge Function → buka Snap → user bayar → Midtrans webhook ke Edge Function → update `orders` |
| **Keamanan** | Server Key hanya di Edge Function; Client Key untuk buka Snap di mobile |
| **Notification URL** | Dikonfigurasi di Midtrans Dashboard & Edge Function (publicly accessible) |
| **Order ID** | Gunakan `orders.id` (UUID) sebagai string ke Midtrans; simpan di `midtrans_order_id` |

**Best Practice — Webhook Handler:**
1. **Verifikasi signature** — `SHA512(order_id + status_code + gross_amount + ServerKey)` harus cocok dengan `signature_key` dari payload
2. **Idempotensi** — Midtrans bisa kirim notifikasi berulang; cek `transaction_status` terakhir sebelum update; return 200 OK meski status sama
3. **Validasi** — Pastikan `order_id` exist di DB sebelum update

### 3.5 Raja Ongkir Shipping API

| Aspek | Keterangan |
|-------|------------|
| **Integrasi** | Raja Ongkir API (Komerce / RajaOngkir) |
| **Endpoint Utama** | Province, City, Destination search; Calculate domestic cost; Waybill tracking |
| **Kurir** | JNE, J&T, POS, TIKI, Sicepat, dan lainnya |
| **Alur** | Mobile request cost via Edge Function → Raja Ongkir → daftar harga; User pilih → simpan ke order; Tracking via waybill |
| **Keamanan** | API key hanya di Edge Function; jangan expose ke client |
| **Precision** | City-level atau District/Subdistrict untuk perhitungan lebih akurat |

---

## 4. Model Data (Database Schema)

Schema aktual database Supabase:

```mermaid
erDiagram
    profiles ||--o{ addresses : has
    profiles ||--o{ orders : places
    profiles ||--o| carts : has
    categories ||--o{ products : has
    products ||--o{ product_images : has
    products ||--o{ cart_items : in
    products ||--o{ order_items : in
    carts ||--o{ cart_items : has
    orders ||--o{ order_items : has
    addresses ||--o{ orders : "shipping"

    profiles {
        uuid id PK
        text role "admin|customer"
        text full_name
        text avatar_url
        text phone_number
        timestamptz created_at
        timestamptz updated_at
    }

    addresses {
        uuid id PK
        uuid profile_id FK
        text receiver_name
        text phone_number
        text street_address
        text city
        text postal_code
        text province_id
        text province
        text city_id
        text district_id
        text subdistrict_id
        boolean is_default
    }

    categories {
        uuid id PK
        text name
        text slug
        text logo_url
        timestamptz created_at
    }

    products {
        uuid id PK
        uuid category_id FK
        text name
        text slug
        text description
        numeric price
        int stock
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    product_images {
        uuid id PK
        uuid product_id FK
        text url
        int sort_order
    }

    carts {
        uuid id PK
        uuid user_id FK
        timestamptz created_at
    }

    cart_items {
        uuid id PK
        uuid cart_id FK
        uuid product_id FK
        int quantity
        timestamptz created_at
    }

    orders {
        uuid id PK
        uuid user_id FK
        uuid shipping_address_id FK
        numeric total_amount
        text status
        text payment_status
        text midtrans_order_id
        text midtrans_transaction_id
        text payment_type
        numeric shipping_cost
        text courier_code
        text courier_service
        text shipping_etd
        text origin_city_id
        text destination_city_id
        text waybill_number
        timestamptz created_at
    }

    order_items {
        uuid id PK
        uuid order_id FK
        uuid product_id FK
        int quantity
        numeric price_at_purchase
        timestamptz created_at
    }
```

---

## 5. Storage Buckets

| Bucket | Penggunaan | Client |
|--------|------------|--------|
| `avatars` | Foto profil (admin & customer) | Admin, Mobile |
| `category-logos` | Logo kategori | Admin |
| `product-images` | Gambar produk (multi per product) | Admin |

**Best Practice:**
- Upload langsung saat file dipilih
- Orphan cleanup via Edge Function (mingguan) untuk file yang tidak terhubung ke record

---

## 6. Keamanan & Authorization

### 6.1 Row Level Security (RLS)

RLS di PostgreSQL mengontrol akses baris berdasarkan `auth.uid()` dan role:

- **Admin:** Akses penuh ke semua tabel (via `profiles.role = 'admin'` / `private.is_admin()`)
- **Customer:** Hanya data milik sendiri (profiles, addresses, carts, orders, order_items) dan read-only produk/kategori

**Best Practice RLS (Supabase):**
- Gunakan `(select auth.uid())` bukan `auth.uid()` — hasil di-cache per statement, performa lebih baik
- Index kolom yang dipakai di policy (`user_id`, `profile_id`, dll)
- Policy INSERT: `WITH CHECK ((select auth.uid()) = user_id)`

**Policy utama:**
| Tabel | Aksi | Policy |
|-------|------|--------|
| orders | INSERT | Users can insert their own orders (`user_id = auth.uid`) |
| orders | SELECT | Admins all; Users own |
| order_items | INSERT | Users can insert for own orders (EXISTS order milik user) |
| addresses | ALL | Users manage own (profile_id) |

### 6.2 Role-Based Access

| Role | Mobile App | Admin Panel |
|------|------------|-------------|
| `customer` | ✅ Full access | ❌ Ditolak |
| `admin` | ❌ (biasanya tidak login di mobile) | ✅ Full access |

### 6.3 Auth Provider (Admin)

Admin panel memvalidasi role `admin` di tabel `profiles` setelah login. User dengan role selain admin akan di-sign out dan akses ditolak.

---

## 7. Realtime

Supabase Realtime memakai RLS sehingga hanya perubahan yang diizinkan policy yang di-broadcast:

1. PostgreSQL logical decoding (WAL)
2. Evaluasi RLS
3. Broadcast ke subscriber via WebSocket

**Use Case:** Admin menerima update real-time saat ada order baru dari mobile.

---

## 8. Environment Variables

| Client | Variable | Keterangan |
|--------|----------|------------|
| Admin Panel | `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | URL project & anon key |
| Mobile App (Expo) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | URL project & anon key |
| Supabase (Edge Function) | `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY` | Server Key untuk Snap API; Client Key untuk Snap UI |
| Supabase (Edge Function) | `RAJAONGKIR_API_KEY` | API key Raja Ongkir untuk cost & tracking |
| Midtrans Dashboard | Payment Notification URL | URL Edge Function webhook (contoh: `https://<project>.supabase.co/functions/v1/midtrans-webhook`) |

> Gunakan **anon key** untuk client; jangan expose **service_role key**. **Server Key** Midtrans hanya di server (Edge Function).

---

## 9. Best Practices

### 9.1 Database (Supabase)
- **Index FK** — Index kolom foreign key untuk performa JOIN
- **RLS** — Semua tabel user data wajib RLS; gunakan `(select auth.uid())`
- **Leaked password** — Aktifkan HaveIBeenPwned di Auth settings
- **Function search_path** — Set `search_path` pada fungsi custom

### 9.2 Payment (Midtrans)
- **Verify signature** — Webhook handler wajib verifikasi sebelum update DB
- **Idempotent** — Handle notifikasi duplikat; return 200 OK
- **Server Key** — Hanya di Edge Function, never expose ke client

### 9.3 Shipping (Raja Ongkir)
- **API key** — Hanya di Edge Function
- **Addresses** — Simpan `city_id`, `province_id` saat user pilih alamat
- **Origin** — Simpan `origin_city_id` store di env atau tabel config

### 9.4 Umum
- **Anon key** — Gunakan untuk client; jangan expose `service_role`
- **Env vars** — Jangan commit secret ke repo; pakai `.env.example` sebagai template

---

## 10. Deployment

| Komponen | Hosting Options |
|----------|-----------------|
| **Admin Panel** | Vercel, Netlify, Docker (serve static) |
| **Mobile App** | App Store, Google Play (Expo / React Native build) |
| **Supabase** | Supabase Cloud (managed) |

---

## 11. Referensi

- [Refine Documentation](https://refine.dev/docs)
- [Refine Supabase Data Provider](https://refine.dev/docs/data/packages/supabase/)
- [Supabase Documentation](https://supabase.com/docs)
- [Supabase React Native Guide](https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native)
- [Supabase Realtime RLS](https://supabase.com/docs/guides/realtime/postgres-cdc)
- [Supabase RLS Best Practices](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Midtrans Snap Integration](https://docs.midtrans.com/docs/snap-snap-integration-guide)
- [Midtrans HTTP(S) Notification / Webhooks](https://docs.midtrans.com/docs/https-notification-webhooks)
- [Raja Ongkir Documentation](https://rajaongkir.com/docs)
- [Raja Ongkir Calculate Domestic Cost](https://rajaongkir.com/docs/shipping-cost/endpoint-rajaongkir-for-search-base/calculate-domestic-cost)
