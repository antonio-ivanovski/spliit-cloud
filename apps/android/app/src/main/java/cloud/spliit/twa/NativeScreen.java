package cloud.spliit.twa;

import android.app.Activity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

final class NativeScreen {
    static LinearLayout content(Activity activity, int title) {
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(activity.getColor(R.color.background));
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * activity.getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding, padding, padding);
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getSystemWindowInsets();
            view.setPadding(padding + bars.left, padding + bars.top, padding + bars.right, padding + bars.bottom);
            return insets;
        });
        scroll.addView(content);
        activity.setContentView(scroll);
        TextView heading = text(activity, content, activity.getString(title));
        heading.setTextSize(26);
        heading.setAccessibilityHeading(true);
        return content;
    }

    static TextView text(Activity activity, LinearLayout content, String text) {
        TextView view = new TextView(activity);
        view.setText(text);
        view.setTextSize(16);
        view.setPadding(0, 12, 0, 20);
        content.addView(view);
        return view;
    }

    static Button button(Activity activity, LinearLayout content, int label, Runnable action) {
        Button button = new Button(activity);
        button.setText(label);
        button.setOnClickListener(view -> action.run());
        content.addView(button);
        return button;
    }
}
