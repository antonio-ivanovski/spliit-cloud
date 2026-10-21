# Spliit Cloud Android: setup, testing, and publication

The maintained project is `apps/android`. It produces an Android 10+ TWA for
`https://spliit.cloud`, package `cloud.spliit.twa`. The web application continues
to deploy independently. Android versioning lives in `apps/android/version.properties`:
`versionName` is a human-readable semantic version, and `versionCode` is a strictly
increasing integer shared by every distribution channel.

Nothing in this implementation creates publisher accounts, production signing
keys, a public release, or a Play listing automatically. Follow the sequence
below before distributing a production APK. Debug builds use
`cloud.spliit.twa.debug` and are not authorized by production Digital Asset Links.

## 1. Review and deploy the website changes

1. Review/merge the Android, API, and web changes through the normal repository
   process. Do not use a normal `v…` release tag for an Android-only release:
   those tags deploy the main product. Android tags start with `android/v…`.
2. Deploy the API and web changes through the normal production release process.
   This adds the public deletion resource and the native update metadata file.
3. Check these public URLs without logging in:
   - `https://spliit.cloud/delete-account`: deletion instructions and contact.
   - `https://spliit.cloud/privacy`: accurate production disclosures.
   - `https://spliit.cloud/android/releases/stable.json`: JSON, initially
     `latest: null`. Do not advertise an unpublished APK.
4. Confirm `privacy@spliit.cloud` is monitored. Verify the production worker is
   running and can execute account deletion after its 48-hour grace period.
5. Review configured AI/OCR, storage, mail, push, logging, and backup providers
   against the privacy policy. These settings cannot be inferred from repository
   defaults; disclose actual production behavior.

## 2. Create your publishing account early

