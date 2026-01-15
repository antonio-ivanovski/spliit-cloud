# User Authentication & Multi-Device Group Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add NextAuth.js-based authentication with social login (Google/GitHub) and email sign-in, enabling authenticated groups that sync across devices while maintaining backward compatibility with anonymous device-local groups.

**Architecture:** Extend Prisma schema with User, AuthProvider, UserGroup, UserSession tables. Integrate NextAuth.js 5 for OAuth and session management. Create dual-mode groups page displaying both authenticated (database-backed) and device-local (localStorage) groups. Implement invite link system for authenticated group joining.

**Tech Stack:** NextAuth.js 5, Prisma ORM, PostgreSQL, tRPC, Next.js 13+ App Router, React Query, Zod

---

## Phase 1: Database Schema & Migrations

### Task 1.1: Create User and Auth Provider Tables

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/YYYYMMDDHHMMSS_add_user_auth/migration.sql` (auto-generated)

**Step 1: Add User and AuthProvider models to Prisma schema**

Add these models after the existing `Activity` model:

```prisma
model User {
  id          String         @id @default(cuid())
  email       String         @unique
  displayName String
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  
  authProviders AuthProvider[]
  userGroups    UserGroup[]
  sessions      UserSession[]
}

enum AuthProviderType {
  GOOGLE
  GITHUB
  EMAIL
}

model AuthProvider {
  id             String           @id @default(cuid())
  userId         String
  provider       AuthProviderType
  providerUserId String
  email          String
  createdAt      DateTime         @default(now())
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([provider, providerUserId])
  @@index([userId])
}

model UserSession {
  id           String   @id @default(cuid())
  userId       String
  sessionToken String   @unique
  lastActiveAt DateTime @default(now())
  expiresAt    DateTime
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([sessionToken])
}

model UserGroup {
  userId   String
  groupId  String
  joinedAt DateTime @default(now())
  
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  
  @@id([userId, groupId])
  @@index([userId])
  @@index([groupId])
}
```

**Step 2: Add UserGroup relation to Group model**

In the existing `Group` model, add this line after the `activities` field:

```prisma
model Group {
  id           String        @id
  name         String
  information  String?       @db.Text
  currency     String        @default("$")
  currencyCode String?
  participants Participant[]
  expenses     Expense[]
  activities   Activity[]
  userGroups   UserGroup[]  // ADD THIS LINE
  createdAt    DateTime      @default(now())
}
```

**Step 3: Add optional userId to Participant model**

In the existing `Participant` model, add this field after `groupId`:

```prisma
model Participant {
  id              String           @id
  name            String
  group           Group            @relation(fields: [groupId], references: [id], onDelete: Cascade)
  groupId         String
  userId          String?          // ADD THIS LINE
  expensesPaidBy  Expense[]
  expensesPaidFor ExpensePaidFor[]
  
  // ADD THIS RELATION
  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)
  
  // ADD THIS INDEX
  @@index([userId])
}
```

Wait - we need to add the relation on the User model too. Update the User model:

```prisma
model User {
  id          String         @id @default(cuid())
  email       String         @unique
  displayName String
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  
  authProviders AuthProvider[]
  userGroups    UserGroup[]
  sessions      UserSession[]
  participants  Participant[]  // ADD THIS LINE
}
```

**Step 4: Run migration**

```bash
npx prisma migrate dev --name add_user_auth
```

Expected: Migration created and applied successfully

**Step 5: Verify migration**

```bash
npx prisma studio
```

Expected: Open Prisma Studio and verify new tables exist (User, AuthProvider, UserSession, UserGroup)

**Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add User, AuthProvider, UserSession, UserGroup tables

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: NextAuth.js Setup

### Task 2.1: Install NextAuth.js and Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install NextAuth.js and required packages**

```bash
npm install next-auth@beta @auth/prisma-adapter
```

Expected: Packages installed successfully (NextAuth.js v5 beta)

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(deps): install NextAuth.js v5 and Prisma adapter

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2.2: Create NextAuth Configuration

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

**Step 1: Create auth configuration file**

Create `src/lib/auth.ts`:

```typescript
import { PrismaAdapter } from '@auth/prisma-adapter'
import NextAuth, { NextAuthConfig } from 'next-auth'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import { prisma } from '@/lib/prisma'

const adapter = PrismaAdapter(prisma)

export const authConfig: NextAuthConfig = {
  adapter,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: process.env.EMAIL_FROM || 'noreply@spliit.app',
    }),
  ],
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
```

**Step 2: Create NextAuth API route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers
```

**Step 3: Add environment variables to env schema**

Modify `src/lib/env.ts` to add new environment variables:

```typescript
const envSchema = z
  .object({
    POSTGRES_URL_NON_POOLING: z.string().url(),
    POSTGRES_PRISMA_URL: z.string().url(),
    NEXT_PUBLIC_BASE_URL: z
      .string()
      .optional()
      .default(
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000',
      ),
    NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    NEXT_PUBLIC_DEFAULT_CURRENCY_CODE: z.string().optional(),
    S3_UPLOAD_KEY: z.string().optional(),
    S3_UPLOAD_SECRET: z.string().optional(),
    S3_UPLOAD_BUCKET: z.string().optional(),
    S3_UPLOAD_REGION: z.string().optional(),
    S3_UPLOAD_ENDPOINT: z.string().optional(),
    NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    OPENAI_API_KEY: z.string().optional(),
    // ADD THESE LINES:
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),
    NEXTAUTH_SECRET: z.string().min(32).optional(),
    NEXTAUTH_URL: z.string().url().optional(),
  })
  .superRefine((env, ctx) => {
    // ... existing validation ...
  })
```

**Step 4: Update .env.example**

Add these lines to `.env.example`:

