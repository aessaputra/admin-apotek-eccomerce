const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

if (!url || !key) {
  throw new Error(
    "VITE_SUPABASE_URL dan VITE_SUPABASE_KEY wajib diisi di file .env"
  );
}

export const SUPABASE_URL = url;
export const SUPABASE_KEY = key;
