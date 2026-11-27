# Frontend

The app is built with Next.js App Router, React and TypeScript. It uses the
Milestone 1 NestJS API as its source of truth.

## Local setup

1. Copy the repository-root `.env.example` to `frontend/.env.local` and set
   `NEXT_PUBLIC_API_URL` to the backend API base URL. The default local backend is
   `http://localhost:3000/api`.
2. Set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` when implementing Stripe Elements.
   Only a publishable key belongs in this frontend environment. Never put a
   Stripe secret key or backend credentials here.
3. Install and start the app:

   ```text
   npm ci
   npm run dev
   ```

   The frontend runs at <http://localhost:3001>; the backend CORS default
   allows this origin with credentials.

## Shared contracts

- `apiRequest<T>(path, init?)` is the browser API client. It uses the configured
  API base URL, sends cookies with requests, normalizes backend error messages,
  maps validation messages to form field names, and refreshes an expired access
  token once before retrying.
- `serverApiRequest<T>(path, init?)` is for Server Components. It forwards the
  incoming session cookie and disables response caching for user-specific data.
- The current user comes from `GET /auth/me`; credentials and tokens are never
  written to localStorage or sessionStorage. The `proxy.ts` route guard checks
  sessions, refreshes expired access cookies, enforces role landing pages and
  sends users with temporary passwords to `/account/change-password`.
- `AppShell` owns the authenticated header and role navigation. Its
  `data-slot="notification-bell"` element is the integration point for the
  notification component.
- Shared UI components are in `src/components/ui/`: `Button`, `TextField`,
  `SelectField`, `TextAreaField`, `DataTable`, `ConfirmDialog`, toast helpers,
  loading/error/empty states, `Pagination`, `StatusBadge`, and `ImageUploader`.
  Pagination consumers use a page size of 10.
- `ImageUploader` accepts existing images, `maxImages`, and upload/remove
  callbacks. The owner page supplies the backend endpoint; the component
  enforces the user-facing JPG/PNG and 5 MB checks, while the backend remains
  authoritative.
- Design tokens and responsive rules are in `src/app/globals.css`.

## Checks

Run `npm run lint` and `npm run build` from `frontend/`.
