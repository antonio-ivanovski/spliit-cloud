package cloud.spliit.twa;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class UpdateChecker {
    static final String ENDPOINT = "https://spliit.cloud/android/releases/stable.json";
    private static final long INTERVAL_MS = 24 * 60 * 60 * 1000L;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    interface Result { void receive(UpdateRelease release, boolean failed); }

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("android-package", Context.MODE_PRIVATE);
    }

    @SuppressWarnings("deprecation")
    static boolean usesPlay(Context context) {
        String choice = preferences(context).getString("update-source", "automatic");
        if (!"automatic".equals(choice)) return "play".equals(choice);
        try {
            String installer = Build.VERSION.SDK_INT >= 30
                    ? context.getPackageManager().getInstallSourceInfo(context.getPackageName()).getInstallingPackageName()
                    : context.getPackageManager().getInstallerPackageName(context.getPackageName());
            return "com.android.vending".equals(installer);
        } catch (Exception ignored) {
            return false;
        }
    }

    static void check(Activity activity, boolean manual, Result callback) {
        SharedPreferences prefs = preferences(activity);
        long now = System.currentTimeMillis();
        long last = prefs.getLong("last-update-attempt", 0);
        if (usesPlay(activity) || (!manual && BuildConfig.DEBUG)
                || (!manual && now >= last && now - last < INTERVAL_MS)) {
            callback.receive(null, false);
            return;
        }
        prefs.edit().putLong("last-update-attempt", now).apply();
        AtomicBoolean delivered = new AtomicBoolean(false);
        // Update discovery must never hold startup hostage to a slow network.
        MAIN.postDelayed(() -> {
            if (delivered.compareAndSet(false, true) && !activity.isFinishing() && !activity.isDestroyed()) {
                callback.receive(null, true);
            }
        }, 4000);
        EXECUTOR.execute(() -> {
            UpdateRelease release = null;
            boolean failed = false;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(ENDPOINT).openConnection();
                connection.setConnectTimeout(3000);
                connection.setReadTimeout(3000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "application/json");
                if (connection.getResponseCode() != 200) throw new IllegalStateException("Unavailable");
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[2048];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > 16384) throw new IllegalStateException("Metadata too large");
                        output.write(buffer, 0, count);
                    }
                    release = UpdateRelease.parse(output.toString(StandardCharsets.UTF_8.name()));
                }
            } catch (Exception ignored) {
                failed = true;
            } finally {
                if (connection != null) connection.disconnect();
            }
            UpdateRelease result = release;
            boolean error = failed;
            MAIN.post(() -> {
                if (delivered.compareAndSet(false, true) && !activity.isFinishing() && !activity.isDestroyed()) callback.receive(result, error);
            });
        });
    }

    static void prompt(Activity activity, UpdateRelease release, Runnable continueApp) {
        new AlertDialog.Builder(activity)
                .setTitle(R.string.updates_title)
                .setMessage(activity.getString(R.string.update_available, release.versionName))
                .setPositiveButton(R.string.view_update, (dialog, which) -> {
                    open(activity, release.releaseUrl);
                    activity.finish();
                })
                .setNegativeButton(R.string.later, (dialog, which) -> continueApp.run())
                .setOnCancelListener(dialog -> continueApp.run())
                .show();
    }

    static void open(Context context, String url) {
        try {
            context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            // A browser may have been disabled between checking and opening.
        }
    }
}
