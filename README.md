# Travel Planning and Booking Platform

## Milestone 1 backend

The NestJS backend uses MongoDB Atlas. For detailed API behavior and requirement
traceability, see [the backend README](./backend/README.md).

### Local setup

1. Install Node.js and npm, then copy `backend/.env.example` to
   `backend/.env`.
2. Set `MONGODB_URI`, strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
   values, and the Stripe/FXRatesAPI credentials needed for those workflows.
   Set `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD` for
   the seeded administrator. Keep `.env` private and never commit it.
3. From `backend/`, install dependencies and seed the reference data and admin:

   ```text
   npm ci
   npm run seed
   ```

4. Start the API:

   ```text
   npm run start:dev
   ```

   Swagger UI is available at <http://localhost:3000/api/docs>.

Run backend checks from `backend/`:

```text
npm test -- --runInBand
npm run build
npm run lint
```

## Milestone 2 frontend

The Next.js frontend lives in [`frontend/`](./frontend/). See the
[frontend setup and shared contracts](./frontend/README.md) for environment
variables, local startup, session handling and reusable component contracts.
Copy `.env.example` to `frontend/.env.local`; never commit the local
environment file.