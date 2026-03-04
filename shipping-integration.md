# Panduan Integrasi Edge Functions Biteship & React Native

Dokumen ini menjelaskan alur lengkap integrasi sistem pengiriman **Biteship** yang menghubungkan aplikasi React Native (Frontend) dengan Supabase Edge Functions (Backend). Biteship bertindak sebagai **agregator kurir** yang menyatukan JNE, J&T, SiCepat, Anteraja, dan puluhan kurir lainnya dalam satu API.

> **Hubungan dengan Midtrans:** Biteship menangani **pengiriman barang**, sedangkan Midtrans menangani **pembayaran**. Keduanya saling terhubung — setelah Midtrans mengkonfirmasi pembayaran sukses via webhook, sistem secara otomatis membuat order pengiriman di Biteship. Lihat `payment-integration.md` untuk dokumentasi pembayaran.

---

## 1. Arsitektur Alur Pengiriman (Shipping Flow)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CHECKOUT FLOW                                    │
│                                                                         │
│  Mobile App                Edge Function              Biteship API      │
│  ─────────                 ─────────────              ────────────      │
│                                                                         │
│  1. User isi alamat ──→ action: 'maps' ──────→ GET /maps/areas         │
│     (autocomplete)    ←── area_id list ◄──────── area suggestions      │
│                                                                         │
│  2. User pilih kurir ──→ action: 'rates' ─────→ POST /rates/couriers   │
│     (cek ongkir)      ←── daftar tarif ◄──────── courier + pricing     │
│                                                                         │
│  3. User bayar via Midtrans (lihat payment-integration.md)              │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                     POST-PAYMENT FLOW (OTOMATIS)                        │
│                                                                         │
│  Midtrans Server          midtrans-webhook            Biteship API      │
│  ──────────────           ────────────────            ────────────      │
│                                                                         │
│  4. Webhook "paid" ──→ Verifikasi SHA-512 + GET Status API             │
│                        createBiteshipOrder() ──→ POST /orders          │
│                        update DB: status,       ←── order_id,          │
│                        waybill_number,               waybill_id        │
│                        biteship_order_id                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                       TRACKING FLOW                                     │
│                                                                         │
│  Mobile App                Edge Function              Biteship API      │
│  ─────────                 ─────────────              ────────────      │
│                                                                         │
│  5. User lacak paket ──→ action: 'track' ─────→ GET /trackings/:id     │
│                       ←── tracking history ◄──── status + timeline     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Ringkasan API Biteship yang Digunakan

| Action | Biteship API | Method | Kegunaan | Kapan Dipanggil |
|--------|-------------|--------|----------|-----------------|
| `maps` | `/v1/maps/areas` | GET | Autocomplete alamat → dapat `area_id` | Saat user mengetik alamat |
| `rates` | `/v1/rates/couriers` | POST | Cek ongkir semua kurir | Saat checkout, sebelum bayar |
| `orders` | `/v1/orders` | POST | Buat pesanan kirim + dapat resi | Otomatis setelah pembayaran sukses |
| `track` | `/v1/trackings/:id` | GET | Lacak status pengiriman | Kapan saja dari halaman order |

---

## 2. Edge Function: `biteship/index.ts` (Proxy API)

Edge Function ini berfungsi sebagai **proxy** antara mobile app dan Biteship API. Alasan menggunakan proxy:
- **Keamanan:** `BITESHIP_API_KEY` tidak pernah terekspos ke mobile app
- **CORS:** Menangani preflight request untuk cross-origin
- **Satu endpoint:** Mobile app cukup memanggil satu URL dengan parameter `action`

### Konfigurasi (`supabase/config.toml`)

```toml
[functions.biteship]
enabled = true
verify_jwt = true                              # Wajib login (Supabase JWT)
import_map = "./functions/biteship/deno.json"
entrypoint = "./functions/biteship/index.ts"
```

> `verify_jwt = true` karena function ini dipanggil dari mobile app oleh user yang sudah login. Berbeda dengan `midtrans-webhook` yang `verify_jwt = false` karena dipanggil oleh server Midtrans (lihat `payment-integration.md`).

