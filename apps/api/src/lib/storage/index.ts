import { env } from '../env'
import { createLocalDriver } from './local'
import { createS3Driver } from './s3'
import type { StorageDriver } from './types'

export type { ObjectMetadata, StorageDriver } from './types'
export { ObjectNotFoundError } from './types'
export { objectBodyToBytes, toBytes } from './bytes'

let cachedDriver: StorageDriver | undefined
let cachedDriverKey: string | undefined

/**
 * The active storage driver, selected from `UPLOADS_DRIVER`. Cached per driver
 * (and per `UPLOADS_DIR`, so tests can swap roots); S3 env values are read live
 * inside the driver methods.
 */
export function getStorageDriver(): StorageDriver {
  const kind = env.UPLOADS_DRIVER ?? 's3'
  const cacheKey = kind === 'local' ? `local:${env.UPLOADS_DIR ?? ''}` : 's3'
  if (!cachedDriver || cachedDriverKey !== cacheKey) {
    cachedDriver =
      kind === 'local'
        ? createLocalDriver(env.UPLOADS_DIR ?? '')
        : createS3Driver()
    cachedDriverKey = cacheKey
  }
  return cachedDriver
}

export function uploadsConfigured(): boolean {
  return getStorageDriver().uploadsConfigured()
}
