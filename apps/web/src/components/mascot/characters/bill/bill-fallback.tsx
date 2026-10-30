import type { MascotCharacterProps } from '../../mascot-character'

// Generated from scripts/mascot/bill-v2.source.json with Bun; format after generation.
export function BillFallback({
  className,
  open = false,
  reaction = 'idle',
}: MascotCharacterProps) {
  return (
    <svg
      viewBox="0 0 140 158"
      className={className}
      aria-hidden="true"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="translate(70 79)">
        <g transform="translate(0 0)">
          <g transform="translate(0 0)">
            <g transform="translate(-31 1)">
              <path
                d="M 0 -5 L -17 7 L -14 17 L 2 5 Z"
                fill="hsl(var(--mascot-paper-edge))"
                stroke="hsl(var(--mascot-stroke))"
                strokeWidth="1.1"
              />
              <path
                d="M 0 -5 L -17 7 L -14 10 L 2 2 Z"
                fill="hsl(var(--mascot-paper))"
              />
              <g transform="translate(-14 13)">
                <path
                  d="M 4 -3 L -3 -5 L -8 13 L -1 16 Z"
                  fill="hsl(var(--mascot-paper))"
                  stroke="hsl(var(--mascot-stroke))"
                  strokeWidth="1"
                />
                <path
                  d="M 3 -2 L -3 1"
                  fill="none"
                  stroke="hsl(var(--mascot-stroke))"
                  strokeWidth="0.8"
                />
                <g transform="translate(-5 15)">
                  <path
                    d="M 4 -3 L -3 -4 L -7 1 L -4 7 L 3 6 L 6 2 Z"
                    fill="hsl(var(--mascot-paper))"
                    stroke="hsl(var(--mascot-stroke))"
                    strokeWidth="1"
                  />
                  <path
                    d="M 4 0 L 0 2 L -2 0"
                    fill="none"
                    stroke="hsl(var(--mascot-stroke))"
                    strokeWidth="0.8"
                  />
                </g>
              </g>
            </g>
            <g
              transform={
                reaction === 'welcome'
                  ? 'translate(31 1) rotate(-100)'
                  : 'translate(31 1)'
              }
            >
              <path
                d="M 0 -5 L 17 7 L 14 17 L -2 5 Z"
                fill="hsl(var(--mascot-paper-edge))"
                stroke="hsl(var(--mascot-stroke))"
                strokeWidth="1.1"
              />
              <path
                d="M 0 -5 L 17 7 L 14 10 L -2 2 Z"
                fill="hsl(var(--mascot-paper))"
              />
              <g transform="translate(14 13)">
                <path
                  d="M -4 -3 L 3 -5 L 8 13 L 1 16 Z"
                  fill="hsl(var(--mascot-paper))"
                  stroke="hsl(var(--mascot-stroke))"
                  strokeWidth="1"
                />
                <path
                  d="M -3 -2 L 3 1"
                  fill="none"
                  stroke="hsl(var(--mascot-stroke))"
                  strokeWidth="0.8"
                />
                <g transform="translate(5 15)">
                  <path
                    d="M -4 -3 L 3 -4 L 7 1 L 4 7 L -3 6 L -6 2 Z"
                    fill="hsl(var(--mascot-paper))"
                    stroke="hsl(var(--mascot-stroke))"
                    strokeWidth="1"
                  />
                  <path
                    d="M -4 0 L 0 2 L 2 0"
                    fill="none"
                    stroke="hsl(var(--mascot-stroke))"
                    strokeWidth="0.8"
                  />
                </g>
              </g>
            </g>
            <g transform={open ? 'translate(-13 0) rotate(-5)' : undefined}>
              <path
                d="M 0 -53 L -26 -53 C -31 -53 -34 -50 -34 -44 L -34 48 L -28 43 L -22 49 L -16 43 L -10 49 L -4 43 L 0 47 Z"
                fill="hsl(var(--mascot-paper))"
              />
              <path
                d="M 0 -53 L -26 -53 C -31 -53 -34 -50 -34 -44 L -34 48 L -28 43 L -22 49 L -16 43 L -10 49 L -4 43 L 0 47"
                fill="none"
                stroke="hsl(var(--mascot-stroke))"
                strokeWidth="1.5"
              />
              <path
                d="M -34 -42 C -28 -47 -14 -45 0 -45 L 0 -53 L -26 -53 C -31 -53 -34 -50 -34 -42 Z"
                fill="hsl(var(--mascot-paper-mid))"
              />
              <path
                d="M -23 -34 L -3 -34"
                fill="none"
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="2.3"
              />
              <path
                d="M -7 23 L -24 23"
                fill="none"
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="1.5"
              />
              <path
                d="M -7 29 L -24 29"
                fill="none"
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="1.5"
              />
              <path
                d="M -7 35 L -17 35"
                fill="none"
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="1.5"
              />
              <g transform="translate(-17 -6)" opacity={open ? 1 : 0}>
                <ellipse
                  cx="-5"
                  cy="-2"
                  rx="2"
                  ry="3.5"
                  fill="hsl(var(--mascot-ink))"
                />
                <ellipse
                  cx="5"
                  cy="-2"
                  rx="2"
                  ry="3.5"
                  fill="hsl(var(--mascot-ink))"
                />
                <path
                  d="M -5 7 C -2 11 2 11 5 7"
                  fill="none"
                  stroke="hsl(var(--mascot-ink))"
                  strokeWidth="1.3"
                />
              </g>
            </g>
            <g transform={open ? 'translate(13 0) rotate(5)' : undefined}>
              <path
                d="M 0 -53 L 24 -53 C 31 -53 34 -49 34 -42 L 34 48 L 28 43 L 22 49 L 16 43 L 10 49 L 4 43 L 0 47 Z"
                fill="hsl(var(--mascot-paper))"
              />
              <path
                d="M 0 -53 L 24 -53 C 31 -53 34 -49 34 -42 L 34 48 L 28 43 L 22 49 L 16 43 L 10 49 L 4 43 L 0 47"
                fill="none"
                stroke="hsl(var(--mascot-stroke))"
                strokeWidth="1.5"
              />
              <path
                d="M 27 -48 C 31 -44 29 -28 29 -12 L 29 41 L 34 48 L 34 -42 C 34 -47 31 -51 27 -48 Z"
                fill="hsl(var(--mascot-paper-edge))"
              />
              <path
                d="M 0 -45 L 24 -45 C 30 -45 31 -43 34 -42 C 34 -49 31 -53 24 -53 L 0 -53 Z"
                fill="hsl(var(--mascot-paper-mid))"
              />
              <path
                d="M 3 -34 L 13 -34"
                fill="none"
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="2.3"
              />
              <path
                d="M 7 23 L 24 23"
                fill="none"
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="1.5"
              />
              <path
                d="M 7 29 L 24 29"
                fill="none"
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="1.5"
              />
              <path
                d="M 7 35 L 17 35"
                fill="none"
                stroke="hsl(var(--mascot-rule))"
                strokeWidth="1.5"
              />
              <g transform="translate(17 -6)" opacity={open ? 1 : 0}>
                <ellipse
                  cx="-5"
                  cy="-2"
                  rx="2"
                  ry="3.5"
                  fill="hsl(var(--mascot-ink))"
                />
                <ellipse
                  cx="5"
                  cy="-2"
                  rx="2"
                  ry="3.5"
                  fill="hsl(var(--mascot-ink))"
                />
                <path
                  d="M -5 7 C -2 11 2 11 5 7"
                  fill="none"
                  stroke="hsl(var(--mascot-ink))"
                  strokeWidth="1.3"
                />
              </g>
            </g>
            <g transform="translate(0 -5)" opacity={open ? 0 : 1}>
              <g transform="translate(0 0)">
                <g transform="translate(-12 -4)">
                  <ellipse
                    cx="0"
                    cy="0"
                    rx="4"
                    ry="6"
                    fill="hsl(var(--mascot-ink))"
                  />
                  <ellipse
                    cx="-1.2"
                    cy="-2"
                    rx="1.05"
                    ry="1.4"
                    fill="#fffcf2"
                  />
                </g>
                <g transform="translate(12 -4)">
                  <ellipse
                    cx="0"
                    cy="0"
                    rx="4"
                    ry="6"
                    fill="hsl(var(--mascot-ink))"
                  />
                  <ellipse
                    cx="-1.2"
                    cy="-2"
                    rx="1.05"
                    ry="1.4"
                    fill="#fffcf2"
                  />
                </g>
              </g>
              <g transform="translate(-12 -15)">
                <path
                  d="M -5 0 C -2 -2 2 -2 5 0"
                  fill="none"
                  stroke="hsl(var(--mascot-ink))"
                  strokeWidth="1.4"
                />
              </g>
              <ellipse cx="-21" cy="5" rx="4.5" ry="2" fill="#e6c7a5" />
              <g transform="translate(12 -15)">
                <path
                  d="M -5 0 C -2 -2 2 -2 5 0"
                  fill="none"
                  stroke="hsl(var(--mascot-ink))"
                  strokeWidth="1.4"
                />
              </g>
              <ellipse cx="21" cy="5" rx="4.5" ry="2" fill="#e6c7a5" />
              <g
                transform={
                  reaction === 'failure'
                    ? 'translate(0 8) scale(1 -0.7)'
                    : 'translate(0 8)'
                }
              >
                <path
                  d="M -8 -2 C -5 6 5 6 8 -2"
                  fill="none"
                  stroke="hsl(var(--mascot-ink))"
                  strokeWidth="2"
                />
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  )
}
