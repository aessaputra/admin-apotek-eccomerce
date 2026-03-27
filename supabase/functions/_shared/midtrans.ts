import type {
  MidtransStatusMapping,
  MidtransStatusResponse,
  Order,
  AuthUser,
  SnapPayload,
  SnapItemDetail,
} from './types.ts';

declare const Deno: {
  env: {
    get: (key: string) => string | undefined;
  };
};

export const verifyMidtransSignature = async (
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
  providedSignature: string,
): Promise<boolean> => {
  const rawString = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(rawString);
  const hashBuffer = await crypto.subtle.digest('SHA-512', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const generatedSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return generatedSignature === providedSignature;
};

export const verifyMidtransTransaction = async (
  orderId: string,
  serverKey: string,
): Promise<MidtransStatusResponse> => {
  const isProduction = Deno.env.get('MIDTRANS_IS_PRODUCTION') === 'true';
  const baseUrl = isProduction
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2';

  const response = await fetch(`${baseUrl}/${orderId}/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${serverKey}:`)}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Midtrans status check failed: ${data.status_message || response.statusText}`);
  }

  return data as MidtransStatusResponse;
};

export const mapMidtransStatus = (
  transactionStatus: string,
  fraudStatus: string,
  currentPaymentStatus: MidtransStatusMapping['newPaymentStatus'],
  currentOrderStatus: string,
): MidtransStatusMapping => {
  let newPaymentStatus = currentPaymentStatus;
  let newOrderStatus = currentOrderStatus;
  let shouldReduceStock = false;

  if (transactionStatus === 'capture') {
    if (fraudStatus === 'deny') {
      newPaymentStatus = 'deny';
      newOrderStatus = 'cancelled';
    } else if (fraudStatus === 'challenge') {
      newPaymentStatus = 'pending';
    } else if (fraudStatus === 'accept') {
      newPaymentStatus = 'settlement';
      newOrderStatus = 'awaiting_shipment';
      shouldReduceStock = currentPaymentStatus !== 'settlement';
    }
  } else if (transactionStatus === 'settlement') {
    newPaymentStatus = 'settlement';
    newOrderStatus = 'awaiting_shipment';
    shouldReduceStock = currentPaymentStatus !== 'settlement';
  } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
    newPaymentStatus = transactionStatus as MidtransStatusMapping['newPaymentStatus'];
    newOrderStatus = 'cancelled';
  } else if (transactionStatus === 'refund') {
    newPaymentStatus = 'refund';
  } else if (transactionStatus === 'partial_refund') {
    newPaymentStatus = 'partial_refund';
  } else if (transactionStatus === 'chargeback') {
    newPaymentStatus = 'chargeback';
  } else if (transactionStatus === 'partial_chargeback') {
    newPaymentStatus = 'partial_chargeback';
  } else if (transactionStatus === 'authorize') {
    newPaymentStatus = 'authorize';
  } else if (transactionStatus === 'pending') {
    newPaymentStatus = 'pending';
  } else if (transactionStatus === 'failure') {
    newPaymentStatus = 'deny';
    newOrderStatus = 'cancelled';
  }

  return { newPaymentStatus, newOrderStatus, shouldReduceStock };
};

export const buildSnapPayload = (order: Order, user: AuthUser): SnapPayload => {
  if (!order.midtrans_order_id) {
    throw new Error('Order does not have midtrans_order_id');
  }

  let calculatedGrossAmount = 0;

  const itemDetails: SnapItemDetail[] = (order.order_items || []).map((item, index) => {
    const price = Math.round(Number(item.price_at_purchase));
    const quantity = Number(item.quantity);
    calculatedGrossAmount += price * quantity;

    return {
      id: item.product_id || `ITEM-${index + 1}`,
      price: price,
      quantity: quantity,
      name: item.products?.name?.slice(0, 50) || 'Product',
      category: item.products?.categories?.name?.slice(0, 50) || 'General',
    };
  });

  if (order.shipping_cost && Number(order.shipping_cost) > 0) {
    const shippingPrice = Math.round(Number(order.shipping_cost));
    calculatedGrossAmount += shippingPrice;
    itemDetails.push({
      id: 'SHIPPING-FEE',
      price: shippingPrice,
      quantity: 1,
      name: 'Ongkos Kirim',
      category: 'Shipping',
    });
  }

  const customerDetails = {
    first_name: order.profiles?.full_name?.split(' ')[0] || 'Customer',
    last_name: order.profiles?.full_name?.split(' ').slice(1).join(' ') || '',
    email: user.email || '',
    phone: order.profiles?.phone_number || '',
  };

  return {
    transaction_details: {
      order_id: order.midtrans_order_id,
      gross_amount: calculatedGrossAmount,
    },
    item_details: itemDetails,
    customer_details: customerDetails,
  };
};
