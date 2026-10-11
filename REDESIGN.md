# Orchestrator dashboard redesign

Branch: `codex/orchestrator-dashboard-redesign`, based on `sqlite-orchestrator-unification`.

The design reference is the existing port 5000 prototype, `api-config-dashboard/design-preview/preview.tsx`, in the original checkout. Its `tokens.css`, `base.css`, and `components.css` are copied unchanged. Both light and dark palettes use that source. `application.css` supplies adapters for real content and smaller screens.

The running app uses real API data and existing permission checks. App Settings replaces the endpoint workspace with the prototype's card hub. Breadcrumbs link App Registry → app → Settings → section. The app editor uses the six-step configuration navigation. The settings General page has the prototype's details/lifecycle/exposure/key/clone/delete layout and reviews changes before saving. Existing upstream controls from `feat/upstream-provider-types` are retained, including GraphQL, MongoDB, PostgreSQL, MySQL, named database connections, and array response mode. Array mode uses the normal endpoint update API so Express receives a JSON object rather than a primitive boolean.

The implementation changes page structure, not only styling: Environment Variables and database connections use searchable tables and header Add actions with modal forms; Runtime Authentication is split into requirement, method, session and throttling cards; History has filtering and quiet rollback actions; Compare groups endpoint additions, changes and removals. General keeps its header visible while the cards scroll and uses the prototype key status/callout arrangement. Endpoint and bot editors share change review, header Save actions and error/success toasts, with sensitive values masked. The test editor uses the client → orchestrator → upstream flow and result tabs. Tenant collections use consistent count/filter/refresh headers.

## Deployment

**Deployment is on hold at the user’s request.** Continue fixes and visual review at localhost:5002 against the localhost:5000 prototype. Do not build a Docker image, recreate the container, or deploy to localhost:3004 until the user explicitly authorizes deployment again.

The running Docker backend is newer than this branch's base. The frontend-only Dockerfile overlays the verified dashboard build on its saved image, preserving backend code, environment, and the existing SQLite bind mount.

1. In `api-config-dashboard`, run `npm ci` and `npm run build`.
2. Tag the existing running image `orchestrator-unified:pre-redesign-20261011` before its first replacement; keep that tag for rollback.
3. Build from `api-config-dashboard`:
   ```sh
   docker build --build-arg ORCHESTRATOR_RUNTIME_IMAGE=orchestrator-unified:pre-redesign-20261011 -f Dockerfile.redesign -t orchestrator-unified:redesign .
   ```
4. Combine the original deployment's `docker-compose.sqlite.yml` with this checkout's `docker-compose.redesign.yml`:
   ```sh
   docker compose -p orchestrator -f /absolute/original/checkout/docker-compose.sqlite.yml -f /absolute/redesign/checkout/docker-compose.redesign.yml up -d --no-deps --no-build orchestrator-unified
   ```

A consistent SQLite backup was saved inside the original data directory at `backups/pre-redesign-20261011.db`. Roll back the UI by using the saved image tag in a compose override and recreating only `orchestrator-unified`; restoring the database is unnecessary for this frontend deployment. Do not point Compose at a new data directory.

## Validation

- TypeScript check and production Vite build.
- Byte-for-byte comparison of the three design stylesheets with the port 5000 prototype.
- Real backend sign-in, app/bot registries, app settings replacement and breadcrumb navigation, bot sections, tenant settings sections, theme switching, command search and general settings change review.
- Phone breakpoint check at 390px, with no horizontal page overflow; desktop visual checks against the prototype.
- No test changes were saved to app configuration; the existing database is retained.

The Monaco editor produces Vite's large-chunk advisory. This existing editor bundle is still served locally with its workers and fonts.

## Review fixes — 11 October

Authentication configuration cards are hidden when authentication is off. Bearer mode shows identity providers; session mode shows session controls, with throttling and two-factor controls for gateway login and brokered identity controls for SSO. Errors use the shared toast rather than page/dialog banners or native alerts. Connection options use theme surface/text colors. Bot Registry matches the App Registry toolbar, filters and row menu. Destructive row actions use labelled trash icons; endpoint Delete controls and confirmation action text remain intact.

