# Android packaging provenance

The initial TWA structure and Gradle launcher scripts are based on Google's
[Bubblewrap 1.27.0](https://github.com/GoogleChromeLabs/bubblewrap/tree/v1.27.0/packages/core/template_project)
(commit `0eb0671985d3f28eb2567a5463999046255fa3b8`), Apache License 2.0.
This checked-in Android project is maintained directly; do not regenerate it in
place with Bubblewrap, which overwrites custom launcher and update behavior.

The runtime uses Google's
[android-browser-helper 2.7.4](https://github.com/GoogleChrome/android-browser-helper/releases/tag/android-browser-helper-2.7.4),
Apache License 2.0, and its AndroidX dependencies. The app does not include Google
Play Billing, advertising, analytics, Firebase, or a native JavaScript bridge.
The Apache 2.0 license is included in the APK's `APACHE-2.0.txt` asset and in this
source tree at `app/src/main/assets/APACHE-2.0.txt`.

Gradle 8.11.1's distribution SHA-256 is pinned in its wrapper configuration. The
wrapper JAR comes from Gradle's official v8.11.1 source tag, with SHA-256
`2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`.
Gradle dependency SHA-256 verification metadata is checked in. Regenerate it only
when intentionally updating dependencies, then review the changed artifacts and
their upstream sources before accepting new checksums.

Existing Spliit artwork and the application source retain their repository
license. Consult Gradle's dependency reports and upstream notices when preparing
redistribution or an F-Droid submission.
