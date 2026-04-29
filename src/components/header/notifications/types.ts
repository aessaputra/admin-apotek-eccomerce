export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string | null;
  body: string | null;
  cta_route: string | null;
  data: Record<string, unknown> | null;
  priority: string | null;
  source_event_key: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AdminOrderNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  orderId: string;
  route: string;
  customerName: string | null;
  orderStatus: string | null;
  paymentStatus: string | null;
  createdAt: string;
  readAt: string | null;
  sourceEventKey: string | null;
}
