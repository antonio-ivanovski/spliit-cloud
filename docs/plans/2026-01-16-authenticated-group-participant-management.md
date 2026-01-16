# Authenticated Group Participant Management Design

## Overview

When creating authenticated groups, participants should NOT be manually entered by name. Instead, authenticated groups should only contain authenticated users who are invited and accept invitations. The creator is automatically added using their account name, not a manually entered participant name.

## Problem

Currently, the group creation form allows manual entry of participant names for all groups. For authenticated groups (synced across devices), this is inconsistent with the authentication model:
- Manual name entries don't represent actual authenticated users
- Invited users should use their registered account names, not arbitrary text
- Mixed manual + authenticated participants creates confusion

## Solution

### Differentiated Form Behavior

**For Authenticated Groups (`isAuthenticated={true}`):**
- Participants section displays as read-only
- Shows only the creator's name (from `session.user.name`)
- "Add Participant" button is hidden
- Users cannot manually add participants
- Participants are added only via "Invite Members" (existing feature using invite links)

**For Device Groups (`isAuthenticated={false}`):**
- Participants section remains fully editable
- Users can add/remove participants manually by name
- "Add Participant" button is visible
- No changes to current behavior

### Component Changes

#### GroupForm Component
**New Prop:**
```typescript
isAuthenticated?: boolean  // Optional, defaults to false
```

**Conditional Rendering:**
- When `isAuthenticated={true}`:
  - Render participants as disabled input fields (read-only UI)
  - Hide the "Add Participant" button
  - Show only creator as initial participant

**Initial Participants:**
- For authenticated groups: Creator's name from `session.user.name`
- For device groups: Default placeholder participants (current behavior)

#### Create Group Page
Pass `isAuthenticated` flag to GroupForm:
```typescript
<GroupForm isAuthenticated={shouldCreateAuthenticated} />
```

This flag is already determined in CreateGroup component.

### Data Flow

1. **CreateGroup component** determines `shouldCreateAuthenticated` from session + query param
2. **CreateGroup passes** `isAuthenticated={shouldCreateAuthenticated}` to `GroupForm`
3. **GroupForm renders**:
   - Authenticated: Read-only creator participant, no add button
   - Device: Current editable behavior
4. **Form submission** sends `participants: [{ name: creatorName }]` for authenticated groups
5. **Create procedure** already handles linking creator to group via `userId`
6. **Post-creation**: Users access group → settings → "Invite Members" to invite others

### User Experience Flow

1. User clicks "Create" on "Authenticated Groups" section
2. Form shows: Group name, currency, info fields + read-only creator as participant
3. User submits form
4. Group is created with user as only participant
5. User is redirected to group page
6. User can click "Invite Members" button to invite others via invite links
7. Invited users join, and their authenticated account name appears as a participant

### Benefits

- **Consistency**: Authenticated groups only contain real authenticated users
- **Clarity**: No confusion between manual names and actual user accounts
- **Security**: Participants are verified via authentication + invitation flow
- **Simplicity**: Users can't accidentally create malformed participant lists
- **Future-proof**: Supports email invites (when adding mail integration)

### Testing Considerations

- [ ] Authenticated group creation shows read-only creator participant
- [ ] "Add Participant" button hidden for authenticated groups
- [ ] Device groups still allow manual participant entry
- [ ] Form submission works correctly for both types
- [ ] Creator is properly linked in database (already tested previously)
- [ ] Invite Members button works to add more participants

## Implementation Order

1. Update GroupForm to accept `isAuthenticated` prop
2. Update CreateGroup to pass the prop
3. Verify both creation paths work correctly
4. Test invite flow works after creation
