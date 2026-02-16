# TerminalSync

> Share your terminal sessions with anyone, anywhere — in real-time.

TerminalSync lets you securely broadcast terminal sessions to mobile devices and web browsers. Perfect for pair programming, debugging, demos, or remote support.

## ✨ Features

- **Real-time terminal sharing** — Stream your shell sessions over WebSocket
- **Mobile app** — View terminals on iOS/Android via React Native/Expo
- **Web UI** — Browser-based terminal viewer
- **Secure by default** — Token-based authentication
- **Automatic tunneling** — Optional cloudflared integration for public access
- **tmux support** — Attach to existing tmux sessions or create new ones
- **Cross-platform** — Works on macOS, Linux, and Windows (WSL)

## 🚀 Quick Start

### Installation

```bash
curl -fsSL https://raw.githubusercontent.com/aleqsio/terminalsync/main/install.sh | bash
```

This installs TerminalSync to `~/.terminalsync` and adds the CLI to your PATH.

### Start Sharing

```bash
terminalsync
```

On first run, TerminalSync will:
1. Generate a secure token
2. Start the local server (default: `localhost:8089`)
3. Optionally create a cloudflared tunnel for remote access
4. Display a QR code to scan with the mobile app

### Connect from Mobile

1. Download the TerminalSync app (link coming soon)
2. Scan the QR code displayed in your terminal
3. Watch your terminal session in real-time!

### Connect from Web

Navigate to the URL shown in the terminal (e.g., `http://localhost:8089` or your tunnel URL).

## 📦 Project Structure

```
terminalsync/
├── app/          # React Native mobile app (Expo)
├── cli/          # Node.js CLI and server
│   ├── src/
│   │   ├── server/    # WebSocket server
│   │   ├── session/   # Terminal session management
│   │   ├── tmux/      # tmux integration
│   │   └── protocol/  # WebSocket protocol
│   └── web-ui/   # Browser-based UI
├── landing/      # Marketing site
└── install.sh    # Installation script
```

## 🛠️ Development

### Prerequisites

- **Node.js** >= 18
- **Git**
- **tmux** (optional, for tmux integration)

### CLI/Server

```bash
cd cli
npm install
npm run dev
```

### Mobile App

```bash
cd app
npm install
npm start
```

Use Expo Go or a development build to run on your device.

### Web UI

```bash
cd cli/web-ui
npm install
npm run dev
```

## ⚙️ Configuration

TerminalSync stores its configuration in `~/.terminalsync/config`:

```bash
TERMINALSYNC_TOKEN=your-secure-token-here
TERMINALSYNC_HOST=0.0.0.0
TERMINALSYNC_PORT=8089
TERMINALSYNC_TUNNEL=true
```

### Environment Variables

All config values can be overridden via environment variables:

```bash
export TERMINALSYNC_TOKEN="your-token"
export TERMINALSYNC_PORT=9000
export TERMINALSYNC_TUNNEL=false
terminalsync
```

## 🔒 Security

- **Token authentication** — All connections require a valid token
- **Local-first** — By default, the server only listens on localhost
- **Opt-in tunneling** — Cloudflared tunnels are optional and can be disabled
- **Read-only by default** — Viewers can only watch; input is disabled (configurable)

⚠️ **Warning:** Only share your terminal with trusted users. Token-based auth is the only protection; anyone with your token can view your terminal.

## 📱 Mobile App Features

- Real-time terminal rendering
- Portrait and landscape support
- Touch-optimized controls
- Connection management
- Multiple session support

## 🌐 Web UI Features

- Full xterm.js terminal emulator
- Responsive design
- Keyboard input support (if enabled)
- Connection status indicators

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

[License info TBD]

## 🙏 Acknowledgments

Built with:
- [node-pty](https://github.com/microsoft/node-pty) — Terminal emulation
- [xterm.js](https://xtermjs.org/) — Web terminal
- [React Native](https://reactnative.dev/) — Mobile UI
- [Expo](https://expo.dev/) — Mobile development platform
- [cloudflared](https://github.com/cloudflare/cloudflared) — Secure tunneling
- [ws](https://github.com/websockets/ws) — WebSocket implementation

---

**Made with ❤️ by [@aleqsio](https://github.com/aleqsio)**