Verified these conditions in the browser on localhost:5002 using unsaved drafts. Empty connection validation produced a toast with no inline error. Bot status filtering and identity-provider trash controls were checked. TypeScript, production build and whitespace checks passed. No configuration writes, Docker image builds or deployment were performed for these fixes.

The login now restores the original redesign document’s two-column composition: navy brand/art panel and sign-in form. It retains username/password authentication and current dashboard light/dark tokens, with a theme toggle. Desktop and 390px mobile layout were verified without signing out the existing localhost session.

## Appearance palettes

Added four selectable preview tiles in Appearance: Midnight Console (the unchanged current/default palette), Coastal Linen from the original blue/beige design document, Graphite, and Orchid. Palette selection is independent of Light/Dark/System display mode, persists locally in the browser, and initializes before first paint. Optional palettes cover shared component tokens, navigation, code surfaces, and the two-column login page. Orchid uses #fcf5ff as the dominant light canvas, with accents based on the requested 60/10/10/5/5/10 composition for #fcf5ff/#24102b/#3c2842/#2c272e/#6f6473/#efdcf5; palette cards show interface previews without color bars or percentage labels. These are design composition targets, not fixed viewport pixel ratios.

Validation: TypeScript and Vite build passed; all four palettes verified in both display modes at localhost:5002; Orchid selection persisted after reload. Restored current palette and light display mode after verification. Docker deployment remains on hold.

Bot detail header actions now share a right-aligned group with the common Save action, preventing space-between from pushing Disable/Export into the middle when editing tabs are selected. Tab keyboard focus uses a shaded surface and bottom line instead of the globally clipped outline that appeared as vertical rails. Verified identical right edge across Overview, Behaviour, Bindings, Limits and Audit, checked light/dark rendering, and passed TypeScript checking.

App users now use one fixed-layout semantic table with consistent columns, truncated long emails/subjects with full-value titles, accessible profile buttons and a per-row Actions menu. Reset password remains restricted to gateway users; Enable/Disable and Delete retain their existing handlers. Endpoint navigation replaces completion ticks and step numbers with Braces, ListTree, Network, FileJson, GitCompareArrows and FlaskConical icons. Verified user Actions menu and all six endpoint icons in the browser at localhost:5002 without executing any account action. TypeScript and whitespace checks passed.

Endpoint tab layout stability: reserved a 34px header and 160px Save action slot even on Test, where no save control is present. Added a stable scrollbar gutter to the editor body and kept keyboard focus within step bounds. Browser measurements confirmed identical header/stepper/body rectangles and pencil-button coordinates across Request, Response, Upstream, Sample, Mapping and Test. TypeScript and whitespace checks passed; no test request was executed.

## Unsaved navigation and header action alignment

Shared Save and continue / Discard changes / Stay dialog now protects tracked endpoint, script, runtime authentication, bot, organization and General settings drafts. Router blocking covers links and browser Back/Forward; imperative navigation, internal tabs, endpoint/script selection and sign-out share the guard. Reload/close uses the native browser warning. Save and continue waits for every save; failure retains the draft. General settings registers without a duplicate header Save button.

Validated dirty bot tab/sidebar navigation, Stay draft retention, Discard navigation, General settings Back button and browser Back, script selection and app tab navigation. Deferred and failed save helper checks passed; TypeScript and build passed. No configuration saves were submitted during verification.

App-detail header groups Save, Export and Settings at the right edge, with Save first to keep the other two actions in place. Endpoint pencil stays last/rightmost; removed the empty Test Save spacer while preserving header height. Deployment to port 3004 remains on hold.

Script Save placement: the shared Save changes control now appears immediately after the description field in the script editor toolbar. It retains change review and unsaved-navigation protection; Export and Settings remain in the app header. TypeScript and whitespace checks passed and browser inspection confirmed the toolbar control.
