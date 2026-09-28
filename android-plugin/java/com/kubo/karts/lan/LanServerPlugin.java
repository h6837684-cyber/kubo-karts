package com.kubo.karts.lan;

// KUBO KARTS v3.8 - Capacitor bridge for the host-phone WebSocket server.
// JS side: src/game/net/lan-host.ts   (registerPlugin('LanServer'))
// v3.8: correct IP list (no VPN / mobile-data addresses), full address details
//       for the lobby, and automatic server discovery (UDP beacon on 3004).

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.IOException;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "LanServer")
public class LanServerPlugin extends Plugin implements MiniWsServer.Listener {

    private MiniWsServer server;
    private LanDiscovery.Beacon beacon;

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", 3003);
        String name = call.getString("name", "KUBO");
        synchronized (this) {
            if (server != null && server.isRunning() && server.getPort() != port) {
                server.stop();
                server = null;
            }
            if (server == null || !server.isRunning()) {
                MiniWsServer s = new MiniWsServer(port, this);
                try {
                    s.start();
                } catch (IOException e) {
                    call.reject("BIND_FAILED: " + e.getMessage());
                    return;
                }
                server = s;
            }
            if (beacon == null) {
                beacon = new LanDiscovery.Beacon(port);
                beacon.start();
            }
            beacon.setName(name);
        }
        JSObject ret = ipsResult();
        ret.put("port", port);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        synchronized (this) {
            if (beacon != null) beacon.stop();
            beacon = null;
            if (server != null) server.stop();
            server = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void getIps(PluginCall call) {
        call.resolve(ipsResult());
    }

    @PluginMethod
    public void setName(PluginCall call) {
        LanDiscovery.Beacon b = beacon;
        if (b != null) b.setName(call.getString("name", "KUBO"));
        call.resolve();
    }

    /** joiner: listen for host beacons (runs off the UI thread) */
    @PluginMethod
    public void discover(final PluginCall call) {
        final int timeout = call.getInt("timeoutMs", 2500);
        new Thread(() -> {
            WifiManager.MulticastLock lock = null;
            try {
                WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    lock = wm.createMulticastLock("kubo-discover");
                    lock.setReferenceCounted(false);
                    lock.acquire();
                }
            } catch (Exception ignored) { lock = null; }
            try {
                List<LanDiscovery.Found> list = LanDiscovery.scan(timeout);
                JSArray arr = new JSArray();
                for (LanDiscovery.Found f : list) {
                    JSObject o = new JSObject();
                    o.put("ip", f.ip);
                    o.put("port", f.port);
                    o.put("name", f.name);
                    arr.put(o);
                }
                JSObject ret = new JSObject();
                ret.put("hosts", arr);
                call.resolve(ret);
            } finally {
                try { if (lock != null && lock.isHeld()) lock.release(); } catch (Exception ignored) { }
            }
        }, "kubo-discover").start();
    }

    /** many frames in ONE bridge call (the host broadcasts every car state) */
    @PluginMethod
    public void sendBatch(PluginCall call) {
        MiniWsServer s = server;
        JSArray items = call.getArray("items");
        if (s != null && items != null) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", null);
                String data = o.optString("data", null);
                if (id != null && data != null) s.send(id, data);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void closeClient(PluginCall call) {
        MiniWsServer s = server;
        String id = call.getString("id");
        if (s != null && id != null) s.closeClient(id);
        call.resolve();
    }

    // ---- socket events -> JS ----
    @Override
    public void onOpen(String id, String remoteAddr) {
        JSObject e = new JSObject();
        e.put("id", id);
        e.put("addr", remoteAddr);
        notifyListeners("open", e);
    }

    @Override
    public void onMessage(String id, String text) {
        JSObject e = new JSObject();
        e.put("id", id);
        e.put("data", text);
        notifyListeners("message", e);
    }

    @Override
    public void onClose(String id) {
        JSObject e = new JSObject();
        e.put("id", id);
        notifyListeners("close", e);
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (this) {
            if (beacon != null) beacon.stop();
            beacon = null;
            if (server != null) server.stop();
            server = null;
        }
        super.handleOnDestroy();
    }

    // ---- addresses ----
    private JSObject ipsResult() {
        // v3.9: THREE independent sources, merged. v3.8 trusted only
        // NetworkInterface; on several ROMs it returned nothing -> no IP shown.
        List<MiniWsServer.Addr> list = MiniWsServer.localAddrs();
        addFromConnectivity(list);                       // Wi-Fi / Ethernet the OS knows about
        if (list.isEmpty()) MiniWsServer.addExtra(list, wifiIp(), "wlan0", "wifi");
        JSArray ips = new JSArray();
        JSArray addrs = new JSArray();
        for (MiniWsServer.Addr a : list) {
            ips.put(a.ip);
            JSObject o = new JSObject();
            o.put("ip", a.ip);
            o.put("iface", a.iface);
            o.put("kind", a.kind);
            addrs.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("ips", ips);
        ret.put("addrs", addrs);
        ret.put("port", server != null ? server.getPort() : 3003);
        ret.put("running", server != null && server.isRunning());
        return ret;
    }

    /** Wi-Fi / Ethernet addresses via ConnectivityManager (never VPN / mobile data) */
    private void addFromConnectivity(List<MiniWsServer.Addr> list) {
        if (Build.VERSION.SDK_INT < 23) return;
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;
            for (Network net : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(net);
                if (nc == null) continue;
                if (nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN) || nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) continue;
                String kind = nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "wifi"
                        : nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? "lan"
                        : nc.hasTransport(NetworkCapabilities.TRANSPORT_USB) ? "usb" : "other";
                LinkProperties lp = cm.getLinkProperties(net);
                if (lp == null) continue;
                for (LinkAddress la : lp.getLinkAddresses()) {
                    if (la.getAddress() instanceof java.net.Inet4Address) {
                        MiniWsServer.addExtra(list, la.getAddress().getHostAddress(), lp.getInterfaceName(), kind);
                    }
                }
            }
        } catch (Throwable ignored) { }
    }

    @SuppressWarnings("deprecation")
    private String wifiIp() {
        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null) return null;
            int ip = wm.getConnectionInfo().getIpAddress();
            if (ip == 0) return null;
            return String.format(Locale.ROOT, "%d.%d.%d.%d", ip & 0xff, ip >> 8 & 0xff, ip >> 16 & 0xff, ip >> 24 & 0xff);
        } catch (Exception e) {
            return null;
        }
    }
}
