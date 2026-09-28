package com.kubo.karts.lan;

// KUBO KARTS v3.8 - automatic server discovery on Wi-Fi / hotspot (no typing IPs).
// HOST : Beacon broadcasts a tiny UDP packet every second on port 3004
//        ("KUBO1|<port>|<room name>") to every LAN interface broadcast address.
// JOIN : scan() listens on 3004 for a moment and returns every host it heard;
//        the host IP is taken from the packet SOURCE, so it is always the
//        address that actually reached this phone.
// Pure Java (no android.* imports) so it can be tested on a PC.

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class LanDiscovery {

    public static final int PORT = 3004;
    private static final String MAGIC = "KUBO1";

    private LanDiscovery() { }

    public static final class Found {
        public final String ip; public final int port; public final String name;
        Found(String ip, int port, String name) { this.ip = ip; this.port = port; this.name = name; }
    }

    // ------------------------------------------------------------------ host side
    public static final class Beacon {
        private volatile boolean running;
        private volatile String name = "KUBO";
        private final int gamePort;
        private Thread thread;

        public Beacon(int gamePort) { this.gamePort = gamePort; }

        public void setName(String n) { if (n != null) name = n.replace('|', ' ').trim(); }

        public synchronized void start() {
            if (running) return;
            running = true;
            thread = new Thread(this::loop, "kubo-beacon");
            thread.setDaemon(true);
            thread.start();
        }

        public synchronized void stop() {
            running = false;
            if (thread != null) thread.interrupt();
            thread = null;
        }

        private void loop() {
            DatagramSocket sock = null;
            try {
                sock = new DatagramSocket();
                sock.setBroadcast(true);
                while (running) {
                    String n = name;
                    if (n.length() > 24) n = n.substring(0, 24);
                    byte[] msg = (MAGIC + "|" + gamePort + "|" + n).getBytes(StandardCharsets.UTF_8);
                    List<String> targets = new ArrayList<>();
                    for (MiniWsServer.Addr a : MiniWsServer.localAddrs()) {
                        if (a.broadcast != null && !targets.contains(a.broadcast)) targets.add(a.broadcast);
                    }
                    targets.add("255.255.255.255");
                    for (String t : targets) {
                        try { sock.send(new DatagramPacket(msg, msg.length, InetAddress.getByName(t), PORT)); }
                        catch (Exception ignored) { /* interface went away */ }
                    }
                    try { Thread.sleep(1000); } catch (InterruptedException e) { break; }
                }
            } catch (Exception ignored) {
            } finally {
                if (sock != null) sock.close();
            }
        }
    }

    // ------------------------------------------------------------------ joiner side
    /** listen for beacons for up to timeoutMs; returns unique hosts (own IPs excluded) */
    public static List<Found> scan(int timeoutMs) {
        Map<String, Found> found = new LinkedHashMap<>();
        List<String> own = MiniWsServer.localIps();
        DatagramSocket sock = null;
        try {
            sock = new DatagramSocket(null);
            sock.setReuseAddress(true);
            sock.setBroadcast(true);
            sock.bind(new InetSocketAddress(PORT));
            long end = System.currentTimeMillis() + Math.max(300, timeoutMs);
            byte[] buf = new byte[256];
            while (true) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) break;
                sock.setSoTimeout((int) Math.max(1, left));
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try { sock.receive(p); } catch (SocketTimeoutException e) { break; }
                String txt = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                String[] parts = txt.split("\\|", 3);
                if (parts.length < 2 || !MAGIC.equals(parts[0])) continue;
                String ip = p.getAddress().getHostAddress();
                if (own.contains(ip)) continue;
                int port;
                try { port = Integer.parseInt(parts[1]); } catch (NumberFormatException e) { continue; }
                found.put(ip + ":" + port, new Found(ip, port, parts.length > 2 ? parts[2] : ""));
            }
        } catch (Exception ignored) {
        } finally {
            if (sock != null) sock.close();
        }
        return new ArrayList<>(found.values());
    }
}
