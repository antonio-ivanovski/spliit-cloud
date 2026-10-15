package cloud.spliit.twa;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateReleaseTest {
    private String metadata(String latest) {
        return "{\"schemaVersion\":1,\"packageName\":\"cloud.spliit.twa\",\"latest\":" + latest + "}";
    }

    private String release(String name, String url) {
        return "{\"versionCode\":12,\"versionName\":\"" + name + "\",\"minSdk\":29,\"releaseUrl\":\"" + url + "\"}";
    }

    @Test public void comparesInstalledCodeAndDeviceCompatibility() throws Exception {
        UpdateRelease update = UpdateRelease.parse(metadata(release("1.2.0",
                "https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/android/v1.2.0")));
        assertTrue(update.canUpdate(11, 29));
        assertFalse(update.canUpdate(12, 36));
        assertFalse(update.canUpdate(13, 36));
        assertFalse(update.canUpdate(11, 28));
    }

    @Test public void acceptsAnUnpublishedChannel() throws Exception {
        assertNull(UpdateRelease.parse(metadata("null")));
    }

    @Test public void rejectsUntrustedOrMismatchedReleaseDestinations() {
        String[] urls = {
            "http://github.com/antonio-ivanovski/spliit-cloud/releases/tag/android/v1.2.0",
            "https://github.com.evil.example/antonio-ivanovski/spliit-cloud/releases/tag/android/v1.2.0",
            "https://github.com/another/repo/releases/tag/android/v1.2.0",
            "https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v1.2.0",
            "https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/android/v1.2.1",
            "https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/android/v1.2.0?redirect=evil",
            "https://user@github.com/antonio-ivanovski/spliit-cloud/releases/tag/android/v1.2.0"
        };
        for (String url : urls) {
            assertThrows(url, Exception.class, () -> UpdateRelease.parse(metadata(release("1.2.0", url))));
        }
    }

    @Test public void rejectsOtherPackagesAndUnknownSchemas() {
        assertThrows(Exception.class, () -> UpdateRelease.parse("{\"schemaVersion\":2,\"packageName\":\"cloud.spliit.twa\",\"latest\":null}"));
        assertThrows(Exception.class, () -> UpdateRelease.parse("{\"schemaVersion\":1,\"packageName\":\"other.app\",\"latest\":null}"));
        assertThrows(Exception.class, () -> UpdateRelease.parse("<html>Unavailable</html>"));
    }
}
