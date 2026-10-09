// Oxlint JS plugin for the Playwright E2E suite (see
// https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html). Enabled
// only for apps/web/e2e via the jsPlugins + overrides entries in
// .oxlintrc.json — the rest of the repo never sees these rules.
//
// E2E tests must rely on web-first assertions and the timeouts in
// playwright.config.ts. Per-call waits mask real slowness and make the suite
// slow. Genuine exceptions use an oxlint-disable-next-line comment with
// justification (note: this repo ignores eslint-style disable directives).

function isTimeoutProperty(node) {
  return (
    node.type === 'Property' &&
    !node.computed &&
    node.key.type === 'Identifier' &&
    node.key.name === 'timeout' &&
    node.value.type === 'Literal' &&
    typeof node.value.value === 'number'
  )
}

function memberCall(node, name) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === name
  )
}

const noCustomTimeout = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban per-call timeout options in e2e tests; use playwright.config.ts defaults.',
    },
  },
  create(context) {
    return {
      Property(node) {
        // Numeric value on purpose: `{ timeout: number }` in a type position
        // is not a wait and must not be flagged.
        if (isTimeoutProperty(node)) {
          context.report({
            node,
            message:
              'Custom timeouts are banned in e2e tests; rely on playwright.config.ts defaults.',
          })
        }
      },
    }
  },
}

const noWaitForTimeout = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban waitForTimeout sleeps in e2e tests.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (memberCall(node, 'waitForTimeout')) {
          context.report({
            node,
            message:
              'waitForTimeout sleeps are banned in e2e tests; use web-first assertions.',
          })
        }
      },
    }
  },
}

const noFocusedTest = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban focused .only tests in e2e tests.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (memberCall(node, 'only')) {
          context.report({
            node,
            message: 'Focused .only tests are banned in e2e tests.',
          })
        }
      },
    }
  },
}

const plugin = {
  meta: { name: 'spliit-e2e' },
  rules: {
    'no-custom-timeout': noCustomTimeout,
    'no-wait-for-timeout': noWaitForTimeout,
    'no-focused-test': noFocusedTest,
  },
}

export default plugin
