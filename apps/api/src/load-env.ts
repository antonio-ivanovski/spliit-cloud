import { config } from 'dotenv'

config({ path: new URL('../../../.env', import.meta.url) })
config({ path: new URL('../.env', import.meta.url) })
