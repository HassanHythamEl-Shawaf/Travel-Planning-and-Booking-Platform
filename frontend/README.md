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
  API `401` responses return to login with the requested path, `403` responses
  route to `/forbidden`, and `404` responses render the app's not-found page.
- The current user comes from `GET /auth/me`; credentials and tokens are never
  written to localStorage or sessionStorage. The `proxy.ts` route guard checks
  sessions, refreshes expired access cookies, enforces role landing pages and
  sends users with temporary passwords to `/account/change-password`. It
  forwards the requested path to server components so an expired session can
  return to the page the user originally requested after login.
- `AppShell` owns the authenticated header and role navigation. Its
  `data-slot="notification-bell"` element is the integration point for the
  notification component.
- Shared UI components are in `src/components/ui/`: `Button`, `TextField`,
  `SelectField`, `TextAreaField`, `DataTable`, `ConfirmDialog`, toast helpers,
  loading/error/empty states, `Pagination`, `StatusBadge`, and `ImageUploader`.
  Paginated API consumers use the exported `PAGE_SIZE` value of 10.
- `ImageUploader` accepts existing images, `maxImages`, and upload/remove
  callbacks. The owner page supplies the backend endpoint; the component
  enforces the user-facing JPG/PNG and 5 MB checks, confirms before removing
  an image, and leaves final validation to the backend.
- Color, spacing, and typography tokens plus responsive rules are in
  `src/app/globals.css`.

## Checks

Run `npm run lint` and `npm run build` from `frontend/`.
