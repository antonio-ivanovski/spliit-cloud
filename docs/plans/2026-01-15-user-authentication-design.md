# User Authentication & Multi-Device Group Management Design

**Date:** 2026-01-15  
**Status:** Approved  
**Scope:** Add user authentication with social login (Google/GitHub) and email sign-in, enabling authenticated groups that sync across devices while maintaining anonymous device-local groups.

---

## Overview

Currently, Spliit is a completely anonymous, device-local expense-splitting app. This design introduces:

1. **User authentication** via social login (Google/GitHub) and email sign-in
2. **Authenticated groups** - Synced across all devices where a user is logged in
3. **Device-local groups** - Continue to work as they do now (localStorage-based, anonymous)
4. **Join links** - Single-use per user, allowing owners to invite specific people to authenticated groups
5. **Equal membership** - No owner concept; all group members are equal. Groups persist if a member deletes their account.

---

## Data Model & Architecture

### New Database Tables

**`User`**
- `id` (String, primary key)
- `email` (String, unique)
- `displayName` (String) - Used across all groups this user joins
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

**`AuthProvider`**
- `id` (String, primary key)
- `userId` (String, foreign key to User)
- `provider` (Enum: GOOGLE, GITHUB, EMAIL)
- `providerUserId` (String) - OAuth provider's user ID
- `email` (String)
- `createdAt` (DateTime)

**`UserGroup`**
- `userId` (String, foreign key to User)
- `groupId` (String, foreign key to Group)
- `joinedAt` (DateTime)
- Primary key: (userId, groupId)

**`UserSession`**
- `id` (String, primary key)
- `userId` (String, foreign key to User)
- `sessionToken` (String, unique)
- `lastActiveAt` (DateTime)
- `expiresAt` (DateTime)

### Modified Tables

**`Participant`** - Add optional field:
- `userId` (String, nullable, foreign key to User) - Links participant to authenticated user

### Key Design Decisions

- **NextAuth.js 5** - Use for OAuth and session management (httpOnly cookies, secure defaults)
- **Clean break** - Anonymous groups remain device-local only. Authenticated groups are database-backed.
- **No ownership** - Every member in an authenticated group has equal rights. Deleting a user removes them from groups but doesn't affect the group itself.
- **Backward compatible** - Anonymous groups continue to work exactly as before.

---

## Authentication & Sign-up Flow

### Sign-up/Login Flow

**First-time user:**
1. User clicks "Sign In"
2. User chooses: "Continue with Google" / "Continue with GitHub" / "Sign in with email"
3. For social: OAuth flow completes, user redirected back
4. For email: User enters email, receives sign-in link, clicks link in email
5. System creates `User` record with email + displayName
6. User is redirected to app home or dashboard

**Existing user, new device:**
1. User clicks "Sign In", chooses same provider
2. NextAuth.js verifies identity
3. User is logged in and can navigate to groups page
4. When visiting groups page, authenticated groups are fetched from database

**Logout:**
- User clicks sign out
- Session is revoked and cleared from database
- User returns to home page

### Groups Page Display

When user visits `/groups`:

**Authenticated users see:**
- **Your Groups (Authenticated)** section
  - Groups fetched from `UserGroup` table
  - Synced across all devices
  - Can be created or joined via invite links
- **Device Groups** section
  - Groups stored in localStorage on this device
  - Can be created on the fly (anonymous, device-local)
  - Remain local even if user is authenticated

**Anonymous users see:**
- **Device Groups** section only
- Can create anonymous groups as before
- No sync to other devices

### Group Creation

**Authenticated groups:**
- User creates group while logged in
- Automatically added to `UserGroup` for that group
- Group is in database, visible on all devices where user logs in
- User becomes a `Participant` in the group with their display name

**Device-local groups:**
- User can create these whether logged in or not
- Stored in localStorage only
- Not synced across devices

### Group Joining (Authenticated)

1. Group member generates a single-use invite link
2. Link encodes: groupId + targetUserId + expiration
3. User who receives link clicks it or enters code manually
4. System validates:
   - Link hasn't expired (24 hours)
   - Link hasn't been used by this user before
   - Target user matches current logged-in user
