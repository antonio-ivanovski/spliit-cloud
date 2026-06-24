-- Add 'DECLINED' value to GroupInvitationStatus so invitees can mark their
-- own invitation as declined from the pending-invitations UI.
ALTER TYPE "GroupInvitationStatus" ADD VALUE 'DECLINED';
