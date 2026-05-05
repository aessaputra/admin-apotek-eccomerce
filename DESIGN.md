---
name: Pharmacy Admin Panel
description: Calm, token-driven operations UI for Indonesian pharmacy commerce admins.
colors:
  primary: "#1677ff"
  primary-hover: "#4096ff"
  primary-active: "#0958d9"
  primary-bg: "#e6f4ff"
  surface: "#fdfefe"
  surface-muted: "#fafafa"
  border-subtle: "#d9d9d9"
  text-strong: "#11181c"
  text-secondary: "#595959"
  success: "#52c41a"
  warning: "#faad14"
  danger: "#ff4d4f"
  info: "#13c2c2"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5715
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  preview: "16px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    typography: "{typography.body}"
    height: "32px"
    padding: "4px 15px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
  card-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "4px 11px"
  tag-status:
    backgroundColor: "{colors.primary-bg}"
    textColor: "{colors.primary-active}"
    rounded: "{rounded.sm}"
    typography: "{typography.label}"
---

# Design System: Pharmacy Admin Panel

## 1. Overview

**Creative North Star: "The Quiet Operations Desk"**

This system is a restrained Ant Design v5 and Refine Blue admin interface for pharmacy commerce work. It should feel like a dependable desk where paid orders, shipment exceptions, stock risks, and customer actions are easy to read without visual drama. Familiar controls are intentional: admins should recognize tables, forms, status tags, cards, and side navigation immediately.

The design language is token-driven rather than decorative. Surfaces are clean, spacing follows the AntD scale, blue is reserved for primary actions and current state, and status colors appear only with readable labels. Custom character appears in precise operational details: the notification queue, courier picker, map frame, upload previews, and dashboard risk summaries.

It rejects generic SaaS dashboards, consumer storefront polish, flashy CMS complexity, hospital EHR heaviness, and any UI that hides operational risk behind color alone.

**Key Characteristics:**
- Refine resource shell with a 64px sticky header, responsive sidebar, and predictable CRUD routes.
- Restrained blue primary palette with semantic AntD status colors.
- Dense but legible tables, cards, forms, and status tags for daily admin work.
- Indonesian-first copy, IDR formatting, and WCAG AA contrast intent.
- Minimal custom motion; state feedback comes from AntD loading, focus, hover, drawers, modals, and skeletons.

## 2. Colors

The palette is Refine Blue plus Ant Design neutrals and semantic state colors. The strategy is restrained: blue is action and selection, neutrals carry the workspace, and semantic colors carry operational status.

### Primary
- **Refine Operations Blue**: Primary actions, active navigation, selected courier services, unread notification emphasis, and focus rings.
- **Operations Blue Hover**: Hover treatment for primary buttons and interactive blue surfaces.
- **Deep Action Blue**: Pressed state, link emphasis, and readable text over pale blue fills.
- **Blue Queue Tint**: Unread notification background and selected state tint.

### Secondary
- **Success Green**: Completed orders, successful payments, verified states, active status.
- **Attention Amber**: Pending work, awaiting shipment, warnings, Biteship attention states.
- **Critical Red**: Cancelled orders, failed payment, customer ban states, destructive actions.
- **Tracking Cyan**: Shipped, sync tracking, and logistics progression states.

### Neutral
- **Admin Surface**: Main card, modal, dropdown, and elevated panel background.
- **Muted Work Surface**: Dashboard stat tiles, PDF table headers, image fallback panels.
- **Subtle Divider**: Table borders, map frames, image borders, card boundaries.
- **Strong Text**: Primary headings, labels, and data values.
- **Secondary Text**: Helper copy, timestamps, table metadata, and field descriptions.

### Named Rules
**The Ten Percent Blue Rule.** Blue is for action, current location, unread state, or selected state. If it appears as decoration, remove it.

**The Label-Before-Color Rule.** Every semantic color must travel with readable text. Tags may be orange, green, red, gold, cyan, purple, or volcano, but the status label is the meaning.

**The No Storefront Color Rule.** Do not let banner previews, product thumbnails, or promotional content turn the admin shell into a consumer shopping surface.

## 3. Typography

**Display Font:** Ant Design system sans stack with native platform fallbacks.
**Body Font:** Ant Design system sans stack with native platform fallbacks.
**Label/Mono Font:** No distinct mono or display face is used.

**Character:** The typography is native, compact, and operational. It earns trust by staying out of the way: no display fonts in data, no ornamental labels, no oversized marketing hierarchy inside task screens.

### Hierarchy
- **Headline** (600, 24px, 1.25): Page titles such as dashboard and reports. Use sparingly and keep margins tight.
- **Title** (600, 16px, 1.5): Card titles, notification headings, courier group names, and section labels.
- **Body** (400, 14px, 1.5715): Forms, table cells, helper paragraphs, descriptions, button labels, and default UI copy.
- **Label** (400, 12px, 1.5): Helper text, timestamps, compact tags, chart descriptions, and secondary metadata.
- **Data Value** (600, 20px to 24px): Dashboard KPI values and trend totals. Use AntD heading token sizes, not custom display typography.

### Named Rules
**The Native Trust Rule.** Use the system sans stack for all admin UI. Do not introduce display fonts into labels, buttons, tables, or data.

**The Compact Copy Rule.** Body copy should stay concise and operational. Long guidance belongs in helper text, alerts, or specs, not in repeated card subtitles.

## 4. Elevation

Elevation is mostly structural and token-based. The app uses flat AntD cards, borders, tonal fills, and one clear elevated layer for dropdowns. Shadows are not a brand expression; they are a utility for popovers, dropdowns, and temporary surfaces.

