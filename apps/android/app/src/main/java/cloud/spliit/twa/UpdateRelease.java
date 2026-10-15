package cloud.spliit.twa;

import java.net.URI;
import org.json.JSONObject;

/** Wire contract shared with the release publisher. Never trust arbitrary download URLs. */
final class UpdateRelease {
    static final String PACKAGE = "cloud.spliit.twa";
    final long versionCode;
    final String versionName;
    final int minSdk;
    final String releaseUrl;

    private UpdateRelease(long code, String name, int sdk, String url) {
        versionCode = code;
        versionName = name;
        minSdk = sdk;
        releaseUrl = url;
    }

    static UpdateRelease parse(String body) throws Exception {
        JSONObject root = new JSONObject(body);
        if (root.getInt("schemaVersion") != 1 || !PACKAGE.equals(root.getString("packageName"))) {
            throw new IllegalArgumentException("Unsupported Android release metadata");
        }
        if (root.isNull("latest")) return null;
        JSONObject latest = root.getJSONObject("latest");
        long code = latest.getLong("versionCode");
        int sdk = latest.getInt("minSdk");
        String name = latest.getString("versionName");
        String url = latest.getString("releaseUrl");
        URI uri = new URI(url);
        String expectedPath = "/antonio-ivanovski/spliit-cloud/releases/tag/android/v" + name;
        if (code <= 0 || code > 2100000000L || sdk < 29 || !name.matches("[0-9]+\\.[0-9]+\\.[0-9]+")
                || !"https".equals(uri.getScheme()) || !"github.com".equals(uri.getHost())
                || uri.getPort() != -1 || uri.getUserInfo() != null || uri.getQuery() != null
                || uri.getFragment() != null || !expectedPath.equals(uri.getPath())) {
            throw new IllegalArgumentException("Invalid Android release");
        }
        return new UpdateRelease(code, name, sdk, url);
    }

    boolean canUpdate(long installedCode, int deviceSdk) {
        return versionCode > installedCode && minSdk <= deviceSdk;
    }
}
