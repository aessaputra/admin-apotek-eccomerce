# Spec: Order Notifications UI Enhancement

## Problem Statement

The current notification dropdown panel for admins only displays the customer's name and the notification timestamp. This lack of information makes it difficult for administrators to understand the state, urgency, or size of incoming orders (e.g. order status, payment status, value, and items) at a glance, leading to inefficient triage. Additionally, there is no option to mark all incoming notifications as read, forcing admins to click every item to clear the unread badge count.

## Solution

Enhance the admin order notification feed to present high-context notification cards and add a global "Mark all as read" button in the notification header.

Specifically, the new design will show:
1. Customer Name and an status tag representing the order's state (e.g., Pending, Settlement, Shipped, Cancelled) using styled pastel colors.
2. Order ID reference, count of items, and the order's total monetary value.
3. A localized and human-friendly creation timestamp.
4. An actionable "Tandai semua sebagai dibaca" / "Mark all as read" button on the right side of the "Pesanan Masuk" / "Incoming Orders" header.

## User Stories

1. As an admin, I want to see the order reference ID (e.g. `#ORD-20260719-03`) in each notification item, so that I can easily reference specific orders.
2. As an admin, I want to see a colored status badge (e.g., "Pesanan Baru", "Lunas") on each notification item, so that I can immediately identify the state of the order.
3. As an admin, I want to see the total number of items and total price of the order in the notification, so that I can gauge the order's value at a glance.
4. As an admin, I want to see a localized date and time, so that I can know exactly when the order event occurred.
5. As an admin, I want to have a "Tandai semua sebagai dibaca" (Mark all as read) button in the notification header, so that I can clear all unread notification badges in a single click without leaving my current screen.
6. As an admin, I want the unread notifications to have a distinct left-border accent and background color, so that they visually stand out from read notifications.
7. As an admin, I want to click a notification card to mark it as read and navigate directly to the order details page.

## Implementation Decisions

### Modified Modules

1. **`src/components/header/notifications/AdminOrderNotifications.tsx`**
   - Redesign notification list item layout to implement the ASCII design specification:
     - Row 1: `customerName` (Typography.Text strong) + status tag (Ant Design Tag).
     - Row 2: `#orderId` • `{itemCount} Barang` • `{totalAmount}`.
     - Row 3: Localized timestamp.
   - Add a "Tandai semua sebagai dibaca" / "Mark all as read" text button aligned right in the header space.
   - Use dynamic colors for order status tags (e.g., Amber for pending, Emerald for settlement, Gray for others).

2. **`src/components/header/notifications/useAdminOrderNotifications.ts`**
   - Export a new async handler `markAllAsRead` from the hook.
   - Implement `markAllAsRead` to update local feed state instantly (set all `readAt` to current timestamp, set `unreadCount` to 0).
   - Perform a batch update query to the Supabase database to set `read_at = now()` for all unread notifications of type `new_order` and audience `admin_dashboard` belonging to the current user.

3. **`src/locales/id/common.json` & `src/locales/en/common.json`**
   - Add translation key `notifications.orders.new.markAllAsRead` ("Tandai semua sebagai dibaca" / "Mark all as read").
   - Update order status tag translations if required.

4. **`supabase/migrations/` (New Migration File)**
   - Replace the trigger `orders_admin_new_order_notifications_trigger` on `public.orders` to be a `CONSTRAINT TRIGGER` that is `DEFERRABLE INITIALLY DEFERRED`.
   - Update the trigger function `private.notify_admins_of_new_order()` to calculate the sum of items from `public.order_items` for the inserted order and save it as `itemCount` in the notification JSON payload.
   - Include `totalAmount` (sourced from `new.total_amount`) in the notification JSON payload.

## Testing Decisions

We will verify the implementation with unit and component tests:
- **`src/components/header/notifications/__tests__/AdminOrderNotifications.test.tsx`**
  - Verify that the "Mark all as read" button renders and invokes `markAllAsRead` when clicked.
  - Verify that the notification card displays the new metadata (Order ID, items summary, status tags, etc.).
  - Verify layout styling changes are correctly applied.
- **`supabase/migrations/__tests__/` (New migration test file)**
  - Verify that when a new order and its items are inserted within a transaction, the deferred trigger correctly creates a notification record containing the right `itemCount` and `totalAmount` in the JSON data payload.

## Out of Scope

- Setting up customer-facing notifications or custom settings panels for specific notification categories.
- Filtering or sorting options in the notifications dropdown menu.
- Paging of notifications inside the dropdown.

## Further Notes

The UI layout follows the ASCII design mockup:
```text
+---------------------------------------------------------+
|  Nadia Fitriani                      [ Pesanan Baru ] • |
|  #ORD-20260719-03  •  2 Barang  •  Rp 145.000           |
|  19 Jul 2026, 17:55 PM                                  |
+---------------------------------------------------------+
```
It utilizes Ant Design v5 Design Tokens (`token.colorPrimary`, `token.colorPrimaryBg`, `token.borderRadiusLG`, etc.) to match the existing dark/light mode system cleanly.