### Shadow Vocabulary
- **Dropdown Elevation** (`token.boxShadowSecondary`): Notification dropdowns and elevated overlays that must separate from the header.
- **Focus Halo** (`0 0 0 2px token.colorPrimaryBg`): Interactive editor surfaces and custom focus-like states.
- **Flat Selection** (`box-shadow: none`): Courier cards, stat tiles, and most content surfaces stay flat with borders or tonal fills.

### Named Rules
**The Flat-Until-Temporary Rule.** Cards are flat at rest. Shadows belong to dropdowns, drawers, modals, and focus feedback, not dashboard decoration.

**The Border-Is-Structure Rule.** Use subtle borders and tonal backgrounds for persistent structure. Do not deepen shadows to create hierarchy.

## 5. Components

### Buttons
- **Shape:** Gently curved AntD controls (6px radius) with 32px default height.
- **Primary:** Refine Operations Blue background with light text, used for save, login, verify, filter confirmation, and submit actions.
- **Hover / Focus:** Use AntD token hover color and visible focus treatment. Preserve loading state on async actions.
- **Secondary / Ghost:** Default buttons handle secondary actions; text buttons are only for low-emphasis header and inline actions.
- **Danger:** Use AntD `danger` for destructive actions and pair with confirmation copy.

### Chips
- **Style:** AntD `Tag` is the status vocabulary. Tags use semantic color names, compact padding, small type, and visible text.
- **State:** Processing tags indicate selected or unread states. Default tags show inactive or unselected states. Courier chips wrap with 4px gaps and zero external margins.

### Cards / Containers
- **Corner Style:** AntD default to large radius depending on component role (6px to 8px), with 12px for dense courier group cards and 16px for banner preview frames.
- **Background:** Card and modal surfaces use the elevated/container token. Stat tiles use a muted fill.
- **Shadow Strategy:** Flat by default; dropdowns and overlays get token elevation.
- **Border:** Dashboard and courier cards use subtle token borders for structure.
- **Internal Padding:** 24px for standard cards, 16px for dense rows, 12px for compact timeline/media bodies.

### Inputs / Fields
- **Style:** AntD vertical forms with labeled `Form.Item`, 32px default controls, 6px radius, and full-width numeric fields where data entry benefits from alignment.
- **Focus:** Use tokenized border and focus ring. Custom editor preview surfaces shift border color to primary and show a pale blue halo.
- **Error / Disabled:** Use AntD validation messages, disabled states, and explicit helper text. Read-only coordinate fields remain visible and explain their source.

### Navigation
- **Style:** Refine resource tree drives the sidebar. Header stays 64px tall, sticky, and elevated with right-aligned language, theme, notification, and user controls.
- **Responsive:** Desktop uses a collapsible 200px sidebar with 80px collapsed width. Mobile uses a 200px drawer with zero body padding.
- **Active State:** Use AntD menu active state; do not invent custom navigation affordances.

### Tables
- **Style:** AntD tables are the main work surface for orders, products, customers, reports, recent orders, and low stock.
- **Density:** Small tables are valid for dashboard summaries; larger list pages use standard table density with action columns.
- **Actions:** Icon actions need tooltips or labels. High-risk actions stay out of dense rows unless confirmed.
- **Scroll:** Horizontal scroll is acceptable for operational tables. Use server-side pagination and URL-synced filters where possible.

### Notifications
- **Style:** Bell badge opens a 360px dropdown with 440px max height, token elevation, rounded corners, and compact list rows.
- **Unread State:** Unread rows use pale blue fill and a left marker. This is one of the few intentional leading accents, limited to a notification queue state.
- **Accessibility:** Badge and row buttons need aria labels with unread count and target order.

### Uploads / Media
- **Style:** AntD picture-card upload is the default for product, avatar, category, settings logo, and banner media.
- **Preview:** Large image previews use contained object fit, 720px modal width, and visible file/ratio warnings.
- **Constraints:** Banner media is constrained by placement ratios and size limits; admins should see warnings before publishing.

### Map Location Picker
- **Style:** A 300px map frame with 8px radius, subtle border, full-width autocomplete, helper text, and non-fatal fallback alerts.
- **Behavior:** Search, click, and draggable marker states all update precise coordinates. Missing API keys or unavailable Places search should degrade gracefully.

## 6. Do's and Don'ts

### Do:
- **Do** use Refine resource conventions and AntD components as the default vocabulary for CRUD screens.
- **Do** reserve Refine Operations Blue for primary actions, current state, selected state, focus, and unread queue emphasis.
- **Do** keep status tags text-first and color-second, especially for payment, shipping, stock, customer ban, and banner activation states.
- **Do** use 16px and 24px spacing for major page rhythm, 8px and 12px for compact rows, filters, and helper areas.
- **Do** preserve Indonesian-first copy, IDR formatting, localized dates, postal-code constraints, and Biteship/Midtrans terminology.
- **Do** use visible labels, aria labels, hidden data tables for charts, and confirmation copy for irreversible operations.

### Don't:
- **Don't** create generic SaaS dashboards with interchangeable metric cards, decorative charts, vague blue branding, and no operational priority.
- **Don't** make admin screens feel like a consumer shopping app with storefront polish, promotional browsing, or campaign-first layout.
- **Don't** turn home banners into a flashy CMS or campaign builder. Keep media constrained, previewable, and safe.
- **Don't** add hospital EHR heaviness, bureaucratic density, or clinical coldness to pharmacy commerce workflows.
- **Don't** hide risk behind color alone, vague labels, or optimistic actions for payment, shipping, stock, customer bans, or published content.
- **Don't** use side-stripe borders on cards, gradient text, decorative glassmorphism, hero-metric templates, or identical card grids.
- **Don't** introduce custom fonts, custom scrollbars, non-standard form controls, or decorative motion unless a specific workflow demands it.
