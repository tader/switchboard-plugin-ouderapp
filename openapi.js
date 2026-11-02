import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
const str = { type: 'string' }, bool = { type: 'boolean' }, ms = { type: 'integer', format: 'int64', description: 'Unix time in milliseconds.' };
const instant = { oneOf: [ms, { type: 'string', format: 'date-time' }], description: 'Preserve server slot values. The app serializes JavaScript Date selections as ISO 8601 strings; existing planning can use Unix milliseconds.' };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const array = items => ({ type: 'array', items });
const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const paths = {};
function operation(method, path, id, summary, tag, { query = [], body, description } = {}) {
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: /^(from|until|date)$/.test(name) ? { ...str, pattern: '^\\d{8}$', description: 'Calendar date YYYYMMDD in the organisation’s local time.' } : str }));
  for (const q of query) {
    const [name, type = 'string', detail] = q;
    parameters.push({ name, in: 'query', schema: { type }, description: detail });
  }
  paths[path] ??= {};
  paths[path][method] = { operationId: id, summary, tags: [tag], ...(description ? { description } : {}), ...(parameters.length ? { parameters } : {}),
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
    responses: { 200: { description: 'Original OuderApp response. Inspect result, payload.hasValidationMessages, messages and approval status; HTTP 200 alone does not establish success.', content: { 'application/json': { schema: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'array', items: {} }, { type: 'boolean' }] } } } } },
  };
}
const get = (...args) => operation('get', ...args), post = (...args) => operation('post', ...args);
get('/parent', 'getParentProfile', 'Current parent profile', 'Account');
get('/parent/authorizations', 'getParentPermissions', 'Available functions and permissions', 'Account');
get('/customer/info', 'getOrganisationInfo', 'Childcare organisation information', 'Account');
get('/children/', 'listChildren', 'Active and inactive children', 'Children');
get('/location/locations', 'listLocations', 'Locations and child groups', 'Children');
get('/timeline/cards/v2/{before}', 'getTimeline', 'Timeline before a millisecond timestamp', 'Updates', { description: 'Use the current Unix time in milliseconds initially; use dates in returned cards to request older entries. Equal timestamps can overlap; deduplicate by returned identifiers.' });
get('/notification/notifications', 'getNotificationCounts', 'Unread notification counts', 'Updates');
get('/v2/albums/overview', 'listAlbums', 'Available photo albums', 'Photos');
get('/v2/albums/', 'getAlbumPhotos', 'Photos from a general or favourites album', 'Photos', { query: [['index', 'integer'], ['nrOfPhotos', 'integer'], ['type', 'string', 'Album type as returned by the server.']] });
get('/children/{childId}/album', 'getChildPhotos', 'Paginated photos for one child', 'Photos', { query: [['index', 'integer'], ['nrOfPhotos', 'integer']] });
get('/children/{childId}/childdocuments/unread', 'getUnreadChildDocumentCount', 'Unread child document count', 'Children');
get('/journal/{journalId}/logmessage/{isLogMessage}', 'getJournalEntries', 'Diary entries associated with a timeline card', 'Diary', { description: 'Use journalId and isLogMessage from a journal timeline card. Preserve the returned card types. Opening details may update read receipts.' });
get('/logbook/overview', 'listConversations', 'Conversations', 'Messages', { query: [['index', 'integer'], ['from', 'integer', 'Unix milliseconds.'], ['to', 'integer', 'Unix milliseconds.']], description: 'Use either index pagination or a from/to period.' });
get('/logbook/details/{messageId}/summary/{includeSummary}', 'getConversation', 'Conversation details', 'Messages', { description: 'Opening messages may update read receipts, even on a read-only connection. includeSummary is true or false.' });
get('/htmlnews/view', 'listNews', 'Organisation news', 'Updates', { query: [['from', 'integer'], ['to', 'integer']] });
get('/htmlnews/{newsId}', 'getNews', 'News article details', 'Updates');
get('/newsletter', 'listNewsletters', 'Newsletters', 'Updates', { query: [['from', 'integer'], ['to', 'integer']] });
get('/newsletter/generated/{newsletterId}', 'getNewsletter', 'Newsletter content', 'Updates');
get('/calendar/{from}/until/{until}', 'getCalendar', 'Planning in a date range', 'Planning', { query: [['childIds', 'string', 'Comma-separated child IDs.']], description: 'Dates use YYYYMMDD. Preserve warnings about an offline data connector; returned planning may be stale.' });
get('/calendar/detail/{date}/child/{childId}', 'getChildDayPlanning', 'Planning details for one child and date', 'Planning');
get('/booking/parent/overview', 'listRequests', 'Paginated childcare requests', 'Requests', { query: [['index', 'integer'], ['careTypes', 'string', 'Comma-separated care type values.'], ['requestType']] });
get('/booking/parent/{requestId}/detail', 'getRequest', 'Childcare request status and details', 'Requests');
get('/booking/parent/pendingapprovalcount', 'getPendingRequestCount', 'Requests awaiting parent approval', 'Requests');
get('/booking/parent/{requestType}/children/{childIds}/planning/{from}/{until}', 'getAbsencePlanning', 'Current slots available for absence or exchange', 'Requests', { description: 'Use requestType absent for sickness/holiday; use the organisation’s returned planning, not reconstructed slots.' });
get('/booking/parent/{requestType}/children/{childIds}/planning/availableslots/{from}/{until}', 'getAvailableSlots', 'Available slots for extra childcare or exchange', 'Requests');
get('/booking/parent/{requestType}/expiryoptions/{date}', 'getRequestExpiryOptions', 'Available on-hold expiry dates', 'Requests');
post('/logbook/logmessage', 'sendMessage', 'Start or reply to a conversation', 'Messages', { body: ref('MessageInput'), description: 'Requires Allow messages and changes. For a reply, preserve originalLogMessageIds, subject and child/group recipients from the conversation. For a new conversation, includedParentIds is optional. Sends immediately; check for an existing message before retrying after a timeout.' });
post('/booking/parent/absent/multiple', 'reportAbsence', 'Report sickness, holiday or other absence', 'Requests', { body: ref('AbsenceInput'), description: 'Requires Allow messages and changes. First obtain absence planning; preserve opaque slot metadata, externalId and attendanceSubCode. Ignore locked/unconfirmed slots. Check all returned validation messages.' });
post('/booking/parent/extra/validate', 'validateExtraCare', 'Validate extra childcare before submission', 'Requests', { body: ref('ExtraInput') });
post('/booking/parent/extra/process', 'requestExtraCare', 'Submit extra childcare requests', 'Requests', { body: ref('ExtraInput'), description: 'Validate and inspect costs before submitting. An accepted request can still await approval or be partially processed. Do not automatically retry a timed-out submission.' });
post('/booking/parent/interchange/multiple', 'requestExchange', 'Request an exchange of childcare days', 'Requests', { body: ref('ExchangeInput'), description: 'Use current absent and available slots. Inspect validation and approval status. Do not automatically retry.' });
post('/booking/parent/calculate/costs', 'calculateCareCosts', 'Calculate costs for selected slots', 'Requests', { body: array(object({ childId: str, selectedSlots: array(ref('Slot')) }, ['childId', 'selectedSlots'])) });
post('/booking/parent/calculate/costs/slots', 'calculateSlotCosts', 'Calculate per-slot costs for a child', 'Requests', { body: ref('CostInput') });
post('/booking/parent/children/{childIds}/productcredits/{date}', 'getProductCredits', 'Available credits for selected children and date', 'Requests', { body: array(object({ productCreditId: str, cost: { type: 'number' } }, ['productCreditId', 'cost'])) });
operation('put', '/booking/parent/cancel/{requestId}', 'cancelRequest', 'Cancel a childcare request', 'Requests', { body: { type: 'object', nullable: true, example: null }, description: 'Requires Allow messages and changes. Fetch request details first and confirm its current state allows cancellation. Sends JSON null.' });

