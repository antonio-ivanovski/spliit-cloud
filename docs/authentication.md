# Authentication Setup

Spliit uses NextAuth.js v5 for authentication with support for:
- Google OAuth
- GitHub OAuth
- Email magic links (via Resend)

## Required Configuration

All deployments require these environment variables:

```env
NEXTAUTH_SECRET=<32-character-random-string>
NEXTAUTH_URL=https://yourdomain.com
```

Generate `NEXTAUTH_SECRET`:
```bash
openssl rand -base64 32
```

For local development:
```env
NEXTAUTH_URL=http://localhost:3000
```

## OAuth Provider Setup

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API:
   - Go to APIs & Services → Library
   - Search for "Google+ API"
   - Click "Enable"
4. Create OAuth 2.0 credentials:
   - Go to APIs & Services → Credentials
   - Click "Create Credentials" → "OAuth client ID"
   - Select "Web application"
   - Add authorized redirect URIs:
     - Development: `http://localhost:3000/api/auth/callback/google`
     - Production: `https://yourdomain.com/api/auth/callback/google`
   - Copy the Client ID and Client Secret
5. Add to `.env`:
   ```env
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

### GitHub OAuth

1. Go to [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the application details:
   - Application name: Your app name
   - Homepage URL: Your domain URL
   - Authorization callback URL:
     - Development: `http://localhost:3000/api/auth/callback/github`
     - Production: `https://yourdomain.com/api/auth/callback/github`
4. Copy the Client ID and generate a Client Secret
5. Add to `.env`:
   ```env
   GITHUB_CLIENT_ID=your-client-id
   GITHUB_CLIENT_SECRET=your-client-secret
   ```

## Email Provider Setup (Resend)

1. Sign up at [Resend.com](https://resend.com/)
2. Verify your domain:
   - Add the DNS records shown in Resend dashboard
   - This enables sending emails from your domain
3. Create an API key in Resend dashboard
4. Add to `.env`:
   ```env
   RESEND_API_KEY=your-api-key
   EMAIL_FROM=noreply@yourdomain.com
   ```

## Environment Variables Summary

### Required
- `NEXTAUTH_SECRET` - Authentication secret (min 32 characters)
- `NEXTAUTH_URL` - Application URL

### Optional (at least one provider recommended)
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GITHUB_CLIENT_ID` - GitHub OAuth client ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth client secret
- `RESEND_API_KEY` - Resend API key for email provider
- `EMAIL_FROM` - Email address to send from

## Local Development Testing

### Using OAuth Locally

For testing OAuth providers locally, you need to expose your localhost:

1. **Using ngrok** (recommended):
   ```bash
   # Install ngrok: https://ngrok.com/download
   ngrok http 3000
   # This gives you a URL like https://xxx.ngrok.io
   ```

2. Update your `.env`:
   ```env
   NEXTAUTH_URL=https://xxx.ngrok.io
   ```

3. Update OAuth provider redirect URLs to:
   - `https://xxx.ngrok.io/api/auth/callback/google`
   - `https://xxx.ngrok.io/api/auth/callback/github`

4. Run the dev server:
   ```bash
   npm run dev
   ```

### Using Email Locally

Email sign-in works locally without additional setup. When testing email authentication:
1. You'll see a "Check your email" message
2. Check your Resend account dashboard or email logs
3. Click the magic link in the email to sign in

## Security Best Practices

1. **Keep secrets secure**:
   - Never commit `.env` files
   - Use environment variable management in your hosting platform
   - Rotate `NEXTAUTH_SECRET` periodically

2. **Use different credentials per environment**:
   - Development: Test OAuth app credentials
   - Production: Production OAuth app credentials

3. **OAuth redirect URLs**:
   - Always use HTTPS in production
   - Match your hosting domain exactly
   - Test OAuth flow after deployments

4. **Session security**:
   - Sessions are stored in database
   - Default session duration: 30 days
   - Passwords are never stored locally

## Troubleshooting

### OAuth callback fails

**Error**: "Callback URL mismatch" or similar
- **Solution**: Ensure the redirect URL in your OAuth provider settings exactly matches your application URL
- Check `NEXTAUTH_URL` environment variable matches your domain
- Remember to include the full path: `/api/auth/callback/{provider}`

### Email sign-in not working

**Error**: "Failed to send email"
- **Solution**: Verify Resend API key is valid
- Check that `EMAIL_FROM` domain is verified in Resend
- Look at Resend dashboard for error logs

### Session persists after logout

**Cause**: This is expected behavior with database sessions
- **Solution**: If unwanted, clear browser cookies or adjust `session.maxAge` in `src/lib/auth.ts`

### "Invalid client_id" error

**Cause**: OAuth credentials are incorrect or misconfigured
- **Solution**: 
  - Double-check Client ID and Secret match provider settings
  - Verify environment variables are loaded correctly
  - Check that OAuth app is still active in provider console

## Support

For issues or questions about authentication:
1. Check [NextAuth.js documentation](https://next-auth.js.org/)
2. Open an issue on [GitHub](https://github.com/spliit-app/spliit/issues)
3. Join the discussion on [Discord](https://discord.gg/YSyVXbwvSY)
