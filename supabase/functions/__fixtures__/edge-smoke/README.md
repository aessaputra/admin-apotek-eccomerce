# Edge Smoke Fixtures

Use this directory only for local, non-mutating Edge Runtime smoke fixtures that are safe to run in CI.

- Do not store real Supabase tokens, service-role keys, provider API keys, bearer tokens, Vault values, raw production IDs, customer data, addresses, phone numbers, emails, or other PII.
- Prefer deterministic placeholders such as `smoke-user`, `smoke-order`, and `smoke-service-role-token`.
- Keep provider calls mocked; smoke validation must not invoke production functions, remote Edge Runtime endpoints, live databases, Midtrans, Biteship, Expo, or Supabase secret commands.
