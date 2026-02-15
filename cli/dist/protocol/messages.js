// --- Shared types ---
export function parseClientMessage(data) {
    const msg = JSON.parse(data);
    if (!msg.type || typeof msg.seq !== "number") {
        throw new Error("Invalid message: missing type or seq");
    }
    switch (msg.type) {
        case "list_sessions":
        case "create_session":
        case "attach":
        case "input":
        case "resize":
        case "detach":
            return msg;
        default:
            throw new Error(`Unknown message type: ${msg.type}`);
    }
}
//# sourceMappingURL=messages.js.map