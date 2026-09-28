package com.kubo.karts.lan;

// KUBO KARTS v3.7 - tiny dependency-free WebSocket server (RFC 6455) for the
// HOST PHONE. It only moves text frames; the room logic runs in the game's JS
// (src/game/net/room-core.ts). Pure Java (no android.* imports) so it is unit
// testable on a PC.

import java.io.BufferedInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

public class MiniWsServer {

    public interface Listener {
        void onOpen(String id, String remoteAddr);
        void onMessage(String id, String text);
        void onClose(String id);
    }

    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_FRAME = 1 << 20;     // 1 MB (game frames are < 2 KB)
    private static final int MAX_QUEUE = 2000;        // a peer this far behind is dead
    private static final int IDLE_MS = 20000;         // clients ping every 2 s
    private static final int MAX_CLIENTS = 16;

    private final int port;
    private final Listener listener;
    private final Map<String, Client> clients = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();
    private volatile ServerSocket serverSocket;
    private volatile boolean running;

    public MiniWsServer(int port, Listener listener) {
        this.port = port;
        this.listener = listener;
    }

    public int getPort() { return port; }
    public boolean isRunning() { return running; }
    public int clientCount() { return clients.size(); }

    public synchronized void start() throws IOException {
        if (running) return;
        ServerSocket ss = new ServerSocket();
        ss.setReuseAddress(true);
        ss.bind(new InetSocketAddress(port));
        serverSocket = ss;
        running = true;
        Thread t = new Thread(this::acceptLoop, "kubo-ws-accept");
        t.setDaemon(true);
        t.start();
    }

