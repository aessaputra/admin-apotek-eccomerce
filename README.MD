# admin-apotek-eccomerce

<div align="center" style="margin: 30px;">
    <a href="https://refine.dev">
    <img alt="refine logo" src="https://refine.ams3.cdn.digitaloceanspaces.com/readme/refine-readme-banner.png">
    </a>
</div>
<br/>

This [Refine](https://github.com/refinedev/refine) project was generated with [create refine-app](https://github.com/refinedev/refine/tree/master/packages/create-refine-app).

## Getting Started

A React Framework for building internal tools, admin panels, dashboards & B2B apps with unmatched flexibility ✨

Refine's hooks and components simplifies the development process and eliminates the repetitive tasks by providing industry-standard solutions for crucial aspects of a project, including authentication, access control, routing, networking, state management, and i18n.

## Available Scripts

### Running the development server.

```bash
    pnpm dev
```

### Building for production.

```bash
    pnpm build
```

### Running the production server.

```bash
    pnpm start
```

## Storage & Orphan Cleanup

Image uploads use immediate upload (Refine best practice). The application deletes replaced and explicitly removed files immediately, while `cleanup-orphan-storage` now runs as a **daily dry-run pg_cron reconciliation job** with a grace period. When delete mode is enabled later, it will quarantine old orphan candidates before any permanent removal.

### One-time setup: Vault secrets

Add the project URL and service role key to Vault so the cron job can call the Edge Function. Run in **Supabase Dashboard → SQL Editor** (replace `YOUR_SERVICE_ROLE_KEY` with the key from Project Settings → API):

```sql
select vault.create_secret('https://ibmpikevzfuqtfpdpkyy.supabase.co', 'project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
```

### Manual run (optional)

```bash
curl -X POST "https://ibmpikevzfuqtfpdpkyy.supabase.co/functions/v1/cleanup-orphan-storage" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"dry-run","triggerSource":"manual"}'
```

## Learn More

To learn more about **Refine**, please check out the [Documentation](https://refine.dev/docs)

- **Supabase Data Provider** [Docs](https://refine.dev/docs/core/providers/data-provider/#overview)
- **Ant Design** [Docs](https://refine.dev/docs/ui-frameworks/antd/tutorial/)
- **React Router** [Docs](https://refine.dev/docs/core/providers/router-provider/)

## License

MIT
