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
  const [open, setOpen] = useState(false)
  const { mutate, data, isPending } = trpc.groups.generateInvite.useMutation()

  const handleGenerateInvite = () => {
    mutate({ groupId })
  }

  const handleCopy = () => {
    if (data?.url) {
      navigator.clipboard.writeText(data.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Invite Members</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Members</DialogTitle>
          <DialogDescription>
            Share this link to invite people to your group. The link expires in 24 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!data && (
            <Button onClick={handleGenerateInvite} disabled={isPending} className="w-full">
              {isPending ? 'Generating...' : 'Generate Invite Link'}
            </Button>
          )}
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