1. Create a personal account in [Google Play Console](https://play.google.com/console).
   Use an account you control long term, enable strong two-factor authentication,
   and complete identity/contact/device verification.
2. Review what publisher information Google makes public before submitting it.
3. Create the app as **Spliit Cloud**, free, without ads, with the permanent
   application ID `cloud.spliit.twa` when uploading its first bundle.
4. Complete any required Android developer verification and package registration
   for both the Play-delivered and independently signed APK certificate.
5. Recruit at least 12 real closed testers. For new personal accounts, plan at
   least 14 continuous days of qualifying opt-in, actual testing/feedback, and
   the subsequent production-access application. Check the requirements shown in
   your account at submission time.

Official references: [account setup](https://support.google.com/googleplay/android-developer/answer/13628312),
[closed testing](https://support.google.com/googleplay/android-developer/answer/14151465),
[developer verification](https://developer.android.com/developer-verification).

## 3. Create and back up two signing keys

Do this yourself on a trusted machine. Do not paste passwords, keystore files,
recovery codes, or base64 signing material into a chat or commit them to Git.

1. Install JDK 21 (Android Studio or a supported OpenJDK distribution).
2. Choose a private directory outside this checkout and generate the **app key**:

   ```sh
   mkdir -p "$HOME/.local/share/spliit-android"
   chmod 700 "$HOME/.local/share/spliit-android"
   keytool -genkeypair -storetype JKS \
     -keystore "$HOME/.local/share/spliit-android/app-signing.jks" \
     -alias spliit-app -keyalg RSA -keysize 4096 -validity 10000
   ```

3. Answer the certificate prompts with your publisher details and choose strong
   passwords. Record the alias and both passwords in your password manager.
4. Generate a distinct **upload key**:

   ```sh
   keytool -genkeypair -storetype JKS \
     -keystore "$HOME/.local/share/spliit-android/play-upload.jks" \
     -alias spliit-upload -keyalg RSA -keysize 4096 -validity 10000
   ```

5. Back up both keystores, aliases, and credentials in two secure locations,
   including an offline copy. Test that you can restore them.
6. Obtain the app key's **public** SHA-256 fingerprint:

   ```sh
   keytool -list -v \
     -keystore "$HOME/.local/share/spliit-android/app-signing.jks" \
     -alias spliit-app
   ```

7. Save the SHA-256 value for website trust and release verification. Export the
   upload certificate for Play if requested:

   ```sh
   keytool -exportcert -rfc \
     -keystore "$HOME/.local/share/spliit-android/play-upload.jks" \
     -alias spliit-upload \
     -file "$HOME/.local/share/spliit-android/play-upload-certificate.pem"
   ```

In Play App Signing, choose the option to **supply your existing app-signing key**.
Follow Play's current encrypted-key export/PEPK or Android Studio instructions.
Register the distinct upload certificate as the upload key. Do not let Play
generate a different app-signing key if you want independent APKs to update the
same installation. Confirm Play shows the same app-signing SHA-256 fingerprint
you recorded. The upload certificate is not the production website certificate.

Official reference: [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756).

## 4. Configure production website trust

1. Set these API deployment variables:

   ```dotenv
   TWA_PACKAGE_NAME=cloud.spliit.twa
   TWA_SHA256_FINGERPRINTS=YOUR_APP_SIGNING_CERTIFICATE_SHA256
   ```

   Fingerprints can be compact or colon-separated in configuration; output is
   canonical colon-separated uppercase. Multiple production certificates can be
   comma-separated when intentionally supporting key rotation.

2. Redeploy/restart the API through your hosting controls. The website proxies
   `/.well-known/assetlinks.json` to it.
3. Verify the actual public web origin:

   ```sh
   bun --filter @spliit/android verify:trust --fingerprint 'YOUR_APP_SIGNING_CERTIFICATE_SHA256'
   ```

4. Confirm no CDN/WAF authentication, redirect, HTML fallback, or challenge is
   applied to the endpoint. Allow cache time to expire after certificate changes.
5. Never add the debug certificate or upload-only certificate to production.
   A debug APK showing browser chrome is expected. Use the production-signed
   package for final trust testing, or a separately configured staging origin
   and package for development.

## 5. Configure local Android tooling

1. Install Android SDK platform 36, build-tools 36.1.0, and platform-tools from
   Android Studio's SDK Manager. Use JDK 21.
2. Set `JAVA_HOME` to JDK 21 and `ANDROID_HOME` to your SDK directory. On a normal
   macOS Android Studio setup, the SDK is `$HOME/Library/Android/sdk`. Existing
   Bubblewrap users may have `$HOME/.bubblewrap/android_sdk` instead.
3. From the repository root:

   ```sh
   bun install --frozen-lockfile
   bun --filter @spliit/android sync:strings
   bun --filter @spliit/android test
   bun --filter @spliit/android check
   bun --filter @spliit/android build:debug
   ```

4. The debug APK is
   `apps/android/app/build/outputs/apk/debug/app-debug.apk`.
   It is for development, not store upload or production update compatibility.
5. Android XML translations are generated from the existing message catalogs.
   Change those through `bun i18n`; regenerate with `sync:strings`. Do not edit
   generated XML translations directly.

## 6. Configure protected GitHub release signing

In the repository's GitHub settings, create the **android-release** environment.
Restrict it to reviewed release tags/workflows and configure required reviewers
where available. Add these environment secrets:

| Secret                             | Value                               |
| ---------------------------------- | ----------------------------------- |
| `ANDROID_APP_KEYSTORE_BASE64`      | Base64 of your app-signing JKS file |
| `ANDROID_APP_KEYSTORE_PASSWORD`    | App keystore password               |
| `ANDROID_APP_KEY_ALIAS`            | `spliit-app`                        |
| `ANDROID_APP_KEY_PASSWORD`         | App private-key password            |
| `ANDROID_UPLOAD_KEYSTORE_BASE64`   | Base64 of your Play upload JKS file |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | Upload keystore password            |
| `ANDROID_UPLOAD_KEY_ALIAS`         | `spliit-upload`                     |
| `ANDROID_UPLOAD_KEY_PASSWORD`      | Upload private-key password         |

Add the environment **variable** `ANDROID_APP_SIGNING_SHA256` containing the
public app-signing certificate fingerprint. Base64-encode each keystore locally
and paste the output directly into the appropriate GitHub secret, not a source
file, command argument containing the value, issue, or chat. Review changes to
release workflows before approving environment access to signing keys.

Enable Actions permission to create pull requests if you want the metadata
announcement workflow to open its PR. If branch protection or repository policy
prevents it, use the manual metadata process in step 10 instead.

## 7. Build your first signed release

1. Review `apps/android/version.properties`: first release is `1.0.0`, code `1`.
2. Review `apps/android/store/release-notes.md` and the English listing worksheet.
   Keep the current APK release notes accurate; web changes have separate notes.
3. Merge the reviewed implementation. Create/push an Android tag **only after
   production trust and signing configuration are ready**:

   ```sh
   git tag android/v1.0.0
   git push origin android/v1.0.0
   ```

4. Approve the protected **Android release** workflow after reviewing its source
   commit. It builds and tests the APK, verifies its certificate/package/version,
   SDK levels, and lack of native libraries, builds the AAB with the upload key,
   and checks live website trust.
5. Download the `android-release` Actions artifact. It contains the signed APK,
   upload-signed AAB, checksum, update metadata, and source revision.
6. The workflow creates a **draft GitHub release** containing the APK and public
   provenance files. It deliberately does not publish it or upload to Play.
7. If a draft already exists after a partial rerun, inspect it and manually
   replace validated assets rather than creating another tag for the same code.

For local signing, set `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` in a private shell environment and
run `build:release`. The same key signs both local outputs; for Play with a
separate upload certificate, rebuild `:app:bundleRelease` with the upload-key
environment, as the CI workflow does. Never upload an unsigned local AAB.

## 8. Qualify on actual devices

### Installed-app artwork and system surfaces

Launcher artwork uses the existing `apps/web/public/logo.svg` mark. The dedicated
`app-icon.svg` is the white-backed maskable composition; `app-icon-512-maskable.png`
exports that composition, while `app-icon-{180,192,512}.png` use a slightly larger
mark for unmasked and Apple touch icons. Android uses the same mark in
`drawable-nodpi/spliit_logo.png`, a 26% foreground inset on its 108dp adaptive
layer, and a permanent white launcher background. Keep the complete mark within
Android's central 66dp safe circle and the PWA's central 80%-diameter safe circle.
Check circular, squircle, and rounded-square launcher masks after artwork changes.

`apps/web/public/notification-badge.svg` is the canonical banknote-and-scissors
notification glyph. Its 96×96 transparent PNG is the service worker's `badge`;
the larger notification `icon` remains in color. Android's `ic_notification.xml`
provides the same glyph as a 24dp white-on-transparent vector through the
delegation service's `SMALL_ICON` metadata. Preserve the transparent loops and
internal gaps: Android masks small icons to monochrome, so a colored logo or
opaque tile becomes a solid silhouette. `icon_monochrome.xml` is a separately
scaled adaptive launcher layer, not a notification-sized drawable.

Use a Galaxy S24+, Android 16 / One UI 8.5, Chrome 155.0.8059.84 as the primary
appearance baseline. Record fresh results with the actual browser version; repeat
with the current supported Chrome release when it changes. Compare a Chrome tab,
the Chrome-installed PWA, and the release-signed TWA separately:

- Check launcher icons and themed-icon mode, then deliver a new notification to
  each installed form. Inspect the status bar and collapsed/expanded shade at
  actual size in both phone themes. Browser delegation can select the native
  small icon instead of the web badge. Dismiss older notifications before retrying.
- Record cold and warm launcher opens, a slow/offline launch, and a deep link.
  Check branding during package-update discovery, the ABH splash handoff, and the
  web bootstrap. Look for `SplashScreenStrategy` / `SplashImageTransferTask`
  failures in `adb logcat`, including “Failed to retrieve splash image” and
  “Failed to transfer splash image”. Do not claim the thin browser loading line
  is removed without checking the device recording.
- Test light, dark, and system app preferences, including light app/dark phone
  and dark app/light phone. Web theme metadata follows the app preference;
  native startup uses the phone preference until Chrome loads the web page.
- Check gesture and three-button navigation, portrait/landscape, drawers, fixed
  action bars, and keyboard opening/closing. Confirm no control sits under a
  system bar and bottom-bar backgrounds continue beneath gestures when supported.

Chrome owns the running TWA window and installed-PWA system bars. It can retain
provider-specific scrims, gesture contrast, or loading indicators. Native wrapper
window flags cannot override Chrome's window. Keep a readable surface-color
fallback and record any remaining provider behavior rather than hiding system UI.
PWA icon updates are browser-managed and may be delayed; compare a fresh install
when qualifying changed assets. Native resources require a new Android build.

### Functional qualification

Install the release-signed APK on a test device; later test Play's delivered
build too. Use synthetic groups/receipts and a dedicated test account. Do not
publish screenshots containing real participants, receipts, or invitations.

Check off each scenario and retain the device/Android/browser version and result:

- Android 10; Android 13 notification permissions; current Pixel and Samsung.
- Up-to-date Chrome; another supporting Chromium browser; unsupported/default
  browser; no enabled Custom Tabs browser.
- Website association: `adb shell pm verify-app-links --re-verify cloud.spliit.twa`,
  then `adb shell pm get-app-links cloud.spliit.twa`.
- Verified invitation links preserve path/query through cold launch and sign-in.
- Password, magic-link, Google/GitHub OAuth if enabled, passkeys, recovery, logout,
  and account switching return to the intended screen.
- Fresh install in airplane mode shows first-launch recovery; retry after
  connecting opens the app. Established offline sessions retain cached data.
- Browser storage clearing and changing browser provider recover coherently.
  Initialization tracking is native launch history, not proof a browser still
  has its service worker; inspect failed/cleared-cache cases explicitly.
- Offline new expenses queue once, survive process death, and synchronize once
  after reconnect. Other connection-required actions explain their limits.
- Single/multiple image, PDF, document, and text shares from another app, both
  after initialization and immediately after a fresh install. Confirm the share
  arrives intact; a first-ever share depends on browser/SW initialization and
  must not silently disappear. Treat a failure as a launch blocker.
- Camera/microphone approval, denial, cancellation, file picking, downloads, and
  exports; unsupported features retain a usable fallback.
- Notifications allowed/denied/revoked; notification taps with app foreground,
  background, and terminated; the correct group/expense opens.
- Android Back dismisses overlays, then navigates, then exits. Check unsaved
  edits and browser/Android update prompts during entry/upload/synchronization.
- Dark mode, TalkBack, enlarged text, RTL, keyboard, safe areas, rotation,
  split-screen, tablets/foldables, and gesture navigation.
- Sponsor navigation and direct `/sponsor` access in Android expose feedback,
  not payment options. Browser access retains the website sponsor page.
- Native updates: manual check, no connection, invalid metadata, no new version,
  newer compatible version, dismissal, and Play source selection. Automatic
  checks occur on ordinary launcher opens, at most daily, with a four-second
  startup deadline; they do not run as a background notification service.
- Upgrade an older release-signed APK in place; preserve app/browser data.
  Repeat GitHub → Play and Play → GitHub with increasing version codes.
- Run Play's pre-launch report. Fix critical crashes, access issues, or broken
  workflows before requesting production access.

Web integration/E2E tests require the separately running API and DB described in
AGENTS.md. Do not start those services just to follow this packaging guide.

## 9. Complete the Play listing and closed test

1. Fill in the listing using `apps/android/store/en-US.md` as a worksheet,
   adjusting claims to your actual enabled production features.
2. Supply the 512 × 512 icon, 1024 × 500 feature graphic, and at least two real
   Android screenshots. Phone screenshots at 1080 × 1920 fit Play's screenshot
   aspect-ratio requirements. Create tablet assets if claiming tablet quality.
3. Set privacy and deletion URLs to the live resources from step 1.
4. Complete Data safety, app access, ads, content rating, audience, and financial
   declarations. Hosted web processing counts: do not declare “no data collected”
   simply because the wrapper itself has no database or analytics SDK.
5. Supply a dedicated demo account and clear reviewer access instructions in
   Play Console; keep its credentials out of Git and public release notes.
6. Enroll your existing app-signing key and separate upload certificate as
   described in step 3. Upload `spliit-cloud.aab` to internal testing first.
7. Test the actual Play-installed application, including its Digital Asset Links
   fingerprint and update-source behavior.
8. Run the qualifying closed test with your recruited testers. Record findings,
   fix them, and apply for production access when eligible.
9. After approval, submit for production and use a staged rollout. Inspect Android
   vitals, user reports, existing service health, and key browser flows before
   expanding distribution. Store approval and timing are controlled by Google.

## 10. Publish independent distribution and its update announcement

1. After device qualification, publish the draft Android GitHub release.
2. **Publish Android update metadata PR** should run on publication. If publication
   was performed with an automation token and did not trigger it, run that
   workflow manually with `android/v1.0.0`.
3. Review its PR. It checks that the release is public/stable, verifies the APK
   checksum, and refuses metadata downgrades. Merge it and deploy the web app.
4. If the workflow cannot create PRs, download `android-update.json` from that
   published release, replace `apps/web/public/android/releases/stable.json`
   through a reviewed PR, and deploy. Verify the public JSON matches the release.
5. Independent installations will discover the update on their next eligible
   launcher/manual check. The prompt opens the release page; Android still asks
   the user to approve installation from their browser. No silent installer or
   “install unknown apps” permission is embedded in Spliit.
6. For Obtainium, add `https://github.com/antonio-ivanovski/spliit-cloud` and use:
   - Release-title regular expression: `^Spliit Cloud Android [0-9]+\.[0-9]+\.[0-9]+$`.
   - APK filename regular expression: `^spliit-cloud\.apk$`.
   - Include prereleases: off. Verify latest tag: off, since the repository's
     overall latest release can be a web release. Enable fallback to older
     releases so intervening web releases do not prevent discovery.
   - Verify the selected tag starts with `android/v`, the package is
     `cloud.spliit.twa`, and the signing certificate matches your public
     fingerprint before enabling updates.
     [Obtainium's GitHub source](https://github.com/ImranR98/Obtainium/blob/main/lib/app_sources/github.dart)
     filters release titles, not tag names, when a title is present.
7. Play installations route updates to Play automatically. If installation source
   is ambiguous or you change channels, open **Android app updates** from the
   launcher shortcut or Spliit account settings and choose the intended source.
8. F-Droid is a separate eligibility exercise: review its wrapper/native-value,
   open-source dependency/toolchain, browser, remote-content, and signing rules.
   Do not upload a binary and assume it will be accepted or share your app key.

## 11. Subsequent versions and recovery

- Increment `versionCode` for every distributed Android build, including testing
  builds sent through Play. Never recycle a code or lower the public metadata.
- Increase `versionName` for native changes, refresh release notes, rerun the
  qualification matrix appropriate to the change, and publish a new Android tag.
- Ordinary PWA feature deployments do not require an APK version bump. Keep
  service-worker update protections and support older installed wrappers.
- Review target-SDK deadlines, browser support, and dependency advisories before
  every Android release. Dependency checksum changes require deliberate review.
- Halt a Play rollout or unpublish a broken GitHub release when necessary.
  Replace a bad Android build with a higher version code; Android downgrade is
  not a recovery strategy. Repair update metadata through review if a release
  must stop being advertised.
- For web regressions, redeploy the known-good application as a fresh web build
  through the existing release process. Preserve pending offline writes.
- Keep app-signing backups and recovery ownership current. Certificate rotation
  affects Play, APK update compatibility, App Links, and Digital Asset Links;
  plan it before changing any production certificate.
