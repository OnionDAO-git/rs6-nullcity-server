# City Dashboard Integration

The controller can expose an internal HTTP API for the city dashboard. Start it only on a private network or behind the dashboard BFF.

Required controller env/flags:

- `CONTROLLER_CITY_HTTP_PORT`, or `--city-http-port <port>`
- `CONTROLLER_CITY_HTTP_TOKEN`, or `CITY_DASHBOARD_NULLCITY_TOKEN`, or `--city-http-token <token>`
- Optional: `CONTROLLER_CITY_HTTP_HOST` / `--city-http-host`, default `127.0.0.1`
- Optional: `CONTROLLER_CITY_HTTP_PATH_PREFIX` / `--city-http-path-prefix`, default `/api/nullcity`

Every request must send `Authorization: Bearer <token>`.

Routes:

- `POST /api/nullcity/residents`: birth a resident from a funded proposal payload.
- `POST /api/nullcity/residents/:id/attention-grants`: credit resident attention with `idempotencyKey`.
- `GET /api/nullcity/residents/:id/wealth`: inspect resident RuneScape gold, item `995`.
- `POST /api/nullcity/residents/:id/gold-burns`: burn resident gold item `995` with `idempotencyKey`.
- `POST /api/nullcity/residents/:id/messages`: deliver an attendee inbox message to a resident.
- `GET /api/nullcity/residents/:id/public-snapshot`: runtime state plus latest Library projection.
- `GET /api/nullcity/residents/:id/log` and `/library-events`: recent Library timeline events.
- `GET /api/nullcity/residents/:id/death`: runtime death marker and Library state.

Idempotency and audit records are persisted under `memory.dir/city-integration/`.
