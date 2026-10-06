Welcome to `vNEXT`! One or two sentences on what this release is about.

## Highlights

- Headline one

### Headline one

A short paragraph per headline, with a screenshot where it helps.

![caption](./assets/next/shot.webp)

## What's Changed

### 🚨 Breaking Changes

Omit this section when there are none. Each entry names what breaks,
who is affected, and the exact migration steps.

### 🚀 Features

- Short entry per user-facing change (`TBD` by @TBD)

### 🐛 Bug fixes

- Short entry per fix (`TBD` by @TBD)
- Fixed all Cloudflare-sent email failing with HTTP 400 (`email.invalid`): callers set the platform-controlled `Message-ID` header, which Cloudflare rejects on the whole request. Tracking now travels in an allowed `X-Spliit-Delivery-Id` header, display-name senders use the documented `{address, name}` shape, and permanent bounces no longer record phantom sends (`TBD` by @TBD)

**Full Changelog**: TBD
