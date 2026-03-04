# Panduan Integrasi Edge Functions Midtrans & React Native

Dokumen ini menjelaskan alur lengkap integrasi sistem pembayaran *Midtrans Snap* yang menghubungkan aplikasi React Native (Frontend) dengan Supabase Edge Functions (Backend).

> **Hubungan dengan Biteship:** Midtrans menangani **pembayaran**, sedangkan Biteship menangani **pengiriman barang**. Setelah Midtrans mengkonfirmasi pembayaran sukses via webhook, sistem secara otomatis membuat order pengiriman di Biteship. Lihat `shipping-integration.md` untuk dokumentasi pengiriman.

---

## 1. Arsitektur Alur Pembayaran (Payment Flow)

Flow ini menjamin keamanan penuh karena Token dan Signature diproses mutlak di Backend (Edge Function), tanpa mengekspos API Key rahasia ke aplikasi Mobile.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PAYMENT FLOW                                     │
│                                                                         │
│  Mobile App                Edge Function              Midtrans API      │
│  ─────────                 ─────────────              ────────────      │
│                                                                         │
│  1. User checkout ──────→ create-snap-token ─────→ POST /snap/v1/txns  │
│     (order_id + JWT)     validate order, build      return snap_token   │
│                       ←── snap_token + url ◄──────── + redirect_url    │
│                                                                         │
│  2. Open WebView ────→ Midtrans Snap UI (redirect_url)                 │
│     User melakukan pembayaran di UI Midtrans                           │
│                                                                         │
│  3. Intercept redirect → Tutup WebView → Tampilkan "Terima Kasih"     │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                     WEBHOOK FLOW (OTOMATIS)                              │
│                                                                         │
│  Midtrans Server          midtrans-webhook            Supabase DB       │
│  ──────────────           ────────────────            ────────────      │
│                                                                         │
│  4. POST notification ──→ Verifikasi SHA-512 signature                 │
│                           Verifikasi GET Status API (double-check)      │
│                           Update order: paid + success                  │
│                           Kurangi stock (RPC atomik)                    │
│                           Buat order Biteship otomatis                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Langkah Detail:

1. **User Checkout (Mobile):** User menekan tombol bayar di aplikasi React Native.
2. **Request Snap Token (API):** Aplikasi mengirimkan request HTTP berisi `order_id` ke Edge Function `create-snap-token`. Parameter request ini diamankan oleh Supabase JWT.
3. **Validasi & Token (Supabase → Midtrans):**
   - Edge Function memvalidasi kepemilikan order (`user_id === JWT user`).
   - Memvalidasi state order (`status === 'pending'` dan `payment_status === 'unpaid'`).
   - Mengkalkulasi nilai total *Gross Amount* dari `order_items` + `shipping_cost`.
   - Menghubungi Server Midtrans (menggunakan rahasia `MIDTRANS_SERVER_KEY`).
   - Menerima `snap_token` dan `redirect_url` dan mengembalikannya ke aplikasi.
4. **Render UI Pembayaran (Mobile):** React Native membuka `redirect_url` menggunakan `react-native-webview`. User akan melihat antarmuka pembayaran Midtrans.
5. **Webhook Asynchronous (Midtrans → Supabase):**
   - Setelah user membayar, Midtrans **secara otomatis** menembak Edge Function `midtrans-webhook`.
   - Webhook memverifikasi **dua lapis keamanan**:
     - **Lapis 1:** Verifikasi SHA-512 signature dari payload webhook.
     - **Lapis 2:** Konfirmasi status transaksi via **GET Status API** langsung ke server Midtrans.
   - Bila valid, update status order, kurangi stock, dan buat order pengiriman Biteship otomatis.
6. **Redirect Intercept (Mobile):** WebView mendeteksi redirect ke URL dummy dan menutup layar pembayaran.

---

## 2. Edge Functions

### A. `create-snap-token/index.ts` — Pembuatan Token Pembayaran

| Aspek | Detail |
|-------|--------|
| **Endpoint** | `POST /functions/v1/create-snap-token` |
| **Auth** | `verify_jwt = true` — wajib login via Supabase JWT |
| **Input** | `{ order_id: string }` |
| **Output** | `{ snap_token: string, redirect_url: string }` |

#### Alur Internal:
```
1. Validasi JWT → ambil user dari token
2. Parse body → ambil order_id
3. Fetch order dari DB → validasi kepemilikan + state
4. Generate midtrans_order_id jika belum ada (format: APT-{shortId}-{timestamp})
5. Build payload via buildSnapPayload() → item_details + customer_details
6. POST ke Midtrans Snap API → terima snap_token
7. Return snap_token + redirect_url ke mobile
```

