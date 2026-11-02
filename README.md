# OuderApp van Konnect for Switchboard

Connect Konnect childcare parent portals to [Switchboard](https://github.com/tader/switchboard). Access your children, locations, timeline, photos, diary, news, conversations and planning through Switchboard's HTTP API, API console and MCP operations.

Install **`tader/switchboard-plugin-ouderapp`** from **Plugins → Install from GitHub**. Requires Node.js 24 or later, with no extra dependencies or OAuth registration. Before the first stable release, explicitly select the development branch containing the implementation.

## Connect

1. Add an **OuderApp van Konnect** connection and choose **Persistent sign-in**.
2. Enter the childcare organisation name from your activation email, or its full root URL: `https://example.ouderportaal.nl`.
3. Enter your usual OuderApp username/email and password, then connect.

Every connection has its own organisation, account, and randomly generated device ID. No childcare provider, account or device from the research capture is hard-coded. Use separate connections for different organisations or accounts. Your account's permissions and the organisation's enabled modules still apply.

Your password is used only during setup. Switchboard stores the access/refresh tokens, username and generated device metadata encrypted. The username is required by the refresh protocol. Access tokens normally last 15 minutes; they renew before expiry or after a 401, including after a restart. The maximum refresh-token lifetime is unknown. If access expires, is revoked, or requires a password reset or additional sign-in step, finish that step in the official app and reconnect. No cookies or token exports are needed.

## Operations

| Area | Available operations |
| --- | --- |
| Account and children | Parent profile, permissions, organisation, active/inactive children, locations/groups |
| Updates | Timeline, notification counts, news and newsletters |
| Photos | Albums and paginated photos, including per-child albums |
| Conversations and diary | List entries, retrieve details, start or reply to a conversation |
| Planning | Date-range calendar, child/day details, current and available slots |
| Requests | List/detail/status, absence, extra childcare, exchange, cancellation, validation/costs/credits |

Connections are **read-only by default**. Enable **Allow messages and changes** when connecting to send messages or submit/cancel childcare requests. Only documented write routes are allowed. Cost/credit calculations use POST and also require this option. The plugin does not automatically register notifications, accept terms, mark news as read, change family data, or submit requests.

Opening a conversation or diary entry may update read receipts at the provider, even on a read-only connection. Photo URLs are signed and expire: fetch the returned URL directly without the OuderApp bearer token.

## Call through Switchboard

Get the connection reference from `GET /api/connections`. Relative paths resolve under the selected organisation's `/restservices-parent/` API:

```bash
curl "$SWITCHBOARD_URL/api/call" \
  -H "Authorization: Bearer $SWITCHBOARD_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"connection":"your-connection","method":"GET","url":"children/"}'
```

The bundled OpenAPI description makes operations discoverable through Switchboard. Responses retain OuderApp's fields, wrappers and pagination. **HTTP 200 does not establish application-level success:** inspect `result`, `messages`, `payload.hasValidationMessages`, partial-processing and approval status.

See [the connection and request guide](docs/ouderapp.md) for messages, absence, booking steps and date formats. This is an **unofficial integration with the app's API**; provider changes may require an update. The supported host format is `<organisation>.ouderportaal.nl` over HTTPS.

## Development and releases

```bash
npm run check
npm test
```

Tests use synthetic accounts, organisations and tokens. See [RESEARCH.md](RESEARCH.md) for protocol evidence and live-verification limits. Release Please manages version/changelog PRs and releases, updating package and plugin versions together. Required CI runs on all branches and is explicitly dispatched for release PRs. `main` requires PRs, passing up-to-date CI and resolved conversations, including for administrators.