### TypeScript Interface

```typescript
// Defined in biteship/index.ts
interface BiteshipProxyRequest {
  action: 'rates' | 'orders' | 'track' | 'maps'
  payload?: Record<string, unknown>
}
```

### Struktur Request

```typescript
// Dari mobile app via Supabase SDK
const { data, error } = await supabase.functions.invoke('biteship', {
  body: {
    action: 'rates' | 'orders' | 'track' | 'maps',
    payload: { /* parameter sesuai action */ }
  }
});
```

### Contoh Setiap Action

#### A. `maps` — Autocomplete Alamat

```typescript
const { data } = await supabase.functions.invoke('biteship', {
  body: {
    action: 'maps',
    payload: { input: 'Kemang Jakarta' }
  }
});
// Response: { areas: [{ id: "IDNP6IDNC148IDNDxxx", name: "Kemang, ...", ... }] }
// Simpan area.id sebagai origin_area_id / destination_area_id di order
```

#### B. `rates` — Cek Ongkir

```typescript
const { data } = await supabase.functions.invoke('biteship', {
  body: {
    action: 'rates',
    payload: {
      origin_area_id: "IDNP6IDNC148IDNDxxx",       // area_id toko
      destination_area_id: "IDNP11IDNC170IDNDxxx",  // area_id pembeli
      couriers: "jne,jnt,sicepat,anteraja",           // kurir yang dicek
      items: [
        { name: "Obat ABC", quantity: 2, weight: 200, value: 25000 }
      ]
    }
  }
});
// Response: { pricing: [{ courier_code: "jne", courier_service_code: "REG", price: 15000, ... }] }
// User pilih salah satu → simpan courier_code, courier_service, shipping_cost ke order
```

#### C. `track` — Lacak Pengiriman

```typescript
const { data } = await supabase.functions.invoke('biteship', {
  body: {
    action: 'track',
    payload: { tracking_id: 'biteship_order_id_dari_database' }
  }
});
// Response: { status: "delivered", history: [{ note: "Paket diterima", ... }] }
```

#### D. `orders` — Buat Order Manual (Opsional)

```typescript
// Biasanya TIDAK perlu dipanggil manual — order otomatis dibuat via midtrans-webhook.
// Gunakan hanya jika ingin membuat order pengiriman secara manual dari admin panel.
const { data } = await supabase.functions.invoke('biteship', {
  body: {
    action: 'orders',
    payload: {
      shipper_contact_name: "Apotek Sehat",
      origin_area_id: "IDNP6IDNC148IDNDxxx",
      destination_area_id: "IDNP11IDNC170IDNDxxx",
      destination_contact_name: "Nama Pembeli",
      destination_address: "Alamat Lengkap",
      courier_company: "jne",
      courier_type: "REG",
      items: [{ name: "Obat", quantity: 1, weight: 200, value: 25000 }]
    }
  }
});
```

---

## 3. Auto-Shipping via Midtrans Webhook

Setelah pembayaran sukses, `midtrans-webhook` Edge Function **secara otomatis** membuat order pengiriman di Biteship. Tidak ada aksi manual yang diperlukan.

### Alur di `midtrans-webhook/index.ts`

```
Midtrans webhook "settlement"
    │
    ├─ 1. Verifikasi SHA-512 signature ✓
    ├─ 2. Double-verify via GET Status API ✓ (konfirmasi langsung ke Midtrans)
    ├─ 3. Update order: payment_status → 'success', status → 'paid'
    ├─ 4. Kurangi stock produk via RPC atomik (reduce_product_stock)
    │
    └─ 5. createBiteshipOrder(order, biteshipKey)
           │
           ├─ Validasi: origin_area_id, destination_area_id, courier_code, courier_service
           ├─ POST ke Biteship /v1/orders
           ├─ Update order di database:
           │    ├─ biteship_order_id  = response.id
           │    ├─ waybill_number     = response.courier.waybill_id
           │    └─ status             = 'processing'
           │
           └─ Jika gagal: log error, TIDAK gagalkan webhook
              (pembayaran tetap valid meski shipping gagal)
```

