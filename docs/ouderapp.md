---
title: Connecting OuderApp van Konnect
services: [ouderapp]
order: 1
---

# Connecting OuderApp van Konnect

Choose **Persistent sign-in**, enter your organisation name or root `https://example.ouderportaal.nl` URL, username/email and password. The organisation name is in your activation email. Use a separate connection for each organisation/account. Your password is discarded after setup; the username, tokens and generated device metadata are stored encrypted for automatic renewal.

Enable **Allow messages and changes** only when you intend to send messages or change childcare requests. Backend account permissions still apply. Modules and options differ between organisations; inspect `parent/authorizations` and the planning responses. New passwords, pending declarations or other additional login steps must be handled in the official app before reconnecting.

## Read information

```http
GET parent
GET parent/authorizations
GET children/
GET location/locations
GET v2/albums/overview
GET children/{childId}/album?index=0&nrOfPhotos=20
GET logbook/overview?index=0
GET calendar/20261101/until/20261130?childIds={childId}
GET booking/parent/overview?index=0
```

Use **YYYYMMDD in the organisation's local time** for calendar/planning path dates. Timeline `before`, news/conversation `from`/`to`, slot times and on-hold timestamps use Unix milliseconds. Preserve selected-date values from planning; for newly chosen request dates the app serializes JavaScript Dates as ISO 8601 strings. Child, group, message and request IDs are opaque strings; keep the exact IDs returned by the server.

For timeline requests, use `timeline/cards/v2/{before}` with the current millisecond timestamp initially, then older dates from returned cards. Deduplicate overlapping entries by their identifiers. Albums use `index` and `nrOfPhotos`; preserve server album types when requesting a general/favourite album. Inspect server responses for pagination rather than assuming all results fit one page.

Fetch signed photo/attachment URLs directly without this connection's bearer token. Do not replace them with guessed URLs or automatically forward credentials to media hosts.

## Messages and diary

`logbook/overview` contains conversations. Details are retrieved with:

```http
GET logbook/details/{messageId}/summary/true
```

> [!NOTE]
> Opening details may update read receipts. The plugin does not automatically fetch message details on connection.

Diary entries are included in journal cards from the timeline. Use the card's `journalId` and `isLogMessage` values with `GET journal/{journalId}/logmessage/{isLogMessage}` to read related diary entries. Keep the card's original type and child identifiers.

To send a message, enable writes and POST `logbook/logmessage`. Supply `message`, `subject` and `childChildGroups`, with a `childId` and `childGroupId` for each recipient. For replies, preserve the existing conversation's `logMessageIds` as `originalLogMessageIds`; for a new conversation these can be null, with optional `includedParentIds`. Obtain recipients from current child/group/conversation data; email addresses are not recipient IDs.

```json
{
  "originalLogMessageIds": null,
  "message": "Your message",
  "subject": "Subject",
  "childChildGroups": [{"childId":"child-id","childGroupId":"group-id"}],
  "includedParentIds": []
}
```

Sending is immediate. After a timeout, read the conversation before retrying to avoid duplicates. Sending formats were verified against public application code; no live messages were sent.

## Absence, extra childcare and exchanges

Always retrieve current planning and request status before constructing a submission:

1. Read the calendar and the appropriate `booking/parent/{requestType}/children/{childIds}/planning/...` operation. Use `absent` for absence planning, `extra` for extra childcare, and `inter_change` for exchanges. Use the available-slots operation for attendance selections.
2. Preserve the chosen slot's `childGroupId`, `selectedDate`, `startTime`, `endTime`, `metadata`, `externalId` and `attendanceSubCode`. Do not invent or strip opaque metadata. Leave locked or unconfirmed slots unchanged. Preserve any warnings that planning is stale because a data connector is offline.
3. For extra childcare, inspect costs, credits and allowed on-hold dates, then call `booking/parent/extra/validate` before `booking/parent/extra/process`. Cost and credit lookups also require writes enabled because their HTTP method is POST.
4. Submit only the intended children and slots. Inspect `result`, `messages`, `hasValidationMessages`, `partiallyProcessed` and approval status. Accepted does not necessarily mean approved; a multi-day request can be partly processed. Re-read request status before retrying after a timeout.

Absence uses `POST booking/parent/absent/multiple`, with `reasonCode` set to `illness`, `vacation` or `unknown`, optional `remarks`, and `childBookings`. Each child entry includes `childId`, `selectedSlots` and optionally `selectedActivities` from current planning.

Extra childcare uses `atomicTransaction`, `onHoldUntil` (milliseconds or null), optional `remarks`, and `childBookings`. Each child/date contains `bookings` grouped by the server's `dayType`, with selected slots/activities, credits and any invoice-payment choice. Follow the server's validation and cost responses; `atomicTransaction` is an explicit choice, not a guarantee of approval.

Exchange requests use `POST booking/parent/interchange/multiple`, containing `childBookings` with `absentSlots`, `attendSlots`, `absentActivities` and `attendActivities`. Match these to the current absence and available-slot responses. Cancellation uses `PUT booking/parent/cancel/{requestId}` with JSON `null`, after checking the current request permits cancellation.

The OpenAPI description contains the request structures. No sickness reports, holidays, bookings, exchanges or cancellations were submitted during live verification. Financial administration, contract changes, file upload, consent changes and push registration are outside this version.
