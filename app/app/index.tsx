import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadConnection, type ConnectionInfo } from "../lib/connectionStorage";
import { useTerminalSyncContext } from "../lib/TerminalSyncContext";

export default function HomeScreen() {
  const router = useRouter();
  const { status, sessions, connect, disconnect } = useTerminalSyncContext();
  const [savedConn, setSavedConn] = useState<ConnectionInfo | null>(null);

  useFocusEffect(
    useCallback(() => {
      const conn = loadConnection();
      setSavedConn(conn);
      if (conn && status === "disconnected") {
        connect(`ws://${conn.host}:${conn.port}`, conn.token);
      }
      return () => {
        if (status !== "disconnected") disconnect();
      };
    }, [status])
  );

  if (!savedConn) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.centered}>
          <Text style={styles.title}>TerminalSync</Text>
          <Text style={styles.subtitle}>
            Open a deep link to connect to a terminal session.
          </Text>
          <Text style={styles.example}>
            terminalsync://terminal/SESSION_ID{"\n"}
            ?host=IP&port=PORT&token=TOKEN
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>TerminalSync</Text>
        <Text style={styles.serverInfo}>
          {savedConn.host}:{savedConn.port}
        </Text>
        {status === "connecting" && (
          <ActivityIndicator
            color="#4a9eff"
            size="small"
            style={{ marginTop: 8 }}
          />
        )}
        {status === "disconnected" && (
          <Text style={styles.errorText}>Disconnected</Text>
        )}
      </View>

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.sessionRow}
            onPress={() =>
              router.push({
                pathname: "/terminal/[id]",
                params: {
                  id: item.id,
                  name: item.name,
                  host: savedConn.host,
                  port: savedConn.port,
                  token: savedConn.token,
                },
              })
            }
          >
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionName}>{item.name || item.id}</Text>
              <Text style={styles.sessionMeta}>
                {item.source} · {item.status} ·{" "}
                {item.attachedClients} client
                {item.attachedClients !== 1 ? "s" : ""}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          status === "connected" ? (
            <Text style={styles.emptyText}>No sessions available</Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f1a",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  header: {
    padding: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#e0e0e0",
    marginBottom: 4,
  },
  serverInfo: {
    fontSize: 14,
    color: "#4a9eff",
    fontFamily: "Menlo",
  },
  errorText: {
    fontSize: 13,
    color: "#e94560",
    marginTop: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    textAlign: "center",
    marginBottom: 20,
  },
  example: {
    fontFamily: "Menlo",
    fontSize: 12,
    color: "#4a9eff",
    textAlign: "center",
    backgroundColor: "#1a1a2e",
    padding: 16,
    borderRadius: 8,
    overflow: "hidden",
  },
  list: {
    paddingHorizontal: 16,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#e0e0e0",
    fontFamily: "Menlo",
  },
  sessionMeta: {
    fontSize: 12,
    color: "#888",
    marginTop: 4,
  },
  chevron: {
    fontSize: 22,
    color: "#555",
    marginLeft: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#555",
    textAlign: "center",
    marginTop: 32,
  },
});