5. If valid, system:
   - Creates `UserGroup` entry (userId, groupId)
   - Automatically creates `Participant` entry with user's displayName
   - Marks link as used for this user
6. User is now in group, can see it on all devices

### Session Management

- NextAuth.js stores session in httpOnly cookie (secure, not accessible to JavaScript)
- Session token stored in `UserSession` table
- Session expires after 30 days of inactivity (configurable)
- User can manually sign out, which revokes session immediately

---

## Navigation & Routing

**New routes:**
- `/auth/signin` - Sign in page (social + email options)
- `/auth/callback` - OAuth callback handler
- `/auth/signout` - Sign out confirmation
- `/groups` - Groups page (shows authenticated + device groups)

**Modified routes:**
- `/groups/[groupId]/...` - Check if user has access before allowing
- Existing routes work the same way

---

## Error Handling & Edge Cases

### Authentication Errors

| Scenario | Message |
|----------|---------|
| Invalid/expired email link | "Link expired or invalid. Request a new sign-in link." |
| OAuth provider error | "Sign-in failed. Try another method or contact support." |
| Session expired | "Your session expired. Please sign in again." |
| User cancels OAuth | "Sign-in cancelled." |

### Group Access & Joining Errors

| Scenario | Message |
|----------|---------|
| Invalid/expired invite link | "This invite link is no longer valid or has expired." |
| User already in group | "You're already a member of this group." |
| Link already used by user | "You've already joined this group using this invite link." |
| Group not found | "The group doesn't exist or you don't have access." |

### Data Sync Issues

- **Missing participant:** If user in `UserGroup` but not `Participant`, auto-create participant with user's displayName
- **Session mismatch:** If cookie invalid, clear it and force re-auth
- **Account deletion:** Remove `User` and `UserGroup` entries. Group persists with remaining members.

---

## Manual Testing Checklist

### Authentication
- [ ] Google sign-in flow works
- [ ] GitHub sign-in flow works
- [ ] Email sign-in flow works
- [ ] Session persists across page reloads
- [ ] Session persists after browser close
- [ ] Signing out clears session
- [ ] Invalid/expired email links are rejected

### Group Synchronization
- [ ] User logs in on device A
- [ ] User joins authenticated group on device A
- [ ] User logs in on device B with same account
- [ ] Group appears automatically on device B
- [ ] User logs out on device A
- [ ] Group still visible on device B
- [ ] Device groups stay local only

### Invite Links
- [ ] Owner generates invite link
- [ ] Different user can use link to join group
- [ ] Same user cannot reuse link (already joined)
- [ ] Expired links are rejected
- [ ] Invalid codes are rejected

### Backward Compatibility
- [ ] Anonymous device groups still work
- [ ] Authenticated users can create device groups
- [ ] Mix of authenticated + device groups on same device

### Account Deletion
- [ ] User deletes account
- [ ] User removed from all groups
- [ ] Remaining group members can still access group
- [ ] Group data is intact

---

## Implementation Strategy

This design will be implemented in phases:

1. **Phase 1: NextAuth.js Setup** - Configure social + email auth
2. **Phase 2: Database Schema** - Add User, AuthProvider, UserGroup, UserSession tables
3. **Phase 3: Auth UI & Flow** - Sign-in page, session management, user menu
4. **Phase 4: Group Synchronization** - Fetch authenticated groups, display on groups page
5. **Phase 5: Invite Links** - Generate, validate, and handle join links
6. **Phase 6: Testing & Refinement** - Manual testing, edge case handling

Each phase is independent and can be deployed separately without breaking existing functionality.

---

## Assumptions & Future Considerations

- **No ownership roles** - All members are equal for now. Role-based permissions can be added later if needed.
- **No group invitations UI** - Will build invite link generation in a simple admin modal initially. Could evolve to invite-specific users by email later.
- **Display name immutable** - Users keep their sign-up display name across groups for now. Per-group nicknames could be added later.
- **Single sign-out** - Session tied to device. Multi-device sign-out would require checking all devices.
