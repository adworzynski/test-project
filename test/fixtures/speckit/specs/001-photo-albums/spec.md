# Feature Specification: Photo Albums

**Feature Branch**: `001-photo-albums`
**Created**: 2026-09-01
**Status**: Approved
**Input**: User description: "Organize photos into albums by date"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an album (Priority: P1)

A user groups photos into a named album.

**Why this priority**: Albums are the core value.

**Independent Test**: Create an album and see it in the list.

**Acceptance Scenarios**:

1. **Given** no albums exist, **When** the user creates "Summer", **Then** "Summer" appears in the album list
2. **Given** an album "Summer", **When** the user creates another "Summer", **Then** an error says the name is taken

---

### User Story 2 - Reorder albums (Priority: P2)

A user drags albums to reorder them.

**Acceptance Scenarios**:

1. **Given** albums A and B, **When** the user drags B above A, **Then** B is listed first

### Edge Cases

- What happens with 1,000 albums?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to create named albums
- **FR-002**: System MUST reject duplicate album names
- **FR-003**: Users MUST be able to reorder albums by drag and drop

## Success Criteria *(mandatory)*

- **SC-001**: Users create an album in under 30 seconds