### `_shared/biteship.ts` — `createBiteshipOrder()`

Fungsi ini menggunakan typed interfaces dari `_shared/types.ts`:

```typescript
// Signature (typed — bukan any)
export const createBiteshipOrder = async (
  order: Order,           // dari _shared/types.ts
  apiKey: string
): Promise<BiteshipOrderResponse> => { ... }
```

| Field Payload Biteship | Sumber Data |
|----------------------|-------------|
| `shipper_contact_name` | Env var `SHOP_SHIPPER_NAME` (default: "Apotek Sehat") |
| `shipper_contact_phone` | Env var `SHOP_SHIPPER_PHONE` (default: "08123456789") |
| `origin_address` | Env var `SHOP_ADDRESS` (default: "Alamat Toko Apotek") |
| `origin_area_id` | `orders.origin_area_id` |
| `destination_contact_name` | `profiles.full_name` |
| `destination_contact_phone` | `addresses.phone_number` |
| `destination_address` | `addresses.street_address` |
| `destination_area_id` | `orders.destination_area_id` |
| `courier_company` | `orders.courier_code` (e.g. "jne") |
| `courier_type` | `orders.courier_service` (e.g. "REG") |
| `items[].weight` | `products.weight` (default: 200 gram) |
| `items[].value` | `order_items.price_at_purchase` |

### `_shared/types.ts` — TypeScript Interfaces (Biteship)

```typescript
interface BiteshipOrderItem {
    name: string
    description: string
    value: number
    quantity: number
    weight: number
}

interface BiteshipOrderPayload {
    shipper_contact_name: string
    shipper_contact_phone: string
    origin_contact_name: string
    origin_contact_phone: string
    origin_address: string
    origin_area_id: string
    destination_contact_name: string
    destination_contact_phone: string
    destination_address: string
    destination_area_id: string
    courier_company: string
    courier_type: string
    items: BiteshipOrderItem[]
}

interface BiteshipOrderResponse {
    id: string
    courier?: {
        waybill_id?: string
    }
}
```

---

## 4. Database Schema (Kolom Terkait Shipping)

### Tabel `orders`

| Kolom | Tipe | Deskripsi |
|-------|------|-----------|
| `shipping_cost` | numeric | Ongkir yang dipilih user saat checkout |
| `courier_code` | text | Kode kurir (e.g. `jne`, `sicepat`, `anteraja`) |
| `courier_service` | text | Tipe layanan (e.g. `REG`, `YES`, `OKE`) |
| `shipping_etd` | text | Estimasi waktu pengiriman (e.g. `1-2 hari`) |
| `origin_area_id` | text | Biteship area ID lokasi toko |
| `destination_area_id` | text | Biteship area ID lokasi pembeli |
| `biteship_order_id` | text | ID order dari Biteship (diisi otomatis oleh webhook) |
| `waybill_number` | text | Nomor resi (diisi otomatis oleh webhook) |

### Tabel `products`

| Kolom | Tipe | Default | Deskripsi |
|-------|------|---------|-----------|
| `weight` | integer | 200 | Berat produk dalam gram (digunakan untuk kalkulasi ongkir) |

---

## 5. Admin Panel (Project Ini)

Admin panel menampilkan data shipping di halaman **Order Detail** (`src/pages/orders/show.tsx`):

| Field | Yang Ditampilkan |
|-------|-----------------|
| Ongkos Kirim | `Rp {shipping_cost}` |
| Kurir | `{courier_code} - {courier_service} ({shipping_etd})` |
| No. Resi | `{waybill_number}` |

Admin juga dapat **mengupdate status order** dan **mengisi nomor resi manual** melalui form di halaman tersebut.

---

## 6. Environment Variables

### Wajib (Supabase Secrets)

```bash
# API Key Biteship (testing: biteship_test.xxx, production: biteship_live.xxx)
npx supabase secrets set BITESHIP_API_KEY=biteship_test.xxx --project-ref ibmpikevzfuqtfpdpkyy
```

### Opsional (Info Pengirim — ada default di kode)

