import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getTerminalHtml } from "../../lib/terminalHtml";
import { saveConnection } from "../../lib/connectionStorage";

export default function TerminalDetailScreen() {
  const { id, name, host, port, token } = useLocalSearchParams<{
    id: string;
    name: string;
    host: string;
    port: string;
    token: string;
  }>();
  const navigation = useNavigation();
  const webviewRef = useRef<WebView>(null);
  const [connStatus, setConnStatus] = useState<string>("connecting");

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name || id,
      headerStyle: { backgroundColor: "#1a1a2e" },
      headerTintColor: "#e0e0e0",
    });
  }, [navigation, name, id]);

  useEffect(() => {
    if (host && port && token) {
      saveConnection({ host, port, token });
    }
  }, [host, port, token]);

  const wsUrl = `ws://${host}:${port}`;
  const html = getTerminalHtml(wsUrl, token ?? "", id ?? "");

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      console.log("[TS] WebView message:", msg);
      if (msg.type === "status") {
        setConnStatus(msg.status);
      } else if (msg.type === "error") {
        console.error("[TS] WebView error:", msg.message);
      }
    } catch {}
  }, []);

  const sendToWebView = useCallback((data: string) => {
    const msg = JSON.stringify({ type: "input", data });
    webviewRef.current?.postMessage(msg);
  }, []);

  const isAttached = connStatus === "attached";

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      {!isAttached && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {connStatus === "connecting"
              ? `Connecting to ${host}:${port}...`
              : connStatus === "connected"
              ? "Attaching to session..."
              : connStatus === "disconnected"
              ? "Disconnected"
              : connStatus === "error"
              ? "Connection error"
              : connStatus}
          </Text>
        </View>
      )}

      <WebView
        ref={webviewRef}
        source={{ html }}
        style={styles.webview}
        originWhitelist={["*"]}
        javaScriptEnabled
        onMessage={onMessage}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        textInteractionEnabled={false}
        keyboardDisplayRequiresUserAction={false}
      />

      <View style={styles.quickKeys}>
        {["Tab", "Esc", "Ctrl+C", "Ctrl+D", "Up", "Down"].map((label) => (
          <Pressable
            key={label}
            style={styles.quickKey}
            onPress={() => {
              const keyMap: Record<string, string> = {
                Tab: "\t",
                Esc: "\x1b",
                "Ctrl+C": "\x03",
                "Ctrl+D": "\x04",
                Up: "\x1b[A",
                Down: "\x1b[B",
              };
              sendToWebView(keyMap[label]);
            }}
          >
            <Text style={styles.quickKeyText}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f1a",
  },
  banner: {
    backgroundColor: "#e94560",
    paddingVertical: 6,
    alignItems: "center",
  },
  bannerText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  webview: {
    flex: 1,
    backgroundColor: "#0f0f1a",
  },
  quickKeys: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2a2a40",
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "#1a1a2e",
    gap: 6,
    paddingBottom: Platform.OS === "ios" ? 28 : 6,
  },
  quickKey: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#2a2a40",
    borderRadius: 6,
  },
  quickKeyText: {
    color: "#aaa",
    fontSize: 12,
    fontWeight: "500",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
