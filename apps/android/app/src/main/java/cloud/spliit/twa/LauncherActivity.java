package cloud.spliit.twa;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ImageView;
import android.widget.FrameLayout;
import androidx.browser.customtabs.CustomTabsCallback;
import com.google.androidbrowserhelper.trusted.QualityEnforcer;
import com.google.androidbrowserhelper.trusted.TwaProviderPicker;

/** No WebView or privileged JS bridge: the browser owns the PWA and its storage. */
public final class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    private String provider;
    private boolean launched;

    @Override protected boolean shouldLaunchImmediately() { return false; }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (isFinishing()) return;
        tryLaunch();
    }

    private void tryLaunch() {
        provider = TwaProviderPicker.pickProvider(getPackageManager()).provider;
        if (!hasBrowser()) { recovery(true); return; }
        String key = "initialized:" + provider;
        if (!UpdateChecker.preferences(this).getBoolean(key, false) && !hasNetwork()) {
            recovery(false);
            return;
        }
        // Deep links and shared receipts must not be interrupted by package-update prompts.
        boolean launcher = Intent.ACTION_MAIN.equals(getIntent().getAction()) && getIntent().getData() == null;
        if (!launcher) { launch(); return; }
        showLaunchBranding();
        UpdateChecker.check(this, false, (release, failed) -> {
            if (release != null && release.canUpdate(BuildConfig.VERSION_CODE, android.os.Build.VERSION.SDK_INT)) {
                UpdateChecker.prompt(this, release, this::launch);
            } else launch();
        });
    }

    private void showLaunchBranding() {
        // ABH shows its transferable splash only once launchTwa() begins.
        // Cover the asynchronous update check with the same artwork first.
        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(getColor(R.color.background));
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getSystemWindowInsets();
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.splash);
        logo.setScaleType(ImageView.ScaleType.CENTER);
        logo.setImportantForAccessibility(ImageView.IMPORTANT_FOR_ACCESSIBILITY_NO);
        content.addView(logo, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(content);
        content.requestApplyInsets();
    }

    private boolean hasNetwork() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(manager.getActiveNetwork());
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private boolean hasBrowser() {
        return provider != null;
    }

    private void launch() {
        if (launched || isFinishing() || isDestroyed()) return;
        launched = true;
        try { launchTwa(); }
        catch (ActivityNotFoundException exception) { launched = false; recovery(true); }
    }

    private void recovery(boolean browserMissing) {
        LinearLayout content = NativeScreen.content(this, browserMissing ? R.string.browser_title : R.string.offline_title);
        NativeScreen.text(this, content, getString(browserMissing ? R.string.browser_message : R.string.offline_message));
        NativeScreen.button(this, content, R.string.retry, this::tryLaunch);
        NativeScreen.button(this, content, browserMissing ? R.string.browser_settings : R.string.connection_settings, () -> {
            try { startActivity(new Intent(browserMissing ? Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS : Settings.ACTION_WIRELESS_SETTINGS)); }
            catch (ActivityNotFoundException ignored) { }
        });
        // The original intent (including temporary file grants) stays on this activity until retry.
    }

    @Override protected Uri getLaunchingUrl() {
        Uri uri = super.getLaunchingUrl();
        if (!"https".equals(uri.getScheme()) || !"spliit.cloud".equals(uri.getHost())
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getUserInfo() != null) {
            uri = Uri.parse("https://spliit.cloud/");
        }
        // Presentation hint only. The web app retains it in sessionStorage across redirects.
        return uri.buildUpon().appendQueryParameter("android-app", "1").build();
    }

    @Override protected CustomTabsCallback getCustomTabsCallback() {
        return new QualityEnforcer() {
            @Override public void onNavigationEvent(int event, Bundle extras) {
                super.onNavigationEvent(event, extras);
                if (event == CustomTabsCallback.NAVIGATION_FINISHED && provider != null) {
                    UpdateChecker.preferences(LauncherActivity.this).edit()
                            .putBoolean("initialized:" + provider, true).apply();
                } else if (event == CustomTabsCallback.NAVIGATION_FAILED && provider != null) {
                    // A cache-cleared browser must qualify for first-launch recovery again.
                    UpdateChecker.preferences(LauncherActivity.this).edit()
                            .remove("initialized:" + provider).apply();
                }
            }
        };
    }
}