```bash
npx supabase secrets set \
  SHOP_SHIPPER_NAME="Apotek Sehat" \
  SHOP_SHIPPER_PHONE="08123456789" \
  SHOP_ADDRESS="Jl. Contoh No. 123, Jakarta" \
  --project-ref ibmpikevzfuqtfpdpkyy
```

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `BITESHIP_API_KEY` | *(wajib, tidak ada default)* | API key dari Biteship Dashboard |
| `SHOP_SHIPPER_NAME` | `Apotek Sehat` | Nama toko sebagai pengirim |
| `SHOP_SHIPPER_PHONE` | `08123456789` | Nomor telepon toko |
| `SHOP_ADDRESS` | `Alamat Toko Apotek` | Alamat lengkap toko untuk pickup |

---

## 7. Setup Biteship Dashboard

### A. Mode Testing (Sandbox)

1. Login ke [Biteship Dashboard](https://dashboard.biteship.com)
2. Aktifkan toggle **"Mode Testing"** di sidebar kiri
3. Buka **Integrations → API** → klik **"Tambah Kunci API"**
4. Key yang dihasilkan berprefiks `biteship_test.xxx` — order disimulasi, kurir tidak dijemput

### B. Mode Production (Live)

1. Matikan toggle **"Mode Testing"**
2. **Ajukan aktivasi** Order API (wajib untuk live mode)
3. Buat API key production — berprefiks `biteship_live.xxx`
4. Update secret di Supabase:
   ```bash
   npx supabase secrets set BITESHIP_API_KEY=biteship_live.xxx --project-ref ibmpikevzfuqtfpdpkyy
   ```

### Perbedaan Mode

| Aspek | Testing (`biteship_test.`) | Production (`biteship_live.`) |
|-------|---------------------------|-------------------------------|
| Base URL | `https://api.biteship.com/v1` (sama) | `https://api.biteship.com/v1` (sama) |
| Order API | Simulasi, kurir tidak datang | Order nyata, kurir dijemput |
| Rates API | Data real (bisa kena biaya) | Data real |
| Tracking API | Data real (bisa kena biaya) | Data real |
| Aktivasi | Tidak perlu | Wajib ajukan aktivasi |

---

## 8. Integrasi React Native (Frontend)

### A. Tipe Data untuk Shipping

```typescript
// types/shipping.ts — Gunakan di mobile app

interface BiteshipArea {
  id: string;
  name: string;
  country_name: string;
  country_code: string;
  administrative_division_level_1_name: string; // Provinsi
  administrative_division_level_2_name: string; // Kota
  administrative_division_level_3_name: string; // Kecamatan
  postal_code: number;
}

interface ShippingRate {
  courier_code: string;         // e.g. "jne"
  courier_service_code: string; // e.g. "REG"
  courier_service_name: string; // e.g. "Regular"
  price: number;                // dalam Rupiah
  duration: string;             // e.g. "1-2 hari"
  type: string;                 // e.g. "regular"
}

interface TrackingHistory {
  note: string;
  updated_at: string;
  status: string;
}

interface TrackingResult {
  status: string;
  courier: {
    company: string;
    type: string;
    waybill_id: string;
  };
  history: TrackingHistory[];
}
```

### B. Service Layer — Shipping API

```typescript
// services/shippingService.ts
import { supabase } from '../lib/supabase';
import type { BiteshipArea, ShippingRate, TrackingResult } from '../types/shipping';

/**
 * Autocomplete alamat — panggil saat user mengetik di search field
 */
export const searchArea = async (keyword: string): Promise<BiteshipArea[]> => {
  const { data, error } = await supabase.functions.invoke('biteship', {
    body: {
      action: 'maps',
      payload: { input: keyword }
    }
  });

  if (error) throw error;
  return data.areas;
};

/**
 * Cek ongkir — panggil setelah user memilih alamat tujuan
 */
export const getShippingRates = async (
  originAreaId: string,
  destinationAreaId: string,
  items: Array<{ name: string; weight: number; quantity: number; value: number }>
): Promise<ShippingRate[]> => {
  const { data, error } = await supabase.functions.invoke('biteship', {
    body: {
      action: 'rates',
      payload: {
        origin_area_id: originAreaId,
        destination_area_id: destinationAreaId,
        couriers: 'jne,jnt,sicepat,anteraja,pos',
        items,
      }
    }
  });

  if (error) throw error;
  return data.pricing;
};

/**
 * Tracking pengiriman — panggil dari halaman order detail
 */
export const trackShipment = async (biteshipOrderId: string): Promise<TrackingResult> => {
  const { data, error } = await supabase.functions.invoke('biteship', {
    body: {
      action: 'track',
      payload: { tracking_id: biteshipOrderId }
    }
  });

  if (error) throw error;
  return data;
};
```

### C. Komponen: Autocomplete Alamat

```tsx
// components/AddressSearch.tsx
import React, { useState, useCallback } from 'react';
import { View, TextInput, FlatList, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { searchArea } from '../services/shippingService';
import type { BiteshipArea } from '../types/shipping';

interface AddressSearchProps {
  onSelectArea: (area: BiteshipArea) => void;
  placeholder?: string;
}

export const AddressSearch = ({ onSelectArea, placeholder = 'Cari alamat...' }: AddressSearchProps) => {
  const [query, setQuery] = useState('');
  const [areas, setAreas] = useState<BiteshipArea[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);

    // Debounce: tunggu 500ms sebelum request
    if (debounceTimer) clearTimeout(debounceTimer);

    if (text.length < 3) {
      setAreas([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await searchArea(text);
        setAreas(results);
      } catch (err) {
        console.error('Search area error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 500);

    setDebounceTimer(timer);
  }, [debounceTimer]);

  const handleSelect = (area: BiteshipArea) => {
    setQuery(area.name);
    setAreas([]);
    onSelectArea(area);
  };

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={handleSearch}
        placeholder={placeholder}
        style={{
          borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
          padding: 12, fontSize: 16, backgroundColor: '#fff'
        }}
      />
      {isLoading && <ActivityIndicator style={{ marginTop: 8 }} />}
      <FlatList
        data={areas}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => handleSelect(item)}
            style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}
          >
            <Text style={{ fontSize: 14 }}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};
```

### D. Komponen: Pilih Kurir & Ongkir

```tsx
// components/ShippingRateSelector.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { getShippingRates } from '../services/shippingService';
import type { ShippingRate } from '../types/shipping';

interface ShippingRateSelectorProps {
  originAreaId: string;
  destinationAreaId: string;
  items: Array<{ name: string; weight: number; quantity: number; value: number }>;
  onSelectRate: (rate: ShippingRate) => void;
}

export const ShippingRateSelector = ({
  originAreaId, destinationAreaId, items, onSelectRate
}: ShippingRateSelectorProps) => {
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRates = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getShippingRates(originAreaId, destinationAreaId, items);
        setRates(result);
      } catch (err) {
        setError('Gagal memuat ongkir. Coba lagi.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchRates();
  }, [originAreaId, destinationAreaId]);

  if (isLoading) return <ActivityIndicator style={{ marginVertical: 20 }} />;
  if (error) return <Text style={{ color: 'red', textAlign: 'center' }}>{error}</Text>;

  const formatRupiah = (amount: number) =>
    `Rp ${amount.toLocaleString('id-ID')}`;

  return (
    <View>
      <Text style={styles.title}>Pilih Kurir</Text>
      {rates.map((rate, index) => (
        <TouchableOpacity
          key={`${rate.courier_code}-${rate.courier_service_code}`}
          style={[styles.rateItem, selectedIndex === index && styles.rateItemSelected]}
          onPress={() => {
            setSelectedIndex(index);
            onSelectRate(rate);
          }}
        >
          <View style={styles.rateInfo}>
            <Text style={styles.courierName}>
              {rate.courier_code.toUpperCase()} - {rate.courier_service_name}
            </Text>
            <Text style={styles.duration}>{rate.duration}</Text>
          </View>
          <Text style={styles.price}>{formatRupiah(rate.price)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  rateItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 8,
  },
  rateItemSelected: { borderColor: '#4CAF50', backgroundColor: '#E8F5E9' },
  rateInfo: { flex: 1 },
  courierName: { fontSize: 14, fontWeight: '600' },
  duration: { fontSize: 12, color: '#888', marginTop: 2 },
  price: { fontSize: 14, fontWeight: 'bold', color: '#333' },
});
```

### E. Komponen: Tracking Pengiriman

```tsx
// components/ShipmentTracking.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { trackShipment } from '../services/shippingService';
import type { TrackingResult } from '../types/shipping';

interface ShipmentTrackingProps {
  biteshipOrderId: string;
}

export const ShipmentTracking = ({ biteshipOrderId }: ShipmentTrackingProps) => {
  const [tracking, setTracking] = useState<TrackingResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTracking = async () => {
      try {
        const result = await trackShipment(biteshipOrderId);
        setTracking(result);
      } catch (err) {
        console.error('Tracking error:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTracking();
  }, [biteshipOrderId]);

  if (isLoading) return <ActivityIndicator style={{ marginVertical: 20 }} />;
  if (!tracking) return <Text>Tidak dapat memuat tracking.</Text>;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered': return '#4CAF50';
      case 'dropping_off': return '#2196F3';
      case 'picked': return '#FF9800';
      default: return '#9E9E9E';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'delivered': return 'Diterima';
      case 'dropping_off': return 'Dalam Pengiriman';
      case 'picked': return 'Dijemput Kurir';
      case 'confirmed': return 'Dikonfirmasi';
      case 'allocated': return 'Dialokasikan';
      default: return status;
    }
  };

  return (
    <View>
      {/* Status Badge */}
      <View style={[styles.statusBadge, { backgroundColor: getStatusColor(tracking.status) }]}>
        <Text style={styles.statusText}>{getStatusLabel(tracking.status)}</Text>
      </View>

      {/* Courier Info */}
      <Text style={styles.courierInfo}>
        {tracking.courier.company.toUpperCase()} • Resi: {tracking.courier.waybill_id}
      </Text>

      {/* Timeline */}
      <View style={styles.timeline}>
        {tracking.history.map((event, index) => (
          <View key={index} style={styles.timelineItem}>
            <View style={styles.dot} />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineNote}>{event.note}</Text>
              <Text style={styles.timelineDate}>
                {new Date(event.updated_at).toLocaleString('id-ID')}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  statusBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 16, marginBottom: 12,
  },
  statusText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  courierInfo: { fontSize: 13, color: '#666', marginBottom: 16 },
  timeline: { paddingLeft: 8 },
  timelineItem: { flexDirection: 'row', marginBottom: 16 },
  dot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#4CAF50', marginTop: 4, marginRight: 12,
  },
  timelineContent: { flex: 1 },
  timelineNote: { fontSize: 14, color: '#333' },
  timelineDate: { fontSize: 12, color: '#999', marginTop: 2 },
});
```

### F. Integrasi: Checkout Flow Lengkap

```tsx
// screens/CheckoutScreen.tsx — Contoh alur checkout lengkap
import React, { useState } from 'react';
import { View, Text, Button, Alert, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { AddressSearch } from '../components/AddressSearch';
import { ShippingRateSelector } from '../components/ShippingRateSelector';
import type { BiteshipArea, ShippingRate } from '../types/shipping';

// Konfigurasi: area_id toko (didapat sekali dari Biteship maps API)
const SHOP_ORIGIN_AREA_ID = 'IDNP6IDNC148IDNDxxx'; // Ganti dengan area_id toko Anda

export const CheckoutScreen = ({ cartItems, orderId, navigation }) => {
  const [destinationArea, setDestinationArea] = useState<BiteshipArea | null>(null);
  const [selectedRate, setSelectedRate] = useState<ShippingRate | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Konversi cart items ke format Biteship
  const biteshipItems = cartItems.map((item) => ({
    name: item.name,
    weight: item.weight || 200,
    quantity: item.quantity,
    value: item.price,
  }));

  const handleConfirmOrder = async () => {
    if (!destinationArea || !selectedRate) {
      Alert.alert('Error', 'Pilih alamat dan kurir terlebih dahulu');
      return;
    }

    setIsProcessing(true);
    try {
      // Update order dengan data shipping
      const { error } = await supabase
        .from('orders')
        .update({
          origin_area_id: SHOP_ORIGIN_AREA_ID,
          destination_area_id: destinationArea.id,
          courier_code: selectedRate.courier_code,
          courier_service: selectedRate.courier_service_code,
          shipping_cost: selectedRate.price,
          shipping_etd: selectedRate.duration,
        })
        .eq('id', orderId);

      if (error) throw error;

      // Lanjut ke pembayaran Midtrans (lihat payment-integration.md)
      navigation.navigate('Payment', { orderId });
    } catch (err) {
      Alert.alert('Error', 'Gagal menyimpan data pengiriman');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 16 }}>Alamat Pengiriman</Text>
      <AddressSearch
        onSelectArea={setDestinationArea}
        placeholder="Ketik alamat tujuan..."
      />

      {destinationArea && (
        <>
          <Text style={{ fontSize: 14, color: '#4CAF50', marginVertical: 8 }}>
            ✓ {destinationArea.name}
          </Text>

          <ShippingRateSelector
            originAreaId={SHOP_ORIGIN_AREA_ID}
            destinationAreaId={destinationArea.id}
            items={biteshipItems}
            onSelectRate={setSelectedRate}
          />
        </>
      )}

      {selectedRate && (
        <View style={{ marginTop: 16, padding: 16, backgroundColor: '#f5f5f5', borderRadius: 8 }}>
          <Text style={{ fontWeight: 'bold' }}>Ringkasan Pengiriman</Text>
          <Text>Kurir: {selectedRate.courier_code.toUpperCase()} - {selectedRate.courier_service_name}</Text>
          <Text>Ongkir: Rp {selectedRate.price.toLocaleString('id-ID')}</Text>
          <Text>Estimasi: {selectedRate.duration}</Text>
        </View>
      )}

      <Button
        title={isProcessing ? 'Memproses...' : 'Lanjut ke Pembayaran'}
        onPress={handleConfirmOrder}
        disabled={!destinationArea || !selectedRate || isProcessing}
      />
    </ScrollView>
  );
};
```

---

## 9. Keamanan

| Lapisan | Mekanisme |
|---------|-----------|
| **Mobile → Edge Function** | Supabase JWT (`verify_jwt = true`) — user harus login |
| **Edge Function → Biteship** | `BITESHIP_API_KEY` di header Authorization (tersimpan di Supabase Secrets) |
| **Midtrans → Webhook → Biteship** | SHA-512 signature + GET Status API double-verification |
| **API Key di mobile** | Tidak ada — semua request lewat proxy Edge Function |
| **TypeScript Safety** | Semua shared modules menggunakan typed interfaces dari `_shared/types.ts` |

---

## 10. Troubleshooting

| Masalah | Penyebab | Solusi |
|---------|----------|-------|
| `Missing BITESHIP_API_KEY` | Secret belum di-set | `npx supabase secrets set BITESHIP_API_KEY=xxx` |
| `Missing origin_area_id on order` | Order tidak punya area_id | Pastikan mobile app menyimpan `origin_area_id` dan `destination_area_id` saat checkout |
| `Missing courier_code on order` | User belum pilih kurir | Pastikan flow checkout mewajibkan pilih kurir sebelum bayar |
| Ongkir Rp 0 atau tidak muncul | `products.weight` kosong | Isi kolom `weight` di tabel products (default 200 gram) |
| Order Biteship gagal tapi pembayaran sukses | Normal — webhook tidak gagal | Cek log di Supabase Dashboard → Edge Functions → midtrans-webhook |
| Resi kosong setelah bayar | Biteship API error atau key salah | Cek log `[biteship] API Error:` di webhook logs |
| `Invalid action specified` | Typo di parameter action | Gunakan: `'rates'`, `'orders'`, `'track'`, atau `'maps'` |
| Autocomplete tidak mengembalikan hasil | Keyword terlalu pendek | Minimal 3 karakter untuk pencarian area |