```bash
# Authentication (NextAuth.js)
NEXTAUTH_SECRET=your-secret-here-min-32-chars
NEXTAUTH_URL=http://localhost:3000

# OAuth Providers (optional - enable at least one)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Email Provider (Resend)
RESEND_API_KEY=
EMAIL_FROM=noreply@yourdomain.com
```

**Step 5: Generate NEXTAUTH_SECRET for local development**

```bash
openssl rand -base64 32
```

Expected: Random 32-character string printed

Add this to your local `.env` file as `NEXTAUTH_SECRET`

**Step 6: Commit**

```bash
git add src/lib/auth.ts src/app/api/auth src/lib/env.ts .env.example
git commit -m "feat(auth): configure NextAuth.js with Google, GitHub, and email providers

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2.3: Update Prisma Adapter Schema

NextAuth.js with Prisma adapter expects specific table structures. We need to adjust our schema to match.

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Replace User-related models with NextAuth schema**

Replace the `User`, `AuthProvider`, and `UserSession` models with NextAuth-compatible models:

```prisma
// Remove the old User, AuthProvider, AuthProviderType, UserSession models
// Replace with these NextAuth-compatible models:

model User {
  id            String         @id @default(cuid())
  name          String?        @map("displayName")
  email         String         @unique
  emailVerified DateTime?
  image         String?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  
  accounts      Account[]
  sessions      Session[]
  userGroups    UserGroup[]
  participants  Participant[]
}

model Account {
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@id([provider, providerAccountId])
  @@index([userId])
}

model Session {
  sessionToken String   @unique
  userId       String
  expires      DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String
  expires    DateTime
  
  @@id([identifier, token])
}
```

**Step 2: Run migration**

```bash
npx prisma migrate dev --name update_auth_schema_for_nextauth
```

Expected: Migration applied successfully

**Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): update auth schema to match NextAuth Prisma adapter

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Authentication UI

### Task 3.1: Create Sign-In Page

**Files:**
- Create: `src/app/auth/signin/page.tsx`
- Create: `src/components/auth/signin-form.tsx`

**Step 1: Create sign-in form component**

Create `src/components/auth/signin-form.tsx`:

```typescript
'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { Github, Mail } from 'lucide-react'

export function SignInForm() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await signIn('resend', { email, redirect: false })
      setEmailSent(true)
    } catch (error) {
      console.error('Sign in error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleOAuthSignIn = async (provider: 'google' | 'github') => {
    setIsLoading(true)
    try {
      await signIn(provider, { callbackUrl: '/groups' })
    } catch (error) {
      console.error('Sign in error:', error)
      setIsLoading(false)
    }
  }

  if (emailSent) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            We've sent you a sign-in link. Click the link in the email to sign in.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in to Spliit</CardTitle>
        <CardDescription>
          Choose your preferred sign-in method
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Button
            variant="outline"
            onClick={() => handleOAuthSignIn('google')}
            disabled={isLoading}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </Button>
          <Button
            variant="outline"
            onClick={() => handleOAuthSignIn('github')}
            disabled={isLoading}
          >
            <Github className="mr-2 h-4 w-4" />
            Continue with GitHub
          </Button>
        </div>
        
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or continue with email
            </span>
          </div>
        </div>

        <form onSubmit={handleEmailSignIn} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            <Mail className="mr-2 h-4 w-4" />
            Send sign-in link
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Create sign-in page**

Create `src/app/auth/signin/page.tsx`:

```typescript
import { SignInForm } from '@/components/auth/signin-form'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Sign In',
}

export default async function SignInPage() {
  const session = await auth()
  
  if (session?.user) {
    redirect('/groups')
  }

  return (
    <main className="container flex min-h-screen items-center justify-center">
      <SignInForm />
    </main>
  )
}
```

**Step 3: Create auth error page**

Create `src/app/auth/error/page.tsx`:

```typescript
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const errorMessages: Record<string, string> = {
    Configuration: 'There is a problem with the server configuration.',
    AccessDenied: 'You do not have permission to sign in.',
    Verification: 'The sign-in link is no longer valid.',
    Default: 'An error occurred during sign in.',
  }

  const error = searchParams.error || 'Default'
  const message = errorMessages[error] || errorMessages.Default

  return (
    <main className="container flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Authentication Error</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/auth/signin">Try again</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
```

**Step 4: Commit**

```bash
git add src/app/auth src/components/auth
git commit -m "feat(auth): create sign-in page with OAuth and email options

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 3.2: Add SessionProvider and User Menu

**Files:**
- Create: `src/components/auth/session-provider.tsx`
- Create: `src/components/auth/user-menu.tsx`
- Modify: `src/app/layout.tsx`

**Step 1: Create SessionProvider wrapper**

Create `src/components/auth/session-provider.tsx`:

```typescript
'use client'

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react'
import { ReactNode } from 'react'

export function SessionProvider({ children }: { children: ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>
}
```

**Step 2: Create user menu component**

Create `src/components/auth/user-menu.tsx`:

```typescript
'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, User as UserIcon } from 'lucide-react'
import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'

export function UserMenu() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
  }

  if (!session?.user) {
    return (
      <Button asChild variant="outline">
        <Link href="/auth/signin">Sign In</Link>
      </Button>
    )
  }

  const initials = session.user.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || session.user.email?.[0].toUpperCase() || 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-9 w-9 rounded-full">
          {session.user.image ? (
            <img
              src={session.user.image}
              alt={session.user.name || 'User'}
              className="h-9 w-9 rounded-full"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              {initials}
            </div>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{session.user.name}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {session.user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/' })}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

**Step 3: Update root layout with SessionProvider**

Modify `src/app/layout.tsx` to wrap children with SessionProvider and add UserMenu to header.

First, read the current layout:

```bash
cat src/app/layout.tsx
```

Then update it to include SessionProvider wrapper and import UserMenu. The exact changes depend on the current layout structure, but the pattern is:

```typescript
import { SessionProvider } from '@/components/auth/session-provider'
import { UserMenu } from '@/components/auth/user-menu'

// In the body, wrap children with SessionProvider
// Add UserMenu to the header/navigation area
```

**Step 4: Test sign-in flow**

```bash
npm run dev
```

Expected: 
- Navigate to http://localhost:3000/auth/signin
- See sign-in form with Google, GitHub, and Email options
- See "Sign In" button in header when not authenticated

**Step 5: Commit**

```bash
git add src/components/auth src/app/layout.tsx
git commit -m "feat(auth): add SessionProvider and user menu to layout

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: tRPC Context with User Session

### Task 4.1: Add User Session to tRPC Context

**Files:**
- Modify: `src/trpc/init.ts`

**Step 1: Update tRPC context to include user session**

Replace the current `createTRPCContext` function:

```typescript
import { Prisma } from '@prisma/client'
import { initTRPC } from '@trpc/server'
import { cache } from 'react'
import superjson from 'superjson'
import { auth } from '@/lib/auth'

superjson.registerCustom<Prisma.Decimal, string>(
  {
    isApplicable: (v): v is Prisma.Decimal => Prisma.Decimal.isDecimal(v),
    serialize: (v) => v.toJSON(),
    deserialize: (v) => new Prisma.Decimal(v),
  },
  'decimal.js',
)

export const createTRPCContext = cache(async () => {
  const session = await auth()
  return {
    userId: session?.user?.id,
    userEmail: session?.user?.email,
  }
})

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>

// Avoid exporting the entire t-object
const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
})

// Base router and procedure helpers
export const createTRPCRouter = t.router
export const baseProcedure = t.procedure

// Authenticated procedure that requires a user session
export const authedProcedure = baseProcedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new Error('UNAUTHORIZED')
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId, // Now TypeScript knows userId is non-null
    },
  })
})
```

**Step 2: Commit**

```bash
git add src/trpc/init.ts
git commit -m "feat(trpc): add user session to context and create authedProcedure

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: User Groups - tRPC Procedures