const slot = object({ childGroupId: str, selectedDate: instant, startTime: ms, endTime: ms, metadata: {}, externalId: { ...str, nullable: true }, attendanceSubCode: { ...str, nullable: true }, customTimes: bool }, ['childGroupId', 'selectedDate', 'startTime', 'endTime']);
const activity = object({ activityPlannedDateId: str, activitySubscriptionId: str, childGroupId: str, selectedDate: instant, activityStartTime: ms, activityEndTime: ms });
const childBooking = object({ childId: str, selectedSlots: array(ref('Slot')), selectedActivities: array(ref('Activity')) }, ['childId', 'selectedSlots']);
export default {
  openapi: '3.0.3', info: { title: 'OuderApp van Konnect', version, description: 'Unofficial parent API. The server URL is supplied from the selected connection. Responses retain upstream fields and wrappers. Writes require explicit opt-in.' }, paths,
  components: { schemas: {
    Slot: slot, Activity: activity,
    MessageInput: object({ originalLogMessageIds: { ...array(str), nullable: true }, message: { ...str, minLength: 1 }, subject: str, childChildGroups: { ...array(object({ childId: str, childGroupId: str }, ['childId', 'childGroupId'])), minItems: 1 }, includedParentIds: array(str) }, ['message', 'childChildGroups']),
    AbsenceInput: object({ reasonCode: { ...str, enum: ['illness', 'vacation', 'unknown'] }, remarks: { ...str, nullable: true }, childBookings: { ...array(childBooking), minItems: 1 } }, ['reasonCode', 'childBookings']),
    ExtraInput: object({ atomicTransaction: bool, remarks: { ...str, nullable: true }, onHoldUntil: { ...ms, nullable: true }, childBookings: { ...array(object({ childId: str, date: instant, bookings: array(object({ dayType: str, selectedSlots: array(ref('Slot')), selectedActivities: array(ref('Activity')), productCredits: array(object({ productCreditId: str, usedCredit: { type: 'number' } }, ['productCreditId', 'usedCredit'])), paidRemainingOnInvoice: bool }, ['dayType', 'selectedSlots'])) }, ['childId', 'date', 'bookings'])), minItems: 1 } }, ['atomicTransaction', 'childBookings']),
    ExchangeInput: object({ atomicTransaction: bool, remarks: { ...str, nullable: true }, onHoldUntil: { ...ms, nullable: true }, childBookings: { ...array(object({ childId: str, absentSlots: array(ref('Slot')), attendSlots: array(ref('Slot')), absentActivities: array(ref('Activity')), attendActivities: array(ref('Activity')) }, ['childId', 'absentSlots', 'attendSlots'])), minItems: 1 } }, ['atomicTransaction', 'childBookings']),
    CostInput: object({ childId: str, dayType: str, selectedSlots: array(ref('Slot')) }, ['childId', 'dayType', 'selectedSlots']),
  } },
};
