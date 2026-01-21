## ADDED Requirements

### Requirement: Custom Webhooks

The system SHALL allow users to configure custom webhook URLs to receive group activity events.

#### Scenario: Create webhook for group

- **WHEN** user opens webhook settings for a group
- **AND** provides a valid HTTPS URL
- **AND** selects events to receive
- **THEN** the system creates a webhook configuration
- **AND** generates a signing secret for payload verification

#### Scenario: Update webhook configuration

- **WHEN** user modifies webhook URL or event selection
- **THEN** the system updates the configuration
- **AND** future events use updated settings

#### Scenario: Delete webhook

- **WHEN** user removes a webhook
- **THEN** the system deletes the configuration
- **AND** stops sending events to that URL

#### Scenario: Disable/enable webhook

- **WHEN** user toggles webhook enabled state
- **THEN** the system updates the enabled flag
- **AND** disabled webhooks do not receive events

### Requirement: Webhook Delivery

The system SHALL deliver events to configured webhooks with proper security headers.

#### Scenario: Deliver webhook payload

- **WHEN** an event matches a webhook subscription
- **THEN** the system sends HTTP POST to webhook URL
- **AND** includes JSON payload with event type, group ID, timestamp, and event data
- **AND** includes X-Spliit-Signature header with HMAC-SHA256 signature
- **AND** includes X-Spliit-Timestamp header with Unix timestamp

#### Scenario: Webhook payload format

- **WHEN** webhook is delivered
- **THEN** payload follows structure:
  ```json
  {
    "event": "CREATE_EXPENSE",
    "groupId": "abc123",
    "timestamp": "2024-01-15T10:30:00Z",
    "data": {
      /* event-specific data */
    }
  }
  ```

#### Scenario: Test webhook delivery

- **WHEN** user clicks "Send test webhook"
- **THEN** the system sends test payload to configured URL
- **AND** displays response status to user

### Requirement: Webhook Retry Policy

The system SHALL retry failed webhook deliveries with exponential backoff.

#### Scenario: Retry on temporary failure

- **WHEN** webhook delivery fails with 5xx error or timeout
- **THEN** the system retries up to 3 times
- **AND** waits 1s, then 10s, then 60s between retries

#### Scenario: No retry on permanent failure

- **WHEN** webhook delivery fails with 4xx error (except 429)
- **THEN** the system does not retry
- **AND** logs the failure

#### Scenario: Rate limit handling

- **WHEN** webhook returns 429 Too Many Requests
- **AND** includes Retry-After header
- **THEN** the system waits specified duration before retry

### Requirement: Webhook Security

The system SHALL provide mechanisms for webhook consumers to verify payload authenticity.

#### Scenario: Signature verification

- **WHEN** webhook consumer receives payload
- **THEN** consumer can verify by computing HMAC-SHA256 of timestamp + payload using secret
- **AND** comparing with X-Spliit-Signature header

#### Scenario: Timestamp validation

- **WHEN** webhook consumer receives payload
- **THEN** consumer can reject payloads with timestamp older than 5 minutes
- **AND** this prevents replay attacks

#### Scenario: Reveal webhook secret

- **WHEN** user requests to view webhook secret
- **THEN** the system displays the secret
- **AND** warns that secret should be kept confidential

#### Scenario: Regenerate webhook secret

- **WHEN** user regenerates webhook secret
- **THEN** the system creates new secret
- **AND** old secret becomes invalid immediately