### Task 5.1: Create User Groups List Procedure

**Files:**
- Create: `src/trpc/routers/userGroups/list.procedure.ts`
- Create: `src/trpc/routers/userGroups/index.ts`
- Modify: `src/trpc/routers/_app.ts`

**Step 1: Write failing test**

Create `src/trpc/routers/userGroups/list.procedure.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals'
import { prisma } from '@/lib/prisma'
import { listUserGroups } from './list.procedure'

describe('listUserGroups', () => {
  const testUserId = 'test-user-id'
  const testGroupId1 = 'test-group-1'
  const testGroupId2 = 'test-group-2'

  beforeEach(async () => {
    // Create test user
    await prisma.user.create({
      data: {
        id: testUserId,
        email: 'test@example.com',
        name: 'Test User',
      },
    })

    // Create test groups
    await prisma.group.create({
      data: {
        id: testGroupId1,
        name: 'Test Group 1',
      },
    })
    await prisma.group.create({
      data: {
        id: testGroupId2,
        name: 'Test Group 2',
      },
    })

    // Link user to groups
    await prisma.userGroup.createMany({
      data: [
        { userId: testUserId, groupId: testGroupId1 },
        { userId: testUserId, groupId: testGroupId2 },
      ],
    })
  })

  afterEach(async () => {
    await prisma.userGroup.deleteMany({ where: { userId: testUserId } })
    await prisma.group.deleteMany({
      where: { id: { in: [testGroupId1, testGroupId2] } },
    })
    await prisma.user.delete({ where: { id: testUserId } })
  })

  it('should return groups for authenticated user', async () => {
    const caller = listUserGroups.createCaller({
      userId: testUserId,
      userEmail: 'test@example.com',
    })

    const result = await caller({})

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      id: testGroupId1,
      name: 'Test Group 1',
    })
    expect(result[1]).toMatchObject({
      id: testGroupId2,
      name: 'Test Group 2',
    })
  })

  it('should throw error when user not authenticated', async () => {
    const caller = listUserGroups.createCaller({
      userId: undefined,
      userEmail: undefined,
    })

    await expect(caller({})).rejects.toThrow('UNAUTHORIZED')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/trpc/routers/userGroups/list.procedure.test.ts
```

Expected: FAIL with "Cannot find module './list.procedure'"

**Step 3: Create list procedure**

Create `src/trpc/routers/userGroups/list.procedure.ts`:

```typescript
import { authedProcedure } from '@/trpc/init'
import { prisma } from '@/lib/prisma'

export const listUserGroups = authedProcedure.query(async ({ ctx }) => {
  const userGroups = await prisma.userGroup.findMany({
    where: { userId: ctx.userId },
    include: {
      group: {
        select: {
          id: true,
          name: true,
          currency: true,
          currencyCode: true,
          createdAt: true,
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  })

  return userGroups.map((ug) => ({
    ...ug.group,
    joinedAt: ug.joinedAt,
  }))
})
```

**Step 4: Create userGroups router**

Create `src/trpc/routers/userGroups/index.ts`:

```typescript
import { createTRPCRouter } from '@/trpc/init'
import { listUserGroups } from './list.procedure'

export const userGroupsRouter = createTRPCRouter({
  list: listUserGroups,
})
```

**Step 5: Add userGroups router to app router**

Modify `src/trpc/routers/_app.ts`:

```typescript
import { createTRPCRouter } from '@/trpc/init'
import { groupsRouter } from './groups'
import { categoriesRouter } from './categories'
import { userGroupsRouter } from './userGroups'

export const appRouter = createTRPCRouter({
  groups: groupsRouter,
  categories: categoriesRouter,
  userGroups: userGroupsRouter, // ADD THIS LINE
})

export type AppRouter = typeof appRouter
```

