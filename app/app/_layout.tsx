import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { TerminalSyncProvider } from "../lib/TerminalSyncContext";

// Ensure the list screen (index) is always at the bottom of the stack,
// even when the app is opened via a deep link.
export const unstable_settings = {
  initialRouteName: "index",
};

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <TerminalSyncProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#1a1a2e" },
            headerTintColor: "#e0e0e0",
            contentStyle: { backgroundColor: "#0f0f1a" },
          }}
        />
      </TerminalSyncProvider>
    </KeyboardProvider>
  );
}
