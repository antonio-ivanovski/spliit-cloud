## ADDED Requirements

### Requirement: Notification Subscriptions

The system SHALL allow users to subscribe to notifications for group activity events.

#### Scenario: Subscribe to group notifications via Telegram (hosted Spliit)

- **WHEN** user opens notification settings for a group on hosted Spliit
- **AND** clicks "Connect Telegram"
- **THEN** the system displays a deep link button to the official Spliit Telegram bot
- **AND** when user clicks, Telegram opens with the bot
- **AND** user clicks "Start" in Telegram
- **AND** the bot automatically captures user's chat ID via the deep link payload
- **AND** the system links the Telegram chat to the group subscription
- **AND** user selects events to receive in Spliit UI
- **AND** future matching events trigger Telegram messages

#### Scenario: Subscribe to group notifications via Telegram (self-hosted)

- **WHEN** user opens notification settings for a group on self-hosted instance
- **AND** self-hoster has configured their own Telegram bot token
- **AND** clicks "Connect Telegram"
- **THEN** the system displays a deep link button to the configured bot
- **AND** flow proceeds same as hosted variant

#### Scenario: Unsubscribe from notifications

- **WHEN** user removes a notification subscription
- **THEN** the system deletes the subscription
- **AND** stops sending notifications for that group/channel combination

#### Scenario: Test notification delivery

- **WHEN** user clicks "Send test notification"
- **THEN** the system sends a test message to configured channel
- **AND** displays success or error feedback

### Requirement: Telegram Deep Link Onboarding

The system SHALL use Telegram deep links to enable frictionless user onboarding without manual chat ID copying.

#### Scenario: Generate subscription deep link

- **WHEN** user initiates Telegram subscription for a group
- **THEN** the system generates a unique, time-limited token
- **AND** creates deep link in format `t.me/{botName}?start={token}`
- **AND** token encodes group ID and subscription intent

#### Scenario: Bot receives deep link start

- **WHEN** user clicks deep link and presses "Start" in Telegram
- **THEN** the Telegram bot receives the `/start {token}` command
- **AND** bot extracts and validates the token
- **AND** bot captures user's chat ID from the message
- **AND** bot calls Spliit API to complete subscription linking
- **AND** bot sends confirmation message to user

#### Scenario: Deep link token expiration

- **WHEN** user clicks deep link
- **AND** token has expired (>15 minutes)
- **THEN** the bot responds with "Link expired, please try again from Spliit"
- **AND** subscription is not created

#### Scenario: User already subscribed

- **WHEN** user clicks deep link for a group they're already subscribed to
- **THEN** the bot responds with "You're already receiving notifications for this group"
- **AND** provides option to manage subscription

### Requirement: Notification Event Types

The system SHALL emit notifications for the following event types when subscribed.

#### Scenario: Notify on expense created

- **WHEN** a new expense is created in a group
- **AND** a subscription exists for CREATE_EXPENSE event
- **THEN** the system sends notification with expense title, amount, and payer

#### Scenario: Notify on expense updated

- **WHEN** an expense is modified in a group
- **AND** a subscription exists for UPDATE_EXPENSE event
- **THEN** the system sends notification with expense title and change summary

#### Scenario: Notify on expense deleted

- **WHEN** an expense is deleted from a group
- **AND** a subscription exists for DELETE_EXPENSE event
- **THEN** the system sends notification with deleted expense title

#### Scenario: Notify on group settings changed

- **WHEN** group name, currency, or participants change
- **AND** a subscription exists for UPDATE_GROUP event
- **THEN** the system sends notification describing the change

### Requirement: Balance Reminder Notifications

The system SHALL support scheduled balance reminder notifications.

#### Scenario: Configure balance reminder

- **WHEN** user enables balance reminders for a subscription
- **AND** specifies frequency (daily, weekly)
- **THEN** the system schedules periodic notifications

#### Scenario: Send balance reminder

- **WHEN** scheduled reminder time is reached
- **AND** group has non-zero balances
- **THEN** the system sends notification with current balance summary
- **AND** reschedules next reminder

#### Scenario: Skip reminder for settled group

- **WHEN** scheduled reminder time is reached
- **AND** all balances in group are zero
- **THEN** the system skips sending notification
- **AND** reschedules next reminder

### Requirement: Notification Provider Extensibility

The system SHALL support multiple notification providers through a pluggable interface.

#### Scenario: List available notification providers

- **WHEN** user opens notification settings
- **THEN** the system displays all providers with required credentials configured

#### Scenario: Provider unavailable without credentials

- **WHEN** a notification provider's required environment variables are not set (e.g., TELEGRAM_BOT_TOKEN)
- **THEN** that provider is not offered to users

### Requirement: Telegram Notification Provider

The system SHALL support Telegram as a notification channel.

#### Scenario: Send Telegram notification

- **WHEN** an event matches a Telegram subscription
- **THEN** the system sends message via Telegram Bot API
- **AND** formats message with group name, event type, and relevant details

#### Scenario: Handle Telegram API errors

- **WHEN** Telegram API returns an error (invalid chat ID, bot blocked)
- **THEN** the system logs the error
- **AND** does not retry immediately
- **AND** marks subscription with error status for user visibility

### Requirement: Telegram Bot Commands

The system SHALL provide Telegram bot commands for subscription management.

#### Scenario: List subscriptions via bot

- **WHEN** user sends `/subscriptions` to the bot
- **THEN** the bot lists all groups the user is subscribed to
- **AND** provides inline buttons to manage each subscription

#### Scenario: Unsubscribe via bot

- **WHEN** user sends `/stop` or uses unsubscribe button
- **THEN** the bot removes the subscription
- **AND** confirms unsubscription to user

#### Scenario: Help command

- **WHEN** user sends `/help` to the bot
- **THEN** the bot explains available commands and how notifications work
