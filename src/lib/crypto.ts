import crypto from 'crypto'
import { env } from './env'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

const getEncryptionKey = () => {
  const key = env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not set')
  }
  const buffer = Buffer.from(key, 'base64')
  if (buffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)')
  }
  return buffer
}

type EncryptedPayload = {
  ciphertext: string
  iv: string
  authTag: string
}

export function encryptSecret(plaintext: string): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

export function decryptSecret(payload: EncryptedPayload): string {
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(payload.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ])

  return plaintext.toString('utf8')
}
