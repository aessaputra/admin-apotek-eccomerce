/**
 * Extract error message from Supabase Edge Function errors.
 * FunctionsHttpError contains response body in context - use it for better UX.
 * @see https://supabase.com/docs/guides/functions/error-handling
 */
export async function getFunctionsErrorMessage(
  error: unknown,
  fallback: string
): Promise<string> {
  if (!error) return fallback;
  if (error instanceof Error && "context" in error) {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } })
      .context;
    try {
      const body = await ctx?.json?.();
      if (body?.error && typeof body.error === "string") return body.error;
    } catch {
      // Ignore JSON parse errors
    }
  }
  return error instanceof Error ? error.message : fallback;
}
