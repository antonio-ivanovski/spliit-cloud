import { Paperclip } from 'lucide-react'

export function DocumentsCount({ count }: { count: number }) {
  if (count === 0) return <></>
  return (
    <div className="flex items-center">
      <Paperclip className="mt-0.5 mr-1 h-3.5 w-3.5 text-muted-foreground" />
      <span>{count}</span>
    </div>
  )
}
