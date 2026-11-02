# OuderApp protocol research

Researched 2026-11-02 using a user-authorized iOS mitmproxy capture and the public Ouderportaal web application. Only protocol structures are retained. No provider-specific hostnames, credentials, account/child IDs, family content, phone identifiers, images or raw captures are included. Fixtures are synthetic.

## Sources and authentication

- [Official OuderApp help centre](https://ouderapp.ovivio.com/hc/nl).
- [Official login instructions](https://ouderapp.ovivio.com/hc/nl/articles/25697937950353-Meer-informatie-over-inloggen-in-de-OuderApp).
- Public `/auth/` and `/parent/` application assets. The examined parent bundle was `main.3dbe25320f452ec0.js`; relevant lazy modules included calendar/planning, absence/extra/exchange requests, albums and mailbox. Vendor implementation code is not bundled.

Each organisation uses its own `<organisation>.ouderportaal.nl` host. Authentication is JSON PUT `/auth-api/login` with `username`, `password` and `deviceInfo`. The native request sends `X-Client-Name: OuderApp` and `X-Client-Version: 3.66.0`. Responses include `authToken`, `refreshToken`, `expiration`, `domainServerName` and password-reset state.

Renewal is JSON PUT `/auth-api/token` with username, refreshToken, connectionType and the same deviceInfo. The capture contains multiple successful renewals with no password or cookies. Access JWTs had 900-second lifetimes; refresh responses used `expiration: null`, so JWT expiry is needed for scheduling. The observed refresh token did not rotate, but the public app supports replacement tokens. The plugin persists any returned replacement before subsequent work. Its generated device metadata identifies Switchboard and never copies the captured phone's UUID or name.

Parent identity is verified through `/restservices-parent/parent` using `Authorization: Bearer …`. JWT claims are used only for expiry scheduling, not as a substitute for this authenticated profile check. Stored credentials are tied to one organisation; unexpected domain changes require a reconnect instead of forwarding credentials.

## Data and optional writes

The capture establishes account, children, location, authorizations, timeline, albums, news, newsletters, notifications and logbook shapes. Some responses use `{result,payload,messages}`, while others are raw arrays/objects. These shapes remain unchanged. Media requests use signed `kidskonnect.cloud` URLs without a bearer header.

Public app code establishes calendar paths with YYYYMMDD dates and optional child IDs, booking list/detail/cancel, absence and available-slot planning, expiry options, costs/credits and extra-request validation. Slot times and existing planning dates use milliseconds; newly selected JavaScript Date values are serialized as ISO strings. Native metadata, external IDs and attendance codes must be retained. Submitted product credits use `usedCredit`; credit lookup requests use `cost`.

Mailbox messages use POST `logbook/logmessage`: `originalLogMessageIds`, message, subject, childChildGroups and optional includedParentIds. Absence uses POST `booking/parent/absent/multiple` with reasonCode (`illness`, `vacation`, `unknown`), remarks and per-child selectedSlots/selectedActivities. Extra childcare uses validation/process endpoints with atomicTransaction, remarks, onHoldUntil and per-child/date bookings. Exchange uses absent/attend slots/activities. HTTP 200 may contain validation failures or partial processing; approval is a separate state.

The implemented plugin completed a fresh login, forced refresh, and GET requests for parent profile, permissions, children and locations, all returning HTTP 200 with successful application results. The renewed token had about 900 seconds remaining. The returned config/credentials contained no password. Credentials were read from the local capture into process memory, never logged or written to fixture files.

Live verification is limited to those authentication and non-message read requests. Calendar, diary and write structures are checked against public app code and synthetic tests rather than live changes. No messages, read-marking endpoints, push registrations, terms acceptance, family data changes or childcare requests were submitted. Maximum refresh lifetime and behaviour across every organisation cannot be established from one account.
