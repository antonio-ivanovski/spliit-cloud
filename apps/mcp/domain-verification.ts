const OPENAI_APPS_CHALLENGE = 'DSr2UeKW2yP07bHAMUvyidOy8MV3q0i9xe_C2GTZ3lY'

export function createOpenAiAppsChallengeResponse() {
  return new Response(OPENAI_APPS_CHALLENGE, {
    headers: {
      'content-type': 'text/plain; charset=UTF-8',
      'cache-control': 'no-store',
    },
  })
}