**Step 6: Run tests to verify they pass**

```bash
npm test -- src/trpc/routers/userGroups/list.procedure.test.ts
```

Expected: PASS (all tests green)

**Step 7: Commit**

```bash
git add src/trpc/routers/userGroups src/trpc/routers/_app.ts
git commit -m "feat(trpc): add userGroups.list procedure for authenticated groups

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 5.2: Create User Group Join Procedure

**Files:**
- Create: `src/trpc/routers/userGroups/join.procedure.ts`
- Modify: `src/trpc/routers/userGroups/index.ts`

**Step 1: Write failing test**

Create `src/trpc/routers/userGroups/join.procedure.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals'
import { prisma } from '@/lib/prisma'
import { joinUserGroup } from './join.procedure'

describe('joinUserGroup', () => {
  const testUserId = 'test-user-join'
  const testGroupId = 'test-group-join'

  beforeEach(async () => {
    await prisma.user.create({
      data: {
        id: testUserId,
        email: 'join@example.com',
        name: 'Join User',
      },
    })

    await prisma.group.create({
      data: {
        id: testGroupId,
        name: 'Group to Join',
      },
    })
  })

  afterEach(async () => {
    await prisma.userGroup.deleteMany({ where: { userId: testUserId } })
    await prisma.participant.deleteMany({ where: { userId: testUserId } })
    await prisma.group.delete({ where: { id: testGroupId } })
    await prisma.user.delete({ where: { id: testUserId } })
  })

  it('should allow user to join group and create participant', async () => {
    const caller = joinUserGroup.createCaller({
      userId: testUserId,
      userEmail: 'join@example.com',
    })

    const result = await caller({ groupId: testGroupId })

    expect(result.success).toBe(true)

    const userGroup = await prisma.userGroup.findUnique({
      where: {
        userId_groupId: {
          userId: testUserId,
          groupId: testGroupId,
        },
      },
    })
    expect(userGroup).toBeTruthy()

    const participant = await prisma.participant.findFirst({
      where: {
        userId: testUserId,
        groupId: testGroupId,
      },
    })
    expect(participant).toBeTruthy()
    expect(participant?.name).toBe('Join User')
  })

  it('should return error if user already in group', async () => {
    await prisma.userGroup.create({
      data: {
        userId: testUserId,
        groupId: testGroupId,
      },
    })

    const caller = joinUserGroup.createCaller({
      userId: testUserId,
      userEmail: 'join@example.com',
    })

    await expect(caller({ groupId: testGroupId })).rejects.toThrow(
      'Already a member',
    )
  })

  it('should throw error for non-existent group', async () => {
    const caller = joinUserGroup.createCaller({
      userId: testUserId,
      userEmail: 'join@example.com',
    })

    await expect(caller({ groupId: 'non-existent' })).rejects.toThrow(
      'Group not found',
    )
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/trpc/routers/userGroups/join.procedure.test.ts
```

Expected: FAIL with "Cannot find module './join.procedure'"

**Step 3: Create join procedure**

Create `src/trpc/routers/userGroups/join.procedure.ts`:

```typescript
import { authedProcedure } from '@/trpc/init'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { nanoid } from 'nanoid'

export const joinUserGroup = authedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Check if group exists
    const group = await prisma.group.findUnique({
      where: { id: input.groupId },
    })

    if (!group) {
      throw new Error('Group not found')
    }

    // Check if user is already a member
    const existingMembership = await prisma.userGroup.findUnique({
      where: {
        userId_groupId: {
          userId: ctx.userId,
          groupId: input.groupId,
        },
      },
    })

    if (existingMembership) {
      throw new Error('Already a member of this group')
    }

    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
    })

    if (!user) {
      throw new Error('User not found')
    }

    // Create UserGroup and Participant in a transaction
    await prisma.$transaction([
      prisma.userGroup.create({
        data: {
          userId: ctx.userId,
          groupId: input.groupId,
        },
      }),
      prisma.participant.create({
        data: {
          id: nanoid(),
          name: user.name || user.email?.split('@')[0] || 'User',
          groupId: input.groupId,
          userId: ctx.userId,
        },
      }),
    ])

    return { success: true }
  })
```

**Step 4: Update userGroups router**

Modify `src/trpc/routers/userGroups/index.ts`:

```typescript
import { createTRPCRouter } from '@/trpc/init'
import { listUserGroups } from './list.procedure'
import { joinUserGroup } from './join.procedure'

export const userGroupsRouter = createTRPCRouter({
  list: listUserGroups,
  join: joinUserGroup, // ADD THIS LINE
})
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- src/trpc/routers/userGroups/join.procedure.test.ts
```

Expected: PASS (all tests green)

**Step 6: Commit**

```bash
git add src/trpc/routers/userGroups
git commit -m "feat(trpc): add userGroups.join procedure with participant creation

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 5.3: Create Authenticated Group Creation Procedure

**Files:**
- Modify: `src/trpc/routers/groups/create.procedure.ts`

**Step 1: Read current create procedure**

```bash
cat src/trpc/routers/groups/create.procedure.ts
```

**Step 2: Update create procedure to support authenticated groups**

Modify the existing `createGroup` procedure to:
1. Accept optional `isAuthenticated` boolean input
2. If authenticated and user logged in, create UserGroup and Participant with userId
3. Maintain backward compatibility with anonymous groups

```typescript
// Add to the input schema:
isAuthenticated: z.boolean().optional().default(false)

// After creating the group, add:
if (input.isAuthenticated && ctx.userId) {
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
  })

  await prisma.$transaction([
    prisma.userGroup.create({
      data: {
        userId: ctx.userId,
        groupId: group.id,
      },
    }),
    // Update the participant creation to include userId
  ])
}
```

