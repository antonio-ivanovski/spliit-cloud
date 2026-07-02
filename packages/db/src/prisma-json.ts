// External type definitions for `prisma-json-types-generator`.
//
// The Activity table stores its event `type`, `actorType`, `subjectType`,
// and `data` payload as code-defined strings/JSON. The schema marks these
// columns with `/// ![ActivityType]` / `/// [ActivityData]` comments and
// the generator expects a `PrismaJson` namespace (see docs at
// https://github.com/arthurfiorette/prisma-json-types-generator). To keep
// the source of truth in one place, every type here is imported from the
// matching Zod schema in `@spliit/domain/activities`, which is the same
// schema used to validate runtime writes and reads.
//
// This file must be a module (`export {}`) so the global declaration
// merges with the one Prisma Client expects internally.
//
// String vs JSON annotations:
//   - `/// ![ActivityType]` (with !) → generator emits bare (ActivityType)
//     references in model files — these need a global type alias.
//   - `/// [ActivityData]` (without !) → generator emits
//     PrismaJson.ActivityData references — these need the PrismaJson namespace.

import type {
  ActivityActorType as DomainActivityActorType,
  ActivityData as DomainActivityData,
  ActivitySubjectType as DomainActivitySubjectType,
  ActivityType as DomainActivityType,
} from '@spliit/domain/activities'

export {}

declare global {
  namespace PrismaJson {
    type ActivityType = DomainActivityType
    type ActivityActorType = DomainActivityActorType
    type ActivitySubjectType = DomainActivitySubjectType
    type ActivityData = DomainActivityData
  }

  // The generator emits bare (ActivityType) for string-annotated fields
  // (type, actorType, subjectType). These global aliases let the generated
  // model files resolve those references. The PrismaJson namespace entries
  // above handle JSON-annotated fields (data) and also serve as fallback
  // for any consumer that uses PrismaJson.ActivityType explicitly.
  type ActivityType = DomainActivityType
  type ActivityActorType = DomainActivityActorType
  type ActivitySubjectType = DomainActivitySubjectType
}
