import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';
import { corsHeaders } from '../_shared/cors.ts';
import { getSupabaseAdminClient } from '../_shared/supabase.ts';

interface BiteshipProxyRequest {
  action: 'rates' | 'track' | 'maps' | 'draft_order' | 'create_order' | 'couriers';
  payload?: Record<string, unknown>;
}

const BITESHIP_API_KEY = Deno.env.get('BITESHIP_API_KEY');
if (!BITESHIP_API_KEY) throw new Error('Missing BITESHIP_API_KEY environment variable');
const BITESHIP_API_URL = 'https://api.biteship.com';
const DEFAULT_ORIGIN_POSTAL_CODE = 42183;
const DEFAULT_COURIERS = 'jne,jnt,sicepat,anteraja,pos,gojek,grab,lalamove';
const BITESHIP_ORIGIN_POSTAL_CODE = Number.parseInt(
  Deno.env.get('BITESHIP_ORIGIN_POSTAL_CODE') || '',
  10,
);
const BITESHIP_COURIERS = (Deno.env.get('BITESHIP_COURIERS') || '').trim() || DEFAULT_COURIERS;
const BITESHIP_ORIGIN_LATITUDE = Deno.env.get('BITESHIP_ORIGIN_LATITUDE');
const BITESHIP_ORIGIN_LONGITUDE = Deno.env.get('BITESHIP_ORIGIN_LONGITUDE');
const SHOP_SHIPPER_NAME = (Deno.env.get('SHOP_SHIPPER_NAME') || '').trim();
const SHOP_SHIPPER_PHONE = (Deno.env.get('SHOP_SHIPPER_PHONE') || '').trim();
const SHOP_SHIPPER_EMAIL = (Deno.env.get('SHOP_SHIPPER_EMAIL') || '').trim();
const SHOP_ORGANIZATION = (Deno.env.get('SHOP_ORGANIZATION') || '').trim();
const SHOP_ADDRESS = (Deno.env.get('SHOP_ADDRESS') || '').trim();
const ORIGIN_POSTAL_CODE = Number.isFinite(BITESHIP_ORIGIN_POSTAL_CODE)
  ? BITESHIP_ORIGIN_POSTAL_CODE
  : DEFAULT_ORIGIN_POSTAL_CODE;

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
const JWT_ISSUER = `${supabaseUrl}/auth/v1`;

// Validate tracking_id to prevent URL manipulation
function isValidTrackingId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// Validate maps input to prevent injection attacks
function validateMapsInput(input: unknown): { valid: boolean; error?: string; sanitized?: string } {
  // Must be a string
  if (typeof input !== 'string') {
    return { valid: false, error: 'Input must be a string' };
  }

  const trimmed = input.trim();

  // Must not be empty
  if (trimmed.length === 0) {
    return { valid: false, error: 'Input cannot be empty' };
  }

  // Maximum length: 100 characters
  if (trimmed.length > 100) {
    return { valid: false, error: 'Input exceeds maximum length of 100 characters' };
  }

  // Reject suspicious patterns that could indicate injection attempts
  const suspiciousPatterns = [
    /<script/i, // XSS attempts
    /javascript:/i, // JavaScript protocol
    /on\w+=/i, // Event handlers
    /[<>]/, // HTML tags
    /\$\{/, // Template literal injection
    /[%][0-9a-f]{2}/i, // URL encoding abuse
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: 'Input contains invalid characters' };
    }
  }

  return { valid: true, sanitized: trimmed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNestedString(data: unknown, path: string[]): string | undefined {
  let current: unknown = data;

  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }

  return typeof current === 'string' ? current : undefined;
}

function getLoggablePayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const {
    token: _token,
    auth: _auth,
    authorization: _authorization,
    api_key: _apiKey,
    ...safePayload
  } = payload;

  return safePayload;
}

function withServerShipperAndOriginFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    shipper_contact_name: _shipperContactName,
    shipper_contact_phone: _shipperContactPhone,
    shipper_contact_email: _shipperContactEmail,
    shipper_organization: _shipperOrganization,
    origin_contact_name: _originContactName,
    origin_contact_phone: _originContactPhone,
    origin_address: _originAddress,
    origin_area_id: _originAreaId,
    origin_postal_code: _originPostalCode,
    ...safePayload
  } = payload;

  return {
    ...safePayload,
    shipper_contact_name: SHOP_SHIPPER_NAME,
    shipper_contact_phone: SHOP_SHIPPER_PHONE,
    shipper_contact_email: SHOP_SHIPPER_EMAIL,
    shipper_organization: SHOP_ORGANIZATION,
    origin_contact_name: SHOP_SHIPPER_NAME,
    origin_contact_phone: SHOP_SHIPPER_PHONE,
    origin_address: SHOP_ADDRESS,
    origin_postal_code: ORIGIN_POSTAL_CODE,
  };
}

Deno.serve(async (req: Request) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Validate JWT using jose jwtVerify with JWKS
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let userId: string;
    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: JWT_ISSUER,
        audience: 'authenticated',
      });
      userId = payload.sub ?? '';
      if (!userId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch (error: unknown) {
      console.error('[biteship] JWT verification failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Parse request
    const { action, payload }: BiteshipProxyRequest = await req.json();

    if (!action) {
      return new Response(JSON.stringify({ error: 'Action is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create_order') {
      if (!isRecord(payload) || !payload.order_id) {
        return new Response(JSON.stringify({ error: 'order_id is required for create_order' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const adminClient = getSupabaseAdminClient();
      const { data: order, error: orderError } = await adminClient
        .from('orders')
        .select('user_id')
        .eq('id', payload.order_id)
        .single();

      if (orderError || !order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (order.user_id !== userId) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: You can only access your own orders' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
    }

    // 6. Validate tracking_id format to prevent URL manipulation
    if (action === 'track' && payload?.tracking_id) {
      const trackingId = String(payload.tracking_id);
      if (!isValidTrackingId(trackingId)) {
        return new Response(JSON.stringify({ error: 'Invalid tracking_id format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 7. Build Biteship request
    let endpoint = '';
    let method = 'POST';
    let requestPayload = isRecord(payload) ? payload : undefined;

    if (action === 'rates') {
      const safePayload = isRecord(requestPayload) ? requestPayload : {};
      const { origin_area_id: _originAreaId, ...ratesPayload } = safePayload;

      const destinationAreaId =
        typeof ratesPayload.destination_area_id === 'string'
          ? ratesPayload.destination_area_id.trim()
          : '';
      const destinationPostalCode = Number(
        ratesPayload.destination_postal_code ?? ratesPayload.destination_postalcode ?? NaN,
      );
      const hasDestinationAreaId = destinationAreaId.length > 0;
      const hasDestinationPostalCode =
        Number.isFinite(destinationPostalCode) &&
        Number.isInteger(destinationPostalCode) &&
        destinationPostalCode >= 10000 &&
        destinationPostalCode <= 99999;

      if (!hasDestinationAreaId && !hasDestinationPostalCode) {
        return new Response(
          JSON.stringify({
            error:
              'Missing destination location for rates. Provide destination_area_id or destination_postal_code. Check addresses.postal_code/subdistrict mapping.',
          }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      requestPayload = {
        ...ratesPayload,
        origin_postal_code: ratesPayload.origin_postal_code ?? ORIGIN_POSTAL_CODE,
        couriers: ratesPayload.couriers ?? BITESHIP_COURIERS,
        ...(BITESHIP_ORIGIN_LATITUDE && BITESHIP_ORIGIN_LONGITUDE
          ? {
              origin_latitude: Number(BITESHIP_ORIGIN_LATITUDE),
              origin_longitude: Number(BITESHIP_ORIGIN_LONGITUDE),
            }
          : {}),
      };
    }

    if (action === 'create_order') {
      if (
        !SHOP_SHIPPER_NAME ||
        !SHOP_SHIPPER_PHONE ||
        !SHOP_SHIPPER_EMAIL ||
        !SHOP_ORGANIZATION ||
        !SHOP_ADDRESS
      ) {
        return new Response(
          JSON.stringify({
            error:
              'Missing shop shipper configuration. Set SHOP_SHIPPER_NAME, SHOP_SHIPPER_PHONE, SHOP_SHIPPER_EMAIL, SHOP_ORGANIZATION, and SHOP_ADDRESS.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      const safePayload = isRecord(requestPayload) ? requestPayload : {};
      requestPayload = withServerShipperAndOriginFields(safePayload);
    }

    if (action === 'draft_order') {
      if (!SHOP_SHIPPER_EMAIL || !SHOP_ORGANIZATION) {
        return new Response(
          JSON.stringify({ error: 'Missing SHOP_SHIPPER_EMAIL or SHOP_ORGANIZATION secret.' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      const safePayload = isRecord(requestPayload) ? requestPayload : {};
      requestPayload = {
        items: [],
        ...withServerShipperAndOriginFields(safePayload),
      };
    }

    switch (action) {
      case 'rates':
        endpoint = '/v1/rates/couriers';
        break;
      case 'draft_order':
        endpoint = '/v1/draft_orders';
        break;
      case 'create_order':
        endpoint = '/v1/orders';
        break;
      case 'track':
        endpoint = `/v1/trackings/${payload?.tracking_id}`;
        method = 'GET';
        break;
      case 'maps': {
        // Validate input before building URL
        const validation = validateMapsInput(payload?.input);
        if (!validation.valid) {
          return new Response(JSON.stringify({ error: validation.error }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        endpoint = `/v1/maps/areas?input=${encodeURIComponent(validation.sanitized!)}&type=single`;
        method = 'GET';
        break;
      }
      case 'couriers':
        endpoint = '/v1/couriers';
        method = 'GET';
        break;
      default:
        return new Response(JSON.stringify({ error: 'Invalid action specified' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const biteshipUrl = `${BITESHIP_API_URL}${endpoint}`;
    const authPrefix =
      BITESHIP_API_KEY.startsWith('biteship_live.') || BITESHIP_API_KEY.startsWith('biteship_test.')
        ? ''
        : 'biteship_test.';
    const authKey = `${authPrefix}${BITESHIP_API_KEY}`;

    const fetchOptions: RequestInit = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        authorization: authKey,
      },
    };

    if (method !== 'GET' && requestPayload) {
      fetchOptions.body = JSON.stringify(requestPayload);
    }

    if (action === 'rates') {
      console.log('[biteship] rates payload:', JSON.stringify(getLoggablePayload(requestPayload)));
    }

    console.log(`[biteship] Calling: ${method} ${biteshipUrl}`);

    // 8. Add timeout to prevent hanging
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    fetchOptions.signal = controller.signal;

    const biteshipResponse = await fetch(biteshipUrl, fetchOptions);
    clearTimeout(timeout);

    const data: unknown = await biteshipResponse.json();

    if (!biteshipResponse.ok) {
      console.error(
        `[biteship] Biteship API error — action: ${action}, status: ${biteshipResponse.status}, payload: ${JSON.stringify(getLoggablePayload(requestPayload))}, body: ${JSON.stringify(data)}`,
      );
      return new Response(JSON.stringify({ error: data }), {
        status: biteshipResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let responseData = data;
    if (action === 'create_order') {
      const biteshipOrderId = getNestedString(data, ['id']);
      const waybillId = getNestedString(data, ['courier', 'waybill_id']);
      const trackingId = getNestedString(data, ['courier', 'tracking_id']);

      responseData = {
        ...(isRecord(data) ? data : {}),
        biteship_order_id: biteshipOrderId,
        waybill_id: waybillId,
        waybill_number: waybillId,
        tracking_id: trackingId,
      };

      if (requestPayload?.order_id && biteshipOrderId) {
        const adminClient = getSupabaseAdminClient();
        const updatePayload: Record<string, unknown> = {
          biteship_order_id: biteshipOrderId,
          updated_at: new Date().toISOString(),
        };
        if (waybillId) {
          updatePayload.waybill_number = waybillId;
          updatePayload.status = 'shipped';
        }

        const { error: updateError } = await adminClient
          .from('orders')
          .update(updatePayload)
          .eq('id', requestPayload.order_id);

        if (updateError) {
          return new Response(
            JSON.stringify({ error: 'Failed to update order shipping details' }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
            );
        }
      }
    }

    if (action === 'couriers') {
      const couriers = isRecord(data) && Array.isArray(data.couriers) ? data.couriers : [];
      return new Response(JSON.stringify(couriers), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Log full error internally for debugging
    console.error('[biteship] Internal error:', { message, error: String(error) });

    // Return generic error message to client - never leak internal error details
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