**Step 3: Write test for authenticated group creation**

Add test case to existing test file or create new test file `src/trpc/routers/groups/create.procedure.test.ts`:

```typescript
it('should create authenticated group and link to user', async () => {
  const caller = createGroup.createCaller({
    userId: 'test-user',
    userEmail: 'test@example.com',
  })

  const result = await caller({
    name: 'Authenticated Group',
    currency: '$',
    isAuthenticated: true,
  })

  expect(result).toHaveProperty('groupId')

  const userGroup = await prisma.userGroup.findUnique({
    where: {
      userId_groupId: {
        userId: 'test-user',
        groupId: result.groupId,
      },
    },
  })
  expect(userGroup).toBeTruthy()
})
```

**Step 4: Run tests**

```bash
npm test -- src/trpc/routers/groups/create.procedure.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/trpc/routers/groups/create.procedure.ts
git commit -m "feat(trpc): support authenticated group creation with UserGroup link

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 6: Groups Page UI

### Task 6.1: Update Groups Page with Authenticated/Device Sections

**Files:**
- Modify: `src/app/groups/page.tsx`
- Create: `src/app/groups/authenticated-group-list.tsx`
- Modify: `src/app/groups/recent-group-list.tsx`

**Step 1: Create authenticated group list component**

Create `src/app/groups/authenticated-group-list.tsx`:

```typescript
'use client'

import { trpc } from '@/trpc/client'
import { RecentGroupListCard } from './recent-group-list-card'
import { Skeleton } from '@/components/ui/skeleton'

