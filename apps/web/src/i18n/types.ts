import type enUS from '@/messages/en-US.json'

export type DefaultMessages = typeof enUS

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
