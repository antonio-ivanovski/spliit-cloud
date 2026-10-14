import path from 'node:path'

import { Config } from '@remotion/cli/config'

import { overrideBundler } from './remotion-bundler'

Config.overrideBundlerConfig(overrideBundler)
Config.setVideoImageFormat('png')
Config.setCodec('h264')
Config.setPixelFormat('yuv420p')

Config.setPublicDir(path.join(import.meta.dirname, 'output/media'))