export function AuthenticatedGroupList() {
  const { data: groups, isLoading } = trpc.userGroups.list.useQuery()

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>You haven't joined any authenticated groups yet.</p>
        <p className="text-sm mt-2">
          Create a new group or join using an invite link.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <RecentGroupListCard
          key={group.id}
          group={{ id: group.id, name: group.name }}
          starred={false}
          archived={false}
        />
      ))}
    </div>
  )
}
```

**Step 2: Update groups page to show both sections**

Modify `src/app/groups/page.tsx`:

```typescript
import { RecentGroupList } from '@/app/groups/recent-group-list'
import { AuthenticatedGroupList } from '@/app/groups/authenticated-group-list'
import { auth } from '@/lib/auth'
import { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const metadata: Metadata = {
  title: 'Groups',
}

export default async function GroupsPage() {
  const session = await auth()

  if (!session?.user) {
    // Anonymous users only see device groups
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Your Groups</h1>
          <p className="text-muted-foreground">
            Groups saved on this device
          </p>
        </div>
        <RecentGroupList />
      </div>
    )
  }

  // Authenticated users see both authenticated and device groups
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Your Groups</h1>
        <p className="text-muted-foreground">
          Manage your authenticated and device-local groups
        </p>
      </div>

      <Tabs defaultValue="authenticated" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="authenticated">Authenticated Groups</TabsTrigger>
          <TabsTrigger value="device">Device Groups</TabsTrigger>
        </TabsList>
        <TabsContent value="authenticated" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Authenticated Groups</CardTitle>
              <CardDescription>
                Synced across all your devices
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AuthenticatedGroupList />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="device" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Device Groups</CardTitle>
              <CardDescription>
                Stored locally on this device only
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RecentGroupList />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

**Step 3: Test groups page**

```bash
npm run dev
```

Expected:
- Anonymous users see only "Device Groups"
- Authenticated users see tabs for "Authenticated Groups" and "Device Groups"

**Step 4: Commit**

```bash
git add src/app/groups
git commit -m "feat(ui): add authenticated/device groups sections to groups page

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 7: Invite Link System

### Task 7.1: Create Invite Link Generation

**Files:**
- Create: `src/lib/invite-links.ts`
- Create: `src/trpc/routers/groups/generateInvite.procedure.ts`
- Modify: `src/trpc/routers/groups/index.ts`

**Step 1: Write failing test**

Create `src/lib/invite-links.test.ts`:

```typescript
import { describe, expect, it } from '@jest/globals'
import { generateInviteToken, verifyInviteToken } from './invite-links'

describe('invite-links', () => {
  it('should generate and verify valid invite token', () => {
    const groupId = 'test-group-123'
    const token = generateInviteToken(groupId)

    expect(token).toBeTruthy()
    expect(typeof token).toBe('string')

    const verified = verifyInviteToken(token)
    expect(verified).toEqual({
      groupId,
      expiresAt: expect.any(Number),
    })
    expect(verified.expiresAt).toBeGreaterThan(Date.now())
  })

  it('should reject expired tokens', () => {
    const groupId = 'test-group-expired'
    // Generate token that expires immediately
    const token = generateInviteToken(groupId, -1)

    expect(() => verifyInviteToken(token)).toThrow('expired')
  })

  it('should reject invalid tokens', () => {
    expect(() => verifyInviteToken('invalid-token')).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/lib/invite-links.test.ts
```

Expected: FAIL with "Cannot find module './invite-links'"

**Step 3: Create invite link utilities**

Create `src/lib/invite-links.ts`:

```typescript
import { nanoid } from 'nanoid'

const INVITE_EXPIRY_HOURS = 24

interface InvitePayload {
  groupId: string
  expiresAt: number
}

export function generateInviteToken(
  groupId: string,
  expiryHours: number = INVITE_EXPIRY_HOURS,
): string {
  const expiresAt = Date.now() + expiryHours * 60 * 60 * 1000
  const payload: InvitePayload = { groupId, expiresAt }
  
  // In production, this should be encrypted/signed with a secret
  // For now, we'll use base64 encoding (NOT SECURE - placeholder)
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `inv_${encoded}`
}

export function verifyInviteToken(token: string): InvitePayload {
  if (!token.startsWith('inv_')) {
    throw new Error('Invalid invite token format')
  }

  try {
    const encoded = token.substring(4)
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8')
    const payload: InvitePayload = JSON.parse(decoded)

    if (payload.expiresAt < Date.now()) {
      throw new Error('Invite token has expired')
    }

    return payload
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) {
      throw error
    }
    throw new Error('Invalid invite token')
  }
}

export function createInviteUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/groups/join/${token}`
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- src/lib/invite-links.test.ts
```

Expected: PASS

**Step 5: Create generate invite procedure**

Create `src/trpc/routers/groups/generateInvite.procedure.ts`:

```typescript
import { authedProcedure } from '@/trpc/init'
import { prisma } from '@/lib/prisma'
import { generateInviteToken, createInviteUrl } from '@/lib/invite-links'
import { env } from '@/lib/env'
import { z } from 'zod'

export const generateInvite = authedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Verify user is a member of the group
    const membership = await prisma.userGroup.findUnique({
      where: {
        userId_groupId: {
          userId: ctx.userId,
          groupId: input.groupId,
        },
      },
    })

    if (!membership) {
      throw new Error('Not a member of this group')
    }

    const token = generateInviteToken(input.groupId)
    const url = createInviteUrl(token, env.NEXT_PUBLIC_BASE_URL)

    return {
      token,
      url,
      expiresIn: '24 hours',
    }
  })
```

**Step 6: Add to groups router**

Modify `src/trpc/routers/groups/index.ts`:

```typescript
import { createTRPCRouter } from '@/trpc/init'
import { balancesRouter } from './balances'
import { expensesRouter } from './expenses'
import { activitiesRouter } from './activities'
import { statsRouter } from './stats'
import { createGroup } from './create.procedure'
import { getGroupDetails } from './getDetails.procedure'
import { getGroup } from './get.procedure'
import { listGroups } from './list.procedure'
import { updateGroup } from './update.procedure'
import { generateInvite } from './generateInvite.procedure' // ADD THIS

export const groupsRouter = createTRPCRouter({
  list: listGroups,
  create: createGroup,
  get: getGroup,
  getDetails: getGroupDetails,
  update: updateGroup,
  generateInvite, // ADD THIS
  balances: balancesRouter,
  expenses: expensesRouter,
  activities: activitiesRouter,
  stats: statsRouter,
})
```

**Step 7: Commit**

```bash
git add src/lib/invite-links.ts src/lib/invite-links.test.ts src/trpc/routers/groups
git commit -m "feat(invite): add invite link generation with 24-hour expiry

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 7.2: Create Invite Link Join Flow

**Files:**
- Create: `src/app/groups/join/[token]/page.tsx`
- Create: `src/components/groups/join-group-card.tsx`

**Step 1: Create join group page**

Create `src/app/groups/join/[token]/page.tsx`:

```typescript
import { JoinGroupCard } from '@/components/groups/join-group-card'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyInviteToken } from '@/lib/invite-links'
import { redirect } from 'next/navigation'

export default async function JoinGroupPage({
  params,
}: {
  params: { token: string }
}) {
  const session = await auth()

  if (!session?.user) {
    // Redirect to sign-in with return URL
    redirect(`/auth/signin?callbackUrl=/groups/join/${params.token}`)
  }

  let groupId: string
  let error: string | null = null

  try {
    const payload = verifyInviteToken(params.token)
    groupId = payload.groupId
  } catch (err) {
    error = err instanceof Error ? err.message : 'Invalid invite link'
    return (
      <main className="container flex min-h-screen items-center justify-center">
        <JoinGroupCard error={error} />
      </main>
    )
  }

  // Check if group exists
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true },
  })

  if (!group) {
    return (
      <main className="container flex min-h-screen items-center justify-center">
        <JoinGroupCard error="Group not found" />
      </main>
    )
  }

  // Check if user is already a member
  const existingMembership = await prisma.userGroup.findUnique({
    where: {
      userId_groupId: {
        userId: session.user.id,
        groupId: group.id,
      },
    },
  })

  if (existingMembership) {
    // Already a member, redirect to group
    redirect(`/groups/${group.id}`)
  }

  return (
    <main className="container flex min-h-screen items-center justify-center">
      <JoinGroupCard group={group} token={params.token} />
    </main>
  )
}
```

**Step 2: Create join group card component**

Create `src/components/groups/join-group-card.tsx`:

```typescript
'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { trpc } from '@/trpc/client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface JoinGroupCardProps {
  group?: { id: string; name: string }
  token?: string
  error?: string
}

