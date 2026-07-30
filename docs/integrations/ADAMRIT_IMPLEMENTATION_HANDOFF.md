# Adamrit Implementation Handoff

Adamrit must implement the receiver and recovery contract in
`adamrit-required-v1.openapi.yaml` before the HRPulse connector can move from
`shadow` to `active`.

## Mandatory changes

1. Create a real employee entity with immutable HIMS UUID, unique
   `(hospital, employee_number)`, HRPulse UUID mapping, optional HIMS user mapping,
   employment status, organization, version, and timestamps. Never match by name.
2. Replace the attendance name/date key with the mapped employee UUID/date key.
   Add `updated_at`, monotonic version, reversal/tombstone fields, and the
   incremental `attendance-records` endpoint. V1 keeps one check-in/check-out per
   day; raw multi-punch support is phase two.
3. Emit `attendance.daily.upserted`, `attendance.daily.reversed`, and
   `leave.request.submitted` through a transactional outbox. Sign the exact raw
   JSON body with HMAC-SHA256 and retain retry attempts.
4. Route employee leave submission through the integration service. Remove
   independent HIMS approval authority; only apply versioned HRPulse decisions and
   balances.
5. Receive only `finalized` payroll runs. Store run UUID/version and employee
   results immutably, acknowledge each row, and return HTTP 207 for partial
   failures.
6. Store only HRPulse employee-document metadata. Request upload sessions and
   five-minute download links from HRPulse; never persist signed URLs or put HR
   files in public patient buckets.
7. Replace permissive HR RLS and browser-side fuzzy filtering with server-side
   session, role, hospital, and employee authorization.
8. Add inbox/outbox idempotency, replay protection, dead letters, audit logging,
   and fabricated-data contract tests.

## Security headers

Adamrit → HRPulse webhooks:

```text
Authorization: Bearer <connector token>
X-Connector-Id: adamrit-hope
X-HIMS-Timestamp: <Unix seconds>
X-HIMS-Signature: v1=<HMAC-SHA256(timestamp + "." + raw-body)>
```

HRPulse → Adamrit uses the equivalent `X-HRPulse-*` headers. Reject signatures
older than five minutes and acknowledge valid duplicate event UUIDs with 2xx.

## Rollout

- Use the `hope` hospital only.
- Backfill the current and previous payroll months.
- Run in shadow mode for seven days and compare employee mappings, attendance
  counts, leave state, and payroll totals.
- Enable active delivery only after zero unresolved identity conflicts and a
  successful finalized-payroll sandbox test.
- Keep Ayushman disabled until Hope completes one successful payroll cycle.
