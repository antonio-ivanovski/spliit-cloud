'use client'

import Link from '@/components/link'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n/react'
import { useCurrentAccount } from '@/lib/use-current-account'
import { Github, Loader2, LogIn, UserPlus, Users } from 'lucide-react'

export default function HomePage() {
  const t = useTranslations()
  const { data: account, isPending } = useCurrentAccount()

  return (
    <main>
      <section className="py-16 md:py-24 lg:py-32">
        <div className="container flex max-w-screen-md flex-col items-center gap-4 text-center">
          <h1 className="!leading-none font-bold text-2xl sm:text-3xl md:text-4xl lg:text-5xl landing-header py-2">
            {t.rich('Homepage.title', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </h1>
          <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8">
            {t.rich('Homepage.description', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {isPending ? (
              <Button disabled size="lg">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('Auth.loading')}
              </Button>
            ) : account ? (
              <Button asChild size="lg">
                <Link href="/groups">
                  <Users className="w-4 h-4 mr-2" />
                  {t('Homepage.button.groups')}
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/auth/sign-in">
                    <LogIn className="w-4 h-4 mr-2" />
                    {t('Homepage.button.signIn')}
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/auth/sign-in?mode=sign-up">
                    <UserPlus className="w-4 h-4 mr-2" />
                    {t('Homepage.button.createAccount')}
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="lg">
                  <Link href="https://github.com/antonio-ivanovski/spliit-cloud">
                    <Github className="w-4 h-4 mr-2" />
                    {t('Homepage.button.github')}
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
