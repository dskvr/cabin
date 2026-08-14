# Requirements: Captain's Cabin

**Defined:** 2026-08-14
**Core Value:** Each captain can tailor and publish their week without requiring code changes, while participants retain Nostr-native identity and interaction.

## v1 Requirements

### Week Configuration

- [x] **WEEK-01**: Captain can create a week from editable Tuesday-talk and Wednesday-workshop templates
- [x] **WEEK-02**: Captain can add, remove, rename, and reorder activities within a week
- [x] **WEEK-03**: Captain can set each activity's date, time, location, and link, with all v1 scheduling interpreted in `Atlantic/Madeira`
- [x] **WEEK-04**: Captain can set the week's theme and public descriptive information

### Demo Day Timing

- [x] **TIME-01**: A newly created Demo Day defaults to 6 minutes of presentation time and 2 minutes of question time
- [x] **TIME-02**: Captain can override presentation and question durations for a week, including a 60-second presentation with 2 minutes of questions

### Intake Configuration

- [x] **FORM-01**: Captain can add, remove, and rename fields in the standard proposal form
- [x] **FORM-02**: Captain can mark proposal fields required or optional, and required fields are validated before submission
- [x] **FORM-03**: Existing proposal answers remain associated with the correct field when a captain renames or reorders the form

### Participant Proposals

- [ ] **PROP-01**: A whitelisted participant can submit a proposal for the active week
- [ ] **PROP-02**: A participant can amend their own proposal while intake remains open

### Access Control

- [ ] **ACES-01**: A Nostr identity not present on the participant whitelist cannot submit or amend a proposal
- [x] **ACES-02**: Only the designated captain can configure a week, customize intake, review proposals, assemble or publish a schedule, archive a week, or clone configuration
- [x] **ACES-03**: Participant and captain actions are accepted only when signed by the corresponding authorized Nostr identity

### Proposal Privacy

- [ ] **PRIV-01**: Proposal content is encrypted for delivery through Nostr so only the designated captain can read it
- [ ] **PRIV-02**: Proposal fields, rejected proposals, and non-public participant details do not appear in public event content or tags

### Scheduling

- [ ] **SCHD-01**: Captain can privately review decrypted proposals and mark them accepted or rejected
- [ ] **SCHD-02**: Captain can manually place an accepted proposal into an activity and time slot
- [ ] **SCHD-03**: Captain is warned about overlapping sessions, duplicate placements, and placements outside an activity's configured bounds
- [ ] **SCHD-04**: The working schedule remains a private draft until the captain explicitly publishes it

### Publication

- [ ] **PUBL-01**: Captain can explicitly publish a finalized schedule that anyone can view without whitelist access
- [ ] **PUBL-02**: The public schedule contains only approved presenter, session, and activity fields selected for publication

### Week Lifecycle

- [ ] **LIFE-01**: A completed week is available as a read-only archive
- [ ] **LIFE-02**: Captain can clone the configuration of any previous week into a new week with fresh identifiers
- [ ] **LIFE-03**: Cloning a week does not copy participant proposals, participant details, placement decisions, or publication state

## v2 Requirements

### Participant Availability

- **AVAL-01**: Whitelisted participant can submit and amend availability for a week
- **AVAL-02**: Captain receives participant-availability warnings while scheduling

### Publication History

- **HIST-01**: Published schedule revisions retain explicit correction and history references

### Event Operations

- **OPER-01**: Captain can use additional live moderation and session-operator controls beyond the existing Demo Day timer
- **OPER-02**: Participants can receive event reminders
- **OPER-03**: Captain can track attendance
- **OPER-04**: Participants can submit post-event feedback

### Advanced Intake

- **FORM-04**: Captain can use additional field types, validation rules, and conditional form logic

## Out of Scope

| Feature | Reason |
|---------|--------|
| Fully arbitrary event builder | Tuesday-talk and Wednesday-workshop templates provide deliberate structure for the first product |
| Captain-selectable timezones | v1 consistently uses `Atlantic/Madeira` |
| Automated schedule generation | Captain-controlled manual placement is the intended first workflow |
| Ordinary public Nostr events for proposal content | Relay-visible payloads cannot satisfy the captain-only privacy requirement |
| Cloning participant or proposal data | A cloned week must begin with a clean participant context |
| Ticketing, payments, and CRM | Not part of sovereignengineering.io week scheduling or participant intake |

## Traceability

Roadmap phases are assigned during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WEEK-01 | Phase 1 | Complete |
| WEEK-02 | Phase 1 | Complete |
| WEEK-03 | Phase 1 | Complete |
| WEEK-04 | Phase 1 | Complete |
| TIME-01 | Phase 1 | Complete |
| TIME-02 | Phase 1 | Complete |
| FORM-01 | Phase 1 | Complete |
| FORM-02 | Phase 1 | Complete |
| FORM-03 | Phase 1 | Complete |
| PROP-01 | Phase 2 | Pending |
| PROP-02 | Phase 2 | Pending |
| ACES-01 | Phase 2 | Pending |
| ACES-02 | Phase 1 | Complete |
| ACES-03 | Phase 1 | Complete |
| PRIV-01 | Phase 2 | Pending |
| PRIV-02 | Phase 2 | Pending |
| SCHD-01 | Phase 3 | Pending |
| SCHD-02 | Phase 3 | Pending |
| SCHD-03 | Phase 3 | Pending |
| SCHD-04 | Phase 3 | Pending |
| PUBL-01 | Phase 3 | Pending |
| PUBL-02 | Phase 3 | Pending |
| LIFE-01 | Phase 4 | Pending |
| LIFE-02 | Phase 4 | Pending |
| LIFE-03 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-08-14*
*Last updated: 2026-08-14 after initial roadmap traceability*
