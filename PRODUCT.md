# Product

## Register

product

## Users

Primary users are Indonesian pharmacy operations admins who manage the day-to-day work of an e-commerce pharmacy: incoming orders, paid-but-unfulfilled queues, stock levels, catalog data, customer accounts, sales reports, home banners, store settings, shipping origins, and courier configuration. They work inside an authenticated back-office panel, use email/password login with admin role checks and MFA, and need fast, reliable screens that keep order, payment, shipping, and inventory decisions clear.

Customers are not users of this panel. They use the separate mobile storefront, while this admin panel handles the operational side of the same Supabase-backed commerce system.

## Product Purpose

This product exists to run the pharmacy's back office with confidence: manage products and categories, process orders safely through Midtrans payment and Biteship shipping states, respond to fulfillment and low-stock risks, review customers, publish home banners, maintain store/shipping settings, and export sales reporting.

Success means admins can see what needs attention, act on it without guessing, and avoid unsafe state changes. The interface should encode real workflows rather than expose raw database CRUD: orders need valid next actions, stock and payment risks need priority, settings need validation, and destructive actions need clear consequences.

## Brand Personality

Calm operations: precise, trustworthy, and low-drama. The tone should be professional and concise, with Indonesian-first copy that helps admins complete work without sounding robotic or promotional.

The product should feel like a reliable operations desk for a pharmacy business: focused on queues, status, risk, and safe completion. It may use familiar Refine and Ant Design conventions because predictability is a feature for admin work, but it should avoid feeling like an untouched template.

## Anti-references

- Generic SaaS dashboards with interchangeable metric cards, decorative charts, vague blue branding, and no operational priority.
- Consumer shopping-app interfaces that emphasize browsing, promotion, and storefront polish over admin task completion.
- Flashy CMS or campaign-builder complexity for home banners; banner management should stay constrained, previewable, and safe.
- Hospital EHR heaviness: avoid bureaucratic density, clinical coldness, and record-system friction when the job is pharmacy commerce operations.
- Any design that hides risk behind color alone, vague labels, or optimistic actions for payment, shipping, stock, customer bans, or published content.

## Design Principles

1. Lead with operational queues. Paid-but-unfulfilled orders, shipment exceptions, low stock, payment issues, and new admin notifications outrank decorative analytics.
2. Encode safe next actions. Order, payment, shipping, banner activation, customer ban, and media deletion flows should show only valid choices, explain consequences, and confirm irreversible changes.
3. Keep workflows familiar and fast. Use Refine resource conventions, Ant Design forms/tables, server-side pagination, persistent filters, clear row actions, and full pages only when the workflow needs context.
4. Localize the work, not just the labels. Indonesian is the default language; dates, currency, postal codes, shipping terminology, payment terminology, and helper text should match Indonesian pharmacy operations.
5. Prefer guided constraints over flexible chaos. Home banners, shipping settings, product weights, SKU rules, and map locations should guide admins toward valid inputs instead of offering open-ended configuration.

## Accessibility & Inclusion

Target WCAG AA as the baseline for future UI work. Critical flows should remain keyboard navigable, contrast-safe, and understandable without relying on color alone. Status indicators need visible text, form controls need clear labels and validation messages, dynamic charts/tables need accessible names or summaries, and destructive actions need readable confirmation copy.

The product is Indonesian-first with English fallback. Keep all visible copy localizable through the existing i18n system, align Ant Design component locale with the active language, and preserve non-visual fallbacks already present in the app, such as MFA manual setup keys and map/location fallback states.
