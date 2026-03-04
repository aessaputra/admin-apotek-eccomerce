# Plan: Order Waybill Flow Review + Refactor

**Plan Name**: order-waybill-refactor-plan
**Created At**: 2026-03-04T16:45:37.360Z
**Session ID**: ses_34ab8da4dffelSWCdZAigxonmt
**Progress**: 6/6

## Objective
Run a structured code review and targeted refactor for order status + waybill flow:
- enforce manual override validation
- tighten form behavior and field rules
- clarify payment-to-shipping status transitions
- verify build and diagnostics

## Task Checklist
- [x] Validate current implementation against review checklist (functionality, security, maintainability)
- [x] Add server-side validation in `supabase/functions/order-manager/index.ts` for manual waybill override reason
- [x] Refine form-level validation and state handling in `src/pages/orders/show.tsx`
- [x] Add explicit status-flow documentation comments in `supabase/functions/_shared/midtrans.ts`
- [x] Run verification (`npm run build`, LSP diagnostics on modified files)
- [x] Summarize evidence and close plan

## Execution Notes
- Keep behavior backward-compatible except validated constraints for manual override.
- Prefer explicit and auditable metadata for manual waybill changes.
- Do not bypass validation with type suppression.

## Evidence
- LSP diagnostics: clean for `supabase/functions/order-manager/index.ts`
- LSP diagnostics: clean for `supabase/functions/_shared/midtrans.ts`
- LSP diagnostics: clean for `src/pages/orders/show.tsx`
- Build: `npm run build` passed (TypeScript + Vite production build)
