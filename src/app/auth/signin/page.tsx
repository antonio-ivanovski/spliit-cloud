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