### B. `midtrans-webhook/index.ts` — Webhook Handler

| Aspek | Detail |
|-------|--------|
| **Endpoint** | `POST /functions/v1/midtrans-webhook` |
| **Auth** | `verify_jwt = false` — dipanggil oleh server Midtrans (bukan user) |
| **Keamanan** | SHA-512 signature + GET Status API double-verification |
| **Auto-actions** | Update status, kurangi stock, buat order Biteship |

#### Alur Internal:
```
1. Parse JSON body → MidtransWebhookPayload
2. LAPIS 1: Verifikasi SHA-512 signature
3. LAPIS 2: GET /v2/{order_id}/status → konfirmasi status real dari Midtrans
   ↳ Jika webhook bilang 'settlement' tapi API bilang 'pending' → gunakan nilai API
4. Fetch order dari DB (dengan relasi: profiles, addresses, order_items, products)
5. Idempotency check → skip jika sudah 'success'/'paid'
6. Map status: transaction_status + fraud_status → payment_status + order_status
7. Update order di DB
8. Jika shouldReduceStock:
   a. Kurangi stock via RPC atomik (reduce_product_stock)
   b. Buat order Biteship otomatis (createBiteshipOrder)
   c. Update biteship_order_id + waybill_number + status='processing'
```

#### Mengapa `verify_jwt = false`?
Midtrans server yang memanggil webhook ini bukan user yang login — jadi tidak membawa JWT. Keamanan dijamin oleh:
- **SHA-512 signature** yang dihitung dari `order_id + status_code + gross_amount + server_key`
- **GET Status API** yang mengkonfirmasi langsung ke server Midtrans

### C. `_shared/midtrans.ts` — Utility Functions

| Function | Deskripsi |
|----------|-----------|
| `verifyMidtransSignature()` | Validasi SHA-512 signature webhook |
| `verifyMidtransTransaction()` | Double-verify via GET Status API (`/v2/{order_id}/status`) |
| `mapMidtransStatus()` | Map `transaction_status` + `fraud_status` → unified local status |
| `buildSnapPayload()` | Build Snap API payload dari DB Order + AuthUser |

### D. `_shared/types.ts` — TypeScript Interfaces

Semua shared module menggunakan typed interfaces, bukan `any`:

```typescript
// Tipe utama yang digunakan:
interface Order { id, user_id, midtrans_order_id, payment_status, status, order_items, profiles, ... }
interface AuthUser { id, email }
interface MidtransWebhookPayload { order_id, status_code, gross_amount, signature_key, transaction_status, ... }
interface MidtransStatusResponse { transaction_status, fraud_status, order_id, ... }
interface SnapPayload { transaction_details, item_details, customer_details }
```

---

## 3. Status Mapping

### Midtrans → Local Status

| `transaction_status` | `fraud_status` | → `payment_status` | → `order_status` | Stock Reduced? |
|---------------------|---------------|--------------------|--------------------|----------------|
| `capture` | `accept` | `success` | `paid` | ✅ Ya |
| `capture` | `challenge` | `pending` | *(unchanged)* | ❌ |
| `settlement` | — | `success` | `paid` | ✅ Ya |
| `pending` | — | `pending` | *(unchanged)* | ❌ |
| `cancel` / `deny` / `expire` | — | `failed` | `cancelled` | ❌ |

### Order Status Lifecycle

```
pending → paid → processing → shipped → delivered
                                      → cancelled (dari pending/paid)
```

---

## 4. Integrasi React Native (Frontend)

### A. Mendapatkan Snap URL dari Supabase

```typescript
import { supabase } from '../lib/supabase';

const handlePayment = async (orderId: string) => {
  setIsLoading(true);
  try {
    const { data, error } = await supabase.functions.invoke('create-snap-token', {
      body: { order_id: orderId },
    });

    if (error) {
      console.error('Gagal memproses token pembayaran:', error);
      Alert.alert('Gagal', 'Terjadi kesalahan sistem pembayaran');
      return;
    }

    // Jika sukses, buka WebView dengan redirect_url
    setPaymentUrl(data.redirect_url);
  } catch (err) {
    Alert.alert('Error', 'Tidak dapat terhubung ke server pembayaran');
  } finally {
    setIsLoading(false);
  }
};
```

### B. Menangani WebView Navigation

Mengkonfigurasi **Finish, Unfinish, dan Error URL** pada *Dashboard Snap Preferences Midtrans* menggunakan URL *Dummy* (seperti `https://example.com/checkout/success`) adalah trik umum dan jitu (Best Practice) pada Mobile App. Karena:
- Kita tidak membutuhkan website asli untuk render hasil di React Native WebView.
- Halaman `example.com` **tidak akan pernah termuat**, karena seketika WebView ingin berpindah kesana, React Native langsung memblokirnya dan menutup WebView-nya sendiri!

