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

## Supabase Auth Setup

### Custom Access Token Hook (Admin Role)

Aplikasi ini menggunakan Custom Access Token Hook untuk memasukkan `user_role` ke JWT. Setelah migration dijalankan, **aktifkan hook di Supabase Dashboard**:

1. Buka [Supabase Dashboard](https://supabase.com/dashboard) → proyek Anda
2. **Authentication** → **Hooks** (Beta)
3. **Custom Access Token** → pilih fungsi `public.custom_access_token_hook`
4. Simpan

Tanpa langkah ini, role akan tetap diambil dari database (fallback). Hook aktif = performa lebih baik (role di JWT, tanpa query tambahan).

## Learn More

To learn more about **Refine**, please check out the [Documentation](https://refine.dev/docs)

- **Supabase Data Provider** [Docs](https://refine.dev/docs/core/providers/data-provider/#overview)
- **Ant Design** [Docs](https://refine.dev/docs/ui-frameworks/antd/tutorial/)
- **React Router** [Docs](https://refine.dev/docs/core/providers/router-provider/)

## License

MIT
