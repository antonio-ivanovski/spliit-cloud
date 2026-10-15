package cloud.spliit.twa;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.AdapterView;

/** Also available by long-pressing the launcher, independent of web authentication. */
public final class AppInfoActivity extends Activity {
    private TextView status;
    private Button check;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout content = NativeScreen.content(this, R.string.updates_title);
        NativeScreen.text(this, content, getString(R.string.version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE));
        String webVersion = getIntent().getData() == null || !getIntent().getData().isHierarchical()
                ? null : getIntent().getData().getQueryParameter("web-version");
        if (webVersion != null && webVersion.matches("[A-Za-z0-9.+_-]{1,64}")) {
            NativeScreen.text(this, content, "Spliit Cloud " + webVersion);
        }
        NativeScreen.text(this, content, getString(R.string.web_version_note));
        NativeScreen.text(this, content, getString(R.string.update_source));
        Spinner source = new Spinner(this);
        String[] values = {"automatic", "github", "play"};
        source.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
                new String[]{getString(R.string.automatic_source), getString(R.string.github_source), getString(R.string.play_source)}));
        String saved = UpdateChecker.preferences(this).getString("update-source", "automatic");
        source.setSelection("github".equals(saved) ? 1 : "play".equals(saved) ? 2 : 0);
        content.addView(source);
        status = NativeScreen.text(this, content, "");
        check = NativeScreen.button(this, content, R.string.check_updates, this::check);
        source.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                UpdateChecker.preferences(AppInfoActivity.this).edit().putString("update-source", values[position]).apply();
                refreshSource();
            }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        NativeScreen.text(this, content, getString(R.string.obtainium_note));
        NativeScreen.button(this, content, R.string.continue_app, () -> {
            startActivity(new Intent(this, LauncherActivity.class).setAction(Intent.ACTION_MAIN));
            finish();
        });
        refreshSource();
    }

    private void refreshSource() {
        boolean play = UpdateChecker.usesPlay(this);
        check.setText(play ? R.string.open_play : R.string.check_updates);
        status.setText(play ? R.string.play_updates : R.string.web_version_note);
    }

    private void check() {
        if (UpdateChecker.usesPlay(this)) {
            UpdateChecker.open(this, "https://play.google.com/store/apps/details?id=" + UpdateRelease.PACKAGE);
            return;
        }
        check.setEnabled(false);
        status.setText(R.string.checking);
        UpdateChecker.check(this, true, (release, failed) -> {
            check.setEnabled(true);
            if (failed) status.setText(R.string.check_failed);
            else if (release != null && release.canUpdate(BuildConfig.VERSION_CODE, android.os.Build.VERSION.SDK_INT)) {
                status.setText(getString(R.string.update_available, release.versionName));
                UpdateChecker.prompt(this, release, () -> { });
            } else status.setText(R.string.up_to_date);
        });
    }
}
