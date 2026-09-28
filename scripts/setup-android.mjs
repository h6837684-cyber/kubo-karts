// KUBO KARTS v3.7 — installs the Wi-Fi host plugin into the Android project.
// Safe to run many times. Needs ./android (created by `npx cap add android`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = path.join(root, 'android', 'app', 'src', 'main');
if (!fs.existsSync(main)) {
  console.error('❌ android/ not found. Run first:  npx cap add android');
  process.exit(1);
}

// 1) plugin sources
const src = path.join(root, 'android-plugin', 'java', 'com', 'kubo', 'karts', 'lan');
const dst = path.join(main, 'java', 'com', 'kubo', 'karts', 'lan');
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('✔ LanServer plugin copied');

// 2) MainActivity: register the plugin + keep the screen on (host phone must not sleep)
function findMainActivity(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findMainActivity(p); if (r) return r; }
    else if (e.name === 'MainActivity.java') return p;
  }
  return null;
}
const ma = findMainActivity(path.join(main, 'java'));
if (!ma) { console.error('❌ MainActivity.java not found'); process.exit(1); }
const pkg = /package\s+([\w.]+);/.exec(fs.readFileSync(ma, 'utf8'))?.[1] ?? 'com.kubo.karts';
fs.writeFileSync(ma, `package ${pkg};

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;
import com.kubo.karts.lan.LanServerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LanServerPlugin.class);   // KUBO v3.7: Wi-Fi / hotspot host
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
`);
console.log('✔ MainActivity patched');

// 3) manifest: cleartext ws:// on the LAN + network state permissions
const mf = path.join(main, 'AndroidManifest.xml');
let xml = fs.readFileSync(mf, 'utf8');
if (!xml.includes('android:usesCleartextTraffic')) xml = xml.replace(/<application\b/, '<application\n        android:usesCleartextTraffic="true"');
for (const perm of ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.ACCESS_WIFI_STATE', 'android.permission.CHANGE_WIFI_MULTICAST_STATE']) {
  if (!xml.includes(`"${perm}"`)) xml = xml.replace(/<\/manifest>\s*$/, `    <uses-permission android:name="${perm}" />\n</manifest>\n`);
}
fs.writeFileSync(mf, xml);
console.log('✔ AndroidManifest patched');
console.log('\nDone. Next: npx cap sync android  →  npx cap open android');