```tsx
import React from 'react';
import { View, Alert } from 'react-native';
import { WebView } from 'react-native-webview';

interface PaymentScreenProps {
  paymentUrl: string;
  onFinishRedirect: (status: 'berhasil' | 'pending' | 'gagal') => void;
}

export const MidtransPaymentScreen = ({ paymentUrl, onFinishRedirect }: PaymentScreenProps) => {

  const handleNavigation = (navState: { url: string }) => {
    const url = navState.url;

    // Jika Midtrans mengarahkan URL ke website dummy kita:
    if (url.includes('example.com') || url.includes('apotek://')) {

      if (url.includes('transaction_status=settlement') || url.includes('transaction_status=capture')) {
        onFinishRedirect('berhasil');
      }
      else if (url.includes('transaction_status=pending')) {
        onFinishRedirect('pending');
      }
      else {
        onFinishRedirect('gagal');
      }
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <WebView
        source={{ uri: paymentUrl }}
        onNavigationStateChange={handleNavigation}
        style={{ flex: 1 }}
      />
    </View>
  );
};
```

### C. Contoh Lengkap: Checkout Screen

```tsx
import React, { useState } from 'react';
import { View, Button, Modal, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { MidtransPaymentScreen } from '../components/MidtransPaymentScreen';

export const CheckoutScreen = ({ orderId, navigation }) => {
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handlePayment = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-snap-token', {
        body: { order_id: orderId },
      });

      if (error) throw error;
      setPaymentUrl(data.redirect_url);
    } catch (err) {
      Alert.alert('Error', 'Gagal memproses pembayaran');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePaymentResult = (status: 'berhasil' | 'pending' | 'gagal') => {
    setPaymentUrl(null);

    switch (status) {
      case 'berhasil':
        navigation.replace('OrderSuccess', { orderId });
        break;
      case 'pending':
        Alert.alert('Menunggu Pembayaran', 'Silakan selesaikan pembayaran Anda.');
        navigation.replace('OrderDetail', { orderId });
        break;
      case 'gagal':
        Alert.alert('Pembayaran Gagal', 'Silakan coba lagi.');
        break;
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Button
        title={isLoading ? 'Memproses...' : 'Bayar Sekarang'}
        onPress={handlePayment}
        disabled={isLoading}
      />

      {isLoading && <ActivityIndicator style={{ marginTop: 20 }} />}

      <Modal visible={!!paymentUrl} animationType="slide">
        {paymentUrl && (
          <MidtransPaymentScreen
            paymentUrl={paymentUrl}
            onFinishRedirect={handlePaymentResult}
          />
        )}
      </Modal>
    </View>
  );
};
```

### D. Polling Status Order (Opsional)

Karena webhook bersifat asynchronous, ada kemungkinan delay antara redirect WebView dan update database. Gunakan polling untuk memastikan UI ter-update:

```typescript
const pollOrderStatus = async (orderId: string, maxAttempts = 10): Promise<string> => {
  for (let i = 0; i < maxAttempts; i++) {
    const { data, error } = await supabase
      .from('orders')
      .select('payment_status, status')
      .eq('id', orderId)
      .single();

    if (data?.payment_status === 'success') {
      return 'success';
    }
    if (data?.payment_status === 'failed') {
      return 'failed';
    }

    // Tunggu 2 detik sebelum cek ulang
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return 'timeout';
};
```

---

## 5. Database Schema (Kolom Terkait Payment)

### Tabel `orders`

| Kolom | Tipe | Deskripsi |
|-------|------|-----------|
| `midtrans_order_id` | text | ID unik untuk Midtrans (format: `APT-{shortId}-{timestamp}`) |
| `midtrans_transaction_id` | text | Transaction ID dari Midtrans (diisi oleh webhook) |
| `payment_type` | text | Metode pembayaran (e.g. `credit_card`, `bank_transfer`, `gopay`) |
| `payment_status` | text | `unpaid` → `pending` → `success` / `failed` |
| `status` | text | `pending` → `paid` → `processing` → `shipped` → `delivered` |
| `total_amount` | numeric | Total harga barang (tanpa ongkir) |
| `shipping_cost` | numeric | Ongkos kirim |
| `updated_at` | timestamptz | Auto-update via trigger `update_orders_updated_at()` |

### RPC Function

```sql
-- Atomik stock reduction (mencegah race condition)
reduce_product_stock(p_product_id uuid, p_quantity int)
-- Mengurangi stock di tabel products secara aman
```

---

## 6. Environment Variables

