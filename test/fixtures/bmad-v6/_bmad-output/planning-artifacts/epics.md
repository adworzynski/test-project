# Pantry Pal - Epic Breakdown

## FR Coverage Map

FR1: Epic 1 - Pantry items
FR2: Epic 1 - Pantry items
FR3: Epic 2 - Reminders
FR4: Epic 1 - Pantry items

## Epic 1: Pantry items
Users can keep a list of what they have.

### Story 1.1: Add an item

As a parent,
I want to add an item with its expiry date,
So that I know what I have.

**Acceptance Criteria:**

**Given** the pantry list is open
**When** I add "Milk" expiring tomorrow
**Then** "Milk" appears in the list with its expiry date

**Given** the add form
**When** I leave the name empty
**Then** I see "Name is required"

### Story 1.2: Scan a barcode

As a parent,
I want to scan a barcode,
So that I don't type item names.

**Acceptance Criteria:**

**Given** the camera permission is granted
**When** I scan a known barcode
**Then** the item name is prefilled

## Epic 2: Reminders

### Story 2.1: Expiry reminders

As a parent,
I want a reminder before food expires,
So that I can use it in time.

**Acceptance Criteria:**

**Given** an item expiring in two days
**When** the daily check runs at 9:00
**Then** I receive a notification naming the item