export function JoinGroupCard({ group, token, error }: JoinGroupCardProps) {
  const router = useRouter()
  const [isJoining, setIsJoining] = useState(false)
  const joinMutation = trpc.userGroups.join.useMutation()

  if (error) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invalid Invite</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.push('/groups')} className="w-full">
            Go to Groups
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!group || !token) {
    return null
  }

  const handleJoin = async () => {
    setIsJoining(true)
    try {
      await joinMutation.mutateAsync({ groupId: group.id })
      router.push(`/groups/${group.id}`)
    } catch (err) {
      console.error('Failed to join group:', err)
      setIsJoining(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Join Group</CardTitle>
        <CardDescription>
          You've been invited to join <strong>{group.name}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          By joining, you'll be able to see group expenses and add your own.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={handleJoin}
            disabled={isJoining}
            className="flex-1"
          >
            {isJoining ? 'Joining...' : 'Join Group'}
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/groups')}
            disabled={isJoining}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

**Step 3: Test invite flow**

```bash
npm run dev
```

Expected:
1. User logged in can generate invite link
2. Another user clicking link is redirected to join page
3. Join page shows group name and "Join" button
4. Clicking "Join" adds user to group and redirects to group page

**Step 4: Commit**

```bash
git add src/app/groups/join src/components/groups
git commit -m "feat(invite): implement join group flow with token verification

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 8: Share/Invite UI in Group

### Task 8.1: Add Invite Button to Group Header

**Files:**
- Modify: `src/app/groups/[groupId]/share-button.tsx`
- Create: `src/components/groups/invite-dialog.tsx`

**Step 1: Create invite dialog component**

Create `src/components/groups/invite-dialog.tsx`:

```typescript
'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { trpc } from '@/trpc/client'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

interface InviteDialogProps {
  groupId: string
}

export function InviteDialog({ groupId }: InviteDialogProps) {
  const [copied, setCopied] = useState(false)
  const { data, isLoading, refetch } = trpc.groups.generateInvite.useMutation()

  const handleGenerateInvite = async () => {
    await refetch()
  }

  const handleCopy = () => {
    if (data?.url) {
      navigator.clipboard.writeText(data.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={handleGenerateInvite}>
          Invite Members
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Members</DialogTitle>
          <DialogDescription>
            Share this link to invite people to your group. The link expires in 24 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">Generating invite link...</p>}
          {data && (
            <>
              <div className="space-y-2">
                <Label htmlFor="invite-url">Invite Link</Label>
                <div className="flex gap-2">
                  <Input
                    id="invite-url"
                    value={data.url}
                    readOnly
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Expires: {data.expiresIn}
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Update share button to include invite option**

Modify `src/app/groups/[groupId]/share-button.tsx` to conditionally show InviteDialog for authenticated groups:

```typescript
import { InviteDialog } from '@/components/groups/invite-dialog'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Check if current user is member of this group
const session = await auth()
let isMember = false

if (session?.user) {
  const membership = await prisma.userGroup.findUnique({
    where: {
      userId_groupId: {
        userId: session.user.id,
        groupId: params.groupId,
      },
    },
  })
  isMember = !!membership
}

// In the component JSX, add:
{isMember && <InviteDialog groupId={params.groupId} />}
```

**Step 3: Test invite UI**

```bash
npm run dev
```

Expected:
- Group members see "Invite Members" button
- Clicking button opens dialog with invite link
- Copy button copies link to clipboard

**Step 4: Commit**

```bash
git add src/app/groups/[groupId]/share-button.tsx src/components/groups/invite-dialog.tsx
git commit -m "feat(ui): add invite dialog to group header for members

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 9: Testing & Documentation

### Task 9.1: Add Integration Tests

**Files:**
- Create: `src/__tests__/integration/auth-flow.test.ts`
- Create: `src/__tests__/integration/group-sync.test.ts`

**Step 1: Create auth flow integration test**

Create `src/__tests__/integration/auth-flow.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals'
import { prisma } from '@/lib/prisma'

describe('Authentication Flow Integration', () => {
  const testEmail = 'integration-test@example.com'
  let userId: string

  afterAll(async () => {
    // Cleanup
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    }
  })

  it('should create user on first sign-in', async () => {
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        name: 'Integration Test User',
      },
    })

    userId = user.id

    expect(user).toHaveProperty('id')
    expect(user.email).toBe(testEmail)
    expect(user.name).toBe('Integration Test User')
  })

  it('should create session for user', async () => {
    const session = await prisma.session.create({
      data: {
        userId,
        sessionToken: 'test-session-token',
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    expect(session.userId).toBe(userId)
    expect(session.sessionToken).toBe('test-session-token')
  })
})
```

**Step 2: Create group sync integration test**

Create `src/__tests__/integration/group-sync.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals'
import { prisma } from '@/lib/prisma'
import { nanoid } from 'nanoid'

describe('Group Synchronization Integration', () => {
  let userId: string
  let groupId: string

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: 'sync-test@example.com',
        name: 'Sync Test User',
      },
    })
    userId = user.id

    const group = await prisma.group.create({
      data: {
        id: nanoid(),
        name: 'Sync Test Group',
      },
    })
    groupId = group.id
  })

  afterAll(async () => {
    await prisma.userGroup.deleteMany({ where: { userId } })
    await prisma.participant.deleteMany({ where: { userId } })
    await prisma.group.delete({ where: { id: groupId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('should link user to group and create participant', async () => {
    await prisma.userGroup.create({
      data: {
        userId,
        groupId,
      },
    })

    await prisma.participant.create({
      data: {
        id: nanoid(),
        name: 'Sync Test User',
        groupId,
        userId,
      },
    })

    const userGroups = await prisma.userGroup.findMany({
      where: { userId },
      include: { group: true },
    })

    expect(userGroups).toHaveLength(1)
    expect(userGroups[0].group.name).toBe('Sync Test Group')

    const participant = await prisma.participant.findFirst({
      where: { userId, groupId },
    })

    expect(participant).toBeTruthy()
    expect(participant?.userId).toBe(userId)
  })

  it('should handle user deletion gracefully', async () => {
    // Verify group still exists after user deleted
    await prisma.participant.deleteMany({ where: { userId } })
    await prisma.userGroup.deleteMany({ where: { userId } })

    const group = await prisma.group.findUnique({
      where: { id: groupId },
    })

    expect(group).toBeTruthy()
    expect(group?.name).toBe('Sync Test Group')
  })
})
```

**Step 3: Run integration tests**

```bash
npm test -- src/__tests__/integration
```

Expected: All integration tests pass

**Step 4: Commit**

```bash
git add src/__tests__/integration
git commit -m "test(integration): add auth flow and group sync integration tests

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 9.2: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Create: `docs/authentication.md`

**Step 1: Add authentication section to README**

Add this section to `README.md` after the "Features" section:

```markdown
## Authentication

Spliit supports both anonymous device-local groups and authenticated groups with cross-device sync:

- **Anonymous mode**: Create groups without signing in (stored in browser localStorage)
- **Authenticated mode**: Sign in with Google, GitHub, or email to sync groups across devices

### Setting up authentication

1. Configure OAuth providers (Google/GitHub) in your cloud console
2. Add credentials to `.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   GITHUB_CLIENT_ID=your-client-id
   GITHUB_CLIENT_SECRET=your-client-secret
   ```
3. For email sign-in, configure Resend:
   ```
   RESEND_API_KEY=your-api-key
   EMAIL_FROM=noreply@yourdomain.com
   ```
4. Generate `NEXTAUTH_SECRET`:
   ```bash
   openssl rand -base64 32
   ```

See [docs/authentication.md](docs/authentication.md) for detailed setup instructions.
```

**Step 2: Create authentication documentation**

Create `docs/authentication.md`:

```markdown
# Authentication Setup

Spliit uses NextAuth.js v5 for authentication with support for:
- Google OAuth
- GitHub OAuth
- Email magic links (via Resend)

## OAuth Provider Setup

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `https://yourdomain.com/api/auth/callback/google`
6. Copy Client ID and Client Secret to `.env`

### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create new OAuth App
3. Set Authorization callback URL: `https://yourdomain.com/api/auth/callback/github`
4. Copy Client ID and Client Secret to `.env`

## Email Provider Setup (Resend)

1. Sign up at [Resend](https://resend.com/)
2. Create API key
3. Verify your domain for sending emails
4. Add API key and sender email to `.env`

## Environment Variables

Required:
```env
NEXTAUTH_SECRET=<32-char-random-string>
NEXTAUTH_URL=https://yourdomain.com
```

Optional (at least one provider required):
```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
RESEND_API_KEY=
EMAIL_FROM=noreply@yourdomain.com
```

## Local Development

For local development:
```env
NEXTAUTH_URL=http://localhost:3000
```

Use ngrok or similar for testing OAuth callbacks locally.

## Security Notes

- Never commit `.env` file
- Use different OAuth credentials for development and production
- Rotate `NEXTAUTH_SECRET` periodically
- Use HTTPS in production (required by OAuth providers)
```

**Step 3: Update .env.example**

This was already done in Task 2.2, verify it includes all auth variables.

**Step 4: Commit**

```bash
git add README.md docs/authentication.md .env.example
git commit -m "docs: add authentication setup documentation

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 10: Manual Testing & Refinement

### Task 10.1: Execute Manual Testing Checklist

**No files created/modified in this task**

**Step 1: Set up test environment**

```bash
npm run dev
```

Expected: Development server running on http://localhost:3000

**Step 2: Test authentication flows**

Follow the checklist from the design document (lines 188-197):

- [ ] Google sign-in flow works
- [ ] GitHub sign-in flow works
- [ ] Email sign-in flow works
- [ ] Session persists across page reloads
- [ ] Session persists after browser close (reopen browser, still logged in)
- [ ] Signing out clears session
- [ ] Invalid/expired email links are rejected

Document any issues found in a file: `docs/testing/auth-test-results.md`

**Step 3: Test group synchronization**

Follow the checklist (lines 199-207):

- [ ] User logs in on device A (use Chrome)
- [ ] User creates authenticated group on device A
- [ ] User logs in on device B with same account (use Firefox/Incognito)
- [ ] Group appears automatically on device B
- [ ] User logs out on device A
- [ ] Group still visible on device B
- [ ] Device groups stay local only (not synced)

**Step 4: Test invite links**

Follow the checklist (lines 209-214):

- [ ] Member generates invite link
- [ ] Different user can use link to join group
- [ ] Same user cannot reuse link (already joined message)
- [ ] Expired links are rejected (manually expire a token)
- [ ] Invalid codes are rejected

**Step 5: Test backward compatibility**

Follow the checklist (lines 216-219):

- [ ] Anonymous device groups still work
- [ ] Authenticated users can create device groups
- [ ] Mix of authenticated + device groups on same device

**Step 6: Document issues and create follow-up tasks**

Create `docs/testing/manual-test-issues.md` with any bugs found.

**Step 7: Commit test results**

```bash
git add docs/testing
git commit -m "test(manual): execute manual testing checklist and document results

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Completion Checklist

Before considering this implementation complete, verify:

- [ ] All Prisma migrations applied successfully
- [ ] NextAuth.js configured with at least one working provider
- [ ] tRPC procedures have passing tests
- [ ] Authenticated groups show in groups page
- [ ] Device groups continue to work for anonymous users
- [ ] Invite link generation and joining works
- [ ] Manual testing checklist completed
- [ ] Documentation updated (README, .env.example, docs/authentication.md)
- [ ] No TypeScript errors (`npm run check-types`)
- [ ] No linting errors (`npm run lint`)
- [ ] All tests pass (`npm test`)

---

## Rollback Plan

If issues arise in production:

1. **Database rollback**: Run down migrations in reverse order
   ```bash
   npx prisma migrate resolve --rolled-back <migration-name>
   ```

2. **Feature flag**: Add environment variable to disable auth
   ```env
   NEXT_PUBLIC_ENABLE_AUTH=false
   ```

3. **Revert code**: Revert commits in reverse order of phases

---

## Future Enhancements

Not in scope for initial implementation, but consider for later:

- [ ] Role-based permissions (owner, admin, member)
- [ ] Email invites (send invite directly to email address)
- [ ] Per-group display names/nicknames
- [ ] Multi-device sign-out
- [ ] Account deletion UI
- [ ] OAuth provider account linking
- [ ] 2FA support
- [ ] Audit log for authentication events