    public synchronized void stop() {
        running = false;
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) { }
        serverSocket = null;
        for (Client c : clients.values()) c.close();
        clients.clear();
    }

    public void send(String id, String text) {
        Client c = clients.get(id);
        if (c != null) c.enqueue(text);
    }

    public void closeClient(String id) {
        Client c = clients.get(id);
        if (c != null) c.close();
    }

    // ------------------------------------------------------------------ accept
    private void acceptLoop() {
        ServerSocket ss = serverSocket;
        while (running && ss != null && !ss.isClosed()) {
            try {
                final Socket s = ss.accept();
                Thread t = new Thread(() -> handle(s), "kubo-ws-client");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (!running) break;
            }
        }
    }

    private void handle(Socket s) {
        Client c = null;
        try {
            s.setTcpNoDelay(true);
            s.setSoTimeout(IDLE_MS);
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            String head = readHead(in);
            if (head == null) { s.close(); return; }
            String key = header(head, "sec-websocket-key");
            String upgrade = header(head, "upgrade");
            if (key == null || upgrade == null || !upgrade.toLowerCase(Locale.ROOT).contains("websocket")) {
                // plain HTTP (e.g. a browser opening http://<ip>:3003) -> health text
                byte[] body = "KUBO KARTS server OK\n".getBytes(StandardCharsets.UTF_8);
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: " + body.length
                        + "\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                out.write(body);
                out.flush();
                s.close();
                return;
            }
            if (clients.size() >= MAX_CLIENTS) {
                out.write("HTTP/1.1 503 Busy\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                out.flush();
                s.close();
                return;
            }
            String accept = Base64Lite.encode(sha1((key.trim() + GUID).getBytes(StandardCharsets.US_ASCII)));
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                    + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            out.flush();

            String id = "a" + seq.incrementAndGet() + "_" + Long.toString(System.nanoTime() & 0xffffff, 36);
            c = new Client(id, s, out);
            clients.put(id, c);
            c.startWriter();
            String addr = s.getInetAddress() != null ? s.getInetAddress().getHostAddress() : "";
            listener.onOpen(id, addr);
            readLoop(c, in);
        } catch (Exception ignored) {
            // timeout / reset / bad frame -> fall through to close
        } finally {
            if (c != null) c.close();
            else { try { s.close(); } catch (IOException ignored) { } }
        }
    }

    private void readLoop(Client c, InputStream in) throws IOException {
        java.io.ByteArrayOutputStream msg = new java.io.ByteArrayOutputStream();
        boolean inText = false;
        while (!c.closed.get()) {
            int b0 = in.read();
            if (b0 < 0) return;
            int b1 = readByte(in);
            boolean fin = (b0 & 0x80) != 0;
            int op = b0 & 0x0F;
            boolean masked = (b1 & 0x80) != 0;
            long len = b1 & 0x7F;
            if (len == 126) len = ((readByte(in) << 8) | readByte(in));
            else if (len == 127) {
                len = 0;
                for (int i = 0; i < 8; i++) len = (len << 8) | readByte(in);
            }
            if (len < 0 || len > MAX_FRAME) return;
            byte[] mask = null;
            if (masked) { mask = new byte[4]; readFully(in, mask); }
            byte[] payload = new byte[(int) len];
            readFully(in, payload);
            if (mask != null) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

            switch (op) {
                case 0x8: // close
                    c.sendControl(0x8, new byte[0]);
                    return;
                case 0x9: // ping -> pong
                    c.sendControl(0xA, payload);
                    break;
                case 0xA: // pong
                    break;
                case 0x1: // text
                    msg.reset();
                    inText = true;
                    // fall through
                case 0x0: // continuation
                    if (!inText) break;
                    msg.write(payload, 0, payload.length);
                    if (msg.size() > MAX_FRAME) return;
                    if (fin) {
                        inText = false;
                        listener.onMessage(c.id, new String(msg.toByteArray(), StandardCharsets.UTF_8));
                    }
                    break;
                default: // binary / unknown: ignore
                    break;
            }
        }
    }

    // ------------------------------------------------------------------ per client
    private final class Client {
        final String id;
        final Socket socket;
        final OutputStream out;
        final LinkedBlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
        final AtomicBoolean closed = new AtomicBoolean(false);

        Client(String id, Socket socket, OutputStream out) {
            this.id = id; this.socket = socket; this.out = out;
        }

        void startWriter() {
            Thread t = new Thread(() -> {
                try {
                    while (!closed.get()) {
                        byte[] f = queue.poll(1, TimeUnit.SECONDS);
                        if (f == null) continue;
                        synchronized (out) { out.write(f); }
                        if (queue.isEmpty()) synchronized (out) { out.flush(); }
                    }
                } catch (Exception e) {
                    close();
                }
            }, "kubo-ws-writer");
            t.setDaemon(true);
            t.start();
        }

        void enqueue(String text) {
            if (closed.get()) return;
            if (queue.size() > MAX_QUEUE) { close(); return; }
            queue.offer(frame(0x1, text.getBytes(StandardCharsets.UTF_8)));
        }

        void sendControl(int op, byte[] payload) {
            try {
                synchronized (out) { out.write(frame(op, payload)); out.flush(); }
            } catch (IOException ignored) { }
        }

        void close() {
            if (!closed.compareAndSet(false, true)) return;
            clients.remove(id, this);
            // no close frame here: a stuck writer could block the caller (the JS
            // bridge thread). Closing the TCP socket is enough for the client.
            try { socket.close(); } catch (IOException ignored) { }
            try { listener.onClose(id); } catch (Exception ignored) { }
        }
    }

    // ------------------------------------------------------------------ helpers
    static byte[] frame(int op, byte[] payload) {
        int len = payload.length;
        int hl = len < 126 ? 2 : (len < 65536 ? 4 : 10);
        byte[] f = new byte[hl + len];
        f[0] = (byte) (0x80 | op);
        if (len < 126) f[1] = (byte) len;
        else if (len < 65536) { f[1] = 126; f[2] = (byte) (len >>> 8); f[3] = (byte) len; }
        else { f[1] = 127; long L = len; for (int i = 0; i < 8; i++) f[9 - i] = (byte) (L >>> (8 * i)); }
        System.arraycopy(payload, 0, f, hl, len);
        return f;
    }

    private static String readHead(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int state = 0;
        while (sb.length() < 8192) {
            int b = in.read();
            if (b < 0) return null;
            sb.append((char) b);
            if (b == '\r' && (state == 0 || state == 2)) state++;
            else if (b == '\n' && (state == 1 || state == 3)) { state++; if (state == 4) return sb.toString(); }
            else state = 0;
        }
        return null;
    }

    private static String header(String head, String name) {
        for (String line : head.split("\r\n")) {
            int i = line.indexOf(':');
            if (i > 0 && line.substring(0, i).trim().equalsIgnoreCase(name)) return line.substring(i + 1).trim();
        }
        return null;
    }

    private static int readByte(InputStream in) throws IOException {
        int b = in.read();
        if (b < 0) throw new EOFException();
        return b;
    }

    private static void readFully(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n < 0) throw new EOFException();
            off += n;
        }
    }

    private static byte[] sha1(byte[] data) {
        try { return MessageDigest.getInstance("SHA-1").digest(data); }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    /** java.util.Base64 needs API 26; Capacitor supports API 23 -> tiny encoder */
    static final class Base64Lite {
        private static final char[] T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
        static String encode(byte[] d) {
            StringBuilder sb = new StringBuilder((d.length + 2) / 3 * 4);
            for (int i = 0; i < d.length; i += 3) {
                int b = (d[i] & 0xff) << 16 | (i + 1 < d.length ? (d[i + 1] & 0xff) << 8 : 0) | (i + 2 < d.length ? (d[i + 2] & 0xff) : 0);
                sb.append(T[b >>> 18 & 63]).append(T[b >>> 12 & 63]);
                sb.append(i + 1 < d.length ? T[b >>> 6 & 63] : '=');
                sb.append(i + 2 < d.length ? T[b & 63] : '=');
            }
            return sb.toString();
        }
    }

    // ------------------------------------------------------------------ network info
    /** v3.8: one usable IPv4 address of this phone.
     *  kind = "wifi" | "hotspot" | "usb" | "lan" | "other". VPN tunnels (tun/ppp)
     *  and mobile-data radios (rmnet/ccmni...) are NEVER returned: their 10.x
     *  addresses looked "private" and were shown to friends as the server IP,
     *  which nobody on the Wi-Fi/hotspot can reach. */
    public static final class Addr {
        public final String ip, iface, kind, broadcast;
        Addr(String ip, String iface, String kind, String broadcast) {
            this.ip = ip; this.iface = iface; this.kind = kind; this.broadcast = broadcast;
        }
    }

    static String kindOf(String n) {
        if (n.startsWith("tun") || n.startsWith("ppp") || n.startsWith("ipsec") || n.startsWith("wg")
                || n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("pdp") || n.startsWith("v4-")
                || n.startsWith("clat") || n.startsWith("dummy") || n.startsWith("lo") || n.startsWith("ifb")
                || n.startsWith("sit") || n.startsWith("ip6") || n.startsWith("gre") || n.startsWith("seth")
                || n.startsWith("usb0_rmnet") || n.startsWith("r_rmnet") || n.startsWith("rev_rmnet")) return null;
        if (n.startsWith("ap") || n.startsWith("swlan") || n.startsWith("softap") || n.startsWith("wigig")
                || n.equals("wlan1") || n.equals("wlan2") || n.startsWith("p2p")) return "hotspot";
        if (n.startsWith("wlan") || n.contains("wifi")) return "wifi";
        if (n.startsWith("rndis") || n.startsWith("ncm") || n.startsWith("usb")) return "usb";
        if (n.startsWith("eth") || n.startsWith("bt-pan") || n.startsWith("bnep")) return "lan";
        return "other";
    }

    static boolean isPrivate(String ip) {
        return ip.startsWith("192.168.") || ip.startsWith("10.")
                || ip.matches("^172\\.(1[6-9]|2\\d|3[01])\\..*");
    }

    public static java.util.List<Addr> localAddrs() {
        java.util.List<Addr> out = new java.util.ArrayList<>();
        // v3.9: pass 1 = strict (interface is UP), pass 2 = relaxed. Some ROMs
        // (Xiaomi/Samsung/Huawei hotspot, Android 11+) report the hotspot
        // interface as "not up" or throw on isUp() although it has a working
        // address -> v3.8 returned an EMPTY list and the lobby showed no IP.
        collect(out, true);
        if (out.isEmpty()) collect(out, false);
        // hotspot first (the host's own network), then Wi-Fi, USB, LAN, other
        final java.util.List<String> order = java.util.Arrays.asList("hotspot", "wifi", "usb", "lan", "other");
        java.util.Collections.sort(out, (x, y) -> order.indexOf(x.kind) - order.indexOf(y.kind));
        return out;
    }

    private static void collect(java.util.List<Addr> out, boolean strict) {
        try {
            java.util.Enumeration<java.net.NetworkInterface> ifs = java.net.NetworkInterface.getNetworkInterfaces();
            if (ifs == null) return;
            for (java.net.NetworkInterface ni : java.util.Collections.list(ifs)) {
                try {
                    if (ni.isLoopback()) continue;
                    if (strict && !ni.isUp()) continue;
                } catch (Throwable e) { if (strict) continue; }
                String n = ni.getName() == null ? "" : ni.getName().toLowerCase(Locale.ROOT);
                String kind = kindOf(n);
                if (kind == null) continue;
                // getInetAddresses() works on ROMs where getInterfaceAddresses() is empty
                java.util.List<java.net.InterfaceAddress> ias = null;
                try { ias = ni.getInterfaceAddresses(); } catch (Throwable ignored) { }
                if (ias != null && !ias.isEmpty()) {
                    for (java.net.InterfaceAddress ia : ias) {
                        if (ia == null) continue;
                        java.net.InetAddress b = null;
                        try { b = ia.getBroadcast(); } catch (Throwable ignored) { }
                        add(out, ia.getAddress(), n, kind, b == null ? null : b.getHostAddress());
                    }
                } else {
                    for (java.net.InetAddress a : java.util.Collections.list(ni.getInetAddresses())) add(out, a, n, kind, null);
                }
            }
        } catch (Throwable ignored) { }
    }

    private static void add(java.util.List<Addr> out, java.net.InetAddress a, String n, String kind, String bcast) {
        if (!(a instanceof java.net.Inet4Address) || a.isLoopbackAddress() || a.isLinkLocalAddress()) return;
        String ip = a.getHostAddress();
        if (ip == null || !isPrivate(ip)) return;           // public / CGNAT = not reachable on a LAN
        for (Addr x : out) if (x.ip.equals(ip)) return;
        out.add(new Addr(ip, n, kind, bcast));
    }

    /** v3.9: add an address found by another API (ConnectivityManager / WifiManager) */
    public static void addExtra(java.util.List<Addr> out, String ip, String iface, String kind) {
        if (ip == null || !isPrivate(ip)) return;
        for (Addr x : out) if (x.ip.equals(ip)) return;
        out.add(new Addr(ip, iface == null ? "" : iface, kind, null));
    }

    /** IPv4 addresses friends can actually reach, best first. */
    public static java.util.List<String> localIps() {
        java.util.List<String> ips = new java.util.ArrayList<>();
        for (Addr a : localAddrs()) if (!ips.contains(a.ip)) ips.add(a.ip);
        return ips;
    }
}