### Wajib (Supabase Secrets)

```bash
# Server key Midtrans (JANGAN gunakan client key!)
npx supabase secrets set MIDTRANS_SERVER_KEY=SB-Mid-server-xxx --project-ref ibmpikevzfuqtfpdpkyy
```

### Opsional

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `MIDTRANS_IS_PRODUCTION` | *(tidak diset = sandbox)* | Set `true` untuk production API Midtrans |

---

## 7. Setup di Dashboard Midtrans

### A. Sandbox (Testing)

1. Buka [Midtrans Dashboard Sandbox](https://dashboard.sandbox.midtrans.com)
2. Masuk ke **Settings** → **Snap Preferences** → **System Settings**
3. Isi ketiga URL redirect dengan **Domain Dummy**:
   - **Finish Redirect URL:** `https://example.com/payment/finish`
   - **Unfinish Redirect URL:** `https://example.com/payment/unfinish`
   - **Error Redirect URL:** `https://example.com/payment/error`
4. Isi **Payment Notification URL** (webhook):
   - `https://ibmpikevzfuqtfpdpkyy.supabase.co/functions/v1/midtrans-webhook`

### B. Production

1. Buka [Midtrans Dashboard Production](https://dashboard.midtrans.com)
2. Ulangi pengaturan yang sama seperti Sandbox
3. Ganti `MIDTRANS_SERVER_KEY` dengan production key
4. Set environment:
   ```bash
   npx supabase secrets set MIDTRANS_IS_PRODUCTION=true --project-ref ibmpikevzfuqtfpdpkyy
   npx supabase secrets set MIDTRANS_SERVER_KEY=Mid-server-xxx --project-ref ibmpikevzfuqtfpdpkyy
   ```

### Perbedaan Mode

| Aspek | Sandbox | Production |
|-------|---------|------------|
| Server Key prefix | `SB-Mid-server-` | `Mid-server-` |
| Snap URL | `app.sandbox.midtrans.com` | `app.midtrans.com` |
| Status API URL | `api.sandbox.midtrans.com` | `api.midtrans.com` |
| Pembayaran | Simulasi (tidak ada uang keluar) | Real |
| Kartu test | `4811 1111 1111 1114` | Kartu asli |

---

## 8. Keamanan

| Lapisan | Mekanisme |
|---------|-----------|
| **Mobile → create-snap-token** | Supabase JWT (`verify_jwt = true`) — user harus login |
| **create-snap-token → Midtrans** | `MIDTRANS_SERVER_KEY` di header Basic Auth (tersimpan di Supabase Secrets) |
| **Midtrans → midtrans-webhook** | SHA-512 signature verification |
| **Webhook → Midtrans** | Double-verification via GET Status API (`/v2/{order_id}/status`) |
| **Stock reduction** | Atomik RPC function `reduce_product_stock()` (mencegah race condition) |
| **API Key di mobile** | Tidak ada — semua request lewat proxy Edge Function |

---

## 9. Troubleshooting

| Masalah | Penyebab | Solusi |
|---------|----------|-------|
| `Missing Authorization header` | JWT tidak dikirim | Pastikan gunakan `supabase.functions.invoke()` (auto-attach JWT) |
| `Order state invalid for payment` | Order bukan `pending`/`unpaid` | Cek status order di DB, mungkin sudah dibayar |
| `Midtrans server key not configured` | Secret belum di-set | `npx supabase secrets set MIDTRANS_SERVER_KEY=xxx` |
| `Invalid signature` di webhook | Server key salah atau payload corrupt | Pastikan `MIDTRANS_SERVER_KEY` sama di Supabase dan Midtrans Dashboard |
| Status mismatch warning di log | Normal — webhook payload stale | Sistem otomatis menggunakan nilai dari GET Status API |
| WebView tidak menutup | URL dummy tidak cocok | Pastikan URL di Midtrans Dashboard mengandung `example.com` |
| Stock tidak berkurang | Webhook belum dipanggil | Cek Payment Notification URL di Midtrans Dashboard |
| Pembayaran sukses tapi status pending | Webhook delay | Tunggu 1-2 menit, atau gunakan polling (`pollOrderStatus`) |

---

## 10. Kesimpulan Keamanan

Tidak peduli apakah App terkadang terputus internetnya sebelum WebView berhasil menutup, Backend Edge Function `midtrans-webhook` Anda tetap akan dijalankan secara independen oleh Midtrans untuk mengkonfirmasi lunasnya suatu transaksi. Webhook memiliki **dua lapis verifikasi** (signature + GET Status API) dan akan memotong stok serta membuat order pengiriman Biteship secara otomatis. Hal ini menjaga konsistensi state dalam aplikasi dan database.
