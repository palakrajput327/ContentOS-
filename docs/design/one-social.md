# One Social visual system

## Direction and scope
A calm indigo workspace with restrained violet accents, softly layered surfaces, clear typography, and compact controls. Shared styling covers the user workspace and admin sections; no dependencies were added.

The initial audit found reusable React 19 components, Radix dialogs, Lucide icons, theme tokens, and mobile workspace navigation. Competing route styles, fixed form columns, excessive hover shadows, eager imports, and legacy display copy were the main issues addressed. Authentication, workspace scoping, API routes, storage keys, and permission checks are preserved.

## Tokens and assets
Source of truth: src/design-system.css. Marketing/authentication: src/marketing.css. Billing-specific layout: src/pages/billing.css.

- Light background: #f6f7fc; surface: #ffffff; muted surface: #f1f3fa.
- Dark background: #0d111c; surface: #141a29; muted surface: #1a2234.
- Primary action: #4f46e5 in light, #6366f1 in dark.
- Violet accent: #8b5cf6. Semantic success/warning/error tokens retain distinct meanings.
- Product panels: 16px radius. Compact controls: 8–10px radius.
- System font stack; no remote font downloads required.
- Focus-visible outlines and reduced-motion preferences are retained.

SVG assets: public/brand/mark-{light,dark,mono}.svg and public/brand/wordmark-{light,dark,mono}.svg. Favicon: public/favicon.svg.

## Responsive behavior
Desktop uses persistent side navigation and multi-column content. At 1000px, composer/Studio become single column. At 850px, the header wraps search below workspace controls. At 600px, forms and content cards become single column; metric cards use two columns; the dashboard pipeline becomes a grid. Tables/calendar retain deliberate horizontal scrolling within their containers. Billing auto-fit columns cannot exceed their parent width.

## Validation and limits
TypeScript and full backend/frontend production builds pass after the visual pass. Source diff whitespace checks pass. No new test or UI dependencies.

Baseline entry JS: 1782.30 kB (401.68 kB gzip); current: 827.18 kB (231.09 kB gzip). Initial CSS: 214.12 kB -> 146.85 kB. Heavy product routes now load separately. Vite still warns about an entry chunk above 500 kB. These are build sizes, not Lighthouse or runtime scores.

Rendered mobile, keyboard, authenticated user, and admin workflow verification remains outstanding. Earlier browser automation could not reach the local preview or establish the native browser URL. Do not interpret CSS breakpoints or successful compilation as rendered verification. The existing workflow test suite previously hit local database connection permissions; no passing regression-test claim is made.

## Changed source areas
- src/AuthApp.tsx: deferred product route loading.
- src/components/ui.tsx, public/brand, public/favicon.svg, index.html: identity and metadata.
- src/lib/appearance.tsx: system/light/dark preference handling.
- src/design-system.css, src/marketing.css, src/dashboard.css, src/pages/billing.css: shared design, scoped page styling, responsive layouts.
- src/pages/Authentication.tsx, src/pages/Landing.tsx: feature presentation and keyboard-accessible preview buttons.
- Display copy in product pages/components and existing server mail templates: One Social branding only.

Work stays on ui/ux. No merge or deployment has been performed. Generated dist and dist-api artifacts are build outputs and are not included in the source commit.
