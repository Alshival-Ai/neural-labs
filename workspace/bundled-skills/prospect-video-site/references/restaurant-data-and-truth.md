# Restaurant Data and Truth Contract

Read this reference for every restaurant build or revision. It defines the
minimum durable data needed to keep business facts separate from creative copy.
It is an implementation contract for the current static-preview workflow, not
a locked generator schema.

## Source precedence

Use the strongest current source available for each fact:

1. client material explicitly identified by the user as approved;
2. the restaurant's current official website, menu, reservation, or ordering
   destination;
3. current official social posts for facts they directly state;
4. Google Places for identity, address, phone, coordinates, business status,
   and listed hours;
5. current public menu photographs or reputable directories as bounded
   evidence; and
6. reviews only as research leads, never as authoritative business claims.

Source precedence is property-specific. An official reservation provider can
be authoritative for its booking URL without being authoritative for the
restaurant story. Record retrieval times because menus, prices, hours, and
conversion URLs are mutable.

If sources disagree, record the conflict. Prefer the newer first-party source
when its identity is certain; otherwise omit the fact or ask the user. Never
silently choose the value that produces the better design.

## `restaurant.json`

For a new restaurant run, keep one machine-readable record with this conceptual
shape:

```json
{
  "schemaVersion": 1,
  "identity": {},
  "business": {},
  "location": {},
  "hours": {},
  "conversion": {},
  "social": {},
  "menu": {},
  "brand": {},
  "creativeDirection": {},
  "approvals": {},
  "sources": [],
  "omissions": [],
  "conflicts": []
}
```

Keep exact source URLs and retrieval timestamps in `sources`. Other objects may
refer to a stable `sourceId` rather than repeating URLs. Store `null` or omit an
optional field when absent; never use a plausible placeholder.

## Property rules

| Object / property | Type | Requirement | Authority and validation | AI inference |
| --- | --- | --- | --- | --- |
| `identity.name` | string | Required | Exact resolved listing or approved client identity | Never |
| `identity.tagline` | string | Optional | Approved client text; conceptual copy must be labeled separately | Only as unapproved concept copy |
| `identity.concept` | string | Optional | Approved client brief or clearly labeled research synthesis | Allowed as analysis, not fact |
| `identity.description` | string | Optional | First-party/client source | Never as factual copy |
| `business.phone` | E.164 plus display string | Optional | Current first-party or Places value; verify click target | Never |
| `business.email` | string | Optional | First-party/client source | Never |
| `business.legalName` | string | Optional | Client/legal source only | Never |
| `location.address` | structured object | Optional | First-party or Places; render only supplied fields | Never |
| `location.coordinates` | latitude/longitude | Optional | Verified listing or geocoded approved address | Never approximate |
| `hours.timezone` | IANA timezone | Required when hours exist | Derive only from verified location using a reliable timezone lookup | Allowed from verified coordinates |
| `hours.schedule` | weekly intervals | Optional | Current first-party or Places listing | Never invent closed/open periods |
| `hours.exceptions` | dated intervals | Optional | First-party/client holiday schedule | Never |
| `conversion.menuUrl` | absolute HTTPS URL | Optional | Verified current destination | Never |
| `conversion.reservationUrl` | absolute HTTPS URL | Optional | Verified restaurant/provider destination | Never |
| `conversion.orderUrl` | absolute HTTPS URL | Optional | Verified restaurant/provider destination | Never |
| `conversion.callEnabled` | boolean | Derived | True only when a verified phone exists and the brief allows it | Deterministic only |
| `conversion.directionsEnabled` | boolean | Derived | True only when verified location or Maps destination exists | Deterministic only |
| `social.*` | absolute URL | Optional | Official profile identity match | Never |
| `brand.logo` | local asset record | Optional | Client-approved or rights-cleared official asset | Never fabricate |
| `brand.colors` | tokens | Optional | Approved brand values or explicitly conceptual palette | Conceptual values allowed only when labeled |
| `brand.fonts` | asset/system choices | Optional | Rights-cleared and technically usable | Creative choice, approval pending |
| `creativeDirection.*` | strings/enums | Optional | Director/client brief or research recommendation | Allowed as recommendation, never auto-approved |
| `approvals.*` | status record | Required for claimed gates | Human/Director decision with timestamp and evidence note | Never |

## Menu model

Keep menu content structured even when the initial static page renders it as
HTML:

```json
{
  "menu": {
    "status": "available",
    "sourceIds": ["menu-april-2026"],
    "sourceDate": "2026-04",
    "retrievedAt": "2026-08-29T23:34:26Z",
    "firstParty": false,
    "confirmationNotice": "Prices and availability can change; call to confirm.",
    "categories": [
      {
        "id": "plates",
        "name": "Meat plates",
        "items": [
          {
            "id": "one-meat-plate",
            "name": "1 meat plate",
            "description": "Choice of listed meats; includes 3 sides",
            "price": null,
            "priceRange": { "min": 11.5, "max": 15.99, "currency": "USD" },
            "sourceId": "menu-april-2026"
          }
        ]
      }
    ]
  }
}
```

The model may include `price`, `priceRange`, `choices`, `modifiers`,
`availabilityNote`, and `dietaryLabels` only when the source explicitly
supports them. Do not convert category conventions into dietary claims. Keep
family packages, daily specials, bulk pricing, and variable-market items in
their own categories instead of flattening away their conditions.

### Image/PDF transcription

When a menu is an image or PDF:

- preserve the original as research evidence outside the deployable tree;
- record provider page, direct file URL, source label, creator when known,
  printed date, retrieved time, local filename, bytes, hash, rights status, and
  whether it is distributed;
- inspect the actual image or PDF rather than relying only on search snippets;
- cross-check name, address, phone, and hours visible in the document against
  the resolved restaurant;
- transcribe only text that is legible at the source resolution;
- keep ranges and conditional pricing as ranges/conditions; and
- retain ambiguity in `omissions` or `conflicts` rather than normalizing it
  away.

Menu text should be semantic HTML and useful without JavaScript. The source
photo is evidence, not a substitute for an accessible menu.

## Media and scene records

The base `MEDIA.json` remains canonical for actual media files. Each restaurant
asset additionally needs a role such as `exterior`, `interior`, `grill`,
`kitchen-hands`, `signature-dish`, `bar`, `wine`, `hospitality`, or
`architectural-detail`.

Authentic client/restaurant media may represent the business only when identity
and usage rights are approved. Stock and AI media must remain explicitly
conceptual and cannot establish menu offerings, premises, staff, food,
techniques, or results.

Scene data must keep purpose, chapter, media ID, layout, interaction, desktop
and mobile behavior, copy, fallback, preload priority, and approval status. Do
not make a renderer-specific field the only source of narrative intent.

## SEO and publication

Independent demos remain `noindex,nofollow,noarchive` in HTML and HTTP. Do not
publish Restaurant or LocalBusiness structured data on a concept preview in a
way that could make it appear official. Production SEO/schema is a later
approved handoff and may use only verified business fields.
